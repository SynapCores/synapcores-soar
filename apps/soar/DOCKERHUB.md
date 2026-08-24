# SynapCores SOAR

**Open-source autonomous SOC platform.** Tier-1 triage agents, immutable audit trail, MCP examiner portal. Self-hostable on a single Docker host — an alternative to Tines, Torq, and Cortex XSOAR that runs on your hardware.

Built on [SynapCores AIDB](https://hub.docker.com/r/synapcores/community) — storage, vectors, graph, immutable audit and agents in one engine, no glue services.

## Run it

No clone, no build, no keys to paste. Save this as `docker-compose.yml`:

```yaml
name: synapcores-soar
services:
  synapcores:
    image: synapcores/community:latest
    environment:
      AIDB_ACCEPT_LICENSE: '1'
      AIDB_JWT_SECRET: demo-only-change-me-BwvOIXz94EaUJxXh0vmDXPMsXgS65mM8
      AIDB_ADMIN_PASSWORD: demo-only-change-me
    volumes:
      - sc_engine_data:/var/lib/synapcores
    healthcheck:
      test: ['CMD', 'curl', '-fsS', 'http://127.0.0.1:8080/health']
      interval: 10s
      timeout: 3s
      retries: 12

  soar:
    image: synapcores/soar:latest
    depends_on:
      synapcores:
        condition: service_healthy
    environment:
      SYNAPCORES_URL: http://synapcores:8080
      AIDB_ADMIN_PASSWORD: demo-only-change-me
      AUTH_SECRET: demo-only-change-me-Our_ZTWUfr_lm5NcPGvjDB8LQqunuKXA
      NEXTAUTH_URL: http://localhost:3001
      MAIL_PROVIDER: console
      SOAR_TRIAGE_MODE: auto
    ports:
      - '3001:3001'

volumes:
  sc_engine_data:
```

```bash
docker compose up -d
```

Then open **<http://localhost:3001>** and create the first account — that user becomes the workspace owner.

The secrets above are throwaway values for a local trial. Replace all three before anyone else can reach it.

## What the container does on start

1. Waits for the engine to answer `/health` (compose `depends_on` only orders starts).
2. Exchanges `AIDB_ADMIN_PASSWORD` for a gateway token via `POST /v1/auth/login`. No token is baked into the image and nothing is signed client-side. Supply `SYNAPCORES_ADMIN_API_KEY` instead if you want to hand the app a narrower key.
3. Applies the framework schema, then the SOAR-domain schema. Both are idempotent, so restarts are safe.
4. Starts the Next.js production server on port 3001.

## Environment

| Variable | Required | Description |
|---|---|---|
| `SYNAPCORES_URL` | yes | Engine base URL, e.g. `http://synapcores:8080` |
| `AIDB_ADMIN_PASSWORD` | yes | Admin password pinned on the engine; the app exchanges it for a token |
| `SYNAPCORES_ADMIN_API_KEY` | no | Supply a token directly to skip the login step |
| `AUTH_SECRET` | yes | NextAuth signing secret, 32 random bytes |
| `NEXTAUTH_URL` | yes | Public URL of this app, e.g. `http://localhost:3001` |
| `FRAMEWORK_TENANT_KEYS_DIR` | no | Per-tenant key directory |
| `MAIL_PROVIDER` | no | `console` (default) or a real provider |
| `SOAR_TRIAGE_MODE` | no | `auto` (default) or `manual` |

## Tags

`latest` tracks the default branch. Version tags follow the repo's releases. Note that pulling `latest` once does **not** keep a host current — Docker only re-resolves a floating tag on an explicit `docker compose pull`, or set `pull_policy: always`.

## Source and licence

<https://github.com/SynapCores/synapcores-soar> — Apache 2.0.
