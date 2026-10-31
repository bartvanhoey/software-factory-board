# Software Factory Board

A self-hosted board that turns GitHub issues into pull requests, with Claude Code doing the work.

You label an issue `ready`. The factory then:

1. **Builds** it with Claude Code on its own branch.
2. **Tests** it.
3. **Reviews** it, and opens a pull request only if the review approves.

The board shows every issue in its lane, from `ready` to `done`. A person always does the final merge. The board sits behind a login, so only people you approve can see it.

## Getting Started

You need Docker with Compose v2. For real work you also need a GitHub token and a Claude Code token; to just look around you need neither.

1. Copy the settings file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set at least:
   - `MFA_ENCRYPTION_KEY` and `RUNNER_API_TOKEN`: random values, made with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your first administrator (12 to 128 characters)

   Leave `BOARD_GITHUB_TOKEN` empty to see demo data. Add `RUNNER_GITHUB_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` when you want the factory to actually build.

3. Start it:

   ```bash
   docker compose up -d --build
   ```

4. Open <http://localhost:2999> and log in with the administrator you set. You will be asked to choose a new password.

5. Add your GitHub repositories on the **Projects** screen and switch them on.

Nothing builds by itself until you set `SCHEDULER_ENABLED=true`.

## Learn more

The full description (roles, MFA, the scheduler, configuration and known limits) is in [docs/project-description.md](docs/project-description.md).
