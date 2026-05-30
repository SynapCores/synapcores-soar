# SynapCores AML — Design Partner Welcome

Thanks for being one of the first AML deployments.

## What's working today (alpha)

End-to-end:

1. **Transaction ingest** from 4 sources: FedNow (RTP/ISO 20022 pacs.008),
   ACH (NACHA), SWIFT (MT103 + pacs.008 MX), and a generic core-banking
   webhook. Generate the connector token at `/settings/connectors`.
2. **Behavioral detection** runs inline on every ingest:
   - structuring (3+ sub-CTR txs in 24h)
   - velocity (>$1M aggregated in 24h per customer)
   - cross-border cash (cash type + non-US destination)
   - CTR-threshold + round-number flags
3. **SAR-drafter agent** dispatched via `AGENT_RUN('sar-drafter', ...)`
   with a deterministic jurisdiction-templated fallback. Five
   jurisdictions: `us-fincen`, `uk-nca`, `au-austrac`, `ca-fintrac`,
   `eu-goaml`. The fallback narrative quotes 31 CFR 1020.320 (or the
   relevant local statute) and rolls in correct peer-aggregate.
4. **HBR action layer** gates `file_sar` and `freeze_account` through
   `/approvals` for human go/no-go before they fire.
5. **MCP examiner portal**. Mint a scoped MCP token, hand to your
   FFIEC / OCC / NYDFS / FCA examiner. They paste it into Claude or
   Cursor and query the case file directly. Every query they make is
   audit-logged at `/audit/mcp-sessions`.
6. **Immutable audit log** with `VERIFY_CHAIN()` integration.

## What's known-gap (alpha → beta → GA)

- The `sanctions-investigator` and `kyc-enricher` agents have prompts
  defined but no UI surface yet — beta adds them on customer detail.
- The `evidence-collector` agent ships in beta; the data tables it
  consumes (UBO graph, case timeline) are populated, but the manifest-
  builder UI is pending.
- The FinCEN BSA E-Filing adapter accepts the customer-side JSON
  envelope; production XSD form-111 transform drops in at the first
  customer deployment.
- Sanctions list ingest cron (OFAC / OpenSanctions / Dow Jones) is
  manual in alpha. Beta adds the scheduled refresh.

## How to wire your first transaction in 5 minutes

```sh
# 1. boot the stack
cp .env.example .env  # fill in AIDB_JWT_SECRET + AUTH_SECRET
docker compose up -d

# 2. wait, get admin password
docker compose logs synapcores | grep "password:"

# 3. open http://localhost:3003/register, create your owner account
#    and the workspace.

# 4. seed realistic transactions:
#    a. mint API key at /settings/api-keys
#    b. AML_API_KEY=sk_user_... pnpm --filter @synapcores/aml seed-demo

# 5. open /cases — one SAR-candidate should be visible
#    (the C-771 → BVI Holdings LLC structuring pattern).

# 6. click into /transactions/[id] for that case, pick a jurisdiction,
#    click Draft SAR. The sar-drafter writes a regulator-grade
#    narrative either via AGENT_RUN or the deterministic fallback.

# 7. on /sars/[id]: edit + Save (status=review), Approve for filing
#    (status=approved), then File with regulator (HBR) — lands on
#    /approvals for a second pair of eyes.
```

## What we'd love feedback on

1. Does the structuring detector match your actual customer behavior?
   The threshold + window (3 sub-CTR in 24h) is tunable in
   `src/lib/aml-transactions.ts`.
2. Does the fallback SAR narrative match what your regulator expects?
   The templates in `src/lib/sar-templates.ts` are editable per
   tenant in production.
3. Is the MCP examiner portal in a shape your real FFIEC / OCC
   examiner would actually use? Specifically: are the 6 tools the
   right surface, or do you need additional read paths for the way
   your bank's audit defenses are structured?
4. UBO graph: we model `aml_ubo_relationships` and the sar-drafter
   walks it. Does your bank already have a UBO data source we should
   wire (OpenCorporates, commercial registry, internal)?

## Reaching us

- **Discord**: https://discord.gg/synapcores `#aml-design-partners`
- **GitHub**: https://github.com/SynapCores/synapcores-aml/issues
- **Anything else**: design-partners@synapcores.com

## SLA expectations (alpha)

- Issues acknowledged within 24 business hours
- ~2-week release cadence during the design-partner phase
- Migration steps documented in every release note

## When the time is right

Design-partner Enterprise pricing locks at sign-up level for the first
12 months. The open core is and stays free under Apache-2.0.
