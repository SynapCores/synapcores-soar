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
  DataTable,
  Input,
  Label,
} from '../ui';
import { getAdminClient } from '../db/server';
import {
  inviteUser,
  listPendingInvites,
  revokeInvitation,
} from '../auth/invitations';
import {
  FRAMEWORK_PERMISSIONS,
  PermissionError,
  requirePermission,
} from '../rbac';
import type { Session } from '../auth/types';
import type { Role } from '../rbac/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

interface TeamPageProps {
  appName: string;
}

export function makeTeamPage({ appName }: TeamPageProps) {
  async function sendInvite(formData: FormData): Promise<void> {
    'use server';
    const session = await getSession();
    try {
      requirePermission(session, FRAMEWORK_PERMISSIONS.TENANT_INVITE);
    } catch (e) {
      if (e instanceof PermissionError && e.code === 'unauthenticated') redirect('/login');
      redirect('/team?err=forbidden');
    }
    const email = String(formData.get('email') ?? '').trim();
    const role = String(formData.get('role') ?? 'analyst') as Role;
    if (!session!.tenant) return;
    const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3001';
    try {
      await inviteUser({
        tenantId: session!.tenant.id,
        tenantName: session!.tenant.name,
        email,
        role,
        invitedByUserId: session!.user.id,
        invitedByName: session!.user.name ?? session!.user.email,
        appName,
        appBaseUrl: base,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invite failed.';
      redirect(`/team?err=${encodeURIComponent(msg)}`);
    }
    redirect('/team?ok=invited');
  }

  async function revoke(formData: FormData): Promise<void> {
    'use server';
    const session = await getSession();
    try {
      requirePermission(session, FRAMEWORK_PERMISSIONS.TENANT_INVITE);
    } catch {
      redirect('/team?err=forbidden');
    }
    const id = String(formData.get('id') ?? '');
    await revokeInvitation(id);
    redirect('/team?ok=revoked');
  }

  return async function TeamPage({
    searchParams,
  }: {
    searchParams?: Promise<{ ok?: string; err?: string }>;
  }) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (!session.tenant) redirect('/onboard');
    const sp = (await searchParams) ?? {};
    const canInvite = session.permissions.includes(FRAMEWORK_PERMISSIONS.TENANT_INVITE);

    const db = getAdminClient();

    // Members — fetch the membership rows, then fetch each user (CE join workaround)
    const memberships = await db.sql<{ user_id: string; role: string; created_at: string }>(
      `SELECT user_id, role, created_at
         FROM memberships WHERE tenant_id = $1 ORDER BY created_at`,
      [session.tenant.id],
    );
    const members = await Promise.all(
      memberships.rows.map(async (m) => {
        const user = await db.sql<{ email: string; name: string | null }>(
          `SELECT email, name FROM users WHERE id = $1 LIMIT 1`,
          [m.user_id],
        );
        const u = user.rows[0];
        return {
          user_id: m.user_id,
          email: u?.email ?? '(unknown)',
          name: u?.name ?? '',
          role: m.role,
          joined: new Date(m.created_at).toLocaleDateString(),
        };
      }),
    );

    const pending = await listPendingInvites(session.tenant.id);

    return (
      <div className="p-6 md:p-8 max-w-5xl space-y-8">
        <AppPageHeader
          title="Team"
          description="Members of this workspace + pending invitations."
        />

        {sp.ok === 'invited' && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
            Invitation sent.
          </div>
        )}
        {sp.ok === 'revoked' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
            Invitation revoked.
          </div>
        )}
        {sp.err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
            {decodeURIComponent(sp.err)}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} user{members.length === 1 ? '' : 's'} in{' '}
              {session.tenant.name}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={members}
              rowKey={(r) => r.user_id}
              columns={[
                { key: 'name', header: 'Name', cell: (r) => r.name || '—' },
                { key: 'email', header: 'Email' },
                {
                  key: 'role',
                  header: 'Role',
                  cell: (r) => <span className="capitalize">{r.role}</span>,
                },
                { key: 'joined', header: 'Joined' },
              ]}
            />
          </CardContent>
        </Card>

        {canInvite && (
          <Card>
            <CardHeader>
              <CardTitle>Invite an analyst</CardTitle>
              <CardDescription>
                They&apos;ll get an email with a join link. Invitations expire
                in 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={sendInvite} className="space-y-4">
                <div className="grid sm:grid-cols-[1fr_180px] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      required
                      placeholder="analyst@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      name="role"
                      defaultValue="analyst"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="admin">Admin</option>
                      <option value="analyst">Analyst</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                </div>
                <Button type="submit">Send invite</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              {pending.length === 0 ? 'None outstanding.' : `${pending.length} waiting.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={pending}
              rowKey={(r) => r.id}
              emptyState="No pending invitations."
              columns={[
                { key: 'email', header: 'Email' },
                {
                  key: 'role',
                  header: 'Role',
                  cell: (r) => <span className="capitalize">{r.role}</span>,
                },
                {
                  key: 'expires_at',
                  header: 'Expires',
                  cell: (r) => new Date(String(r.expires_at)).toLocaleDateString(),
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (r) => (
                    canInvite ? (
                      <form action={revoke}>
                        <input type="hidden" name="id" value={String(r.id)} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          Revoke
                        </Button>
                      </form>
                    ) : null
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    );
  };
}
