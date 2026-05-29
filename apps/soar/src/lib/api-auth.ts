/**
 * API-key authentication for webhook + machine endpoints.
 *
 * Reads `Authorization: Bearer sk_user_...` from the request, looks
 * up the key in api_keys, returns the resolved {tenantId, userId} or
 * null if the key is missing / revoked / expired.
 */

import 'server-only';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export interface ResolvedApiKey {
  tenantId: string;
  userId: string;
  keyId: string;
}

export async function resolveBearerKey(req: Request): Promise<ResolvedApiKey | null> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  const plaintext = auth.slice(7).trim();
  if (!plaintext.startsWith('sk_user_')) return null;

  // Narrow by prefix first so we don't bcrypt-compare every row.
  const prefix = plaintext.slice(0, 12);
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    tenant_id: string;
    user_id: string;
    key_hash: string;
    expires_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT id, tenant_id, user_id, key_hash, expires_at, revoked_at
       FROM api_keys
      WHERE key_prefix = $1 AND revoked_at IS NULL
      LIMIT 10`,
    [prefix],
  );

  for (const row of result.rows) {
    if (row.revoked_at) continue;
    if (row.expires_at && new Date(row.expires_at) < new Date()) continue;
    if (await bcrypt.compare(plaintext, row.key_hash)) {
      // Best-effort: stamp last_used. Fire and forget.
      void db
        .sql(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
        .catch(() => undefined);
      return {
        tenantId: row.tenant_id,
        userId: row.user_id,
        keyId: row.id,
      };
    }
  }
  return null;
}
