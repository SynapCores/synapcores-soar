/**
 * SWIFT connector — ingests MT103 wire transfers (legacy) and pacs.008
 * ISO 20022 (the modern MX migration path).
 *
 * MT103 is plain-text tag-prefixed (':20:', ':32A:', etc.). The
 * customer's shim parses the message + posts normalized JSON:
 *   {
 *     "uetr":          "00000000-0000-0000-0000-000000000000",
 *     "msg_type":      "MT103" | "pacs.008",
 *     "value_date":    "2026-05-29",
 *     "amount":        9870.00,
 *     "currency":      "USD",
 *     "ordering_customer": { "name": "...", "account": "...", "country": "US" },
 *     "beneficiary":       { "name": "BVI Holdings LLC", "account": "1234", "country": "BVI" },
 *     "remittance_info":   "Real estate consulting fee"
 *   }
 */

import 'server-only';
import type { IngestTransactionInput } from '../aml-transactions';

interface SwiftPayload {
  uetr?: string;
  msg_type?: string;
  value_date?: string;
  amount?: number;
  currency?: string;
  ordering_customer?: { name?: string; account?: string; country?: string; customer_id?: string };
  beneficiary?: { name?: string; account?: string; country?: string };
  remittance_info?: string;
}

export function parseSwiftAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function mapSwiftPayload(
  raw: SwiftPayload,
  tenantId: string,
): IngestTransactionInput | null {
  if (typeof raw.amount !== 'number' || !raw.currency) return null;
  return {
    tenantId,
    source: 'swift',
    sourceTxId: raw.uetr,
    fromCustomer: raw.ordering_customer?.customer_id,
    fromAccount: raw.ordering_customer?.account,
    toCounterparty:
      raw.beneficiary?.name && raw.beneficiary?.account
        ? `${raw.beneficiary.account} / ${raw.beneficiary.name}`
        : raw.beneficiary?.name ?? raw.beneficiary?.account ?? 'unknown',
    toCountry: raw.beneficiary?.country,
    amountUsd: raw.amount,
    currency: raw.currency.toUpperCase(),
    type: 'wire',
    narrative: raw.remittance_info,
    ts: raw.value_date ? new Date(raw.value_date) : new Date(),
    rawPayload: raw,
  };
}
