/**
 * Tenant lifecycle.
 *
 * `createTenant()` is what an app calls from its /onboard server action
 * after a brand-new user signs up — turns the user into a tenant owner.
 *
 * The framework writes the tenant row + the owner membership; mints a
 * per-tenant API key the framework will use when scoping DB calls
 * (see ../db/server.ts:getClientForSession). The plaintext key is
 * stored in FRAMEWORK_TENANT_KEYS_DIR (file fallback). Production
 * deployments should swap that for a real secret manager — the
 * function signatures don't change.
 *
 * Multi-tenancy model (Phase 2): one SynapCores instance, framework
 * filters queries by tenant_id. The per-tenant API key is the same as
 * the admin key for now (the framework + apps add `WHERE tenant_id = $`
 * everywhere). Phase 8 upgrades this to true per-tenant SynapCores
 * tenants when the customer-data-isolation contract becomes load-
 * bearing for enterprise.
 */

import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';

import { getAdminClient } from '../db/server';
import { ValidationError } from './users';
import type { TenantInfo } from './types';
import type { Role } from '../rbac/types';

export interface CreateTenantInput {
  /** Human-readable workspace name. */
  name: string;
  /** URL-safe slug; auto-derived from name if omitted. */
  slug?: string;
  /** The user becoming the owner of this tenant. */
  ownerUserId: string;
}

export async function createTenant(input: CreateTenantInput): Promise<TenantInfo> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new ValidationError('Workspace name must be at least 2 characters.');
  }
  const slug = (input.slug ?? slugify(name)).trim();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    throw new ValidationError(
      'Slug must be 2-40 lowercase letters, digits, or hyphens.',
    );
  }

  const db = getAdminClient();

  // Conflict check
  const existing = await db.sql(
    `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  if (existing.rows.length > 0) {
    throw new ValidationError(
      `Workspace slug "${slug}" is taken. Try another.`,
    );
  }

  const id = randomUUID();
  const apiKey = mintApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, 12);

  // CE engine quirk: DEFAULT NOW() doesn't reliably auto-populate.
  // Pass timestamps explicitly to keep ingest deterministic.
  await db.sql(
    `INSERT INTO tenants (id, name, slug, api_key_hash, api_key_prefix, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [id, name, slug, apiKeyHash, apiKey.slice(0, 8)],
  );

  // Owner membership
  await db.sql(
    `INSERT INTO memberships (user_id, tenant_id, role, created_at)
     VALUES ($1, $2, 'owner', NOW())`,
    [input.ownerUserId, id],
  );

  await persistTenantApiKey(id, apiKey);
  await writeAuditEvent({
    tenantId: id,
    actorId: input.ownerUserId,
    actorType: 'user',
    action: 'tenant.create',
    targetId: id,
    payload: { slug, name },
  });

  return { id, name, slug, apiKey };
}

/**
 * Add an existing user to an existing tenant with a role.
 * Used by invitation redemption.
 */
export async function addMembership(
  userId: string,
  tenantId: string,
  role: Role,
): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)`,
    [userId, tenantId, role],
  );
  await writeAuditEvent({
    tenantId,
    actorId: userId,
    actorType: 'user',
    action: 'tenant.join',
    targetId: tenantId,
    payload: { role },
  });
}

// ─── audit helper ────────────────────────────────────────────────────────

interface AuditEvent {
  tenantId: string | null;
  actorId: string | null;
  actorType: 'user' | 'system' | 'mcp_token';
  action: string;
  targetId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string;
}

export async function writeAuditEvent(evt: AuditEvent): Promise<void> {
  const db = getAdminClient();
  // CE engine note: `::json` cast isn't supported; JSON columns accept
  // a JSON-encoded TEXT value directly.
  await db.sql(
    `INSERT INTO framework_audit_log
       (ts, tenant_id, actor_id, actor_type, action, target_id, payload, request_id)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      evt.tenantId,
      evt.actorId,
      evt.actorType,
      evt.action,
      evt.targetId ?? null,
      JSON.stringify(evt.payload ?? {}),
      evt.requestId ?? null,
    ],
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function mintApiKey(): string {
  // 32 bytes ≈ 256 bits of entropy; base64url-encoded fits in a single line.
  return `sk_${randomBytes(32).toString('base64url')}`;
}

async function persistTenantApiKey(tenantId: string, apiKey: string): Promise<void> {
  const dir = process.env.FRAMEWORK_TENANT_KEYS_DIR ?? './var/tenant-keys';
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${tenantId}.key`), apiKey, { mode: 0o600 });
}
