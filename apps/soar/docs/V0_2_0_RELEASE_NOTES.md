# SynapCores SOAR v0.2.0 — Demo Completion Release Notes

Closes the SOAR Demo Completion Requirements doc — turns the v0.1.0
"autonomous SOC concept" into a complete closed-loop incident response
demo.

## Coverage vs the 12 Requirements

| Req | What | Status | Where |
|---|---|---|---|
| 1 | Ingestion Capability Matrix | ✅ Documented | `docs/CAPABILITY_MATRIX.md` |
| 2 | Demo Event Simulator | ✅ Shipped | `src/lib/simulator/` |
| 3 | Incident Knowledge Graph | 🟡 SQL projection ships, Cypher-via-SQL pending engine #223 | `src/lib/v0_2_0_migration.sql` |
| 4 | Similar Incident Retrieval | ✅ Shipped (vector + entity Jaccard + sequence Jaccard) | `src/lib/learning/similar.ts` |
| 5 | Agent RCA | ✅ `rca-analyst` persona shipped | `src/lib/personas.ts` |
| 6 | Human-in-the-Loop Action Gate | ✅ Existing approval queue + new auto-approve allowlist | `src/lib/actions/approvals.ts` |
| 7 | Remediation Execution Layer | ✅ 10 actions (was 6 in v0.1) | `src/lib/actions/registry.ts` |
| 8 | Immutable Audit Trail | ✅ All 12 audit event types emit; `VERIFY_CHAIN()` exposed in `/audit` | `src/lib/schema.sql` + close-incident.ts |
| 9 | Closed-Loop Learning | ✅ Shipped — embeddings, MTTD/MTTR, pattern signature, future-memory retrieval | `src/lib/learning/close-incident.ts` |
| 10 | Dashboard Demo Flow | ✅ Existing 10-page navigation covers the loop; success-metrics card on `/dashboard` shows live MTTD/MTTR |
| 11 | Success Metrics | ✅ MTTD, MTTR, MTTT persisted on incident close; surfaced on `/dashboard` |
| 12 | Engineer Questions | ✅ Answered | `docs/ENGINEER_ANSWERS.md` |

## What's shipped (new files)

```
apps/soar/
├── docs/
│   ├── CAPABILITY_MATRIX.md      ← Req 1 + Req 12 Q1-4
│   ├── ENGINEER_ANSWERS.md       ← all 10 engineer questions
│   └── V0_2_0_RELEASE_NOTES.md   ← this file
├── src/lib/
│   ├── v0_2_0_migration.sql      ← schema additions for learning + RCA
│   ├── personas.ts               ← +1 (rca-analyst, total now 6)
│   ├── actions/registry.ts       ← +4 actions (rollback_deployment,
│   │                                attach_evidence_pack, close_incident,
│   │                                mark_related_alerts), total now 10
│   ├── simulator/
│   │   ├── types.ts              ← SimEvent / Scenario / SimulatorConfig
│   │   ├── scenarios.ts          ← 2 canonical scenarios (compromised
│   │   │                            session + deployment regression)
│   │   ├── run.ts                ← webhook + file + kafka(EE) emitters
│   │   └── index.ts
│   └── learning/
│       ├── close-incident.ts     ← Req 9 — the headline closed-loop feature
│       └── similar.ts            ← Req 4 — vector + graph similarity
```

## How the demo runs end-to-end

```sh
# 1. boot the stack
docker compose up -d

# 2. mint a webhook connector token at /settings/connectors

# 3. fire the canonical demo scenario
SOAR_URL=http://localhost:3001/api/v1/soar/alerts \
SOAR_TOKEN=<connector_token> \
pnpm --filter @synapcores/soar simulator:run \
  --scenario demo-compromised-session-001 \
  --mode webhook

# 4. open /dashboard → watch:
#    - live event stream  (alerts page)
#    - incident materialise (incidents page)
#    - entity graph build (graph card)
#    - similar incidents retrieved (similar panel on incident detail)
#    - RCA agent produces structured root cause (rca panel)
#    - recommended actions (actions list)
#    - approval queue (approvals page)
#    - audit trail (audit page)
#    - incident closes
#    - MTTD/MTTR appear on dashboard

# 5. replay the SAME scenario:
pnpm --filter @synapcores/soar simulator:run \
  --scenario demo-compromised-session-001 \
  --mode webhook
# → the new incident retrieves the prior incident as similar memory,
#   recommended actions pre-fill with the prior resolution
```

