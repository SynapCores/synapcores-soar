#!/bin/sh
# SOAR app container entrypoint.
#   1. wait for the engine to answer (compose `depends_on` only orders starts)
#   2. obtain an admin token — minted here unless one was supplied
#   3. apply the framework schema, then the SOAR-domain schema (both idempotent)
#   4. start the Next.js production server
#
# Bootstrap runs here rather than at build time because it writes to a live
# engine. Both steps are safe to re-run, so a container restart is harmless.
set -eu

ENGINE="${SYNAPCORES_URL:-http://synapcores:8080}"

echo "[entrypoint] waiting for engine at ${ENGINE}"
i=0
until curl -fsS "${ENGINE}/health" >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] engine did not become healthy after 120s at ${ENGINE}" >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] engine is healthy"

# Plug and play: mint our own token from the pinned admin password. An
# explicitly supplied SYNAPCORES_ADMIN_API_KEY still wins, so anyone who wants
# to hand the app a narrower, longer-lived key can.
if [ -n "${SYNAPCORES_ADMIN_API_KEY:-}" ]; then
  echo "[entrypoint] using the supplied SYNAPCORES_ADMIN_API_KEY"
else
  if [ -z "${AIDB_ADMIN_PASSWORD:-}" ]; then
    echo "[entrypoint] neither SYNAPCORES_ADMIN_API_KEY nor AIDB_ADMIN_PASSWORD is set." >&2
    echo "[entrypoint] Set AIDB_ADMIN_PASSWORD in .env — the engine pins it on first boot" >&2
    echo "[entrypoint] and this container exchanges it for a token automatically." >&2
    exit 1
  fi
  echo "[entrypoint] minting an admin token from AIDB_ADMIN_PASSWORD"
  SYNAPCORES_ADMIN_API_KEY="$(node apps/soar/bin/aidb-login.mjs)"
  export SYNAPCORES_ADMIN_API_KEY
fi

echo "[entrypoint] applying framework schema"
node packages/app-framework/bin/bootstrap.mjs

echo "[entrypoint] applying SOAR schema"
node apps/soar/bin/bootstrap.mjs

echo "[entrypoint] starting Next.js on :${PORT:-3001}"
exec node apps/soar/server.js
