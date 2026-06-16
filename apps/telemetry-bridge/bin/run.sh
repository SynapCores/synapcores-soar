#!/usr/bin/env bash
# telemetry-bridge — start the DCU bridge service.
#
# Reads SYNAPCORES_URL + SYNAPCORES_ADMIN_API_KEY from .env.local at the
# bridge package root (or from the parent aerospace-rca app — we copy
# the same values).

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

# Inherit from aerospace-rca's .env.local if our own isn't set.
if [[ -z "${SYNAPCORES_ADMIN_API_KEY:-}" && -f ../aerospace-rca/.env.local ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' ../aerospace-rca/.env.local | xargs -0 -d '\n' 2>/dev/null || true)
fi

exec pnpm dev
