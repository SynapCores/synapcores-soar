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
  listApiKeys,
  mintApiKey,
  revokeApiKey,
} from '../auth/api-keys';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

async function mint(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  if (!session || !session.tenant) redirect('/login');
  const label = String(formData.get('label') ?? '').trim() || 'untitled';
  const { plaintext, row } = await mintApiKey({
    tenantId: session!.tenant!.id,
    userId: session!.user.id,
    label,
  });
  redirect(
    `/settings/api-keys?ok=minted&token=${encodeURIComponent(plaintext)}&id=${row.id}`,
  );
}

async function revoke(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  if (!session) redirect('/login');
  const id = String(formData.get('id') ?? '');
  await revokeApiKey(id);
  redirect('/settings/api-keys?ok=revoked');
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; token?: string; id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.tenant) redirect('/onboard');
  const sp = (await searchParams) ?? {};
  const keys = await listApiKeys(session.tenant.id, session.user.id);

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title="API keys"
        description="Programmatic tokens for the SynapCores SDK and CLI. One-time secret — copy at mint."
      />

      {sp.ok === 'minted' && sp.token && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Copy this token now</CardTitle>
            <CardDescription>
              We don&apos;t store the plaintext — once you close this page it&apos;s gone.
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
          API key revoked.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mint a new key</CardTitle>
          <CardDescription>
            Label it for the system that will use it (e.g. &ldquo;laptop CLI&rdquo;).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={mint} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" required placeholder="laptop CLI" />
            </div>
            <Button type="submit">Mint key</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={keys}
            rowKey={(r) => r.id}
            emptyState="You haven't minted any keys yet."
            columns={[
              { key: 'label', header: 'Label' },
              {
                key: 'key_prefix',
                header: 'Prefix',
                className: 'font-mono text-xs',
                cell: (r) => `${r.key_prefix}…`,
              },
              {
                key: 'created_at',
                header: 'Created',
                cell: (r) => new Date(r.created_at).toLocaleString(),
              },
              {
                key: 'revoked_at',
                header: 'Status',
                cell: (r) =>
                  r.revoked_at ? (
                    <span className="text-muted-foreground">Revoked</span>
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
