'use server';
import { createTenant } from '@synapcores/app-framework/auth/server-actions';
import { requireSession } from '@/lib/session';
export async function provisionWorkspace(input: { name: string; slug?: string }): Promise<{ tenantId: string }> {
  const session = await requireSession();
  const tenant = await createTenant({
    name: input.name,
    slug: input.slug,
    ownerUserId: session.user.id,
  });
  return { tenantId: tenant.id };
}
