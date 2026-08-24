# SynapCores SOAR

**Open-source autonomous SOC platform.** Tier-1 triage agents, immutable audit trail, MCP examiner portal. Self-hostable on a single Docker host — an alternative to Tines, Torq, and Cortex XSOAR that runs on your hardware.

This image is the SOAR web application. It needs a SynapCores engine alongside it; the compose file below wires both up.

## Quick start

```bash
git clone https://github.com/SynapCores/synapcores-soar
cd synapcores-soar
cp .env.example .env

# 1. Generate the two secrets and put them in .env
openssl rand -base64 32   # -> AIDB_JWT_SECRET
openssl rand -base64 32   # -> AUTH_SECRET

# 2. Boot the engine, then copy the admin key it prints on first boot
docker compose up -d synapcores
docker compose logs synapcores | grep -o 'aidb_[A-Za-z0-9_-]*' | head -1
#    -> paste into SYNAPCORES_ADMIN_API_KEY in .env

# 3. Boot SOAR
docker compose up -d soar
```

Open <http://localhost:3001> and create the first account — that user becomes the workspace owner.

## What the container does on start

1. Waits for the engine to answer `/health` (compose `depends_on` only orders starts).
2. Applies the framework schema, then the SOAR-domain schema. Both are idempotent, so restarts are safe.
3. Starts the Next.js production server on port 3001.

## Environment

| Variable | Required | Description |
|---|---|---|
| `SYNAPCORES_URL` | yes | Engine base URL, e.g. `http://synapcores:8080` |
| `SYNAPCORES_ADMIN_API_KEY` | yes | Admin key the engine mints on first boot |
| `AUTH_SECRET` | yes | NextAuth signing secret, 32 random bytes |
| `NEXTAUTH_URL` | yes | Public URL of this app, e.g. `http://localhost:3001` |
| `FRAMEWORK_TENANT_KEYS_DIR` | no | Per-tenant key directory |
| `MAIL_PROVIDER` | no | `console` (default) or a real provider |
| `SOAR_TRIAGE_MODE` | no | `auto` (default) or `manual` |

## Tags

`latest` tracks the default branch. Version tags follow the repo's releases. Note that pulling `latest` once does **not** keep a host current — Docker only re-resolves a floating tag on an explicit `docker compose pull`, or set `pull_policy: always`.

## Source and licence

<https://github.com/SynapCores/synapcores-soar> — Apache 2.0.
