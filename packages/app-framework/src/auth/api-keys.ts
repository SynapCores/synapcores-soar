/**
 * Personal API keys for SDK + CLI use.
 *
 * Plaintext is shown to the user ONCE at mint time (we hash with bcrypt).
 * Rotation is the supported "I lost it" path — revoke + remint.
 */

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { getAdminClient } from '../db/server';

export interface ApiKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export async function mintApiKey(opts: {
  tenantId: string;
  userId: string;
  label: string;
}): Promise<{ plaintext: string; row: ApiKeyRow }> {
  const id = randomUUID();
  const plaintext = `sk_user_${randomBytes(24).toString('base64url')}`;
  const hash = await bcrypt.hash(plaintext, 12);
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO api_keys (id, tenant_id, user_id, label, key_hash, key_prefix, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [id, opts.tenantId, opts.userId, opts.label, hash, plaintext.slice(0, 12)],
  );
  return {
    plaintext,
    row: {
      id,
      label: opts.label,
      key_prefix: plaintext.slice(0, 12),
      created_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      last_used_at: null,
    },
  };
}

export async function listApiKeys(
  tenantId: string,
  userId: string,
): Promise<ApiKeyRow[]> {
  const db = getAdminClient();
  const result = await db.sql<ApiKeyRow>(
    `SELECT id, label, key_prefix, created_at, expires_at, revoked_at, last_used_at
       FROM api_keys
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC`,
    [tenantId, userId],
  );
  return result.rows;
}

export async function revokeApiKey(id: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`,
    [id],
  );
}
