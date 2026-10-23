#!/usr/bin/env bash
# Review lane: takes one card labelled `review`, runs the merge gate on
# (current main + PR head), has an agent review the diff, and merges only if
# everything passes and --merge was given.
# Usage: bash scripts/review.sh [--dry-run] [--merge] [issue-number]
set -euo pipefail

DRY_RUN=0
DO_MERGE=0
ISSUE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --merge) DO_MERGE=1 ;;
    ''|*[!0-9]*) echo "usage: review.sh [--dry-run] [--merge] [issue-number]" >&2; exit 64 ;;
    *) ISSUE="$arg" ;;
  esac
done

SOLUTION="BlazorEmployeeManagement.sln"
MAX_TURNS=20

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
LOCK="$ROOT/.git/mini-board.lock"
LOG_DIR="$ROOT/.git/mini-board-logs"
WT_ROOT="$(dirname "$ROOT")/mini-board-worktrees"
PROMPT_FILE="$ROOT/prompts/review.md"
WT=""

say() { printf '==> %s\n' "$*"; }
# act: run a command, or only print it in --dry-run mode.
act() {
  if (( DRY_RUN )); then
    printf '[dry-run]'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

# --- preflight ---------------------------------------------------------------
for cmd in git gh claude dotnet; do
  command -v "$cmd" >/dev/null || { echo "missing tool: $cmd" >&2; exit 69; }
done
[ -f "$PROMPT_FILE" ] || { echo "missing file: $PROMPT_FILE" >&2; exit 66; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in" >&2; exit 69; }

mkdir -p "$LOG_DIR"
mkdir "$LOCK" 2>/dev/null || { echo "another run holds $LOCK" >&2; exit 75; }
cleanup() {
  rmdir "$LOCK" 2>/dev/null || true
  if (( ! DRY_RUN )) && [ -n "$WT" ] && [ -d "$WT" ]; then
    git worktree remove --force "$WT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- pick --------------------------------------------------------------------
if [ -z "$ISSUE" ]; then
  ISSUE="$(gh issue list --label review --state open --json number \
    --jq 'sort_by(.number) | .[0].number // empty')"
  [ -n "$ISSUE" ] || { echo "no open issue labelled review"; exit 0; }
fi

LABELS="$(gh issue view "$ISSUE" --json labels --jq '.labels[].name')"
grep -qx review <<<"$LABELS" || { echo "issue #$ISSUE is not labelled review" >&2; exit 65; }

TITLE="$(gh issue view "$ISSUE" --json title --jq .title)"
BODY="$(gh issue view "$ISSUE" --json body --jq .body)"

BRANCH="issue-$ISSUE"
PR="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
[ -n "$PR" ] || { echo "no open PR for branch $BRANCH" >&2; exit 65; }

git fetch -q origin main "$BRANCH"
SHA="$(git rev-parse "origin/$BRANCH")"
BASE="$(git rev-parse origin/main)"
SHORT="${SHA:0:7}"
say "review #$ISSUE (PR #$PR) head $SHORT onto main ${BASE:0:7}: $TITLE"

LOG="$LOG_DIR/review-$BRANCH.log"
AGENT_OUT="$LOG_DIR/review-$BRANCH.agent.txt"

# --- verdict helpers ---------------------------------------------------------
to_qa() { # $1 = why
  say "back to qa: $1"
  act gh issue edit "$ISSUE" --remove-label review --add-label qa
  act gh pr comment "$PR" --body "$(printf '[review] back to qa at %s\n%s\nNext: qa reruns on the new commit.' "$SHORT" "$1")"
  exit 1
}

send_back() { # $1 = reasons text
  say "REQUEST CHANGES -> building"
  act gh issue edit "$ISSUE" --remove-label review --add-label building
  act gh pr comment "$PR" --body "$(printf '[review] changes requested at %s\nDid: merge gate, agent review.\n❌ Not done:\n%s\nNext: back to building.' "$SHORT" "$1")"
  exit 1
}

inconclusive() { # $1 = why
  say "INCONCLUSIVE: $1 (card stays in review)"
  act gh pr comment "$PR" --body "$(printf '[review] inconclusive at %s\n%s\nNext: card stays in review, rerun scripts/review.sh.' "$SHORT" "$1")"
  exit 2
}

# --- the PR must be what QA passed -------------------------------------------
QA_SHORT="$(gh pr view "$PR" --json comments --jq '.comments[].body' \
  | tr -d '\r' | sed -n 's/^\[qa\] pass at \([0-9a-f]*\).*/\1/p' | tail -1 || true)"
[ -n "$QA_SHORT" ] || to_qa "no [qa] pass comment found on this PR"
case "$SHA" in
  "$QA_SHORT"*) ;;
  *) to_qa "PR head is $SHORT but qa passed $QA_SHORT" ;;
esac

# --- dry run stops here ------------------------------------------------------
if (( DRY_RUN )); then
  say "dry-run: qa passed $QA_SHORT, matches head"
  say "dry-run: would merge $SHORT into main ${BASE:0:7} in $WT_ROOT/review-$BRANCH, build + test, then run claude -p read-only (max $MAX_TURNS turns)"
  say "dry-run: approve + --merge -> merge, review -> done; changes -> review -> building"
  act gh issue edit "$ISSUE" --remove-label review --add-label done
  act gh issue edit "$ISSUE" --remove-label review --add-label building
  exit 0
fi

# --- merge gate (script, no AI) ----------------------------------------------
WT="$WT_ROOT/review-$BRANCH"
mkdir -p "$WT_ROOT"
git worktree add --detach "$WT" "$BASE" >/dev/null

GATE_OK=1
GATE_NOTE=""
say "merge gate: main + PR head, build + test"
if ! ( cd "$WT" && git merge --no-commit --no-ff "$SHA" ) >"$LOG" 2>&1; then
  GATE_OK=0; GATE_NOTE="merge conflict with main"
elif ! ( cd "$WT" && dotnet build "$SOLUTION" --nologo -v q ) >>"$LOG" 2>&1; then
  GATE_OK=0; GATE_NOTE="dotnet build failed on main + PR"
elif ! ( cd "$WT" && dotnet test "$SOLUTION" --nologo -v q --no-build ) >>"$LOG" 2>&1; then
  GATE_OK=0; GATE_NOTE="dotnet test failed on main + PR"
fi

# --- agent review (read-only) ------------------------------------------------
PROMPT="$(cat "$PROMPT_FILE"; printf '\n\nCommit under review: %s\nBase: origin/main\n\n## Issue #%s: %s\n\n%s\n' "$SHA" "$ISSUE" "$TITLE" "$BODY")"
say "review agent running; log: $AGENT_OUT"
( cd "$WT" && claude -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --allowedTools "Read" "Glob" "Grep" \
      "Bash(git diff:*)" "Bash(git log:*)" "Bash(git status:*)" "Bash(dotnet:*)"
) >"$AGENT_OUT" 2>>"$LOG" || inconclusive "review agent exited with an error"

# --- staleness checks --------------------------------------------------------
git fetch -q origin main "$BRANCH"
[ "$(git rev-parse origin/main)" = "$BASE" ] || inconclusive "main moved while review ran"
[ "$(git rev-parse "origin/$BRANCH")" = "$SHA" ] || inconclusive "PR head moved while review ran"

# --- decide ------------------------------------------------------------------
VERDICT="$(tr -d '\r' <"$AGENT_OUT" | grep -E '^VERDICT: (APPROVE|REQUEST_CHANGES)$' | tail -1 | cut -d' ' -f2 || true)"
REASONS="$(tr -d '\r' <"$AGENT_OUT" | sed -n 's/^REASON: /- /p' | head -5 | cut -c1-300 || true)"
[ -n "$VERDICT" ] || inconclusive "agent gave no VERDICT line"

if (( ! GATE_OK )); then
  send_back "- $GATE_NOTE
$REASONS"
fi
if [ "$VERDICT" = "REQUEST_CHANGES" ]; then
  send_back "$REASONS"
fi

# --- approved ----------------------------------------------------------------
if (( ! DO_MERGE )); then
  say "approved, not merged (rerun with --merge to merge)"
  act gh pr comment "$PR" --body "$(printf '[review] approved at %s\nDid: merge gate (main + PR), agent review.\n✅ Done:\n%s\nNext: not merged, rerun with --merge.' "$SHORT" "$REASONS")"
  exit 0
fi

say "merge PR #$PR (squash, pinned to $SHORT)"
if [ "$(gh pr view "$PR" --json isDraft --jq .isDraft)" = "true" ]; then
  act gh pr ready "$PR"
fi
act gh pr merge "$PR" --squash --match-head-commit "$SHA" || inconclusive "GitHub refused the merge"

act gh issue edit "$ISSUE" --remove-label review --add-label done
act gh pr comment "$PR" --body "$(printf '[review] merged at %s\nDid: merge gate (main + PR), agent review, squash merge pinned to this commit.\n✅ Done:\n%s\nNext: none.' "$SHORT" "$REASONS")"

# --- tidy up the builder's leftovers -----------------------------------------
BUILD_WT="$WT_ROOT/$BRANCH"
if [ -d "$BUILD_WT" ]; then act git worktree remove --force "$BUILD_WT" || true; fi
act git branch -D "$BRANCH" || true
act git push origin --delete "$BRANCH" || true
say "done: PR #$PR merged. Run 'git pull' on main to get it."