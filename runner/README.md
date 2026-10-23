# Runner

TypeScript port of the bash lane scripts. This version has the **build lane** and **label setup**, as a
one-shot CLI. The scheduler loop and the qa and review lanes come later (`scripts/qa.sh` and
`scripts/review.sh` are still the reference for those).

## Use

Inside the Docker container (see `docker/README.md`):

```
docker compose exec runner npm run runner -- labels --project <name> [--dry-run]
docker compose exec runner npm run runner -- build  --project <name> [--issue <n>] [--dry-run]
```

- `--dry-run` runs every read (labels, issues, fetch, an initial clone) and only prints the calls that
  would change GitHub or the repo. It skips the agent and the tests and writes no events.
- Needs `GH_TOKEN` (write access to the repo's issues, pull requests and contents) and, for `build`,
  `ANTHROPIC_API_KEY`, both from the root `.env`.
- Exit codes: `0` ok or nothing to do, `1` lane failed, `64` usage, `65` precondition (for example the
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
6. Pushes, opens a draft PR with `Closes #<n>`, and moves the card to `qa`.

On a failure after the claim, the lane comments on the issue and the card stays in `building`.

## Where things live

| What | Where |
| --- | --- |
| clones | `local.json` override, else `$FACTORY_WORKSPACE/<repo name>` (cloned with `gh` if missing) |
| worktrees | `<workspace>/.factory-worktrees/<project>/issue-<n>`, removed when the run ends |
| agent logs | `$FACTORY_DATA/logs/<project>/issue-<n>.log` |
| events | `$FACTORY_DATA/events.jsonl` (schema: `shared/src/event.ts`) |
| locks | `$FACTORY_DATA/locks/<project>.lock`, one run per project, stale locks are taken over |
| prompt | `prompts/builder.md`, or the project's `prompts.builder`; `{{build_command}}`, `{{test_command}}` and `{{project_name}}` are filled in |

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
