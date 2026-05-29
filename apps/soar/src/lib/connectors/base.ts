/**
 * Shared connector helpers.
 *
 * Each connector route handler:
 *   1. Authenticates (HEC token, HMAC, shared secret) — via verifyConnectorAuth
 *   2. Parses upstream JSON
 *   3. Maps to our normalized IngestAlertInput shape
 *   4. Calls ingestAlert() — gets dedup verdict for free
 *   5. Returns 200 with { alert_id, status }
 *
 * Customers wire a single connector at:
 *   /settings/connectors → "Splunk HEC" → "Generate token + URL"
 *
 * The token is stored hashed in soar_integrations (provider='connector_<source>').
 * On incoming webhook we look it up and resolve the tenant.
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export interface ResolvedConnector {
  tenantId: string;
  integrationId: string;
  provider: string;
  secretPayload: Record<string, unknown>;
}

/**
 * Resolve a connector by token. Each connector type stores its token
 * hash under a provider-specific shape; we narrow by provider prefix
 * so a stolen token from one connector can't be used for another.
 */
export async function resolveConnectorToken(
  provider: string,
  token: string,
): Promise<ResolvedConnector | null> {
  if (!token || token.length < 8) return null;
  const db = getAdminClient();
  // CE engine: integrations table doesn't carry a separate prefix
  // column, so we scan all enabled connectors of this provider type +
  // bcrypt-compare. N is bounded — most tenants wire one connector
  // per source.
  const result = await db.sql<{
    id: string;
    tenant_id: string;
    secret_payload: string | null;
  }>(
    `SELECT id, tenant_id, secret_payload
       FROM soar_integrations
      WHERE provider = $1 AND enabled = TRUE`,
    [`connector_${provider}`],
  );

  for (const row of result.rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload =
        typeof row.secret_payload === 'string'
          ? (JSON.parse(row.secret_payload) as Record<string, unknown>)
          : ((row.secret_payload as unknown as Record<string, unknown>) ?? {});
    } catch {
      payload = {};
    }
    const stored = String(payload.token_hash ?? '');
    if (!stored) continue;
    if (await bcrypt.compare(token, stored)) {
      return {
        tenantId: row.tenant_id,
        integrationId: row.id,
        provider,
        secretPayload: payload,
      };
    }
  }
  return null;
}

/**
 * Verify HMAC signature on request body. Used by Okta event hooks +
 * Sentinel + any provider that signs with a shared secret. Constant-
 * time compare.
 */
export function verifyHmac({
  secret,
  algorithm,
  body,
  header,
  encoding = 'hex',
}: {
  secret: string;
  algorithm: 'sha256' | 'sha1';
  body: string;
  header: string;
  encoding?: 'hex' | 'base64';
}): boolean {
  try {
    const expected = createHmac(algorithm, secret)
      .update(body)
      .digest(encoding);
    const got = header.startsWith(`${algorithm}=`)
      ? header.slice(algorithm.length + 1)
      : header;
    const a = Buffer.from(expected);
    const b = Buffer.from(got);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Standard error response. Connectors should NEVER leak upstream-system
 * detail in their replies — attackers can probe for valid endpoints.
 */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

export function badRequestResponse(message: string): Response {
  return Response.json(
    { error: message },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}
