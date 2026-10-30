---
status: accepted
---

# The runner gets its configuration from the web service over an internal API

Credentials and the project list are managed by the Administrator in the web service and stored in its database. The runner fetches them from the web service over an internal API reachable only on the compose network, authenticated by one runner credential supplied through its environment. The runner no longer reads `.env` secrets or the `projects/` folder.

## Status of the implementation

The project list is implemented: projects are rows in the web service's database, managed on the Projects screen, and the
runner fetches them from `GET /api/internal/projects` with `RUNNER_API_TOKEN` (no cache and no file fallback). Credentials
are not: the GitHub and Claude tokens are still in the runner's `.env` until ADR 0002 is built.

## Considered Options

- **Shared SQLite file mounted in both containers.** Rejected: it couples the two containers to the same schema and locking behaviour, and it breaks if an installation moves to Postgres.
- **Keep `.env` and `projects/*.json` for the runner.** Rejected: the Administrator could not manage credentials or projects in one place, and secrets would stay in `.env`.

## Consequences

- The web service must be running for the runner to start a run.
- The runner credential is the one secret the runner still needs from its environment.
- The web service keeps the web read token and the runner write token as separate settings, so the web container never holds the write token.
