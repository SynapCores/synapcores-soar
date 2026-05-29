# SynapCores SOAR

The open-core SOAR platform for the autonomous SOC. Built on the
SynapCores AI-native database.

```
SIEM/EDR webhook ─→ EMBED dedup ─→ Tier-1 triage agent ─→ Incident
                                           ↓                  ↓
                                    /actions ledger ─→ adapter fires
                                           ↓
                                     HBR? ─→ /approvals queue
```

## Quickstart (docker compose)

Requires Docker 24+ and ~4 GB free RAM for the SynapCores engine.

```sh
git clone https://github.com/SynapCores/synapcores-soar
cd synapcores-soar
cp .env.example .env
# Edit .env: set AIDB_JWT_SECRET, AUTH_SECRET (both 32 random bytes).
# Leave SYNAPCORES_ADMIN_API_KEY blank for first boot.

docker compose up -d

# Wait ~30s for the engine to warm up.
docker compose logs synapcores | grep "password:"
# Use that admin password to log into the engine console at
# http://localhost:28080 and mint an admin API token. Paste it into
# .env as SYNAPCORES_ADMIN_API_KEY, then:
docker compose restart soar

# Open the SOAR app:
open http://localhost:3001/register
```

The first user you register becomes the **owner** of the first
workspace. From there:

1. **Mint a connector token** at `/settings/connectors` and point your
   SIEM at the webhook URL.
2. Alerts will appear at `/alerts`. Click **Run Tier-1 triage** on
   any alert to dispatch the agent.
3. Triage agent's verdict routes the alert to `/incidents` (true
   positive), closes it (false positive), or queues for human.
4. **Wire integrations** at `/settings/integrations` to allow the
   action dispatcher to actually fire (Slack, ServiceNow, Okta,
   CrowdStrike, Cloudflare).
5. HBR actions (isolate, disable, revoke, block) route to
   `/approvals` for human go/no-go before they fire.
6. For external auditors / SOC 2 / FFIEC examiners, mint a scoped
   MCP token at `/settings/mcp-tokens` and hand them
   `/api/v1/mcp` + the bearer — they query the audit log + incidents
   directly in Claude / Cursor.

## Architecture

```
synapcores-apps/
├── packages/
│   └── app-framework/        @synapcores/app-framework
│       ├── auth/              Auth.js v5 + tenants + invitations +
│       │                       mailer + api-keys + mcp-tokens
│       ├── db/                SynapCores SDK + bootstrap
│       ├── agent/             AGENT_RUN client
│       ├── rbac/              role + permission primitives
│       ├── ui/                shadcn-style components + DataTable
│       ├── layout/            DashboardLayout + Sidebar + TopBar
│       └── pages/             Settings / Profile / Workspace / Team /
│                              Audit / ApiKeys / McpTokens / Accept-invite
│
└── apps/
    └── soar/                  @synapcores/soar (this app)
        ├── src/lib/
        │   ├── soar-alerts.ts      ingest + dedup + listAlerts +
        │   │                        writeSoarAudit
        │   ├── personas.ts         5 agent persona definitions
        │   ├── triage.ts           dispatcher (AGENT_RUN + fallback)
        │   ├── actions/            action registry + dispatcher +
        │   │   ├── adapters/        adapters (Slack, ServiceNow, Okta,
        │   │   │                     CrowdStrike, Cloudflare, generic webhook)
        │   │   ├── approvals.ts    HBR approval-queue resolution
        │   │   └── integrations.ts per-tenant adapter config store
        │   ├── connectors/         ingest connectors (Splunk, Sentinel,
        │   │   ├── splunk-hec.ts    CrowdStrike, Okta)
        │   │   ├── sentinel.ts
        │   │   ├── crowdstrike.ts
        │   │   └── okta.ts
        │   ├── mcp/                MCP examiner-portal server
        │   ├── playbooks.ts        playbook schema + simulator
        │   └── api-auth.ts         personal Bearer-key resolver
        │
        └── src/app/
            ├── (app)/              authenticated app routes
            │   ├── dashboard/
            │   ├── alerts/{,[id]}
            │   ├── incidents/
            │   ├── actions/
            │   ├── approvals/
            │   ├── playbooks/{,[id],new}
            │   ├── audit/{,mcp-sessions/{,[token_id]}}
            │   ├── team/
            │   └── settings/{profile,workspace,api-keys,mcp-tokens,
            │                  integrations,connectors}
            │
            ├── api/v1/
            │   ├── soar/alerts/        webhook ingest (Bearer)
            │   ├── connectors/{splunk,sentinel,crowdstrike,okta}/
            │   └── mcp/                JSON-RPC MCP server
            │
            ├── login/{,verify,magic}
            ├── register/
            ├── onboard/
            ├── forgot-password/
            ├── reset-password/[token]/
            └── accept-invite/[token]/
```

