#!/bin/sh
# Single-container supervisor for SynapCores SOAR.
#
# Starts the engine, applies both schemas, then runs the web app. Everything
# logs to this container's stdout with a prefix, so one `docker logs` shows the
# whole story.
set -eu

log() { echo "[soar] $*"; }
ENGINE_URL="${SYNAPCORES_URL:-http://127.0.0.1:8080}"

# Secrets are generated per container, so no image ships a known credential.
# Set any of them explicitly to pin it (needed if you publish port 8080 and
# want to reach the engine yourself, or to keep sessions valid across restarts).
if [ -z "${AIDB_ADMIN_PASSWORD:-}" ]; then
  AIDB_ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
  export AIDB_ADMIN_PASSWORD
  log "generated a random engine admin password for this container"
fi
if [ -z "${AIDB_JWT_SECRET:-}" ]; then
  AIDB_JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  export AIDB_JWT_SECRET
fi
if [ -z "${AUTH_SECRET:-}" ]; then
  AUTH_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  export AUTH_SECRET
  log "generated a random session secret — set AUTH_SECRET to keep logins across restarts"
fi
: "${NEXTAUTH_URL:=http://localhost:${PORT:-3001}}"
export NEXTAUTH_URL

log "starting SynapCores engine"
# Must pass the image's own config. Launching the binary bare falls back to
# compiled defaults with a short request timeout, and CREATE TABLE then dies
# with "Operation timeout" while the gateway still answers -- a container that
# looks up but has no schema.
( cd /opt/synapcores && ./synapcores --config /etc/synapcores/gateway.toml ) 2>&1 | sed 's/^/[engine] /' &
ENGINE_PID=$!

log "waiting for the engine"
i=0
until curl -fsS "${ENGINE_URL}/health" >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -ge 90 ]; then log "engine did not become healthy after 180s"; exit 1; fi
  kill -0 "$ENGINE_PID" 2>/dev/null || { log "engine exited during startup"; exit 1; }
  sleep 2
done
log "engine is up"

cd /srv
if [ -z "${SYNAPCORES_ADMIN_API_KEY:-}" ]; then
  log "minting an admin token"
  SYNAPCORES_ADMIN_API_KEY="$(node apps/soar/bin/aidb-login.mjs)"
  export SYNAPCORES_ADMIN_API_KEY
fi

log "applying framework schema"
node packages/app-framework/bin/bootstrap.mjs 2>&1 | sed 's/^/[schema] /'
log "applying SOAR schema"
node apps/soar/bin/bootstrap.mjs 2>&1 | sed 's/^/[schema] /'

log "starting SOAR on :${PORT:-3001}"
node /srv/apps/soar/server.js 2>&1 | sed 's/^/[app] /' &
APP_PID=$!

log "ready — open http://localhost:${PORT:-3001} and create the first account"

# Supervise. `wait -n` is a bashism; this image's /bin/sh is dash, where it
# fails with "Illegal option -n" and silently supervises nothing. Poll instead.
while true; do
  for pid_name in "$ENGINE_PID engine" "$APP_PID app"; do
    pid=${pid_name%% *}; name=${pid_name##* }
    if ! kill -0 "$pid" 2>/dev/null; then
      log "$name exited — shutting the container down so the failure is visible"
      kill "$ENGINE_PID" "$APP_PID" 2>/dev/null || true
      exit 1
    fi
  done
  sleep 5
done
