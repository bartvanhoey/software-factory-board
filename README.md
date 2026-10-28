# Software Factory Board

A self-hosted board that shows how software work moves through an automated factory. Each company runs its own copy, so nothing is shared between companies.

You label a GitHub issue `ready`. A runner builds it with Claude Code in an isolated worktree, a second pass tests it, a third reviews it, and only after the review approves does the factory open a pull request. The web board shows every issue in its lane, and sits behind a login with roles, multi-factor authentication and an audit log.

## How it works

Issues move through lanes, which are GitHub labels: `ready`, `building`, `qa`, `review`, then `done`.

1. **Build:** picks the oldest `ready` issue, runs `claude -p` in a worktree on branch `issue-<n>`, checks the result itself (a commit, a clean tree, the project's tests), pushes the branch and moves the card to `qa`.
2. **QA** and **review:** each posts its verdict as a comment on the issue. The review lane opens the pull request (`Closes #<n>`) only when it approves, so an open pull request always means "approved".
3. **Rework:** a card that qa or review sent back is built again on the same branch, up to a limit per project.

The lanes are run by hand today (see [Status](#status-and-limits)). The details are in [runner/README.md](runner/README.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `runner/` | The lane commands: `labels`, `build`, `qa`, `review` |
| `web/` | The board and the login system (Next.js, App Router, Tailwind) |
| `shared/` | Schemas and the project registry loader used by both |
| `projects/` | One JSON file per target repository |
| `prompts/` | The builder, qa, review and rework prompts |
| `docker/`, `docker-compose.yml` | The hardened container setup |
| `docs/adr/`, `GLOSSARY.md` | Accepted decisions and the project's vocabulary |

## Run it in Docker

You need Docker with Compose v2, a GitHub token for the repositories you want to automate, and a Claude Code OAuth token. It is tested on Windows with Docker Desktop; it has not been run on Linux.

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Set it to |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your Claude Code token (runner only) |
| `GH_TOKEN` | A token that can write issues, pull requests and contents (runner only) |
| `WEB_GH_TOKEN` | A separate read-only token for the board. Leave it empty to see demo data |
| `MFA_ENCRYPTION_KEY` | 32 random bytes, base64. The web container refuses to start without it |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first administrator (12 to 128 characters) |

Generate the key once and keep a copy outside the repository. Losing or changing it makes every stored MFA secret unreadable, and everyone must set MFA up again:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then start it:

```bash
docker compose up -d --build
```

Open <http://localhost:2999>. The first login goes through three steps: log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, choose a new password, then set up an authenticator app and save the ten recovery codes. After the first start, remove `ADMIN_PASSWORD` from `.env`: it is only used while no administrator exists.

Add a project by creating `projects/<name>.json` (see [projects/README.md](projects/README.md)) and run `npm run validate`. Then run the lanes inside the runner container:

```bash
docker compose exec runner npm run runner -- labels --project <name>
docker compose exec runner npm run runner -- build  --project <name> --dry-run
docker compose exec runner npm run runner -- build  --project <name>
```

Stop it with `docker compose down`. Data stays in named volumes (`auth`, `workspace`, `data`, `cache`).

The board listens on `127.0.0.1` only, over plain http, with `COOKIE_SECURE=false` as `.env.example` sets it. To expose it beyond your machine, put a TLS proxy in front first, set `COOKIE_SECURE=true`, and only then change the port mapping. More in [docker/README.md](docker/README.md).

## Signing in and roles

Anyone can register, but a new account sees only a "waiting for approval" page until an administrator gives it a role. Passwords are 12 to 128 characters and are checked against a list of common ones. Wrong guesses are delayed, never locked: five free attempts, then 30 seconds doubling up to 15 minutes.

| In this README | Role in the app | What it can do |
| --- | --- | --- |
| Administrator | `admin` | Everything below, plus the Users and Audit screens |
| (not used yet) | `issue-admin` | Sees the board. It has no extra function yet |
| Member | `viewer` | Sees the whole board and changes nothing |

Sessions last 8 hours idle and 7 days at most. Administrator sessions are shorter: 1 hour idle and 12 hours at most.

## Administration

Administrators get an **Admin** link in the header.

- **Users** (`/admin/users`): give or remove roles, disable or enable an account, reset a password (a temporary one is shown once and must be changed at next login), require MFA for a user, reset a user's MFA, and mark an email address as confirmed. Accounts waiting for a role are listed first. Users are disabled, never deleted. An administrator cannot remove their own role, disable themselves or reset their own password, at least one active administrator always remains, and an administrator who has MFA cannot be demoted in the app (disable the account instead).
- **Audit log** (`/admin/audit`): who did what, newest first, filterable by action and user. It is read-only, and database triggers keep entries from being edited or deleted. It records logins, registrations, role and account changes, password and MFA resets, and every change made by the break-glass command.

## Multi-factor authentication

MFA uses any authenticator app (6-digit codes, 30 seconds). Administrators must use it. An administrator can require it for any other user, and users can turn it on themselves at `/account/mfa`.

- Turning it on shows a QR code and **ten one-time recovery codes**, shown once.
- After the password, a user with MFA has five minutes to enter a code. Until then the session grants nothing, and a code works only once.
- Users can get new recovery codes or replace their authenticator, both after proving a current code.
- An administrator can reset MFA for a non-admin on the Users screen. An administrator's own MFA can only be reset from the server (see below).

## Email verification and password reset

Off by default. With `EMAIL_VERIFICATION=true`, a new account is held until its address is confirmed, and the login page offers **Forgot your password?**. It needs these settings:

| Variable | Meaning |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Your mail server |
| `APP_URL` | The public address of the site, for links in emails (`https` unless `localhost`) |

- **Confirming** needs the emailed link and a login to that account, so a stranger cannot confirm an account they registered with your address by tricking you into clicking.
- **Resetting** works once for an hour, ends all the user's sessions and does not skip MFA.
- Mail uses TLS from the start on port 465 and requires STARTTLS on any other port. The certificate is always verified. If the mail server is down, logins still work.

The full behaviour, limits and trade-offs are in [docker/README.md](docker/README.md).

## Break-glass recovery

When the web app cannot help (an administrator lost their authenticator and recovery codes, or the only administrator forgot their password), run these inside the web container:

```bash
docker compose exec web npm run admin -- reset-mfa      --email <email> --reason "<why>"
docker compose exec web npm run admin -- reset-password --email <email> --reason "<why>"
```

`reset-mfa` removes the user's MFA and ends their sessions. `reset-password` sets a temporary password, printed once on your terminal, and ends their sessions. It does not touch MFA, so run both if both are lost. If an administrator's password may be compromised, run `reset-password` first. Every run is recorded in the audit log with your reason.

Access to the server is the authorisation: anyone who can run `docker exec` can do this to any account, including administrators. The temporary password stays in your terminal's scrollback.

## Configuration reference

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MFA_ENCRYPTION_KEY` | yes | | Encrypts MFA secrets. Must be random bytes |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start | | Creates the first administrator when none exists |
| `WEB_GH_TOKEN` | no | | Read-only token for the board. Empty means demo data |
| `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` | for the runner | | Runner credentials, never given to the web container |
| `COOKIE_SECURE` | no | on in production | `false` for plain http on localhost |
| `TRUST_PROXY` | no | `false` | Believe `X-Forwarded-For` from a proxy you control |
| `EMAIL_VERIFICATION` | no | `false` | Email verification and reset by email |
| `SMTP_*`, `APP_URL` | with verification | | See above |

## Status and limits

Built: the lane commands, the board, the login system described above, and the break-glass command.

Not built yet:

- **No scheduler.** The lanes run only when you start them. The runner container idles.
- **Projects are files.** They are added in `projects/*.json`, not from the web app. [ADR 0001](docs/adr/0001-runner-gets-config-from-web-over-internal-api.md) and [ADR 0002](docs/adr/0002-secrets-encrypted-in-db-master-key-outside-it.md) record the accepted direction (settings and encrypted credentials managed in the web app); none of that exists yet.
- **No network allow-list** for the runner container, which runs agent-written code.

Known limits of the login system:

- Resetting another account's password, resetting MFA or switching off "require MFA" does not ask the acting administrator for a fresh code, so a stolen, still-valid administrator session can do it. Those sessions are short for that reason.
- Without a trusted proxy there is no per-IP limit, so registration and "forgot password" use shared hourly limits that a determined stranger can use up.
- Tested against a local mail server with a self-signed certificate, not a production mail provider.

## Development

You need Node.js 22 or newer (the login system uses the built-in `node:sqlite`).

```bash
npm install
npm test                # all workspaces
npm run typecheck
npm run validate        # checks projects/*.json
```

To run the board on your machine without Docker, set the login settings and start the production build. The development server (`next dev`) has not been tried with the login system.

```bash
export AUTH_DB_PATH="$PWD/auth.db" MFA_ENCRYPTION_KEY="<base64 key>" COOKIE_SECURE=false FACTORY_DEMO=1
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD="<12 to 128 characters>"
npm run build -w web
npm run start -w web -- -p 3000
```

[web/README.md](web/README.md) describes the board itself. [GLOSSARY.md](GLOSSARY.md) defines the project's terms.

## License

MIT. See [LICENSE](LICENSE).
