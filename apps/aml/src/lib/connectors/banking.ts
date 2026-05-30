/**
 * Generic core-banking webhook — the catch-all.
 *
 * Customers who don't run FedNow / ACH / SWIFT (digital banks, MSBs,
 * crypto exchanges, card programs) wire their core directly with the
 * normalized shape we already accept on /api/v1/aml/transactions.
 *
 * This connector exists so the customer can use a *connector token*
 * (mintable from /settings/connectors) instead of a personal API key,
 * which keeps the audit trail cleaner ("ingested from connector X"
 * rather than "ingested as user Y").
 */

import 'server-only';
import type { IngestTransactionInput } from '../aml-transactions';

interface BankingPayload {
  source?: string;
  source_tx_id?: string;
  from_customer?: string;
  from_account?: string;
  to_counterparty?: string;
  to_country?: string;
  amount_usd?: number;
  currency?: string;
  type?: 'wire' | 'ach' | 'card' | 'cash' | 'crypto' | 'check';
  narrative?: string;
  ts?: string;
  raw_payload?: unknown;
}

export function parseBankingAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function mapBankingPayload(
  raw: BankingPayload,
  tenantId: string,
): IngestTransactionInput | null {
  if (typeof raw.amount_usd !== 'number' || !raw.currency || !raw.type) return null;
  return {
    tenantId,
    source: raw.source ?? 'core-banking',
    sourceTxId: raw.source_tx_id,
    fromCustomer: raw.from_customer,
    fromAccount: raw.from_account,
    toCounterparty: raw.to_counterparty,
    toCountry: raw.to_country,
    amountUsd: raw.amount_usd,
    currency: raw.currency.toUpperCase(),
    type: raw.type,
    narrative: raw.narrative,
    ts: raw.ts ? new Date(raw.ts) : new Date(),
    rawPayload: raw.raw_payload ?? raw,
  };
}
