import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '../routes/auth';
import {
  AppPageHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../ui';
import { getAdminClient } from '../db/server';
import {
  requirePermission,
  FRAMEWORK_PERMISSIONS,
  PermissionError,
} from '../rbac';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

async function updateWorkspace(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  try {
    requirePermission(session, FRAMEWORK_PERMISSIONS.SETTINGS_WRITE);
  } catch (e) {
    if (e instanceof PermissionError && e.code === 'unauthenticated') redirect('/login');
    redirect('/settings/workspace?err=forbidden');
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name || !session!.tenant) return;
  const db = getAdminClient();
  await db.sql(
    `UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2`,
    [name, session!.tenant.id],
  );
  redirect('/settings/workspace?ok=name');
}

export default async function WorkspaceSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.tenant) redirect('/onboard');
  const sp = (await searchParams) ?? {};
  const canEdit = session.permissions.includes(FRAMEWORK_PERMISSIONS.SETTINGS_WRITE);

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <AppPageHeader
        title="Workspace"
        description="Tenant-level settings."
      />
      {sp.ok === 'name' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Workspace name updated.
        </div>
      )}
      {sp.err === 'forbidden' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          You don&apos;t have permission to change workspace settings.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{session.tenant.name}</CardTitle>
          <CardDescription>
            Slug: <code className="text-primary">{session.tenant.slug}</code>{' '}
            (immutable — used in URLs and audit references)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateWorkspace} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={session.tenant.name}
                disabled={!canEdit}
              />
              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  Only owners and admins can edit workspace settings.
                </p>
              )}
            </div>
            <Button type="submit" disabled={!canEdit}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
