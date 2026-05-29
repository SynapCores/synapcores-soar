/**
 * Per-tenant integration storage.
 *
 * Each integration row carries a JSON `secret_payload` keyed by the
 * provider's shape (e.g. `{api_token: "..."}` for CrowdStrike,
 * `{webhook_url: "..."}` for Slack). The framework's secret store
 * (Phase 2 file-backed in dev; AWS SM / Vault in production) handles
 * encryption-at-rest in production deployments.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAdminClient } from '@synapcores/app-framework/db/server';

export interface IntegrationRow {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  secret_payload: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export async function listIntegrations(tenantId: string): Promise<IntegrationRow[]> {
  const db = getAdminClient();
  const result = await db.sql<
    Omit<IntegrationRow, 'secret_payload'> & { secret_payload: string | null }
  >(
    `SELECT id, tenant_id, provider, label, secret_payload, enabled,
            created_at, updated_at, last_used_at
       FROM soar_integrations
      WHERE tenant_id = $1
      ORDER BY provider, label`,
    [tenantId],
  );
  return result.rows.map((r) => ({
    ...r,
    secret_payload:
      typeof r.secret_payload === 'string'
        ? safeJson(r.secret_payload)
        : (r.secret_payload as Record<string, unknown> | null),
  }));
}

/** Look up the first enabled integration for a provider. */
export async function findIntegration(
  tenantId: string,
  provider: string,
): Promise<IntegrationRow | null> {
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    label: string;
    secret_payload: string | null;
    enabled: boolean;
  }>(
    `SELECT id, label, secret_payload, enabled
       FROM soar_integrations
      WHERE tenant_id = $1 AND provider = $2 AND enabled = TRUE
      LIMIT 1`,
    [tenantId, provider],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: tenantId,
    provider,
    label: row.label,
    secret_payload:
      typeof row.secret_payload === 'string'
        ? safeJson(row.secret_payload)
        : (row.secret_payload as Record<string, unknown> | null),
    enabled: row.enabled,
    created_at: '',
    updated_at: '',
    last_used_at: null,
  };
}

export interface SaveIntegrationInput {
  tenantId: string;
  provider: string;
  label: string;
  /** Provider-shape JSON: webhook_url, api_token, base_url, etc. */
  secretPayload: Record<string, unknown>;
  enabled?: boolean;
}

export async function saveIntegration(input: SaveIntegrationInput): Promise<IntegrationRow> {
  const db = getAdminClient();
  const id = randomUUID();
  const enabled = input.enabled ?? true;
  await db.sql(
    `INSERT INTO soar_integrations
       (id, tenant_id, provider, label, secret_payload, enabled,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [
      id,
      input.tenantId,
      input.provider,
      input.label,
      JSON.stringify(input.secretPayload),
      enabled,
    ],
  );
  return {
    id,
    tenant_id: input.tenantId,
    provider: input.provider,
    label: input.label,
    secret_payload: input.secretPayload,
    enabled,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_used_at: null,
  };
}

export async function removeIntegration(id: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(`DELETE FROM soar_integrations WHERE id = $1`, [id]);
}

export async function stampIntegrationUsed(id: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE soar_integrations SET last_used_at = NOW() WHERE id = $1`,
    [id],
  );
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
