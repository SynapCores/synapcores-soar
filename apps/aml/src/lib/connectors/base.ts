/**
 * AML connector helpers — token resolver against aml_integrations.
 * Same shape as SOAR's connector base; the tenant ID is bound at mint.
 */

import 'server-only';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export interface ResolvedConnector {
  tenantId: string;
  integrationId: string;
  provider: string;
  secretPayload: Record<string, unknown>;
}

export async function resolveConnectorToken(
  provider: string,
  token: string,
): Promise<ResolvedConnector | null> {
  if (!token || token.length < 8) return null;
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    tenant_id: string;
    secret_payload: string | null;
  }>(
    `SELECT id, tenant_id, secret_payload
       FROM aml_integrations
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
