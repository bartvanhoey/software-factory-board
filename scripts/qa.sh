#!/usr/bin/env bash
# QA lane: takes one card labelled `qa`, tests its PR branch in a throwaway
# worktree, then moves the card to `review` (pass) or back to `building` (fail).
# Usage: bash scripts/qa.sh [--dry-run] [issue-number]
set -euo pipefail

DRY_RUN=0
ISSUE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    ''|*[!0-9]*) echo "usage: qa.sh [--dry-run] [issue-number]" >&2; exit 64 ;;
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
PROMPT_FILE="$ROOT/prompts/qa.md"
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
  ISSUE="$(gh issue list --label qa --state open --json number \
    --jq 'sort_by(.number) | .[0].number // empty')"
  [ -n "$ISSUE" ] || { echo "no open issue labelled qa"; exit 0; }
fi

LABELS="$(gh issue view "$ISSUE" --json labels --jq '.labels[].name')"
grep -qx qa <<<"$LABELS" || { echo "issue #$ISSUE is not labelled qa" >&2; exit 65; }

TITLE="$(gh issue view "$ISSUE" --json title --jq .title)"
BODY="$(gh issue view "$ISSUE" --json body --jq .body)"

BRANCH="issue-$ISSUE"
PR="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
[ -n "$PR" ] || { echo "no open PR for branch $BRANCH" >&2; exit 65; }

git fetch -q origin "$BRANCH"
SHA="$(git rev-parse "origin/$BRANCH")"
SHORT="${SHA:0:7}"
say "qa #$ISSUE (PR #$PR) at commit $SHORT: $TITLE"

LOG="$LOG_DIR/qa-$BRANCH.log"
AGENT_OUT="$LOG_DIR/qa-$BRANCH.agent.txt"

# --- verdict helpers ---------------------------------------------------------
send_back() { # $1 = reasons text
  say "FAIL -> building"
  act gh issue edit "$ISSUE" --remove-label qa --add-label building
  act gh pr comment "$PR" --body "$(printf '[qa] fail at %s\nDid: build, test, agent review.\n❌ Not done:\n%s\nNext: back to building.' "$SHORT" "$1")"
  exit 1
}

inconclusive() { # $1 = why
  say "INCONCLUSIVE: $1 (card stays in qa)"
  act gh pr comment "$PR" --body "$(printf '[qa] inconclusive at %s\n%s\nNext: card stays in qa, rerun scripts/qa.sh.' "$SHORT" "$1")"
  exit 2
}

# --- dry run stops here ------------------------------------------------------
if (( DRY_RUN )); then
  say "dry-run: would build + test $SHORT in $WT_ROOT/qa-$BRANCH, then run claude -p read-only (max $MAX_TURNS turns)"
  say "dry-run: pass -> qa -> review, fail -> qa -> building"
  act gh issue edit "$ISSUE" --remove-label qa --add-label review
  act gh issue edit "$ISSUE" --remove-label qa --add-label building
  exit 0
fi

# --- isolate -----------------------------------------------------------------
WT="$WT_ROOT/qa-$BRANCH"
mkdir -p "$WT_ROOT"
git worktree add --detach "$WT" "$SHA" >/dev/null

# --- mechanical checks (script, no AI) ---------------------------------------
CHECKS_OK=1
CHECK_NOTE=""
say "dotnet build + test"
if ! ( cd "$WT" && dotnet build "$SOLUTION" --nologo -v q ) >"$LOG" 2>&1; then
  CHECKS_OK=0; CHECK_NOTE="dotnet build failed"
elif ! ( cd "$WT" && dotnet test "$SOLUTION" --nologo -v q --no-build ) >>"$LOG" 2>&1; then
  CHECKS_OK=0; CHECK_NOTE="dotnet test failed"
fi

# --- agent review (read-only) ------------------------------------------------
PROMPT="$(cat "$PROMPT_FILE"; printf '\n\n## Issue #%s: %s\n\n%s\n' "$ISSUE" "$TITLE" "$BODY")"
say "qa agent running; log: $AGENT_OUT"
( cd "$WT" && claude -p "$PROMPT" \
    --max-turns "$MAX_TURNS" \
    --allowedTools "Read" "Glob" "Grep" \
      "Bash(git diff:*)" "Bash(git log:*)" "Bash(git status:*)" "Bash(dotnet:*)"
) >"$AGENT_OUT" 2>>"$LOG" || inconclusive "qa agent exited with an error"

# --- decide ------------------------------------------------------------------
git fetch -q origin "$BRANCH"
[ "$(git rev-parse "origin/$BRANCH")" = "$SHA" ] || inconclusive "branch moved while qa ran"

VERDICT="$(tr -d '\r' <"$AGENT_OUT" | grep -E '^VERDICT: (PASS|FAIL)$' | tail -1 | cut -d' ' -f2 || true)"
REASONS="$(tr -d '\r' <"$AGENT_OUT" | sed -n 's/^REASON: /- /p' | head -5 | cut -c1-300 || true)"
[ -n "$VERDICT" ] || inconclusive "agent gave no VERDICT line"

if (( ! CHECKS_OK )); then
  send_back "- $CHECK_NOTE
$REASONS"
fi
if [ "$VERDICT" = "FAIL" ]; then
  send_back "$REASONS"
fi

say "PASS -> review"
act gh issue edit "$ISSUE" --remove-label qa --add-label review
act gh pr comment "$PR" --body "$(printf '[qa] pass at %s\nDid: dotnet build + test, agent review.\n✅ Done:\n%s\nNext: review.' "$SHORT" "$REASONS")"
say "done"
