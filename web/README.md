# Web dashboard

Board of the factory's issue processing across all projects registered in the web app. The board only reads GitHub; it changes nothing there.
It sits behind a login (roles, MFA, admin and audit screens), described in the [root README](../README.md).
Next.js (App Router) + Tailwind. GitHub is read with plain `fetch` against the GraphQL API, no client library.

## Run

In Docker it is part of `docker compose up` and listens on http://localhost:2999. Set `WEB_GH_TOKEN` and the login
settings in the root `.env` (see the [root README](../README.md) and `docker/README.md`).

Without Docker, the web app refuses to start unless the login settings are present. Use the production build
(the development server `next dev` has not been tried with the login system):

```
npm install                       # from the repo root
export AUTH_DB_PATH="$PWD/auth.db" MFA_ENCRYPTION_KEY="<base64 key>" RUNNER_API_TOKEN="<base64 token>" COOKIE_SECURE=false FACTORY_DEMO=1
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD="<12 to 128 characters>"
npm run build -w web
npm run start -w web -- -p 3000
```

Open http://localhost:3000 and log in as `ADMIN_EMAIL`. The first login goes through three steps before the board
shows: choose a new password, set up an authenticator app, and save the ten recovery codes. Generate each key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
For live data, set `GH_TOKEN` (and drop `FACTORY_DEMO`); without it the page shows demo data and says so in a banner.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GH_TOKEN` | | read access (issues, pull requests, checks) to every registered project's repo. In Docker this is `WEB_GH_TOKEN` |
| `FACTORY_DEMO` | | `1` forces demo data |
| `FACTORY_PROJECTS_DIR` | `../projects` | folder whose `*.json` files are imported once, when the project table is empty |
| `RUNNER_API_TOKEN` | | required: the secret the runner presents to `GET /api/internal/projects` (at least 32 random bytes, base64) |
| `AUTH_DB_PATH`, `MFA_ENCRYPTION_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE`, ... | | login settings, see the configuration reference in the [root README](../README.md) |

## Board

- Columns: `ready`, `building`, `qa`, `review` (issue labels) and `done` (closed in the last 7 days by a PR or with a lane label).
- A `qa` or `review` card has no PR yet: the factory opens it only after the review approves. Until then the card shows `branch issue-<n>` with a GitHub compare link.
- Issues without a lane label are not shown. An issue with two lane labels shows in the furthest lane with a warning.
- `/?project=a,b` filters by project; no filter shows all. `/projects/<name>` shows one project.
- One failing repo only marks its own project as errored; the rest still load.
- Data is fetched on each request and cached by Next for 30 s.

## Notes

- Next runs with `--webpack` because `@factory/shared` imports its own files as `./x.js` (NodeNext style) and Turbopack cannot map those to `.ts`.
- `AGENTS.md` is written by `next dev` (Next's guidance for coding agents).

## Test

```
npm test -w web
npm run typecheck -w web
```
