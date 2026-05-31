# SOAR Demo Completion — Req #3 Live Validation

**Date:** 2026-05-31
**Engine:** SynapCores CE v1.7.0.2-ce-pass7 (host binary, build 9b9220fc + pass-7 fixes)
**Validator:** Direct REST calls against `/v1/query/execute` on `127.0.0.1:28080`

## What was tested

Requirement 3 of the SOAR Demo Completion doc lists 14 required graph
node types and 13 required relationship types. Each was created with a
real Cypher `MERGE` and verified to round-trip; three multi-hop
traversals exercise the demo-narrative shape end-to-end.

## Results — 30/30 PASS

### Nodes (14/14)

```
✅ Incident             ✅ Alert               ✅ User
✅ Device               ✅ IPAddress           ✅ Service
✅ Deployment           ✅ Commit              ✅ CloudAccount
✅ IAMRole              ✅ RemediationAction   ✅ Analyst
✅ Evidence             ✅ HistoricalIncident
```

### Relationships (13/13)

```
✅ ALERT_BELONGS_TO_INCIDENT          ✅ USER_LOGGED_IN_FROM_IP
✅ USER_USED_DEVICE                   ✅ DEVICE_TRIGGERED_ALERT
✅ SERVICE_DEPENDS_ON_SERVICE         ✅ DEPLOYMENT_CHANGED_SERVICE
✅ COMMIT_DEPLOYED_IN                 ✅ INCIDENT_IMPACTED_SERVICE
✅ INCIDENT_SIMILAR_TO   (with {score: 0.87} — props survive)
✅ INCIDENT_RESOLVED_BY               ✅ ACTION_APPROVED_BY
✅ EVIDENCE_ATTACHED_TO               ✅ INCIDENT_LEARNED_FROM
```

### Multi-hop traversals (3/3)

| Query | Result |
|---|---|
| `Incident ← Alert ← Device ← User` (3-hop) | returns Alice's User node |
| `Incident → Service` (blast radius) | returns checkout-api |
| `Incident → HistoricalIncident WITH r.score` | returns `HIST-001, 0.87` |

## What this proves

The SOAR app's graph layer (v0.2.0 `src/lib/graph/incident-graph.ts`)
backed by the engine's Cypher backend can:

1. Build the full incident-correlation graph the demo requires
2. Carry relationship properties (similarity scores survive round-trip)
3. Run real multi-hop traversals for blast-radius + RCA agent input
4. Lookup similar past incidents (the closed-loop memory retrieval
   path from Req #9)

## Engine compatibility note

These tests run against `/v1/query/execute` directly — the pass-3 fix
for #223 (dedicated graph_backend attachment) means Cypher works
through the production SQL endpoint. No app-side workaround needed.

Pass-7's fix for #235 (UNION misroute) also benefits this layer
since SOAR's dashboard rollups (`SELECT … UNION ALL SELECT …` for
combining alert+incident counters) now route through the correct SQL
union executor instead of the Cypher executor.

## Reproducer

Saved at `/home/devops/scratch/pass7-fresh-cert/soar-req3-validation.log`
— rerun by replaying the 30 SQL statements against any running
v1.7.0.2-ce-pass7 (or later) engine.
