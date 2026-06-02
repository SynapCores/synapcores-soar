# SynapCores SOAR

**Open-source autonomous SOC platform. Tier-1 triage agents, immutable audit, MCP examiner portal. Self-hostable on a single Docker host.**

<!-- TODO(maintainer): drop a screenshot or GIF here.
     Suggested: a 5-second loop of an alert arriving, the triage agent
     running, an incident appearing in /incidents, an HBR action queued
     in /approvals. Without an image this README converts ~3× worse on
     GitHub. -->

> A Tines / Torq / Cortex XSOAR alternative — open-source, runs on your hardware, the same engine your AI agents use.

```
SIEM/EDR webhook ──► EMBED dedup ──► Tier-1 triage agent ──► Incident
                                              │                 │
                                       /actions ledger ──► adapter fires
                                              │
                                        HBR? ──► /approvals queue (human go/no-go)
                                              │
                                        immutable audit ──► MCP examiner portal
```

---

## What it does

Every step here is **shipping today** on `main`, not slideware:

- **Ingest alerts from your SIEM/EDR.** First-class connectors for Splunk HEC, Microsoft Sentinel, CrowdStrike Falcon, Okta event hooks. Generic webhook with per-tenant Bearer tokens for anything else.
- **Dedup by meaning, not by hash.** Incoming alerts are EMBED'd; near-duplicate fan-out from a single root cause collapses to one incident.
- **Run a Tier-1 triage agent against every alert.** Configurable agent personas, action library, SIEM lookups, deploy correlation. Output: true positive → incident, false positive → close, ambiguous → human review.
- **Action library with HBR gating.** Out-of-the-box adapters for Slack, ServiceNow, Okta (revoke session), CrowdStrike (isolate host), Cloudflare (block IP). High-blast-radius actions queue in `/approvals` for human go/no-go before they fire.
- **Immutable, examiner-ready audit trail.** Every action, every approval, every agent reasoning step persists to an append-only ledger.
- **MCP examiner portal.** Mint a scoped MCP token, hand the bearer to your SOC 2 / FFIEC examiner — they query the audit ledger directly from Claude / Cursor without touching the SOC team's daily flow.

## Why this exists

Existing SOAR products are either expensive enterprise stacks (Splunk SOAR, Cortex XSOAR) or polished SaaS with per-action billing (Tines, Torq). None of them are self-hostable, none let you BYO LLM, and none expose an audit ledger that a regulator can examine themselves.

This is the SOC platform built the way SOC engineers actually want it: open core, local-first, AI-native, examiner-friendly.

## Quickstart (5 minutes, single Docker host)

Requires **Docker 24+** and **~4 GB free RAM** for the SynapCores engine.

```bash
git clone https://github.com/SynapCores/synapcores-soar
cd synapcores-soar
cp .env.example .env
# Edit .env: set AIDB_JWT_SECRET and AUTH_SECRET (both 32 random bytes).
# Leave SYNAPCORES_ADMIN_API_KEY blank for first boot.

# 1. Boot the SynapCores engine
docker compose up -d synapcores

# 2. Grab the engine admin password
docker compose logs synapcores | grep "password:"
# → log into http://localhost:28080, mint an admin API token,
#   paste it into .env as SYNAPCORES_ADMIN_API_KEY

# 3. Boot SOAR
docker compose up -d soar

# 4. Register the first user — becomes the workspace owner
open http://localhost:3001/register
```

That's the entire install. **Less than 5 minutes** assuming the engine container pulls cleanly.

## First 15 minutes after install

1. **Mint a connector token** at `/settings/connectors`. Point your SIEM at the resulting webhook URL.
2. Alerts appear at `/alerts`. Click **Run Tier-1 triage** to dispatch the agent.
3. Watch the agent route the alert → `/incidents` (true positive), close it (false positive), or queue for human review.
4. **Wire integrations** at `/settings/integrations` — Slack, ServiceNow, Okta, CrowdStrike, Cloudflare.
5. Actions with high blast radius (isolate host, disable user, revoke session, block IP) queue at `/approvals` for human go/no-go before firing.
6. For a SOC 2 / FFIEC examiner, mint a scoped MCP token at `/settings/mcp-tokens`. Hand them `/api/v1/mcp` + the bearer. They query the audit trail from Claude or Cursor without touching the SOC team.

## What ships out of the box

| Surface | What it does | Path |
|---|---|---|
| `/alerts` | Inbound alert queue + manual Tier-1 dispatch | `apps/soar/src/app/(app)/alerts` |
| `/incidents` | Active and closed incidents, triage history | `apps/soar/src/app/(app)/incidents` |
| `/actions` | Action library, run history, status | `apps/soar/src/app/(app)/actions` |
| `/approvals` | HBR queue for high-blast-radius actions | `apps/soar/src/app/(app)/approvals` |
| `/audit` | Immutable audit ledger | `apps/soar/src/app/(app)/audit` |
| `/playbooks` | Authored playbooks + dry-run + simulation | `apps/soar/src/app/(app)/playbooks` |
| `/dashboard` | MTTD / MOT / MTTR metrics | `apps/soar/src/app/(app)/dashboard` |
| `/settings/connectors` | Per-tenant ingest tokens | `apps/soar/src/app/(app)/settings/connectors` |
| `/settings/integrations` | Slack / ServiceNow / Okta / CrowdStrike / Cloudflare config | `apps/soar/src/app/(app)/settings/integrations` |
| `/settings/mcp-tokens` | Scoped MCP tokens for examiners | `apps/soar/src/app/(app)/settings/mcp-tokens` |
| `/team` | Workspace members + RBAC | `apps/soar/src/app/(app)/team` |

