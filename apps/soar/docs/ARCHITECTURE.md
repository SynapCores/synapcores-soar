# SynapCores SOAR — Architecture

## Big picture

```
                   ┌────────────────────────────────┐
                   │  SIEM / EDR / IAM webhooks     │
                   │  (Splunk, Sentinel,            │
                   │   CrowdStrike, Okta, …)        │
                   └─────────────┬──────────────────┘
                                 │
                                 ▼
            POST /api/v1/connectors/{provider}
                                 │
              resolveConnectorToken (bcrypt) → tenantId
                                 │
                       per-provider mapper
                                 │
                       ingestAlert (Phase 4)
                                 │
                  EMBED(title || description)
                                 │
                  COSINE_SIMILARITY over 30d window
                       │                    │
                       ▼                    ▼
                  cosine ≥ 0.85          cosine < 0.85
                       │                    │
                       ▼                    ▼
                status='duplicate'      status='new'
                                 │
                       analyst clicks
                       Run Tier-1 triage
                                 │
                                 ▼
                  runTriage() ─→ AGENT_RUN('tier1-triage', alert_id)
                                 │
                       ┌─────────┴─────────┐
                       ▼                   ▼
                   verdict           timeout / no LLM
                                           │
                                           ▼
                              deterministic fallback
                                 │
                                 ▼
                  status = closed | incident | triaged
                                 │
                                 ▼
                       analyst / playbook
                       dispatches action
                                 │
                                 ▼
                  dispatchAction(actionId, args, ctx)
                                 │
                       ┌─────────┴─────────┐
                       ▼                   ▼
                  HBR + unapproved      non-HBR
                       │                   │
                       ▼                   ▼
              soar_approval_queue     adapter fires
              state='pending'         (Slack / Okta / CS / CF /
                       │              ServiceNow / webhook)
              human Approve/Reject          │
                       │                   │
                       ▼                   ▼
              re-dispatch with         state =
              preApproved:true         completed | failed
                       │                   │
                       └─────────┬─────────┘
                                 ▼
                       soar_audit_log (IMMUTABLE)
                                 │
                                 ▼
              examiner pastes mcp_... token into
              Claude / Cursor → tools/call → JSON-RPC reply
              (every call audit-logged with actor_type='mcp_token')
```

## Data tables (all tenant-scoped)

### Framework (control plane)
- `tenants` — workspaces
- `users` — humans
- `memberships` — user → tenant + role
- `invitations` — pending invites by email
- `sessions` — for "log out everywhere" + audit
- `auth_tokens` — magic-link / password-reset / email-verify
- `mcp_tokens` — scoped auditor tokens (Phase 3)
- `api_keys` — personal/programmatic bearer tokens (Phase 3)
- `framework_audit_log` — IMMUTABLE: cross-cutting events (login,
  invite, role change, mcp.mint, ...)

### SOAR domain (data plane)
- `soar_alerts` (with `VECTOR(384)` for the EMBED) — the firehose
- `soar_assets` / `soar_identities` / `soar_incidents` /
  `soar_incident_alerts` — the asset/identity/case model
- `soar_playbooks` — DAG of action calls + branches
- `soar_evidence` — tamper-evident artefact packs
- `soar_threat_intel` — IOC store
- `soar_integrations` — per-tenant adapter + connector config
  (`provider='slack'` for action adapters; `provider='connector_X'`
  for ingest connectors)
- `soar_actions` — every dispatched action (ledger)
- `soar_approval_queue` — HBR actions waiting on human decision
- `soar_audit_log` — IMMUTABLE: every alert state change, every
  agent tool call, every analyst override

## The 5 agent personas

Defined in `src/lib/personas.ts`. Each carries: name +
system-prompt + tool registry + model preference + HBR action list.
Registered in the engine via the operator's `ai_chat.toml`. Phase 5
ships a deterministic fallback so the loop is reviewable without an
LLM wired.

| Persona | Job |
|---|---|
| `tier1-triage` | Dedup + score + escalate / close / queue-for-human |
| `incident-responder` | Walk the matched playbook, pause on HBR |
| `forensic-investigator` | Timeline reconstruction (read-only) |
| `threat-hunter` | Replay new IOCs against historical access |
| `evidence-collector` | Tamper-evident artefact packs |

## HBR (high blast radius) actions

These ALWAYS pause for human approval by default:
`isolate_endpoint`, `disable_user`, `revoke_sessions`, `block_ip`,
`snapshot_disk`. The dispatcher writes to `soar_approval_queue`,
human flips at `/approvals`, dispatcher re-fires with
`preApproved: true`.

Phase 7 verifies this end-to-end (approve + reject paths, edge cases:
expired, already-decided, missing action row).

## MCP examiner portal

JSON-RPC 2.0 over POST at `/api/v1/mcp`. 5 read-only tools:
`query_audit_log`, `query_alerts`, `query_incidents`, `list_actions`,
`verify_chain`. Tenant + scope bound at token mint.

Every `tools/call` writes a `soar_audit_log` row with
`actor_type='mcp_token'`. Workspace owner can review at
`/audit/mcp-sessions/[token_id]`.

## Engine quirks (CE)

Worked around throughout the codebase, called out inline where the
workaround lives:

- **JOINs across tables are unreliable.** We do two-step lookups
  (e.g. memberships → tenants in `resolveFrameworkSession`,
  approval_queue → actions in `listPendingApprovals`).
- **`::json` casts on INSERT are not supported.** Pass JSON columns
  as already-stringified TEXT.
- **`DEFAULT NOW()` doesn't reliably auto-populate on tables with
  `VECTOR` columns or some other schemas.** Pass `NOW()` explicitly
  in the INSERT VALUES.
- **Dynamic WHERE assembly is fragile.** Resolve filter shapes at
  compile time and dispatch to fixed-shape queries (see `listAlerts`).
- **Param-binding via `$N` placeholders requires prepare/exec.** The
  SDK transparently routes parameterized SQL through
  `/v1/query/prepare` → `/v1/query/exec` → `/v1/query/close`.

## Stack choices, briefly

- **Next.js 15 App Router**: server components by default, server
  actions for mutations. Saves us from building a separate BFF.
- **SynapCores Community Edition** as the entire data tier — no
  Postgres, no Redis, no separate vector DB. One process.
- **Auth.js v5 (next-auth 5 beta)**: JWT-mode sessions with framework
  Session shape resolved per request from DB. Credentials + magic-
  link providers ship; SSO providers slot in without forking.
- **bcryptjs**: every credential (user passwords, API keys, MCP
  tokens, connector tokens, tenant keys) hashed with cost 12.
- **zod**: schema validation at every boundary — webhook bodies,
  server-action input, playbook JSON.

## Phasing trail

Each phase has its own commit + verification log in `git log`. The
big-ticket integration tests live inline in the phase commits.
