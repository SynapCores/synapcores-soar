/**
 * SAR-drafter dispatch.
 *
 * Primary path: SELECT AGENT_RUN('sar-drafter', $1::json) - the engine's
 * persona-bound ReAct loop reads similar prior SARs via vector_search,
 * walks the UBO graph, and produces a draft.
 *
 * Fallback path: if AGENT_RUN times out, errors, or AML_TRIAGE_MODE
 * is 'fallback', we run buildSarNarrative() against the
 * jurisdiction template directly. Honest about its source — the
 * narrative is prefixed "[Deterministic fallback]" so analysts see
 * it during review.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import {
  buildSarNarrative,
  type Jurisdiction,
  type SARContext,
} from './sar-templates';
import { getTransaction, writeAmlAudit } from './aml-transactions';

const MODE = process.env.AML_TRIAGE_MODE ?? 'auto';
const DEFAULT_JURISDICTION: Jurisdiction =
  (process.env.AML_DEFAULT_JURISDICTION as Jurisdiction) ?? 'us-fincen';

export interface SARDraftResult {
  sarId: string;
  caseId: string;
  source: 'agent' | 'fallback';
  jurisdiction: Jurisdiction;
  narrative: string;
  durationMs: number;
}

export async function draftSarFromTransaction(
  tenantId: string,
  txId: string,
  jurisdiction: Jurisdiction = DEFAULT_JURISDICTION,
  draftedByUserId?: string,
): Promise<SARDraftResult> {
  const tx = await getTransaction(tenantId, txId);
  if (!tx) throw new Error(`Transaction ${txId} not found.`);

  const db = getAdminClient();

  // ─── Materialize a case row if one isn't already linked ─────────────
  const caseId = await ensureCaseForTransaction(tenantId, txId, tx.amount_usd);

  // Peer activity (for the structuring story).
  const peerInfo =
    tx.from_customer && tx.flags?.structuring
      ? await peerActivityWindow(tenantId, tx.from_customer, tx.ts)
      : null;

  const ctx: SARContext = {
    customerId: tx.from_customer,
    counterparty: tx.to_counterparty,
    counterpartyCountry: tx.to_country,
    txAmount: tx.amount_usd,
    txCurrency: tx.currency,
    txType: tx.type,
    txTimestamp: tx.ts,
    flags: (tx.flags ?? {}) as Record<string, boolean | undefined>,
    narrative: tx.narrative,
    peerCount: peerInfo?.count,
    peerAggregate: peerInfo?.amount,
  };

  const start = Date.now();
  let narrative: string;
  let source: 'agent' | 'fallback' = 'fallback';

  if (MODE === 'fallback') {
    narrative = buildSarNarrative(jurisdiction, ctx);
  } else {
    try {
      const result = await db.sql<{ verdict: string }>(
        `SELECT AGENT_RUN('sar-drafter', $1) AS verdict`,
        [
          JSON.stringify({
            tenant_id: tenantId,
            transaction_id: txId,
            jurisdiction,
            context: ctx,
          }),
        ],
      );
      const raw = result.rows[0]?.verdict;
      if (raw) {
        const parsed = parseAgentNarrative(raw);
        narrative = parsed;
        source = 'agent';
      } else {
        throw new Error('AGENT_RUN returned no rows');
      }
    } catch (err) {
      if (MODE === 'agent') throw err;
      narrative = `[Deterministic fallback — LLM unavailable]\n\n${buildSarNarrative(jurisdiction, ctx)}`;
    }
  }

  // ─── Persist the draft ───────────────────────────────────────────────
  const sarId = randomUUID();
  await db.sql(
    `INSERT INTO aml_sars
       (id, tenant_id, case_id, jurisdiction, status, draft_narrative,
        drafted_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, NOW(), NOW())`,
    [
      sarId,
      tenantId,
      caseId,
      jurisdiction,
      narrative,
      source === 'agent' ? 'sar-drafter' : 'fallback:sar-drafter',
    ],
  );

  await writeAmlAudit({
    tenantId,
    actorId: draftedByUserId ?? (source === 'agent' ? 'sar-drafter' : 'system'),
    actorType: source === 'agent' ? 'agent' : 'system',
    action: 'sar.draft',
    transactionId: txId,
    caseId,
    sarId,
    payload: {
      jurisdiction,
      source,
      duration_ms: Date.now() - start,
    },
  });

  return {
    sarId,
    caseId,
    source,
    jurisdiction,
    narrative,
    durationMs: Date.now() - start,
  };
}

async function ensureCaseForTransaction(
  tenantId: string,
  txId: string,
  txAmount: number,
): Promise<string> {
  const db = getAdminClient();
  // Already linked?
  const existing = await db.sql<{ case_id: string }>(
    `SELECT case_id FROM aml_case_transactions WHERE transaction_id = $1 LIMIT 1`,
    [txId],
  );
  if (existing.rows[0]) return existing.rows[0].case_id;

  const caseId = randomUUID();
  const severity =
    txAmount >= 100_000 ? 'high' : txAmount >= 25_000 ? 'medium' : 'low';
  await db.sql(
    `INSERT INTO aml_cases
       (id, tenant_id, title, severity, status, primary_tx, opened_at)
     VALUES ($1, $2, $3, $4, 'sar_drafted', $5, NOW())`,
    [caseId, tenantId, `SAR candidate ${txId.slice(0, 8)}`, severity, txId],
  );
  await db.sql(
    `INSERT INTO aml_case_transactions (case_id, transaction_id)
     VALUES ($1, $2)`,
    [caseId, txId],
  );
  await writeAmlAudit({
    tenantId,
    actorType: 'system',
    action: 'case.open',
    transactionId: txId,
    caseId,
    payload: { severity, amount: txAmount },
  });
  return caseId;
}

async function peerActivityWindow(
  tenantId: string,
  customerId: string,
  txTs: string,
): Promise<{ count: number; amount: number }> {
  const db = getAdminClient();
  const windowStart = new Date(
    new Date(txTs).getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const count = await db.sqlScalar<number>(
    `SELECT COUNT(*) FROM aml_transactions
       WHERE tenant_id = $1 AND from_customer = $2 AND ts >= $3 AND ts <= $4`,
    [tenantId, customerId, windowStart, txTs],
  );
  const sum = await db.sqlScalar<number>(
    `SELECT COALESCE(SUM(amount_usd), 0) FROM aml_transactions
       WHERE tenant_id = $1 AND from_customer = $2 AND ts >= $3 AND ts <= $4`,
    [tenantId, customerId, windowStart, txTs],
  );
  return { count: Number(count ?? 0), amount: Number(sum ?? 0) };
}

function parseAgentNarrative(raw: string): string {
  try {
    const obj = JSON.parse(raw) as { narrative?: string };
    return obj.narrative ?? raw;
  } catch {
    return raw;
  }
}

// ─── SAR list / read / mutate helpers (consumed by the UI) ───────────────

export interface SarRow {
  id: string;
  case_id: string;
  jurisdiction: string;
  status: string;
  draft_narrative: string | null;
  final_narrative: string | null;
  drafted_by: string | null;
  approved_by: string | null;
  filed_by: string | null;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSars(tenantId: string): Promise<SarRow[]> {
  const db = getAdminClient();
  const result = await db.sql<SarRow>(
    `SELECT id, case_id, jurisdiction, status, draft_narrative,
            final_narrative, drafted_by, approved_by, filed_by, filed_at,
            created_at, updated_at
       FROM aml_sars
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [tenantId],
  );
  return result.rows;
}

export async function getSar(
  tenantId: string,
  id: string,
): Promise<SarRow | null> {
  const db = getAdminClient();
  const result = await db.sql<SarRow>(
    `SELECT id, case_id, jurisdiction, status, draft_narrative,
            final_narrative, drafted_by, approved_by, filed_by, filed_at,
            created_at, updated_at
       FROM aml_sars
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function updateSarNarrative(
  tenantId: string,
  id: string,
  finalNarrative: string,
): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE aml_sars
        SET final_narrative = $3, status = 'review', updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, finalNarrative],
  );
}

export async function approveSar(
  tenantId: string,
  id: string,
  approvedByUserId: string,
): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE aml_sars
        SET status = 'approved', approved_by = $3, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, approvedByUserId],
  );
  await writeAmlAudit({
    tenantId,
    actorId: approvedByUserId,
    actorType: 'analyst',
    action: 'sar.approve',
    sarId: id,
    payload: {},
  });
}
