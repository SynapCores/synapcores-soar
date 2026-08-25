# SynapCores SOAR

**Open-source autonomous SOC platform.** Tier-1 triage agents, immutable audit trail, MCP examiner portal. Self-hostable on a single Docker host — an alternative to Tines, Torq, and Cortex XSOAR that runs on your hardware.

Built on [SynapCores AIDB](https://hub.docker.com/r/synapcores/community) — storage, vectors, graph, immutable audit and agents in one engine, no glue services.

## Run it

```bash
docker run -p 3001:3001 synapcores/soar
```

Open **<http://localhost:3001>** and create the first account — that user becomes the workspace owner.

Everything is in this one image: the database, the triage agents and the web app. Nothing else to install, no keys to paste. First boot takes under a minute while the engine starts and the schema is applied.

To keep data and logins across restarts, give it a volume and pin the session secret:

```bash
docker run -p 3001:3001 \
  -v soar:/var/lib/synapcores \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  synapcores/soar
```

## What the container does on start

1. Starts the SynapCores engine and waits for it to answer.
2. Generates credentials for this container and exchanges them for a gateway token. No image ships a known password and no token is baked in.
3. Applies the framework schema, then the SOAR-domain schema. Both are idempotent, so restarts are safe.
4. Starts the production server on port 3001.

If any of those services dies later, the container exits rather than serving a half-working app.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the UI listens on |
| `AUTH_SECRET` | random per container | Session signing secret. Set it to keep users logged in across restarts. |
| `NEXTAUTH_URL` | `http://localhost:3001` | Public URL, if you put this behind a proxy |
| `AIDB_ADMIN_PASSWORD` | random per container | Set one if you want to reach the engine API yourself |
| `MAIL_PROVIDER` | `console` | Where invitation mail goes |
| `SOAR_TRIAGE_MODE` | `auto` | `auto` or `manual` |

Nothing is required. The engine's API is on port 8080 inside the container; publish it with `-p 8080:8080` to query the data directly.

## Tags

`latest` tracks the default branch. Version tags follow the repo's releases. Note that pulling `latest` once does **not** keep a host current — Docker only re-resolves a floating tag on an explicit `docker compose pull`, or set `pull_policy: always`.

## Source and licence

<https://github.com/SynapCores/synapcores-soar> — Apache 2.0.
