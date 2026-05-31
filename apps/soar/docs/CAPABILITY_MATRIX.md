# SynapCores SOAR — Ingestion Capability Matrix

Answers to Requirement 1 / Engineer Question 1 of the
SOAR Demo Completion Requirements doc.

Status against the **current shipped CE engine** (v1.7.0.2-ce-test build,
2026-05-30) and the synapcores-soar `main` branch.

| Source Type | Supported Today? | CE or Enterprise | Notes |
|---|---|---|---|
| **Webhook ingestion** | ✅ Yes | CE | Generic `/api/v1/soar/alerts` Bearer-authed POST endpoint, per-tenant connector tokens, persisted to `soar_alerts` |
| **Splunk webhook/API** | ✅ Yes | CE | First-class `/api/v1/connectors/splunk` (HEC-format) — `apps/soar/src/lib/connectors/splunk-hec.ts` |
| **Microsoft Sentinel** | ✅ Yes | CE | First-class `/api/v1/connectors/sentinel` (Logic-App-shaped) — `apps/soar/src/lib/connectors/sentinel.ts` |
| **CrowdStrike Falcon** | ✅ Yes | CE | First-class `/api/v1/connectors/crowdstrike` workflow — `apps/soar/src/lib/connectors/crowdstrike.ts` |
| **Okta** | ✅ Yes | CE | First-class `/api/v1/connectors/okta` event hooks — `apps/soar/src/lib/connectors/okta.ts` |
| **Elastic / SIEM webhook** | ✅ Yes | CE | Use the generic webhook endpoint; normalize at the connector level. First-class Elastic adapter is planned. |
| **Datadog webhook** | 🟡 Generic webhook | CE | No first-class adapter. The generic webhook works for trial; first-class adapter pending v0.3.0 of the SOAR app. |
| **Prometheus Alertmanager** | 🟡 Generic webhook | CE | Same — generic webhook works; first-class adapter pending v0.3.0. |
| **OpenTelemetry (OTLP)** | ❌ No | CE | Roadmap. Would land as a first-class OTLP receiver on a separate port + adapter that maps OTel spans → alerts. |
| **SentinelOne** | ❌ No | CE | Roadmap — same connector pattern as CrowdStrike, pending v0.3.0. |
| **AWS CloudTrail** | ❌ No | CE | Roadmap — needs S3-event-notification → SOAR webhook bridge OR direct CloudTrail event-bus subscriber. |
| **GitHub deployment events** | 🟡 Generic webhook | CE | The generic webhook endpoint accepts `application/json` from GitHub webhooks; first-class GitHub adapter (deployment/push/pr event normalization) pending v0.3.0. |
| **Jira ticket creation** | 🟡 Generic webhook | CE | Use the generic webhook endpoint with Jira's automation rules. First-class Jira adapter (event normalization + bidirectional incident sync) pending v0.3.0. |
| **Slack notification** | ✅ Outbound only | CE | The Slack adapter exists for **outbound** (notifications in the action library — `notify_channel`). Inbound Slack-event ingestion (e.g. `/alert` slash command, alerting bot) is roadmap. |
| **Kafka protocol streaming** | ❌ No (CE) | **Enterprise only** | Per directive — Kafka protocol support is reserved for the Enterprise edition. SynapCores engine has Kafka streaming primitives (`crates/aidb-query/src/streaming_kafka.rs`) but the SOAR app's Kafka source adapter is gated to Enterprise builds. The simulator includes a Kafka mode stub for Enterprise validation. |

## Legend

- ✅ **Yes** — first-class adapter shipped on `main`, end-to-end tested via recipe-cert
- 🟡 **Generic webhook** — works via the generic webhook endpoint, but no first-class adapter yet (operator does the schema-mapping work themselves)
- ❌ **No** — not in `main`; tracked in roadmap

## Source-of-truth in code

- Connector adapters: `apps/soar/src/lib/connectors/`
- Connector token minting: `apps/soar/src/lib/connectors/mint.ts`
- Generic webhook handler: `apps/soar/src/lib/connectors/handler.ts`
- REST routes: `apps/soar/src/app/api/v1/connectors/*/route.ts`

## What ships in v0.2.0 (this release) vs v0.3.0 (next)

**v0.2.0 ships (this release) — SOAR Demo Completion pass:**
- Demo event simulator (Req 2)
- RCA agent persona (Req 5)
- Closed-loop learning module (Req 9)
- 9-action remediation library (Req 7)
- Auto-approve for low-risk actions (Req 6)
- Capability matrix + engineer answers (this doc + ENGINEER_ANSWERS.md)

**v0.3.0 (next) — Connector breadth:**
- First-class Datadog, Prometheus, GitHub, Jira, SentinelOne, AWS CloudTrail adapters
- OTLP receiver (separate port + adapter)
- Slack inbound (events API + slash command)
