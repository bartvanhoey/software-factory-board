# Runner

TypeScript port of the bash lane scripts. This version has the **build lane**, the **qa lane**, the
**review lane** and **label setup**, as one-shot CLI commands. The scheduler loop comes later.

**A PR exists only after a successful review.** Build pushes a branch `issue-<n>`, qa and review find the
work by that branch name, and every verdict is a comment on the **issue**. The review lane opens the PR
(`Closes #<n>`) when it approves. So an open PR always means "approved", and a card that was sent back
leaves only a branch behind.

## Use

Inside the Docker container (see `docker/README.md`):

```
docker compose exec runner npm run runner -- labels --project <name> [--dry-run]
docker compose exec runner npm run runner -- build  --project <name> [--issue <n>] [--dry-run]
docker compose exec runner npm run runner -- qa     --project <name> [--issue <n>] [--dry-run]
docker compose exec runner npm run runner -- review --project <name> [--issue <n>] [--merge] [--dry-run]
```

- `--dry-run` runs every read (labels, issues, fetch, an initial clone) and only prints the calls that
  would change GitHub or the repo. It skips the agent and the tests and writes no events.
- Needs `GH_TOKEN` (write access to the repo's issues, pull requests and contents) and, for `build`,
  `ANTHROPIC_API_KEY`, both from the root `.env`.
- Exit codes: `0` ok or nothing to do, `1` lane failed or a card was sent back, `2` qa or review inconclusive, `64` usage, `65` precondition (for example the
  issue is not `ready`), `66` missing file, `69` missing tool or not logged in, `75` another run holds the lock.

## What the build lane does

1. Creates any missing `ready`, `building`, `qa`, `review` labels (grey, blue, yellow, green). It only
   creates: existing labels keep their colour and description.
2. Picks the oldest `ready` issue (or `--issue`), and fetches the project's `defaultBranch`. A wrong
   branch name fails here, before anything is claimed.
3. Claims it: assigns the bot, `ready` becomes `building`.
4. Creates a worktree `issue-<n>` from `origin/<defaultBranch>` and runs `claude -p` in it.
5. Checks the result itself: at least one commit, a clean tree, then the project's `commands.test`
   (or `commands.build` when there are no tests, or nothing when there are neither).
   If the builder made **no commit** but left changes, the lane commits them itself as the bot
   (`🤖 [build] #<n>: <issue title>`, `git add -A`, hooks run) and still verifies. It refuses, and
   commits nothing, when a changed file looks like a secret (`.env*` except `.env.example`, `*.pem`,
   `*.key`, `*.pfx`, `*.p12`, `id_rsa*`). Leftover changes next to a commit the builder made stay a failure.
   The issue comment says when the lane made the commit.
6. Pushes the branch (no PR), moves the card to `qa`, and comments on the issue with the branch and a
   GitHub compare link (`<default>...issue-<n>`).

On a failure after the claim, the lane comments on the issue and the card stays in `building`.

## What the qa lane does

1. Picks the oldest `qa` issue (or `--issue`) and checks that branch `issue-<n>` exists on `origin`. A card
   without that branch is refused (exit 65) and left alone.
2. Fetches the branch, pins its commit, and creates a fresh detached worktree `qa-issue-<n>` at exactly that commit.
3. Runs the mechanical checks from the registry, build then test (the first failure stops them). A project
   with neither command skips them, and the agent decides alone.
4. Runs a read-only agent (`prompts/qa.md`: Read, Glob, Grep, a few `git` subcommands and the stack's
   toolchain; no Edit or Write) that ends with `VERDICT: PASS` or `FAIL` and up to five `REASON:` lines.
   The last exact `VERDICT:` line counts, and a failed check always wins over a PASS.
5. Decides, and comments on the **issue** (`[qa] pass|fail at <sha>`; there is no PR yet):
   - pass: `qa` becomes `review`
   - failed check or FAIL verdict: `qa` becomes `building`
   - inconclusive (agent error, no verdict line, or the branch moved while qa ran): the card stays in `qa`

## What the review lane does

The last gate before a merge. **Nothing is merged unless you pass `--merge`.**

1. Picks the oldest `review` issue (or `--issue`) and checks that branch `issue-<n>` exists on `origin`
   (exit 65 if not).
2. **QA gate:** the issue must carry a `[qa] pass at <sha>` comment for the branch's current head, written by
   the factory's own account (the `gh` login). Comments from anyone else are ignored, so a pass cannot be
   forged, and the latest qa result wins. Otherwise the card goes back to `qa`.
3. **Merge gate:** a fresh worktree at the current default branch, the branch head merged in with
   `git merge --no-commit --no-ff`, then the project's build and test on that result.
4. A read-only agent (`prompts/review.md`, same tools as qa) answers `VERDICT: APPROVE` or `REQUEST_CHANGES`.
5. Staleness: if the default branch or the branch head moved while it ran, the result is inconclusive.
6. Decides, and comments on the **issue**:
   - a conflict, a failed build or test, or `REQUEST_CHANGES`: `review` becomes `building`. **No PR is opened.**
   - approved: **opens the PR** (a normal one, not a draft) with `Closes #<n>`, the qa pass and the review
     notes in its body, and comments `PR #<n>: <url>` on the issue. An open PR for the branch is reused, so a
     rerun never opens a second one, and a draft PR left by an older flow is marked ready. Without `--merge`
     the card stays in `review` and the open PR waits for a human to merge it.
   - approved with `--merge`: also squash-merges **pinned to the reviewed commit** (a later push makes GitHub
     refuse it), removes the `review` label, and deletes the `issue-<n>` branch locally and on `origin`. The
     issue closes through the PR's `Closes #<n>`, so there is no `done` label.
   - anything undecidable, including GitHub refusing the PR or the merge: the card stays in `review`. A PR that
     was already opened stays open and the next run reuses it.

A pull request opened by hand, or a push to the branch after the approval, is not covered by this: GitHub does
not know the factory's verdict. A required `factory/review` commit status with branch protection is the
follow-up that closes that.

A card sent back to `building` is not picked up again automatically: the build lane only takes `ready`
issues and refuses a branch that already exists on `origin`. A rework path comes later.

## Where things live

| What | Where |
| --- | --- |
| clones | `local.json` override, else `$FACTORY_WORKSPACE/<repo name>` (cloned with `gh` if missing) |
| worktrees | `<workspace>/.factory-worktrees/<project>/issue-<n>`, removed when the run ends |
| agent logs | `$FACTORY_DATA/logs/<project>/issue-<n>.log`; for qa `qa-issue-<n>.log` (checks) and `qa-issue-<n>.agent.txt` (the agent's answer); the same for review as `review-issue-<n>.*` |
| events | `$FACTORY_DATA/events.jsonl` (schema: `shared/src/event.ts`) |
| locks | `$FACTORY_DATA/locks/<project>.lock`, one run per project, stale locks are taken over |
| prompt | `prompts/builder.md`, `prompts/qa.md` and `prompts/review.md`, or the project's `prompts.builder` / `prompts.qa` / `prompts.review`; `{{build_command}}`, `{{test_command}}`, `{{default_branch}}` and `{{project_name}}` are filled in |

## Design

`src/lanes/build.ts` only talks to the interfaces in `src/ports.ts` (`Gh`, `Git`, `AgentRunner`, `Shell`,
`EventLog`). The real implementations in `src/adapters/` call the `gh`, `git` and `claude` programs with an
argument array, so no shell is involved, and long text goes through stdin. The tests use fakes
(`src/testing/fakes.ts`), so they need no network.

Git authenticates through `gh auth git-credential` per command and nothing is written to git config.
Commits are authored as the bot account. The agent only gets file tools, a few `git` subcommands and its
stack's toolchain (`allowedToolsFor` in `src/prompt.ts`).

## Limits

- Network egress from the container is not restricted yet.
- On native Windows, `gh`, `git` and `claude` must be real executables on `PATH` (no `.cmd` shims), because
  nothing is run through a shell.
- Test with `npm test -w runner`; `npm run typecheck -w runner`.
