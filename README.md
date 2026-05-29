# SynapCores Apps

Monorepo for the SynapCores vertical applications.

The shared foundation lives in `packages/app-framework`. Each app
(`apps/soar`, `apps/aml`, etc.) is a Next.js 15 application that
imports the framework for auth, layout, RBAC, the SynapCores SDK
wrapper, audit-log UI, MCP token management, and the common
component library — and adds its own domain logic on top.

## Architecture

```
synapcores-apps/
├── packages/
│   └── app-framework/        # @synapcores/app-framework
│       ├── auth/             # Auth.js v5 wrappers + session
│       ├── db/               # SynapCores SDK client
│       ├── agent/            # AGENT_RUN client
│       ├── rbac/             # role/permission primitives
│       ├── ui/               # shared React components
│       ├── layout/           # DashboardLayout + Sidebar
│       └── routes/           # shared route handlers (/api/auth/*, /api/audit/*, ...)
│
└── apps/
    ├── soar/                 # @synapcores/soar  → synapcores.com/soar product
    ├── aml/                  # @synapcores/aml   (next)
    └── compliance/           # @synapcores/compliance (next)
```

The data tier is **SynapCores** — there is no Postgres, no MySQL, no
SQLite. The framework's DB client talks to a SynapCores instance over
its REST API. The agent client dispatches `AGENT_RUN()` calls.

## Quickstart (dev)

```sh
pnpm install
pnpm dev               # boots apps/soar at :3001
# alternatively:
pnpm soar:dev
```

The SOAR app expects a SynapCores instance reachable at
`SYNAPCORES_URL` (default: `http://127.0.0.1:28080`).

## Stack

- Next.js 15 (App Router, server actions)
- TypeScript (strict)
- Tailwind CSS + shadcn/ui
- Auth.js v5 (credentials + magic link)
- zod (validation)
- react-hook-form (forms)
- @tanstack/react-table (tables)
- @synapcores/sdk (data tier)

## Licensing

- `packages/app-framework` — Apache-2.0
- `apps/soar` — Apache-2.0 (open core; Enterprise tier in a private repo)
- Other apps — same pattern.
