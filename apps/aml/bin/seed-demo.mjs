#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/aml seed-demo
 *
 * Loads a realistic AML seed dataset:
 *   - 1 baseline tx
 *   - 3-tx structuring pattern (sub-CTR clustering)
 *   - 1 high-value CTR + round-number flag
 *   - 1 cross-border cash (xb-cash flag)
 *   - 1 ACH peer-velocity event
 *
 * Requires SOAR_API_KEY env var (mint at /settings/api-keys).
 */

const URL_BASE = process.env.AML_URL ?? 'http://localhost:3003';
const API_KEY = process.env.AML_API_KEY ?? process.env.SOAR_API_KEY;

if (!API_KEY) {
  console.error(
    '[seed-demo] AML_API_KEY (or SOAR_API_KEY) is required.\n' +
      'Mint one at /settings/api-keys and re-run:\n' +
      '  AML_API_KEY=sk_user_... pnpm --filter @synapcores/aml seed-demo',
  );
  process.exit(2);
}

const TRANSACTIONS = [
  {
    source: 'core-banking',
    source_tx_id: 'BANK-DEMO-1001',
    from_customer: 'C-771',
    from_account: 'ACCT-9821',
    to_counterparty: 'ACCT-1234 / BVI Holdings LLC',
    to_country: 'BVI',
    amount_usd: 1200,
    currency: 'USD',
    type: 'wire',
    narrative: 'Initial consultancy retainer',
    ts: '2026-05-29T08:00:00Z',
  },
  {
    source: 'core-banking',
    source_tx_id: 'BANK-DEMO-1002',
    from_customer: 'C-771',
    from_account: 'ACCT-9821',
    to_counterparty: 'ACCT-1234 / BVI Holdings LLC',
    to_country: 'BVI',
    amount_usd: 9800,
    currency: 'USD',
    type: 'wire',
    narrative: 'Real estate consulting fee',
    ts: '2026-05-29T10:00:00Z',
  },
  {
    source: 'core-banking',
    source_tx_id: 'BANK-DEMO-1003',
    from_customer: 'C-771',
    from_account: 'ACCT-9821',
    to_counterparty: 'ACCT-1234 / BVI Holdings LLC',
    to_country: 'BVI',
    amount_usd: 9500,
    currency: 'USD',
    type: 'wire',
    narrative: 'Consulting payment',
    ts: '2026-05-29T14:00:00Z',
  },
  {
    source: 'core-banking',
    source_tx_id: 'BANK-DEMO-1004',
    from_customer: 'C-771',
    from_account: 'ACCT-9821',
    to_counterparty: 'ACCT-1234 / BVI Holdings LLC',
    to_country: 'BVI',
    amount_usd: 9700,
    currency: 'USD',
    type: 'wire',
    narrative: 'Additional retainer (structuring should fire here)',
    ts: '2026-05-29T18:00:00Z',
  },
  {
    source: 'ach',
    source_tx_id: 'ACH-DEMO-2001',
    from_customer: 'C-882',
    amount_usd: 30000,
    currency: 'USD',
    type: 'ach',
    narrative: 'Quarterly distribution (CTR + round-number)',
    ts: '2026-05-29T11:00:00Z',
  },
  {
    source: 'core-banking',
    source_tx_id: 'BANK-DEMO-3001',
    from_customer: 'C-441',
    to_counterparty: 'GBR Trading Partners',
    to_country: 'CY',
    amount_usd: 15000,
    currency: 'USD',
    type: 'cash',
    narrative: 'Cross-border cash movement (xb-cash flag)',
    ts: '2026-05-29T12:00:00Z',
  },
];

async function ingest(tx) {
  const res = await fetch(`${URL_BASE}/api/v1/aml/transactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(tx),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log(
    `[seed-demo] ingesting ${TRANSACTIONS.length} transactions at ${URL_BASE}`,
  );
  for (const tx of TRANSACTIONS) {
    const r = await ingest(tx);
    if (!r.ok) {
      console.error(`  ✗ ${tx.source_tx_id} → HTTP ${r.status}`, r.body);
      continue;
    }
    const dup = r.body.dup_of ? ` (dup of ${r.body.dup_of.slice(0, 8)})` : '';
    const flags =
      r.body.flags && Object.keys(r.body.flags).length > 0
        ? ` [${Object.keys(r.body.flags).join(',')}]`
        : '';
    console.log(
      `  ✓ ${tx.source_tx_id} → ${r.body.status}${flags}${dup} (${r.body.status_reason})`,
    );
  }
  console.log(
    '\n[seed-demo] done. Open the AML UI at /cases — one SAR-candidate should be visible. Click Draft SAR from /transactions/[id] to exercise Phase 3 narrative generation.',
  );
}

main().catch((err) => {
  console.error('[seed-demo] crashed:', err);
  process.exit(1);
});
