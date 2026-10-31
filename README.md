# Software Factory

A software factory that runs in a Docker container and turns GitHub issues into pull requests, with Claude Code doing the work. It comes with a web application for:

- **Issue Board:** every issue in its lane, from `ready` to `done`.
- **Users:** who may log in, and with which role.
- **Projects:** the GitHub repositories the factory works on.

You label an issue `ready`. The factory then:

1. **Builds** it with Claude Code on its own branch.
2. **Tests** it.
3. **Reviews** it, and opens a pull request only if the review approves.

A person always does the final merge. The web application sits behind a login, so only people you approve can see it.

## Getting Started

1. Create a file named `.env` in the project root with the variables below. This is the minimum; `.env.example` lists the optional ones.

   ```bash
   # Random secrets, one value each: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   MFA_ENCRYPTION_KEY=<random base64 value>
   RUNNER_API_TOKEN=<another random base64 value>

   # Your first administrator (password: 12 to 128 characters)
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<a strong password>

   # Needed only for the factory to build; leave empty to just look around
   CLAUDE_CODE_OAUTH_TOKEN=<your Claude Code token>

   # GitHub tokens: two separate ones, never reuse one for the other
   RUNNER_GITHUB_TOKEN=<token the factory builds with: writes branches, issues and pull requests>
   BOARD_GITHUB_TOKEN=<read-only token for the board; leave empty to see demo data>

   # Plain http on localhost
   COOKIE_SECURE=false
   ```

   **Claude Code token:** install [Claude Code](https://claude.com/claude-code), run `claude setup-token` and follow the login. It prints a long-lived token (it needs a Claude subscription).

   **GitHub tokens:** create two separate fine-grained tokens at <https://github.com/settings/personal-access-tokens/new>. For each one, under *Repository access* choose *Only select repositories* and pick the repositories the factory will work on. Then under *Repository permissions* set exactly this and leave everything else on *No access*:

   | Repository permission | `RUNNER_GITHUB_TOKEN` | `BOARD_GITHUB_TOKEN` |
   | --- | --- | --- |
   | Issues | **Read and write** | Read-only |
   | Pull requests | **Read and write** | Read-only |
   | Contents | **Read and write** | Read-only |
   | Commit statuses | No access | Read-only |

   The board token must never be able to write: it only displays what is on GitHub.

2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. Open <http://localhost:2999> and log in with the administrator you set. You will be asked to choose a new password.

4. Add your GitHub repositories on the **Projects** screen and switch them on.

Nothing builds by itself until you set `SCHEDULER_ENABLED=true`.

## Learn more

The full description (roles, MFA, the scheduler, configuration and known limits) is in [docs/project-description.md](docs/project-description.md).
