/**
 * Connector webhook handler — boilerplate that wraps the per-provider
 * mappers. Each provider's route.ts is a 5-line file that calls into
 * here.
 */

import 'server-only';
import { resolveConnectorToken, unauthorizedResponse, badRequestResponse } from './base';
import { ingestAlert, type IngestAlertInput } from '../soar-alerts';

export type AuthExtractor = (req: Request) => string;
export type Mapper<Raw> = (raw: Raw, tenantId: string) => IngestAlertInput | null;
export type MultiMapper<Raw> = (raw: Raw, tenantId: string) => IngestAlertInput[];

export interface HandleWebhookOpts<Raw> {
  provider: string; // 'splunk' | 'sentinel' | 'crowdstrike' | 'okta'
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
    const result = await ingestAlert(mapped);
    return Response.json(
      {
        alert_id: result.alertId,
        status: result.status,
        dup_of: result.dupOf,
        cosine_to_nearest: result.cosineToNearest,
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

export interface HandleMultiOpts<Raw> {
  provider: string;
  extractAuth: AuthExtractor;
  mapMany: MultiMapper<Raw>;
}

/**
 * Multi-event variant — Okta's event-hook payload carries an array.
 */
export async function handleConnectorMultiWebhook<Raw>(
  req: Request,
  opts: HandleMultiOpts<Raw>,
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

  const mappedList = opts.mapMany(body, resolved.tenantId);
  if (mappedList.length === 0) {
    return Response.json({ alerts: [] }, { status: 200 });
  }

  const ingested: Array<{ alert_id: string; status: string; dup_of: string | null }> = [];
  for (const m of mappedList) {
    try {
      const r = await ingestAlert(m);
      ingested.push({ alert_id: r.alertId, status: r.status, dup_of: r.dupOf });
    } catch {
      // Continue on individual failures — don't punish the whole batch.
    }
  }
  return Response.json({ alerts: ingested }, { status: 201 });
}
