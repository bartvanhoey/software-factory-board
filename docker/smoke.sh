#!/usr/bin/env bash
# Verifies the sandbox hardening against a running compose service.
# Usage: bash docker/smoke.sh
set -uo pipefail

cd "$(dirname "$0")/.."
SVC=runner
FAIL=0

# Run a command inside a throwaway container with the same settings as compose.
# stdin is closed on purpose: a check such as `su` would otherwise wait for a password forever.
run() { docker compose run --rm --no-deps -T --entrypoint "" "$SVC" "$@" </dev/null; }

check() { # check <description> <expected: pass|fail> <command...>
  local desc="$1" want="$2"; shift 2
  if run "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then printf 'ok    %s\n' "$desc"; else printf 'FAIL  %s (wanted %s, got %s)\n' "$desc" "$want" "$got"; FAIL=1; fi
}

[ -f .env ] || { echo "missing .env: copy .env.example to .env first" >&2; exit 1; }

echo "== toolchain"
for t in "node --version" "git --version" "gh --version" "claude --version" "dotnet --version"; do
  # shellcheck disable=SC2086
  check "$t" pass $t
done

echo "== identity"
check "runs as non-root"             pass sh -c '[ "$(id -u)" = 10001 ]'
check "no sudo available"            fail sh -c 'command -v sudo'
check "cannot become root"           fail su -c true root

echo "== filesystem"
check "root fs is read-only"         fail sh -c 'touch /usr/probe'
check "cannot write /etc"            fail sh -c 'touch /etc/probe'
check "can write /workspace"         pass sh -c 'touch /workspace/.probe && rm /workspace/.probe'
check "can write /data"              pass sh -c 'touch /data/.probe && rm /data/.probe'
check "can write /cache"             pass sh -c 'touch /cache/.probe && rm /cache/.probe'
check "NuGet cache is on /cache"     pass sh -c '[ "$NUGET_PACKAGES" = /cache/nuget ]'
check "can write HOME"               pass sh -c 'touch "$HOME/.probe"'
check "/tmp is noexec"               fail sh -c 'cp /bin/true /tmp/t && /tmp/t'
check "projects/ is read-only"       fail sh -c 'touch /app/projects/.probe'

echo "== privileges"
check "capability set is empty"      pass sh -c 'grep -q "^CapEff:[[:space:]]*0000000000000000$" /proc/self/status'
check "no-new-privileges is set"     pass sh -c 'grep -q "^NoNewPrivs:[[:space:]]*1$" /proc/self/status'

echo "== secrets"
docker run --rm --entrypoint sh software-factory-runner:dev -c 'env | grep -E "^(GH_TOKEN|ANTHROPIC_API_KEY)=." ' >/dev/null 2>&1 \
  && { echo "FAIL  image contains a secret in its env"; FAIL=1; } || echo "ok    image env has no secrets"

echo "== web service (needs: docker compose up -d web)"
wexec() { docker compose exec -T web "$@" </dev/null; }
wcheck() { # wcheck <description> <expected: pass|fail> <command...>
  local desc="$1" want="$2"; shift 2
  if wexec "$@" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then printf 'ok    %s\n' "$desc"; else printf 'FAIL  %s (wanted %s, got %s)\n' "$desc" "$want" "$got"; FAIL=1; fi
}
if docker compose ps --status running --services 2>/dev/null | grep -qx web; then
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:2999/ || true)"
  if [ "$code" = 200 ]; then echo "ok    dashboard answers on 127.0.0.1:2999"; else echo "FAIL  dashboard on 127.0.0.1:2999 (http $code)"; FAIL=1; fi
  wcheck "web runs as non-root"             pass sh -c '[ "$(id -u)" = 10001 ]'
  wcheck "web code is read-only"            fail sh -c 'touch /app/web/probe'
  wcheck "web can write its cache tmpfs"    pass sh -c 'touch /app/web/.next/cache/.probe && rm /app/web/.next/cache/.probe'
  wcheck "web capability set is empty"      pass sh -c 'grep -q "^CapEff:[[:space:]]*0000000000000000$" /proc/self/status'
  wcheck "web has no ANTHROPIC_API_KEY"     fail sh -c 'test -n "$ANTHROPIC_API_KEY"'
  runner_token="$(sed -n 's/^GH_TOKEN=//p' .env | tr -d '\r')"
  if [ -z "$runner_token" ]; then
    echo "skip  runner GH_TOKEN is empty in .env, cannot compare with the web token"
  elif [ "$(wexec printenv GH_TOKEN 2>/dev/null | tr -d '\r')" = "$runner_token" ]; then
    echo "FAIL  web container holds the runner's GH_TOKEN"; FAIL=1
  else
    echo "ok    web container does not hold the runner's GH_TOKEN"
  fi
else
  echo "skip  web service is not running"
fi

[ "$FAIL" = 0 ] && echo "all checks passed" || { echo "some checks failed"; exit 1; }
