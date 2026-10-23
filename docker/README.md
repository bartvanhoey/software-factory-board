# Docker sandbox

Hardened container for the factory runner. The entrypoint is a placeholder that
prints the toolchain versions; the Node runner replaces it later.

## Use

```
cp .env.example .env        # fill in GH_TOKEN and ANTHROPIC_API_KEY
docker compose build
docker compose run --rm --no-deps runner true   # prints toolchain versions
bash docker/smoke.sh                            # verifies the hardening
docker compose up -d                            # idles until the runner exists
docker compose down
```

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
| named volumes `workspace`, `data` | the only persistent writable paths |
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
