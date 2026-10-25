# Docker sandbox

Hardened container for the factory runner and dashboard. The entrypoint prints the toolchain
versions and then runs the given command.

## Use

```
cp .env.example .env        # fill in GH_TOKEN and ANTHROPIC_API_KEY
docker compose build
docker compose run --rm --no-deps runner true   # prints toolchain versions
bash docker/smoke.sh                            # verifies the hardening
docker compose up -d                            # starts the runner (idle) and the dashboard
docker compose down
```

## Services

Both run the same image.

| Service | Command | Notes |
| --- | --- | --- |
| `runner` | `sleep infinity` (idle) | gets `.env` (`GH_TOKEN`, `ANTHROPIC_API_KEY`); run lanes with `docker compose exec runner npm run runner -- ...`, see `runner/README.md` |
| `web` | `next start` on port 2999 | dashboard at http://localhost:2999, bound to `127.0.0.1` only |

The dashboard has a login, but it is served over plain http, so the port is published on localhost only. To expose it
beyond localhost, put a TLS proxy in front first (then set `COOKIE_SECURE=true`), and only then change the port mapping.

`web` never receives the runner's `GH_TOKEN` (it can write) or `ANTHROPIC_API_KEY`. It reads
`WEB_GH_TOKEN` from `.env`, which should be a read-only token. Leave it empty to see demo data.
Its code is baked into the image, so rebuild after changes: `docker compose up -d --build`.

## Dashboard login settings

`web` keeps users, sessions and the audit log in SQLite (`auth.db`) on the `auth` named volume, mounted at
`/auth` in `web` only. The runner never sees it. Use a named volume, not a bind mount: SQLite locking on a
Windows folder is unreliable. Back up the volume, and keep `MFA_ENCRYPTION_KEY` safe separately.

`web` validates these at startup and exits with code 1, naming each bad variable (never its value), so
`docker compose logs web` shows the reason. Compose passes them to `web` one by one, never via `env_file`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MFA_ENCRYPTION_KEY` | yes | | 32 random bytes, base64. Encrypts MFA secrets at rest. Lose it and every user must re-enroll MFA. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | no | | First admin, created on first start only when no admin exists. Set both or neither; password 12-128 characters. Remove `ADMIN_PASSWORD` from `.env` afterwards. |
| `EMAIL_VERIFICATION` | no | `false` | Not implemented yet: `true` makes the container refuse to start. Later, `true` makes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` required. |
| `COOKIE_SECURE` | no | on in production | Set `false` for plain http on localhost. Exposing the dashboard beyond localhost needs a TLS proxy. |
| `TRUST_PROXY` | no | `false` | `true` when a reverse proxy you control sets `X-Forwarded-For`; enables per-IP login and registration limits. Leave `false` otherwise: the header is spoofable, and logins are then throttled per account only. Only use `true` when the proxy is the sole way in; if port 2999 is also reachable directly, clients can forge the header and dodge the per-IP limits. |
| `AUTH_DB_PATH` | no | `/auth/auth.db` | Set by compose. |

Roles and administration: `admin` includes `issue-admin` and `viewer`, and `issue-admin` includes `viewer`. Admins use
`/admin/users` to give accounts roles (a new account sees only the waiting page until then), disable or enable
accounts, and reset passwords. A reset shows a temporary password once, forces a change at next login and ends that
user's sessions. Admins cannot remove their own admin role, disable themselves or reset their own password, and at
least one active admin must always remain. `/admin/audit` is a read-only, filterable log of who did what. Users are
disabled, never deleted. Role changes take effect on the next request; they do not end sessions.

Login, registration, the waiting page (for accounts without a role) and password change are live. The first admin
comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD` and must change its password at first login. Public routes are
`/login`, `/register` and `/api/health` (the container healthcheck, which answers only `ok` or an error); everything
else needs a session. Behind a TLS proxy, set `serverActions.allowedOrigins` in `web/next.config.ts` to the public
host, because Next rejects actions whose `Origin` differs from `Host`.

On Windows Git Bash, prefix with `MSYS_NO_PATHCONV=1` if paths get mangled.

## Toolchain (all pinned)

| Tool | Version | Pinned by |
| --- | --- | --- |
| Node base image | 22 (bookworm-slim) | image digest |
| .NET SDK | 8.0.x | image digest of `dotnet/sdk:8.0-bookworm-slim` |
| npm | 12.2.1 | npm version (install scripts blocked unless allowlisted) |
| GitHub CLI | 2.87.3 | version + sha256 per arch |
| Claude Code | 2.1.308 | npm version |

To bump a base image: `docker pull <tag>`, `docker inspect --format '{{index .RepoDigests 0}}' <tag>`, update the digest in `Dockerfile`.

## Hardening

| Setting | Effect |
| --- | --- |
| non-root user `factory` (uid 10001) | no root, no sudo, no login shell |
| `read_only: true` | root filesystem is immutable |
| `tmpfs` on `/tmp` (noexec) and `/home/factory` | scratch space only, wiped on restart |
| named volumes `workspace`, `data`, `cache`, `auth` | the only persistent writable paths (`cache` holds the NuGet packages, `NUGET_PACKAGES=/cache/nuget`; `auth` is mounted in `web` only) |
| `./projects` mounted `:ro` | registry cannot be changed from inside |
| `cap_drop: [ALL]` | empty capability set |
| `no-new-privileges` | setuid binaries cannot escalate |
| `pids_limit`, `mem_limit`, `cpus` | fork-bomb and runaway guards |
| secrets via `.env` only | none in the image or its env |

## Not covered yet

- Network egress is unrestricted. The agent runs untrusted code, so an allowlist
  (GitHub, Anthropic, NuGet/npm registries) is the next hardening step.
- One shared image for all stacks. Per-stack images come later.
- `HOME` is wiped on restart: the runner must authenticate from env vars each start.
