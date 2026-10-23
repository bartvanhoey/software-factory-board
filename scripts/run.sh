#!/usr/bin/env bash
# Moves one `ready` issue through the build lane:
# claim -> worktree -> builder agent -> independent test run -> draft PR -> label `qa`.
# Usage: bash scripts/run.sh [--dry-run] [issue-number]
set -euo pipefail

DRY_RUN=0
ISSUE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    ''|*[!0-9]*) echo "usage: run.sh [--dry-run] [issue-number]" >&2; exit 64 ;;
    *) ISSUE="$arg" ;;
  esac
done

SOLUTION="BlazorEmployeeManagement.sln"
MAX_TURNS=30

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
LOCK="$ROOT/.git/mini-board.lock"
LOG_DIR="$ROOT/.git/mini-board-logs"
WT_ROOT="$(dirname "$ROOT")/mini-board-worktrees"
PROMPT_FILE="$ROOT/prompts/builder.md"

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
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# --- pick --------------------------------------------------------------------
if [ -z "$ISSUE" ]; then
  ISSUE="$(gh issue list --label ready --state open --json number \
    --jq 'sort_by(.number) | .[0].number // empty')"
  [ -n "$ISSUE" ] || { echo "no open issue labelled ready"; exit 0; }
fi

LABELS="$(gh issue view "$ISSUE" --json labels --jq '.labels[].name')"
grep -qx ready <<<"$LABELS" || { echo "issue #$ISSUE is not labelled ready" >&2; exit 65; }

TITLE="$(gh issue view "$ISSUE" --json title --jq .title)"
BODY="$(gh issue view "$ISSUE" --json body --jq .body)"
say "picked #$ISSUE: $TITLE"

fail() {
  say "FAILED: $*"
  act gh issue comment "$ISSUE" \
    --body "[build] failed: $*. Card stays in building. Full log is local only."
  exit 1
}

# --- claim -------------------------------------------------------------------
ME="$(gh api user --jq .login)"
say "claim #$ISSUE as $ME (ready -> building)"
act gh issue edit "$ISSUE" --add-assignee "$ME" --remove-label ready --add-label building

# --- isolate -----------------------------------------------------------------
BRANCH="issue-$ISSUE"
WT="$WT_ROOT/$BRANCH"
LOG="$LOG_DIR/$BRANCH.log"
git fetch -q origin main
say "worktree $WT on branch $BRANCH"
act mkdir -p "$WT_ROOT"
act git worktree add -b "$BRANCH" "$WT" origin/main

# --- build -------------------------------------------------------------------
PROMPT="$(cat "$PROMPT_FILE"; printf '\n\n## Issue #%s: %s\n\n%s\n' "$ISSUE" "$TITLE" "$BODY")"

if (( DRY_RUN )); then
  say "dry-run: would run claude -p in $WT (max $MAX_TURNS turns)"
else
  say "builder agent running; follow with: tail -f $LOG"
  ( cd "$WT" && claude -p "$PROMPT" \
      --max-turns "$MAX_TURNS" \
      --allowedTools "Read" "Edit" "Write" "Glob" "Grep" \
        "Bash(dotnet:*)" "Bash(git add:*)" "Bash(git commit:*)" \
        "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)"
  ) >"$LOG" 2>&1 || fail "builder agent exited with an error"

  # Do not trust the agent's own claims: verify.
  [ "$(git -C "$WT" rev-list --count origin/main..HEAD)" -gt 0 ] || fail "builder made no commit"
  [ -z "$(git -C "$WT" status --porcelain)" ] || fail "builder left uncommitted changes"

  say "independent test run"
  ( cd "$WT" && dotnet test "$SOLUTION" --nologo -v q ) >>"$LOG" 2>&1 \
    || fail "tests failed on the branch"
fi

# --- hand off ----------------------------------------------------------------
say "push $BRANCH and open draft PR"
act git -C "$WT" push -u origin "$BRANCH"
PR_BODY="$(printf 'Closes #%s\n\nBuilt by the build lane (scripts/run.sh).\nIndependent `dotnet test %s`: passed.' "$ISSUE" "$SOLUTION")"
if (( DRY_RUN )); then
  act gh pr create --draft --base main --head "$BRANCH" --title "$TITLE" --body "$PR_BODY"
  PR_URL="<pr-url>"
else
  PR_URL="$(gh pr create --draft --base main --head "$BRANCH" --title "$TITLE" --body "$PR_BODY")"
fi

say "building -> qa"
act gh issue edit "$ISSUE" --remove-label building --add-label qa
act gh issue comment "$ISSUE" --body "[build] done. Draft PR: $PR_URL. Tests passed. Next: qa."
say "done: $PR_URL"