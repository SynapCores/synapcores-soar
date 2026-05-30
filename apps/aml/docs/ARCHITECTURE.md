# SynapCores AML — Architecture

## Big picture

```
        ┌──────────────────────────────────────────┐
        │  core-banking / payment-rail webhooks     │
        │  (FedNow, ACH, SWIFT, generic core)       │
        └────────────────────┬─────────────────────┘
                             ▼
            POST /api/v1/connectors/{provider}
                             │
              resolveConnectorToken (bcrypt) → tenantId
                             │
                     per-provider mapper
                             │
                ingestTransaction (Phase 2)
                             │
              EMBED(narrative || counterparty)
                             │
            FOUR behavioral detectors run inline:
              ┌─ structuring (3+ sub-CTR in 24h)
              ├─ velocity (>$1M aggregated 24h)
              ├─ cross_border_cash (cash type + non-US)
              └─ ctr_threshold / round_number
                             │
                             ▼
       status = new | triaged | sar_candidate | cleared | duplicate
                             │
                             ▼
              analyst clicks Draft SAR
              + picks jurisdiction
                             │
                             ▼
          runSarDrafter() → AGENT_RUN('sar-drafter', payload)
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
              verdict           timeout / no LLM
                                       │
                                       ▼
                        buildSarNarrative(jurisdiction, ctx)
                  ┌──────────┴──────────┘
                  ▼
               aml_sars (status=draft)
                  │
                  ▼ analyst edits + saves (status=review)
                  ▼ Approves for filing (status=approved)
                  ▼ Clicks "File with regulator (HBR)"
                  │
                  ▼
       dispatchAction('file_sar', args, ctx) — HBR
                  │
                  ▼
         aml_approval_queue (state=pending)
                  │
                  ▼ human reviewer approves
                  ▼
       fincenBsaFileSarAdapter → BSA E-Filing
                  │
                  ▼
        aml_audit_log (IMMUTABLE)
                  │
                  ▼
      examiner pastes mcp_... token into Claude → tools/call
      (every call audit-logged with actor_type='mcp_token')
```

## Data tables (all tenant-scoped)

### Framework (control plane — shared with SOAR + other apps)
- `tenants`, `users`, `memberships`, `invitations`, `sessions`
- `auth_tokens`, `mcp_tokens`, `api_keys`
- `framework_audit_log` (IMMUTABLE)

### AML domain (data plane)
- `aml_transactions` (with `VECTOR(384)` for the narrative embed)
- `aml_customers`, `aml_accounts`
- `aml_sanctions_hits` (OFAC/PEP/adverse-media findings)
- `aml_ubo_relationships` (graph traversal target for sar-drafter)
- `aml_cases` + `aml_case_transactions` junction
- `aml_sars` (jurisdiction-templated)
- `aml_integrations`, `aml_actions`, `aml_approval_queue`
- `aml_audit_log` (IMMUTABLE)

## The 5 agent personas

| Persona | Job | HBR actions |
|---|---|---|
| `tm-triage` | Dedup + score + escalate / clear / queue-for-human | `freeze_account`, `file_sar` |
| `kyc-enricher` | CDD/EDD + risk-rating refresh | — |
| `sanctions-investigator` | True/false-positive resolution | — |
| `sar-drafter` | UBO walk + similar-SAR retrieval + jurisdiction template | — |
| `evidence-collector` | Tamper-evident artefact packs | — |

## HBR actions

- `file_sar` (FinCEN BSA E-Filing or equivalent — irreversible)
- `freeze_account` (core-banking hold — customer-impact)

Both route through `/approvals` for human go/no-go before they fire.

## Action library

| Action | HBR | Adapters |
|---|---|---|
| `notify_channel` | no | slack, webhook |
| `create_ticket` | no | servicenow |
| `screen_customer` | no | complyadvantage |
| `file_sar` | yes | fincen-bsa |
| `freeze_account` | yes | core-banking |
| `request_eddr` | no | webhook |
| `escalate_to_l2` | no | slack, webhook |

## Connectors

| Provider | Path | Notes |
|---|---|---|
| FedNow | `/api/v1/connectors/fednow` | ISO 20022 pacs.008 normalized envelope |
| ACH | `/api/v1/connectors/ach` | NACHA entry detail records |
| SWIFT | `/api/v1/connectors/swift` | MT103 + pacs.008 MX |
| banking | `/api/v1/connectors/banking` | Generic core-banking passthrough |

Mint a connector token at `/settings/connectors` and paste into your
upstream system's webhook config.

## MCP examiner portal

JSON-RPC 2.0 at `/api/v1/mcp`. Six read-only tools the examiner queries
through Claude / Cursor:

- `query_audit_log` (filter by action prefix + actor type)
- `query_transactions` (filter by status)
- `query_cases`
- `query_sars` (filter by status)
- `query_screening_hits` (filter by status)
- `verify_chain` (graceful degrade when engine lacks VERIFY_CHAIN)

Workspace owner sees every individual call at
`/audit/mcp-sessions/[token_id]`.

## Engine quirks (carried over from SOAR)

Same workarounds, same callout-comments inline:

- JOINs across tables unreliable → two-step lookups.
- `::json` casts not supported → pass JSON as already-stringified TEXT.
- `DEFAULT NOW()` doesn't reliably auto-populate → pass `NOW()`
  explicitly in INSERT VALUES (caught for tenants/users/api_keys
  during AML smoke-test; framework now bakes the explicit timestamp).
- ORDER BY column must appear in SELECT.
- Param binding via `$N` placeholders requires prepare/exec — handled
  transparently by the SDK.

## Stack

- Next.js 15 App Router + server actions
- SynapCores Community Edition (data tier)
- Auth.js v5 JWT-mode sessions
- bcryptjs (every credential)
- zod (boundary validation)
- @synapcores/app-framework (auth + RBAC + UI + SDK)
