/**
 * Mint a connector token. Same shape as SOAR's; stored under
 * provider='connector_<source>' in aml_integrations.
 */

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export type ConnectorProvider = 'fednow' | 'ach' | 'swift' | 'banking';

export interface ConnectorRow {
  id: string;
  provider: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export async function mintConnectorToken(opts: {
  tenantId: string;
  provider: ConnectorProvider;
  label: string;
}): Promise<{ plaintext: string; row: ConnectorRow }> {
  const id = randomUUID();
  const plaintext = `${opts.provider}_${randomBytes(24).toString('base64url')}`;
  const hash = await bcrypt.hash(plaintext, 12);
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO aml_integrations
       (id, tenant_id, provider, label, secret_payload, enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())`,
    [
      id,
      opts.tenantId,
      `connector_${opts.provider}`,
      opts.label,
      JSON.stringify({ token_hash: hash, prefix: plaintext.slice(0, 10) }),
    ],
  );
  return {
    plaintext,
    row: {
      id,
      provider: `connector_${opts.provider}`,
      label: opts.label,
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
  };
}

export async function listConnectors(tenantId: string): Promise<ConnectorRow[]> {
  const db = getAdminClient();
  const result = await db.sql<ConnectorRow>(
    `SELECT id, provider, label, created_at, last_used_at
       FROM aml_integrations
      WHERE tenant_id = $1 AND provider LIKE 'connector_%'
      ORDER BY created_at DESC`,
    [tenantId],
  );
  return result.rows;
}

export async function revokeConnector(id: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE aml_integrations SET enabled = FALSE, updated_at = NOW() WHERE id = $1`,
    [id],
  );
}
