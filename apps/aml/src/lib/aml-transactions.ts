/**
 * AML transaction primitives — ingest + behavioral checks + dedup + audit.
 *
 * Dedup model: (source, source_tx_id) — financial systems already mint
 * unique tx IDs; we trust them. Cheap, deterministic, fast.
 *
 * Behavioral checks run on every fresh ingest. We surface flags as a
 * JSON column + persist a status_reason explanation. Phase 3 agents
 * read these as triage hints.
 *
 * Phase 4 fires sanctions screening + action dispatch off the
 * flagged set.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { getAdminClient } from '@synapcores/app-framework/db/server';

/** Currency Transaction Report (CTR) threshold in USD. */
const CTR_THRESHOLD = 10_000;
/** Window for structuring detection (3+ sub-CTR txs within 24h). */
const STRUCTURING_WINDOW_HOURS = 24;
/** Velocity check: amount above this in 24h is suspicious. */
const VELOCITY_THRESHOLD = 1_000_000;

export type TxStatus =
  | 'new'
  | 'triaged'
  | 'sar_candidate'
  | 'cleared'
  | 'duplicate';

export type TxType = 'wire' | 'ach' | 'card' | 'cash' | 'crypto' | 'check';

export interface IngestTransactionInput {
  tenantId: string;
  source: string;
  sourceTxId?: string;
  fromCustomer?: string;
  fromAccount?: string;
  toCounterparty?: string;
  toCountry?: string;
  amountUsd: number;
  currency: string;
  type: TxType;
  narrative?: string;
  ts: Date;
  rawPayload?: unknown;
}

export interface TxFlags {
  structuring?: boolean;
  velocity?: boolean;
  round_number?: boolean;
  ctr_threshold?: boolean;
  cross_border_cash?: boolean;
}

export interface TxRow {
  id: string;
  tenant_id: string;
  source: string;
  source_tx_id: string | null;
  from_customer: string | null;
  from_account: string | null;
  to_counterparty: string | null;
  to_country: string | null;
  amount_usd: number;
  currency: string;
  type: string;
  narrative: string | null;
  status: string;
  status_reason: string | null;
  dup_of: string | null;
  flags: TxFlags | null;
  raw_payload: unknown;
  ts: string;
  ingested_at: string;
  triaged_at: string | null;
}

export interface IngestResult {
  txId: string;
  status: TxStatus;
  dupOf: string | null;
  flags: TxFlags;
  statusReason: string;
}

export async function ingestTransaction(
  input: IngestTransactionInput,
): Promise<IngestResult> {
  const db = getAdminClient();

  // ─── Dedup-by-key (source, source_tx_id) ──────────────────────────────
  if (input.sourceTxId) {
    const existing = await db.sql<{ id: string }>(
      `SELECT id FROM aml_transactions
        WHERE tenant_id = $1 AND source = $2 AND source_tx_id = $3
        LIMIT 1`,
      [input.tenantId, input.source, input.sourceTxId],
    );
    if (existing.rows[0]) {
      return {
        txId: existing.rows[0].id,
        status: 'duplicate',
        dupOf: existing.rows[0].id,
        flags: {},
        statusReason: `Existing ingest for ${input.source}/${input.sourceTxId}.`,
      };
    }
  }

  // ─── Behavioral checks ───────────────────────────────────────────────
  const flags = await computeFlags(input);
  const status: TxStatus = pickStatus(flags);
  const statusReason = explain(flags, input.amountUsd);

  // ─── Insert ──────────────────────────────────────────────────────────
  const id = randomUUID();
  const text = `${input.narrative ?? ''} ${input.toCounterparty ?? ''}`.trim();
  await db.sql(
    `INSERT INTO aml_transactions
       (id, tenant_id, source, source_tx_id, from_customer, from_account,
        to_counterparty, to_country, amount_usd, currency, type, narrative,
        status, status_reason, flags, raw_payload, semantic_vec, ts, ingested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             EMBED($17), $18, NOW())`,
    [
      id,
      input.tenantId,
      input.source,
      input.sourceTxId ?? null,
      input.fromCustomer ?? null,
      input.fromAccount ?? null,
      input.toCounterparty ?? null,
      input.toCountry ?? null,
      input.amountUsd,
      input.currency,
      input.type,
      input.narrative ?? null,
      status,
      statusReason,
      JSON.stringify(flags),
      JSON.stringify(input.rawPayload ?? {}),
      text || `${input.type} ${input.currency} ${input.amountUsd}`,
      input.ts.toISOString(),
    ],
  );

  await writeAmlAudit({
    tenantId: input.tenantId,
    actorType: 'system',
    action: hasAnyFlag(flags) ? 'tx.flag' : 'tx.ingest',
    transactionId: id,
    payload: {
      source: input.source,
      amount_usd: input.amountUsd,
      currency: input.currency,
      flags,
      status,
    },
  });

  return { txId: id, status, dupOf: null, flags, statusReason };
}

