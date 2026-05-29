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
import {
  FRAMEWORK_PERMISSIONS,
  requirePermission,
  PermissionError,
} from '../rbac';
import {
  listMcpTokens,
  mintMcpToken,
  revokeMcpToken,
  type McpTokenScope,
} from '../auth/mcp-tokens';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

async function mint(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  try {
    requirePermission(session, FRAMEWORK_PERMISSIONS.MCP_MINT);
  } catch (e) {
    if (e instanceof PermissionError && e.code === 'unauthenticated') redirect('/login');
    redirect('/settings/mcp-tokens?err=forbidden');
  }
  const label = String(formData.get('label') ?? '').trim() || 'untitled';
  const expiryDays = Math.max(
    1,
    Math.min(90, parseInt(String(formData.get('expiry_days') ?? '14'), 10) || 14),
  );
  const scope: McpTokenScope = { operations: ['read'] };
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const { plaintext } = await mintMcpToken({
    tenantId: session!.tenant!.id,
    mintedByUserId: session!.user.id,
    label,
    scope,
    expiresAt,
  });
  redirect(
    `/settings/mcp-tokens?ok=minted&token=${encodeURIComponent(plaintext)}`,
  );
}

async function revoke(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  try {
    requirePermission(session, FRAMEWORK_PERMISSIONS.MCP_REVOKE);
  } catch {
    redirect('/settings/mcp-tokens?err=forbidden');
  }
  await revokeMcpToken(String(formData.get('id') ?? ''));
  redirect('/settings/mcp-tokens?ok=revoked');
}

export default async function McpTokensPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string; token?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.tenant) redirect('/onboard');
  const sp = (await searchParams) ?? {};
  const canMint = session.permissions.includes(FRAMEWORK_PERMISSIONS.MCP_MINT);

  const tokens = await listMcpTokens(session.tenant.id);

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title="MCP auditor tokens"
        description="Scoped, time-bound, read-only tokens for external auditors and examiners. Every query they run is audit-logged."
      />

      {sp.ok === 'minted' && sp.token && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Hand this token to your auditor</CardTitle>
            <CardDescription>
              Shown once. They paste it into Claude, Cursor, or any MCP
              client. Every action they take is audit-logged on our side.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md bg-black/40 px-3 py-2 text-sm">
              {decodeURIComponent(sp.token)}
            </code>
          </CardContent>
        </Card>
      )}
      {sp.ok === 'revoked' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
          MCP token revoked. The auditor will lose access on their next query.
        </div>
      )}
      {sp.err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {decodeURIComponent(sp.err)}
        </div>
      )}

      {canMint && (
        <Card>
          <CardHeader>
            <CardTitle>Mint an auditor token</CardTitle>
            <CardDescription>
              Label it with the auditor / engagement (e.g.{' '}
              <code>&ldquo;SOC 2 Q3 2026 — Jane Smith @ ACME LLP&rdquo;</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={mint} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  name="label"
                  required
                  placeholder="SOC 2 Q3 2026 — Jane Smith @ ACME LLP"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry_days">Expires in (days)</Label>
                <Input
                  id="expiry_days"
                  name="expiry_days"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={14}
                />
                <p className="text-xs text-muted-foreground">
                  Capped at 90 days. Renew or revoke at any time.
                </p>
              </div>
              <Button type="submit">Mint token</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active tokens</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={tokens}
            rowKey={(r) => r.id}
            emptyState="No auditor tokens minted yet."
            columns={[
              { key: 'label', header: 'Label' },
              {
                key: 'created_at',
                header: 'Created',
                cell: (r) => new Date(r.created_at).toLocaleDateString(),
              },
              {
                key: 'expires_at',
                header: 'Expires',
                cell: (r) => new Date(r.expires_at).toLocaleDateString(),
              },
              {
                key: 'revoked_at',
                header: 'Status',
                cell: (r) =>
                  r.revoked_at ? (
                    <span className="text-muted-foreground">Revoked</span>
                  ) : new Date(r.expires_at) < new Date() ? (
                    <span className="text-amber-400">Expired</span>
                  ) : (
                    <span className="text-green-400">Active</span>
                  ),
              },
              {
                key: 'actions',
                header: '',
                cell: (r) =>
                  r.revoked_at ? null : (
                    <form action={revoke}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    </form>
                  ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
