/**
 * POST /api/v1/aml/transactions
 *
 * Webhook ingest from core-banking + payment-rail systems.
 *
 * Auth: Authorization: Bearer sk_user_... (personal API key from
 * /settings/api-keys; production deploys mint a service-account key
 * per connector).
 *
 * Request body:
 *   {
 *     "source":        "core-banking" | "ach" | "swift" | "fednow" | "card-network",
 *     "source_tx_id":  "BANK-9842",
 *     "from_customer": "C-771",
 *     "from_account":  "ACCT-9821",
 *     "to_counterparty": "ACCT-1234 / Foreign Beneficiary",
 *     "to_country":    "BVI",
 *     "amount_usd":    9870.00,
 *     "currency":      "USD",
 *     "type":          "wire" | "ach" | "card" | "cash" | "crypto" | "check",
 *     "narrative":     "Real estate consulting fee",
 *     "ts":            "2026-05-29T12:00:00Z",
 *     "raw_payload":   { ... arbitrary upstream JSON ... }
 *   }
 */

import 'server-only';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { resolveBearerKey } from '@/lib/api-auth';
import { ingestTransaction } from '@/lib/aml-transactions';

const bodySchema = z.object({
  source: z.string().min(1),
  source_tx_id: z.string().optional(),
  from_customer: z.string().optional(),
  from_account: z.string().optional(),
  to_counterparty: z.string().optional(),
  to_country: z.string().optional(),
  amount_usd: z.number().positive(),
  currency: z.string().length(3),
  type: z.enum(['wire', 'ach', 'card', 'cash', 'crypto', 'check']),
  narrative: z.string().optional(),
  ts: z.string().datetime().optional(),
  raw_payload: z.unknown().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const resolved = await resolveBearerKey(req);
  if (!resolved) {
    return Response.json(
      { error: 'Unauthorized: provide a valid Bearer API key.' },
      { status: 401 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return Response.json(
      {
        error: 'Invalid request body.',
        details: err instanceof z.ZodError ? err.flatten() : String(err),
      },
      { status: 400 },
    );
  }

  try {
    const result = await ingestTransaction({
      tenantId: resolved.tenantId,
      source: parsed.source,
      sourceTxId: parsed.source_tx_id,
      fromCustomer: parsed.from_customer,
      fromAccount: parsed.from_account,
      toCounterparty: parsed.to_counterparty,
      toCountry: parsed.to_country,
      amountUsd: parsed.amount_usd,
      currency: parsed.currency,
      type: parsed.type,
      narrative: parsed.narrative,
      ts: parsed.ts ? new Date(parsed.ts) : new Date(),
      rawPayload: parsed.raw_payload,
    });
    return Response.json(
      {
        transaction_id: result.txId,
        status: result.status,
        dup_of: result.dupOf,
        flags: result.flags,
        status_reason: result.statusReason,
      },
      { status: 201 },
    );
  } catch (err) {
    return Response.json(
      { error: 'Ingest failed.', details: String(err) },
      { status: 500 },
    );
  }
}
