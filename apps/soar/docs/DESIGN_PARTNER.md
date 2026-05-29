# SynapCores SOAR — Design Partner Welcome

Thanks for being one of the first deployments.

This doc is the short version of what to wire, what to expect, and
how to reach us when something doesn't work.

## What's actually working today (alpha)

End-to-end:

1. **Alert ingest** from Splunk, Microsoft Sentinel, CrowdStrike
   Falcon, Okta. Generate the connector token at
   `/settings/connectors`; copy/paste the bearer + URL into the
   upstream system.
2. **Semantic alert dedup** via EMBED + cosine ≥ 0.85 over a rolling
   30-day window. Verified: cosine 0.907 between two near-identical
   PowerShell alerts; cosine ‑0.016 between unrelated alerts.
3. **Tier-1 triage agent**. Dispatches via SQL `AGENT_RUN('tier1-
   triage', ...)`. If you don't have an LLM wired yet, set
   `SOAR_TRIAGE_MODE=fallback` and the deterministic rules-based
   triage takes over so you can watch the loop.
4. **6 actions** with HBR gating: `notify_channel`, `create_ticket`,
   `isolate_endpoint`, `disable_user`, `revoke_sessions`, `block_ip`.
   HBR ones (isolate / disable / revoke / block) route through
   `/approvals` for human go/no-go before they fire.
5. **MCP examiner portal**. Mint a scoped token at
   `/settings/mcp-tokens`, hand it to your SOC 2 / FFIEC examiner.
   They paste it into Claude or Cursor and query the audit log,
   incidents, and evidence directly. Every query they make is
   audit-logged on your side at `/audit/mcp-sessions`.
6. **Playbook authoring** with dry-run. Define DAGs of action calls +
   branches at `/playbooks/[id]`; simulate against fixture alerts
   before enabling.

## What's a known gap (alpha → beta → GA)

These are tracked in the issues tab:

- The triage agent's `enrich_asset` / `enrich_identity` tools rely on
  asset/identity rows being populated. Phase 8+ wires automated
  population from connectors.
- Investigation graph view is currently a placeholder card on the
  alert detail page. Beta wires `react-force-graph-2d` to the
  Cypher-backed asset/identity/alert subgraph.
- The `forensic-investigator` and `threat-hunter` personas have
  prompts defined but no UI surface yet. Beta exposes them on the
  incident detail page.
- The certified playbook library (50+ pre-built workflows) is the
  Enterprise tier deliverable. Open core ships with 2 starter
  templates (IR-Phishing-Click, AUTH-Impossible-Travel).

## How to wire your first alert in 5 minutes

```sh
# 1. boot the stack
cp .env.example .env  # fill in AIDB_JWT_SECRET + AUTH_SECRET
docker compose up -d

# 2. wait for the engine; get the admin password
docker compose logs synapcores | grep "password:"

# 3. open http://localhost:3001/register, create your owner account
#    and your first workspace.

# 4. seed some realistic alerts:
#    a. mint a personal API key at /settings/api-keys, copy plaintext
#    b. SOAR_API_KEY=sk_user_... pnpm --filter @synapcores/soar seed-demo

# 5. open /alerts, click Run Tier-1 triage on a high-severity row,
#    watch it land in /incidents.

# 6. open /approvals to see what an HBR action looks like queued
#    (request an isolate from any alert detail page).
```

## What we'd love feedback on

1. Does the alert dedup catch the duplicates your SOC actually sees?
   Tune `DEDUP_THRESHOLD` in `src/lib/soar-alerts.ts` and tell us
   what works.
2. Does the triage agent's verdict shape match what your analysts
   need to make a decision quickly?
3. Does the approval queue UX feel right? In particular: is the
   decision-note field doing the right thing for your audit story?
4. The MCP examiner portal is the wildcard. Does an actual SOC 2
   auditor know what to do with an MCP token? (If not, we have a
   bigger pre-flight email + ramp-up doc in the queue.)

## Reaching us

- **Real-time**: Discord — https://discord.gg/synapcores (the
  `#soar-design-partners` channel)
- **Engineering**: GitHub issues —
  https://github.com/SynapCores/synapcores-soar/issues
- **Anything else**: design-partners@synapcores.com

## Service-level expectations (alpha)

- This is **alpha**. We don't promise zero downtime; we promise we'll
  hear about it fast.
- We'll respond to design-partner GitHub issues within 24 business
  hours.
- We'll roll a release every ~2 weeks during the design-partner
  phase. Migration steps will always be in the release notes.

## When the time is right

Design-partner pricing for the Enterprise tier (managed cloud + the
certified playbook library + SOC 2 Type II auditor-portal license)
locks at the level we agreed at sign-up for the first 12 months. If
you decide to stay self-hosted forever, the open-core is and stays
free under Apache-2.0.
