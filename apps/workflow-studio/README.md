# @synapcores/workflow-studio

A visual workflow builder for SynapCores. Drag SQL, AI, and approval nodes onto a canvas; the studio compiles them to a deterministic `WorkflowDefinition` that the SynapCores engine executes.

This is `0.1.0-alpha.1` — APIs and the canvas surface will change before `0.1.0`.

---

## Quickstart — five minutes

You'll need:

- **Node ≥ 20** and **pnpm ≥ 9** (the monorepo uses pnpm workspaces).
- A running **SynapCores engine ≥ v1.8.6.1-ce**. The fastest way is Docker:

  ```bash
  docker run -d --name synapcores \
    -p 8080:8080 \
    -e AIDB_ACCEPT_LICENSE=1 \
    -v synapcores-data:/var/lib/synapcores \
    synapcores/community:latest
  ```

  Once it's up, grab the admin token the engine printed on first boot (look for `OpenClaw Memory API key:` or set `AIDB_ADMIN_PASSWORD` ahead of time, then mint a JWT via `POST /v1/auth/login`).

### 1. Install + env

```bash
# From the monorepo root
pnpm install

# Copy the example env, fill in real values
cp apps/workflow-studio/.env.example apps/workflow-studio/.env.local
$EDITOR apps/workflow-studio/.env.local
```

The two values you **must** set are:

- `AUTH_SECRET` — `openssl rand -base64 48`
- `SYNAPCORES_API_KEY` — the engine admin token from above (set both `SYNAPCORES_API_KEY` and `SYNAPCORES_ADMIN_API_KEY` to it; the bootstrap script accepts either name)

### 2. Seed the studio's own tables + default admin user

```bash
pnpm --filter @synapcores/workflow-studio bootstrap
```

This:

1. Runs the app-framework bootstrap (users / tenants / sessions tables).
2. Applies the studio domain schema (`workflow_definitions`, `workflow_versions`, `workflow_runs`, `workflow_step_runs`, `workflow_approval_queue`, `workflow_deploys`).
3. Seeds **one admin user** if the `users` table is empty:

   ```
   email:    admin@localhost          (override with STUDIO_ADMIN_EMAIL)
   password: change-me-now            (override with STUDIO_ADMIN_PASSWORD)
   ```

   Change the password before exposing the studio to anyone — the alpha has no in-app password rotation.

### 3. Start the dev server

```bash
pnpm --filter @synapcores/workflow-studio dev
```

The studio comes up on **http://localhost:3010**.

Log in with the seeded admin credentials. You'll land on `/canvas` and can start building.

---

## Required env vars

| Var | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | yes | Signs Auth.js session cookies. Missing → every login fails with `MissingSecret`. |
| `NEXTAUTH_URL` | yes | Public origin Auth.js mints redirects against. Default `http://localhost:3010`. |
| `AUTH_TRUST_HOST` | yes | Trust the proxy/host header. Required in Docker + behind any reverse proxy. |
| `SYNAPCORES_URL` | yes | Engine base URL. Default `http://127.0.0.1:28080` — adjust to match the port your engine listens on. |
| `SYNAPCORES_API_KEY` | yes | Engine admin JWT/API key. Studio uses it for compile + execute calls. |
| `SYNAPCORES_ADMIN_API_KEY` | optional | Alias for `SYNAPCORES_API_KEY` (either accepted by the bootstrap script). |
| `STUDIO_ADMIN_EMAIL` | optional | Default `admin@localhost`. Used by `pnpm bootstrap` on first run only. |
| `STUDIO_ADMIN_PASSWORD` | optional | Default `change-me-now`. Used by `pnpm bootstrap` on first run only. |

---

## Common scripts

```bash
# Dev server (Next.js, port 3010)
pnpm --filter @synapcores/workflow-studio dev

# Production build
pnpm --filter @synapcores/workflow-studio build

# Type-check
pnpm --filter @synapcores/workflow-studio typecheck

# Lint
pnpm --filter @synapcores/workflow-studio lint

# Seed admin + schema (first run only)
pnpm --filter @synapcores/workflow-studio bootstrap

# CLI: compile a workflow JSON to SQL without the UI
pnpm --filter @synapcores/workflow-studio compile path/to/workflow.json
```

---

## Troubleshooting

**`There was a problem with the server configuration` on every login** — `AUTH_SECRET` is unset. Set it in `.env.local`, restart `pnpm dev`.

**`CredentialsSignin` after `pnpm bootstrap` ran cleanly** — pre-alpha.1 builds wrote a SHA-256 hash to `users.password_hash` while Auth.js's `verifyPassword` uses bcrypt. Upgrade to `0.1.0-alpha.1` or later and re-run `pnpm bootstrap` against a fresh `users` table.

**`bootstrap` step 3 succeeds but the admin can't log in** — the bootstrap user is created at `admin@localhost`. Older framework builds rejected that with `z.string().email()` (no TLD). `0.1.0-alpha.1` relaxes the email validator to accept `local@host` shapes. Upgrade and retry.

**Engine returns `Permission denied (os error 13)` on `EMBED` / first model auto-pull** — you're on a SynapCores Docker image between `v1.8.1-ce` and `v1.8.6-ce` inclusive. Upgrade the engine to `v1.8.6.1-ce` or newer; the Dockerfile chown bug is fixed there.

**Canvas re-renders infinitely / `getSnapshot` warning in DevTools** — pre-alpha.1 builds used `useWorkflowStore((s) => ({ ... }))` which returns a new object every render. `0.1.0-alpha.1` wraps every selector in `useShallow`. Upgrade.

**Sidebar links `/audit` and `/team` 404** — fixed in `0.1.0-alpha.1`. Both came from the framework's default sidebar section; the studio doesn't implement those routes and now drops the framework's "Workspace" group entirely.

---

## License

Apache-2.0. See [`../../LICENSE`](../../LICENSE).
