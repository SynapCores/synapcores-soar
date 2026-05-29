/**
 * MCP tokens for external auditors / examiners.
 *
 * Scoped, read-only, time-bound. The auditor pastes the token into
 * Claude / Cursor / any MCP-compatible LLM; every query they run is
 * audit-logged on our side.
 *
 * Phase 3: mint + list + revoke. The MCP server endpoint that consumes
 * these tokens ships in Phase 9.
 */

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { getAdminClient } from '../db/server';

export interface McpTokenScope {
  /** Whitelist of tables the auditor can read. Empty = all. */
  tables?: string[];
  /** Allowed operations. Phase 3: only 'read'. */
  operations: ('read' | 'export')[];
}

export interface McpTokenRow {
  id: string;
  label: string;
  scope: McpTokenScope;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export async function mintMcpToken(opts: {
  tenantId: string;
  mintedByUserId: string;
  label: string;
  scope: McpTokenScope;
  expiresAt: Date;
}): Promise<{ plaintext: string; row: McpTokenRow }> {
  const id = randomUUID();
  const plaintext = `mcp_${randomBytes(32).toString('base64url')}`;
  const hash = await bcrypt.hash(plaintext, 12);
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO mcp_tokens
       (id, tenant_id, token_hash, label, scope, minted_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
    [
      id,
      opts.tenantId,
      hash,
      opts.label,
      JSON.stringify(opts.scope),
      opts.mintedByUserId,
      opts.expiresAt.toISOString(),
    ],
  );
  return {
    plaintext,
    row: {
      id,
      label: opts.label,
      scope: opts.scope,
      created_at: new Date().toISOString(),
      expires_at: opts.expiresAt.toISOString(),
      revoked_at: null,
      last_used_at: null,
    },
  };
}

export async function listMcpTokens(tenantId: string): Promise<McpTokenRow[]> {
  const db = getAdminClient();
  const result = await db.sql<McpTokenRow & { scope: string }>(
    `SELECT id, label, scope, created_at, expires_at, revoked_at, last_used_at
       FROM mcp_tokens WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId],
  );
  return result.rows.map((r) => ({
    ...r,
    scope:
      typeof r.scope === 'string'
        ? (JSON.parse(r.scope) as McpTokenScope)
        : (r.scope as unknown as McpTokenScope),
  }));
}

export async function revokeMcpToken(id: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE mcp_tokens SET revoked_at = NOW() WHERE id = $1`,
    [id],
  );
}
