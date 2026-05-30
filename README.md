# SynapCores Apps

Open-core vertical applications on the SynapCores AI-native database.

Two production-shape verticals in this monorepo today, both built on a
shared `@synapcores/app-framework`:

| App | What it is | Port | Repo |
|---|---|---|---|
| **SOAR** | Autonomous SOC — alert ingest → EMBED dedup → triage agent → incident/action ledger → HBR approvals → MCP examiner portal | 3001 | `apps/soar` |
| **AML** | Transaction-monitoring + SAR-drafting — FedNow/ACH/SWIFT ingest → behavioral detection → 5-jurisdiction SAR drafting → HBR file-with-regulator → MCP examiner portal | 3003 | `apps/aml` |

Both share the same engine (one `synapcores/community` container) and
the same auth/RBAC/UI primitives.

```
                  ┌──────────────────────────────┐
                  │   SynapCores Engine (CE)     │
                  │  vectors · SQL · graph · IM  │
                  │           :28080             │
                  └──────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                     │
       ┌──────▼───────┐                     ┌───────▼──────┐
       │   SOAR app   │                     │   AML app    │
       │   :3001      │                     │   :3003      │
       └──────────────┘                     └──────────────┘
                       └─ @synapcores/app-framework ─┘
                          (auth · RBAC · UI · agent ·
                           tenants · audit · MCP)
```

## Quickstart (docker compose)

Requires Docker 24+ and ~4 GB free RAM for the SynapCores engine.

```sh
git clone https://github.com/SynapCores/synapcores-apps
cd synapcores-apps
cp .env.example .env
# Edit .env: set AIDB_JWT_SECRET, AUTH_SECRET (both 32 random bytes).
# Leave SYNAPCORES_ADMIN_API_KEY blank for first boot.

# 1. Boot just the engine first
docker compose up -d synapcores

# 2. Grab the engine admin password
docker compose logs synapcores | grep "password:"
# Log into the engine console at http://localhost:28080,
# mint an admin API token, paste into .env as SYNAPCORES_ADMIN_API_KEY.

# 3. Boot the apps
docker compose up -d

# Open whichever app you want:
open http://localhost:3001/register   # SOAR
open http://localhost:3003/register   # AML
```

The first user registered becomes the **owner** of the first workspace
in that app.

## SOAR — autonomous SOC

```
SIEM/EDR webhook ─→ EMBED dedup ─→ Tier-1 triage agent ─→ Incident
                                           ↓                  ↓
                                    /actions ledger ─→ adapter fires
                                           ↓
                                     HBR? ─→ /approvals queue
```

After register:

1. **Mint a connector token** at `/settings/connectors`. Point your
   SIEM at the webhook URL (Splunk HEC, Sentinel Logic App,
   CrowdStrike workflow, Okta event hook).
2. Alerts appear at `/alerts`. Click **Run Tier-1 triage** to
   dispatch the agent.
3. Triage routes to `/incidents` (true positive), closes it (false
   positive), or queues for human review.
4. **Wire integrations** at `/settings/integrations` (Slack,
   ServiceNow, Okta, CrowdStrike, Cloudflare).
5. HBR actions (isolate, disable, revoke, block) route to
   `/approvals` for human go/no-go before they fire.
6. For SOC 2 / FFIEC examiners, mint a scoped MCP token at
   `/settings/mcp-tokens`. Hand them `/api/v1/mcp` + the bearer —
   they query directly from Claude / Cursor.

Apps-side deep-dive: `apps/soar/docs/ARCHITECTURE.md`,
`apps/soar/docs/DESIGN_PARTNER.md`.

## AML — transaction monitoring + SAR drafting

```
FedNow/ACH/SWIFT/banking webhook ─→ behavioral detector
                                          ↓
                  structuring · velocity · xb-cash · CTR · round-#
                                          ↓
                                   /cases → sar-drafter
                                          ↓
                          /sars (review → approved → file)
                                          ↓
                              HBR? ─→ /approvals queue
```

After register:

1. **Mint a connector token** at `/settings/connectors`. Pick
   FedNow (ISO 20022 pacs.008), ACH (NACHA), SWIFT (MT103 + pacs.008),
   or generic banking webhook.
2. Transactions flow into `/transactions`. The behavioral detector
   inline-flags structuring (3+ sub-CTR in 24h), velocity (>$1M/24h),
   cross-border cash, CTR threshold, and round-number.
3. SAR-candidates land on `/cases`. Pick a jurisdiction, click
   **Draft SAR** — the `sar-drafter` agent (or deterministic
   FinCEN/NCA/AUSTRAC/FINTRAC/goAML template) produces a regulator-
   grade narrative with statute references.
4. Review / approve at `/sars/[id]`. **File with regulator** is HBR —
   routes through `/approvals`.
5. **Wire integrations** at `/settings/integrations` (ComplyAdvantage
   sanctions, FinCEN BSA E-Filing, core-banking account holds, Slack).
6. For FFIEC / OCC / NYDFS / FCA examiners, mint a scoped MCP token —
   they query case/transaction/SAR/screening data directly from Claude.

Apps-side deep-dive: `apps/aml/docs/ARCHITECTURE.md`,
`apps/aml/docs/DESIGN_PARTNER.md`.

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
    ├── soar/                  @synapcores/soar
    │   └── (see apps/soar/README.md + docs/ARCHITECTURE.md)
    │
    └── aml/                   @synapcores/aml
        └── (see apps/aml/README.md + docs/ARCHITECTURE.md)
```

**Data flow** (same in both apps):
- The **engine** holds everything persistent (users, tenants, app
  data, audit, integrations, MCP tokens).
- The **apps** are stateless: server-rendered Next.js + server
  actions. `.next/` cache is the only meaningful app-side state.
- Each app lives in its own tenants; users with memberships in both
  can switch apps without re-auth.

## Stack

- Next.js 15 (App Router, server actions)
- TypeScript (strict)
- Tailwind CSS + shadcn/ui
- Auth.js v5 (credentials + magic-link)
- bcryptjs (password + API key + connector + MCP-token hashing)
- zod (validation)
- @synapcores/app-framework (auth + RBAC + shared UI + agent)
- SynapCores Community Edition v1.7.0.1-ce (data tier)

## Licensing

- `packages/app-framework` — Apache-2.0
- `apps/soar` — Apache-2.0 (open core)
- `apps/aml` — Apache-2.0 (open core)
- Enterprise tier (managed cloud + certified playbook library + SOC 2
  Type II auditor portal + dedicated support) — request pricing at
  https://synapcores.com.

## Contributing

Issues + PRs welcome. The framework
(`packages/app-framework`) is designed for reuse across vertical apps —
SOAR + AML are the first two; Compliance + Claims + Legal are next.

## Status

**Design-partner alpha.** Not yet GA. Both end-to-end loops run on the
same engine. Production deployments need an LLM wired (see
`*_TRIAGE_MODE=auto`) and the relevant adapters configured.
