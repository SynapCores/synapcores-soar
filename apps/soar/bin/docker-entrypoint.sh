#!/bin/sh
# SOAR app container entrypoint.
#   1. wait for the engine to answer (compose `depends_on` only orders starts)
#   2. apply the framework schema, then the SOAR-domain schema (both idempotent)
#   3. start the Next.js production server
#
# Bootstrap runs here rather than at build time because it writes to a live
# engine. Both steps are safe to re-run, so a container restart is harmless.
set -eu

ENGINE="${SYNAPCORES_URL:-http://synapcores:8080}"

if [ -z "${SYNAPCORES_ADMIN_API_KEY:-}" ]; then
  echo "[entrypoint] SYNAPCORES_ADMIN_API_KEY is not set — cannot bootstrap." >&2
  echo "[entrypoint] Set it in .env; see README 'Quickstart'." >&2
  exit 1
fi

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

echo "[entrypoint] applying framework schema"
node packages/app-framework/bin/bootstrap.mjs

echo "[entrypoint] applying SOAR schema"
node apps/soar/bin/bootstrap.mjs

echo "[entrypoint] starting Next.js on :${PORT:-3001}"
exec node apps/soar/server.js