## Known gaps + workarounds

These are **documented as gaps**, not silently worked around:

### Gap 1 — Cypher graph queries via SQL endpoint (#223)

**Issue:** `MATCH (n) RETURN n` via `/v1/query/execute` errors with
*"Cypher execution requires a graph backend on ExecutionContext"*.
Engine bug #223 — the SQL execution context never attaches the graph
backend. Affects every deployment shape, not docker-specific.

**Workaround:** The SOAR graph layer uses the dedicated
`/v2/graph/*` REST endpoints (which DO wire the backend per-request).
The recipe text + graph projection in v0.2.0 uses those endpoints.

**When #223 lands:** the Cypher-in-SQL examples in our docs become
runnable as published; no SOAR app code change required.

### Gap 2 — Inline AUTOML.PREDICT inside arithmetic/aggregate (#232)

**Issue:** `SELECT SUM(CASE WHEN ABS(AUTOML.PREDICT(...) - col) < N
THEN 0 ELSE 1 END)` errors with feature-mismatch — the rewrite reads
the outer alias as a feature name.

**Workaround:** The SOAR app uses `AUTOML.PREDICT(...)` only in clean
top-of-SELECT shapes (works) and never inside CASE / arithmetic /
aggregate (broken). Where the RCA agent would naturally want
predict-driven branching, we split into a top-level `PREDICT`
statement + a follow-up SELECT.

### Gap 3 — `LIMIT (SELECT …)` subquery (#005-related)

**Issue:** `LIMIT (SELECT CEIL(...) FROM t)` parser errors.

**Workaround:** Compute the limit client-side (or hardcode reasonable
demo values). Affected: the similar-incident retrieval uses
`LIMIT $k` with a JS-computed `k`, never a subquery.

### Gap 4 — First-class connector breadth (v0.3.0)

Not a code gap, a release-line decision. v0.2.0 keeps the 4 first-class
connectors from v0.1.0 (Splunk / Sentinel / CrowdStrike / Okta) and
documents the generic-webhook path for Datadog / Prometheus / GitHub /
Jira. The first-class adapters for those + SentinelOne + AWS CloudTrail +
OTLP + Slack-inbound ship in v0.3.0.

### Gap 5 — Schema-cache invalidation race INSERT→UPDATE (#234)

**Issue:** A recipe that does `INSERT INTO t (...); UPDATE t SET ...`
in sequence can hit a schema-cache invalidation race that surfaces
as *"Table t does not exist"* on the UPDATE.

**Workaround:** The SOAR ingest path issues `INSERT INTO soar_alerts`
+ separate `UPDATE soar_incidents` calls; both target different tables
so the race doesn't trip. If two writes to the same table in the same
session start failing in production, route them through separate
sessions (acquire a new DB client between writes).

## Migrations

```sh
# Apply the v0.2.0 schema migration. Idempotent.
psql ... -f apps/soar/src/lib/v0_2_0_migration.sql
# OR via the engine's recipe endpoint:
curl -X POST http://localhost:8080/v1/recipes/execute \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"recipe\":$(cat apps/soar/src/lib/v0_2_0_migration.sql | jq -Rs .)}"
```

## Test plan for the demo viewer

```
1. Visit /dashboard → see "Live event stream" pane                      ← Req 10 step 1
2. Fire the simulator → alerts appear on /alerts in real time           ← Req 10 step 1
3. Within ~5s → incident created on /incidents                          ← Req 10 step 2
4. Click incident → "Entity graph" tab shows nodes + edges              ← Req 10 step 3
5. "Similar incidents" panel shows prior incidents w/ scores            ← Req 10 step 4
6. "RCA" panel shows structured root cause + recommended actions        ← Req 10 step 5/6
7. "Approvals" → analyst approves recommended action                    ← Req 10 step 7
8. "Actions" → executed action with adapter response logged             ← Req 10 step 8
9. "Audit" → full chain, VERIFY_CHAIN green check                       ← Req 10 step 9
10. After close → /dashboard shows MTTD/MTTR; replay → memory retrieved ← Req 10 step 10
```

## Demo Positioning (verbatim from Req doc)

> Observability tells you something broke.
>
> SynapCores SOAR shows what changed, remembers how similar incidents
> were resolved, reasons over the operational graph, executes approved
> response actions, and turns every incident into future memory.
