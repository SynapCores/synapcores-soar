/**
 * AML connector webhook handler — wraps per-provider mappers.
 * Each route is a 5-line file that calls into here.
 */

import 'server-only';
import {
  resolveConnectorToken,
  unauthorizedResponse,
  badRequestResponse,
} from './base';
import { ingestTransaction, type IngestTransactionInput } from '../aml-transactions';

export type AuthExtractor = (req: Request) => string;
export type Mapper<Raw> = (raw: Raw, tenantId: string) => IngestTransactionInput | null;

export interface HandleWebhookOpts<Raw> {
  provider: string;
  extractAuth: AuthExtractor;
  map: Mapper<Raw>;
}

export async function handleConnectorWebhook<Raw>(
  req: Request,
  opts: HandleWebhookOpts<Raw>,
): Promise<Response> {
  const token = opts.extractAuth(req);
  if (!token) return unauthorizedResponse();

  const resolved = await resolveConnectorToken(opts.provider, token);
  if (!resolved) return unauthorizedResponse();

  let body: Raw;
  try {
    body = (await req.json()) as Raw;
  } catch {
    return badRequestResponse('Invalid JSON body.');
  }

  const mapped = opts.map(body, resolved.tenantId);
  if (!mapped) return badRequestResponse('Could not map upstream payload.');

  try {
    const result = await ingestTransaction(mapped);
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
