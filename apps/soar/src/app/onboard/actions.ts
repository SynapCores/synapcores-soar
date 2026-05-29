'use server';

import { createTenant } from '@synapcores/app-framework/auth/server-actions';
import { requireSession } from '@/lib/session';

/**
 * Provision a new workspace owned by the current user.
 *
 * SOAR-app-specific note: once we add SOAR's domain schema (Phase 4),
 * this action will also drop the per-tenant SOAR tables (or seed them
 * into the shared schema with tenant_id columns). For now it just
 * lands the framework tenant.
 */
export async function provisionWorkspace(input: {
  name: string;
  slug?: string;
}): Promise<{ tenantId: string }> {
  const session = await requireSession();
  const tenant = await createTenant({
    name: input.name,
    slug: input.slug,
    ownerUserId: session.user.id,
  });
  return { tenantId: tenant.id };
}
