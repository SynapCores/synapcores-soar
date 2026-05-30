/**
 * Resolve an incoming MCP bearer token to a tenant + token row.
 * Reads from the framework's mcp_tokens table — same table SOAR
 * reads; tenant ID is bound at mint, so an AML token only sees AML
 * data even if the table is shared.
 */

import 'server-only';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export interface ResolvedMcpToken {
  tenantId: string;
  tokenId: string;
  label: string;
  scope: { operations?: string[]; tables?: string[] };
}

export async function resolveMcpToken(token: string): Promise<ResolvedMcpToken | null> {
  if (!token || !token.startsWith('mcp_')) return null;
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    tenant_id: string;
    label: string;
    scope: string;
    token_hash: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, tenant_id, label, scope, token_hash, expires_at, revoked_at
       FROM mcp_tokens
      WHERE revoked_at IS NULL`,
  );

  for (const row of result.rows) {
    if (new Date(row.expires_at) < new Date()) continue;
    if (await bcrypt.compare(token, row.token_hash)) {
      let scope: ResolvedMcpToken['scope'] = { operations: ['read'] };
      try {
        scope =
          typeof row.scope === 'string'
            ? (JSON.parse(row.scope) as ResolvedMcpToken['scope'])
            : (row.scope as unknown as ResolvedMcpToken['scope']);
      } catch {
        scope = { operations: ['read'] };
      }
      void db
        .sql(`UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1`, [row.id])
        .catch(() => undefined);
      return {
        tenantId: row.tenant_id,
        tokenId: row.id,
        label: row.label,
        scope,
      };
    }
  }
  return null;
}