**Data flow**:
- The **engine** holds everything that needs persistence (users,
  tenants, alerts, incidents, audit, integrations, MCP tokens).
- The **app** is stateless: server-rendered Next.js + server actions.
- `.next/` cache is the only meaningful app-side state; safe to wipe.

## Stack

- Next.js 15 (App Router, server actions)
- TypeScript (strict)
- Tailwind CSS + shadcn/ui
- Auth.js v5 (credentials + magic-link)
- bcryptjs (password + API key + connector + MCP-token hashing)
- zod (validation)
- @synapcores/app-framework (auth + RBAC + shared UI)
- SynapCores Community Edition (data tier)

## Connector setup

See `/settings/connectors` in-app. Inline guides per provider:

- **Splunk** → Settings → Data inputs → HEC → New Token → URL =
  `<soar>/api/v1/connectors/splunk`, auth: `Splunk <token>` or
  `Bearer <token>`.
- **Microsoft Sentinel** → Automation → Logic App → "When a Sentinel
  incident is created" → HTTP POST to `<soar>/api/v1/connectors/sentinel`,
  auth: `Bearer <token>`.
- **CrowdStrike Falcon** → Workflows → "New detection" trigger →
  "Send via webhook" → POST to `<soar>/api/v1/connectors/crowdstrike`,
  auth: `Bearer <token>`.
- **Okta** → Workflow → Event Hooks → URL =
  `<soar>/api/v1/connectors/okta`, auth header
  `X-Synapcores-Auth: <token>`. Subscribe to `user.session.start`,
  `user.account.lock`, `mfa.bypass`.

## Adapter setup

See `/settings/integrations` in-app. Each adapter takes a
provider-shape JSON payload. Examples in the placeholder text on the
form.

## Licensing

- `packages/app-framework` — Apache-2.0
- `apps/soar` — Apache-2.0 (open core)
- Enterprise tier (managed cloud + certified playbook library + SOC 2
  Type II auditor portal + dedicated support) — request pricing at
  https://synapcores.com/soar.

## Phasing

This release is built in 11 phases; see git log for each phase's
verification trail. Highlights:

- **Phase 4**: alert ingest + EMBED-based dedup (verified cosine 0.907
  on near-duplicates, -0.016 on unrelated)
- **Phase 5**: 5 agent personas + AGENT_RUN dispatch with
  deterministic fallback
- **Phase 6/7**: action library + HBR approval queue
- **Phase 8**: 4 first-class connectors (Splunk, Sentinel,
  CrowdStrike, Okta)
- **Phase 9**: MCP examiner portal — JSON-RPC server with 5 read-only
  tools, every call audit-logged

## Contributing

Issues + PRs welcome. The framework (`packages/app-framework`) is
designed for reuse across vertical apps — SOAR is the first; AML +
Compliance + Claims + Legal are coming.

## Status

**Design partner alpha.** Not yet GA. The autonomous SOC loop runs
end-to-end. Production deployments need an LLM wired (see
`SOAR_TRIAGE_MODE=agent` + the engine's `ai_chat.toml`) and the
relevant adapters configured at `/settings/integrations`.
