/**
 * ACH (NACHA) connector — ingests credit/debit ACH entries.
 *
 * NACHA file format is plain-text fixed-width records. The customer's
 * processing shim parses NACHA + posts one normalized JSON per entry:
 *   {
 *     "trace_number": "021000026283719",
 *     "effective_date": "2026-05-29",
 *     "type": "CCD" | "PPD" | "WEB" | "TEL",
 *     "amount": 9500.00,
 *     "originator_dfi": "021000026",
 *     "receiver_dfi":   "121000358",
 *     "originator_customer_id": "C-771",
 *     "originator_account":    "9821",
 *     "receiver_account":      "1234",
 *     "receiver_name":         "BVI Holdings LLC",
 *     "memo":                  "consulting"
 *   }
 */

import 'server-only';
import type { IngestTransactionInput } from '../aml-transactions';

interface ACHPayload {
  trace_number?: string;
  effective_date?: string;
  type?: string;
  amount?: number;
  originator_dfi?: string;
  receiver_dfi?: string;
  originator_customer_id?: string;
  originator_account?: string;
  receiver_account?: string;
  receiver_name?: string;
  memo?: string;
}

export function parseAchAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function mapAchPayload(
  raw: ACHPayload,
  tenantId: string,
): IngestTransactionInput | null {
  if (typeof raw.amount !== 'number') return null;
  return {
    tenantId,
    source: 'ach',
    sourceTxId: raw.trace_number,
    fromCustomer: raw.originator_customer_id,
    fromAccount: raw.originator_account,
    toCounterparty:
      raw.receiver_name && raw.receiver_account
        ? `${raw.receiver_account} / ${raw.receiver_name}`
        : raw.receiver_account ?? raw.receiver_name ?? 'unknown',
    amountUsd: raw.amount,
    currency: 'USD',
    type: 'ach',
    narrative: raw.memo ?? raw.type,
    ts: raw.effective_date ? new Date(raw.effective_date) : new Date(),
    rawPayload: raw,
  };
}
