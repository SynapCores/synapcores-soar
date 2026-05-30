/**
 * FedNow connector — ingests RTP/FedNow payment messages.
 *
 * FedNow uses ISO 20022 pacs.008 messages. Customers typically route
 * these through their payment processor's webhook adapter (e.g. The
 * Clearing House, Banco Santander Connect, fintech-built shim).
 *
 * Wire shape we accept (normalized envelope; the customer's adapter
 * does the pacs.008 parsing):
 *   {
 *     "msg_id":     "PACS-008-2026-05-29-00001",
 *     "settlement_date": "2026-05-29",
 *     "ts":         "2026-05-29T10:00:00Z",
 *     "amount":     9870.00,
 *     "currency":   "USD",
 *     "debtor":   {"customer_id":"C-771","account":"ACCT-9821","name":"..."},
 *     "creditor": {"account":"ACCT-1234","name":"BVI Holdings LLC","country":"BVI"},
 *     "purpose_code": "SERV",
 *     "remittance_info": "Real estate consulting fee"
 *   }
 *
 * Auth: Bearer header.
 */

import 'server-only';
import type { IngestTransactionInput } from '../aml-transactions';

interface FedNowPayload {
  msg_id?: string;
  ts?: string;
  amount?: number;
  currency?: string;
  debtor?: { customer_id?: string; account?: string; name?: string };
  creditor?: { account?: string; name?: string; country?: string };
  purpose_code?: string;
  remittance_info?: string;
}

export function parseFedNowAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function mapFedNowPayload(
  raw: FedNowPayload,
  tenantId: string,
): IngestTransactionInput | null {
  if (typeof raw.amount !== 'number' || !raw.currency) return null;
  const counterparty =
    raw.creditor?.name && raw.creditor?.account
      ? `${raw.creditor.account} / ${raw.creditor.name}`
      : raw.creditor?.name ?? raw.creditor?.account ?? 'unknown';
  return {
    tenantId,
    source: 'fednow',
    sourceTxId: raw.msg_id,
    fromCustomer: raw.debtor?.customer_id,
    fromAccount: raw.debtor?.account,
    toCounterparty: counterparty,
    toCountry: raw.creditor?.country,
    amountUsd: raw.amount,
    currency: raw.currency.toUpperCase(),
    type: 'wire',
    narrative: raw.remittance_info ?? raw.purpose_code,
    ts: raw.ts ? new Date(raw.ts) : new Date(),
    rawPayload: raw,
  };
}
