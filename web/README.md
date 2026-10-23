# Web dashboard

Read-only board of the factory's issue processing across all projects in `projects/`.
Next.js (App Router) + Tailwind. GitHub is read with plain `fetch` against the GraphQL API, no client library.

## Run

```
npm install                       # from the repo root
FACTORY_DEMO=1 npm run dev -w web # demo data, no token needed
```

Open http://localhost:3000. In Docker it is part of `docker compose up` and listens on
http://localhost:2999 (set `WEB_GH_TOKEN` in the root `.env`, see `docker/README.md`).
For live data without Docker, copy `.env.local.example` to `.env.local` and set `GH_TOKEN`.
Without `GH_TOKEN` the page shows demo data and says so in a banner.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GH_TOKEN` | | read access (issues, pull requests, checks) to every repo in `projects/` |
| `FACTORY_DEMO` | | `1` forces demo data |
| `FACTORY_PROJECTS_DIR` | `../projects` | registry folder |

## Board

- Columns: `ready`, `building`, `qa`, `review` (issue labels) and `done` (closed in the last 7 days by a PR or with a lane label).
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