async function computeFlags(input: IngestTransactionInput): Promise<TxFlags> {
  const flags: TxFlags = {};

  // CTR threshold — any single tx ≥ $10k.
  if (input.amountUsd >= CTR_THRESHOLD) {
    flags.ctr_threshold = true;
  }
  // Round-number signal — heuristic for layering.
  if (input.amountUsd >= 5_000 && input.amountUsd % 10_000 === 0) {
    flags.round_number = true;
  }
  // Cross-border cash — high-risk vector.
  if (
    input.type === 'cash' &&
    input.toCountry &&
    input.toCountry !== 'US'
  ) {
    flags.cross_border_cash = true;
  }

  if (input.fromCustomer) {
    const db = getAdminClient();
    // Structuring — 3+ sub-CTR txs in the window from the same customer.
    const windowStart = new Date(
      input.ts.getTime() - STRUCTURING_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const subCtr = await db.sqlScalar<number>(
      `SELECT COUNT(*)
         FROM aml_transactions
        WHERE tenant_id = $1
          AND from_customer = $2
          AND amount_usd < $3
          AND amount_usd > 0
          AND ts >= $4
          AND ts <= $5`,
      [
        input.tenantId,
        input.fromCustomer,
        CTR_THRESHOLD,
        windowStart.toISOString(),
        input.ts.toISOString(),
      ],
    );
    if (
      Number(subCtr ?? 0) >= 2 &&
      input.amountUsd < CTR_THRESHOLD
    ) {
      flags.structuring = true;
    }

    // Velocity — total tx amount in 24h above threshold.
    const total = await db.sqlScalar<number>(
      `SELECT COALESCE(SUM(amount_usd), 0)
         FROM aml_transactions
        WHERE tenant_id = $1
          AND from_customer = $2
          AND ts >= $3
          AND ts <= $4`,
      [
        input.tenantId,
        input.fromCustomer,
        windowStart.toISOString(),
        input.ts.toISOString(),
      ],
    );
    if (Number(total ?? 0) + input.amountUsd >= VELOCITY_THRESHOLD) {
      flags.velocity = true;
    }
  }

  return flags;
}

function pickStatus(flags: TxFlags): TxStatus {
  if (flags.structuring || flags.velocity || flags.cross_border_cash) {
    return 'sar_candidate';
  }
  if (flags.ctr_threshold || flags.round_number) {
    return 'triaged';
  }
  return 'new';
}

function explain(flags: TxFlags, amount: number): string {
  const parts: string[] = [];
  if (flags.structuring) parts.push('Structuring pattern (3+ sub-CTR txs in 24h)');
  if (flags.velocity) parts.push('Velocity: >$1M aggregated in 24h');
  if (flags.cross_border_cash) parts.push('Cross-border cash movement');
  if (flags.ctr_threshold) parts.push(`Above CTR threshold ($${amount.toLocaleString()})`);
  if (flags.round_number) parts.push('Round-number amount');
  if (parts.length === 0) parts.push('Routine transaction.');
  return parts.join(' · ');
}

function hasAnyFlag(flags: TxFlags): boolean {
  return Object.values(flags).some(Boolean);
}

// ─── Read paths ──────────────────────────────────────────────────────────

export interface ListTxOpts {
  tenantId: string;
  status?: TxStatus | 'all';
  limit?: number;
  offset?: number;
}

export async function listTransactions(opts: ListTxOpts): Promise<TxRow[]> {
  const db = getAdminClient();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const status = opts.status ?? 'all';

  const cols = `id, tenant_id, source, source_tx_id, from_customer, from_account,
            to_counterparty, to_country, amount_usd, currency, type, narrative,
            status, status_reason, dup_of, flags, raw_payload, ts, ingested_at, triaged_at`;

  let result;
  if (status === 'all') {
    result = await db.sql<TxRow>(
      `SELECT ${cols} FROM aml_transactions
        WHERE tenant_id = $1 ORDER BY ts DESC LIMIT $2 OFFSET $3`,
      [opts.tenantId, limit, offset],
    );
  } else {
    result = await db.sql<TxRow>(
      `SELECT ${cols} FROM aml_transactions
        WHERE tenant_id = $1 AND status = $2 ORDER BY ts DESC LIMIT $3 OFFSET $4`,
      [opts.tenantId, status, limit, offset],
    );
  }
  return result.rows.map(normalizeTxRow);
}

export async function getTransaction(
  tenantId: string,
  id: string,
): Promise<TxRow | null> {
  const db = getAdminClient();
  const result = await db.sql<TxRow>(
    `SELECT id, tenant_id, source, source_tx_id, from_customer, from_account,
            to_counterparty, to_country, amount_usd, currency, type, narrative,
            status, status_reason, dup_of, flags, raw_payload, ts, ingested_at, triaged_at
       FROM aml_transactions
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  const row = result.rows[0];
  return row ? normalizeTxRow(row) : null;
}

export async function transactionCounts(tenantId: string): Promise<{
  new: number;
  triaged: number;
  sar_candidate: number;
  cleared: number;
  duplicate: number;
  total: number;
}> {
  const db = getAdminClient();
  const out = { new: 0, triaged: 0, sar_candidate: 0, cleared: 0, duplicate: 0, total: 0 };
  const statuses: TxStatus[] = ['new', 'triaged', 'sar_candidate', 'cleared', 'duplicate'];
  for (const s of statuses) {
    const n = await db.sqlScalar<number>(
      `SELECT COUNT(*) FROM aml_transactions WHERE tenant_id = $1 AND status = $2`,
      [tenantId, s],
    );
    out[s] = Number(n ?? 0);
    out.total += out[s];
  }
  return out;
}

function normalizeTxRow(row: TxRow): TxRow {
  return {
    ...row,
    amount_usd: Number(row.amount_usd),
    flags:
      typeof row.flags === 'string'
        ? (JSON.parse(row.flags) as TxFlags)
        : (row.flags as TxFlags | null),
  };
}

// ─── Audit helper ────────────────────────────────────────────────────────

interface AmlAuditEvent {
  tenantId: string;
  actorId?: string | null;
  actorType: 'analyst' | 'agent' | 'system' | 'mcp_token';
  action: string;
  transactionId?: string | null;
  caseId?: string | null;
  sarId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string;
}

export async function writeAmlAudit(evt: AmlAuditEvent): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO aml_audit_log
       (ts, tenant_id, actor_id, actor_type, action, transaction_id, case_id, sar_id, payload, request_id)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      evt.tenantId,
      evt.actorId ?? null,
      evt.actorType,
      evt.action,
      evt.transactionId ?? null,
      evt.caseId ?? null,
      evt.sarId ?? null,
      JSON.stringify(evt.payload ?? {}),
      evt.requestId ?? null,
    ],
  );
}