## Connectors (ingest side)

| Source | Status | Notes |
|---|---|---|
| Splunk HEC | ✅ Shipped | First-class adapter |
| Microsoft Sentinel | ✅ Shipped | Logic-App-shaped payload |
| CrowdStrike Falcon | ✅ Shipped | Workflow integration |
| Okta event hooks | ✅ Shipped | First-class adapter |
| Elastic SIEM | ✅ Generic webhook | First-class adapter on roadmap |
| Datadog / Prometheus / Jira / GitHub | 🟡 Generic webhook | First-class adapters on roadmap (v0.3.0) |
| OpenTelemetry / SentinelOne / CloudTrail | ❌ Roadmap | Tracked in `apps/soar/docs/CAPABILITY_MATRIX.md` |
| Kafka streaming | Enterprise only | Engine supports it; SOAR adapter gated to EE |

The full matrix lives at [`apps/soar/docs/CAPABILITY_MATRIX.md`](apps/soar/docs/CAPABILITY_MATRIX.md).

## Action library (response side)

| Action | Adapter | HBR-gated by default |
|---|---|---|
| `notify_channel` | Slack | No |
| `create_ticket` | ServiceNow | No |
| `revoke_session` | Okta | **Yes** |
| `disable_user` | Okta | **Yes** |
| `isolate_host` | CrowdStrike | **Yes** |
| `block_ip` | Cloudflare | **Yes** |
| `add_comment` | (internal) | No |

HBR = High Blast Radius. Anything that could break production if wrong queues for human approval at `/approvals`. Configurable per-tenant.

## How this compares

| | SynapCores SOAR | Tines | Torq | Splunk SOAR | Cortex XSOAR |
|---|---|---|---|---|---|
| Self-hosted | ✅ Single Docker | ❌ SaaS only | ❌ SaaS only | ✅ Heavy stack | ✅ Heavy stack |
| Open source | ✅ Apache-2.0 (apps), CE binary (engine) | ❌ Proprietary | ❌ Proprietary | ❌ Proprietary | ❌ Proprietary |
| BYO LLM | ✅ OpenAI / Anthropic / local Ollama | 🟡 Paid add-on | 🟡 Paid add-on | ❌ | 🟡 Limited |
| Per-action pricing | ❌ Flat | ✅ Yes | ✅ Yes | ❌ Enterprise license | ❌ Enterprise license |
| Immutable audit | ✅ First-class | 🟡 Read-only logs | 🟡 Read-only logs | ✅ | ✅ |
| MCP examiner portal | ✅ Out of the box | ❌ | ❌ | ❌ | ❌ |
| Install time | ~5 min | n/a (SaaS) | n/a (SaaS) | days | days |

## Architecture (single host)

```
                  ┌───────────────────────────────┐
                  │   SynapCores Engine (CE)      │
                  │  vectors · SQL · graph · IM   │
                  │           :28080              │
                  └──────────────┬────────────────┘
                                 │ HTTP
                          ┌──────▼──────┐
                          │  SOAR app   │
                          │   :3001     │
                          └─────────────┘
```

The SOAR app is a Next.js application talking to the SynapCores CE engine over HTTP. Both run as containers on a single host. All ingest happens through SOAR's HTTPS endpoints; the engine never accepts external traffic.

For depth, see [`apps/soar/docs/ARCHITECTURE.md`](apps/soar/docs/ARCHITECTURE.md).

## Roadmap

Tracked in [`apps/soar/docs/CAPABILITY_MATRIX.md`](apps/soar/docs/CAPABILITY_MATRIX.md). Highlights:

- **v0.3.0** — first-class adapters for Datadog, Prometheus, GitHub, Jira; SentinelOne EDR; AWS CloudTrail
- **v0.4.0** — playbook marketplace, agent persona templates per vertical (fintech, healthcare, manufacturing)
- **v0.5.0** — OpenTelemetry receiver, inbound Slack slash commands

## Design partner program

Two-to-four-week sprint where the SynapCores team (engineering + product) sits in your Slack and ships a working tier-1 triage agent against your real SIEM stack. Free for selected partners in exchange for a case study.

Apply: https://synapcores.com/partners

## Community

- **Issues & feature requests**: GitHub issues on this repo
- **Discussion**: GitHub Discussions
- **Security disclosures**: security@synapcores.com

## License

- **SOAR app code** (`apps/soar` + `packages/app-framework`): Apache-2.0
- **SynapCores engine binary** (Community Edition): free under SynapCores CE EULA; source is proprietary

See `LICENSE` in this repo for the SOAR app terms.

## Related repositories

- **The engine itself**: https://github.com/SynapCores/synapcores-releases (Community Edition binaries)
- **The AML transaction-monitoring sibling app**: https://github.com/SynapCores/synapcores-aml
- **Reference agents** (drop-in Python / voice): https://github.com/SynapCores/synapcores-agent
- **Docs**: https://docs.synapcores.com

---

Built by [SynapCores](https://synapcores.com). If this saved your SOC team a day of work, [⭐ the repo](https://github.com/SynapCores/synapcores-soar/stargazers).
