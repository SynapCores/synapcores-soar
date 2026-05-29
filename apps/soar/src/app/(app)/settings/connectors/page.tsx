import { redirect } from 'next/navigation';
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
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import {
  listConnectors,
  mintConnectorToken,
  revokeConnector,
  type ConnectorProvider,
} from '@/lib/connectors/mint';

const PROVIDERS: ReadonlyArray<ConnectorProvider> = [
  'splunk',
  'sentinel',
  'crowdstrike',
  'okta',
];

const SETUP_NOTES: Record<ConnectorProvider, string> = {
  splunk:
    'Splunk → Settings → Data inputs → HTTP Event Collector → New Token. Then create an alert action: POST to the URL below with Authorization: Splunk <token>.',
  sentinel:
    'Sentinel → Automation → Logic App → trigger "When a Microsoft Sentinel incident is created" → HTTP action → POST to the URL below with Authorization: Bearer <token>.',
  crowdstrike:
    'Falcon console → Workflows → New workflow → trigger "New detection" → action "Send via webhook" → POST to the URL below with Authorization: Bearer <token>.',
  okta:
    'Okta Admin → Workflow → Event Hooks → Create Event Hook → URL = the one below. Auth header = X-Synapcores-Auth, value = <token>. Subscribe to user.session.start, user.account.lock, mfa.bypass.',
};

async function mint(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const provider = String(formData.get('provider') ?? 'splunk') as ConnectorProvider;
  const label = String(formData.get('label') ?? '').trim() || provider;
  if (!PROVIDERS.includes(provider)) redirect('/settings/connectors?err=bad_provider');
  const { plaintext, row } = await mintConnectorToken({
    tenantId: session.tenant.id,
    provider,
    label,
  });
  redirect(
    `/settings/connectors?ok=minted&provider=${provider}&token=${encodeURIComponent(plaintext)}&id=${row.id}`,
  );
}

async function revoke(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  await revokeConnector(String(formData.get('id') ?? ''));
  redirect('/settings/connectors?ok=revoked');
}

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    ok?: string;
    provider?: string;
    token?: string;
    err?: string;
  }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const connectors = await listConnectors(session.tenant.id);
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3001';

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="Connectors"
        description="Webhook ingest endpoints for your SIEM / EDR / IAM. Each mints a unique bearer token; the URL stays the same per provider."
      />

      {sp.ok === 'minted' && sp.token && sp.provider && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>
              {sp.provider} connector token (copy now)
            </CardTitle>
            <CardDescription>
              Shown once. Paste it into{' '}
              {sp.provider === 'splunk' && 'Splunk HEC token field'}
              {sp.provider === 'sentinel' && 'the Sentinel Logic App HTTP action Authorization'}
              {sp.provider === 'crowdstrike' && 'the Falcon Workflow webhook Authorization'}
              {sp.provider === 'okta' && 'Okta Event Hook auth header (X-Synapcores-Auth)'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Webhook URL</Label>
              <code className="block break-all rounded-md bg-black/40 px-3 py-2 text-sm mt-1">
                {`${base}/api/v1/connectors/${sp.provider}`}
              </code>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Bearer token</Label>
              <code className="block break-all rounded-md bg-black/40 px-3 py-2 text-sm mt-1">
                {decodeURIComponent(sp.token)}
              </code>
            </div>
          </CardContent>
        </Card>
      )}

      {sp.ok === 'revoked' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
          Connector disabled. Future inbound webhooks will be rejected.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mint a connector token</CardTitle>
          <CardDescription>
            Pick the source SIEM/EDR/IAM. The token authenticates inbound
            webhooks; the bearer goes in the upstream system&apos;s alert
            action config.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={mint} className="space-y-4">
            <div className="grid sm:grid-cols-[200px_1fr] gap-3">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <select
                  id="provider"
                  name="provider"
                  defaultValue="splunk"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  name="label"
                  required
                  placeholder="Acme Bank — Prod Splunk"
                />
              </div>
            </div>
            <Button type="submit">Mint connector token</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup guides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {PROVIDERS.map((p) => (
            <details key={p} className="rounded border border-border p-3">
              <summary className="font-headline capitalize cursor-pointer">{p}</summary>
              <p className="mt-2 text-muted-foreground">{SETUP_NOTES[p]}</p>
              <code className="block break-all rounded bg-black/40 px-2 py-1 text-xs mt-2">
                {`${base}/api/v1/connectors/${p}`}
              </code>
            </details>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active connectors</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={connectors}
            rowKey={(r) => r.id}
            emptyState="No connectors yet."
            columns={[
              {
                key: 'provider',
                header: 'Provider',
                cell: (r) => String(r.provider).replace(/^connector_/, ''),
              },
              { key: 'label', header: 'Label' },
              {
                key: 'created_at',
                header: 'Created',
                cell: (r) => new Date(String(r.created_at)).toLocaleDateString(),
              },
              {
                key: 'last_used_at',
                header: 'Last received',
                cell: (r) =>
                  r.last_used_at
                    ? new Date(String(r.last_used_at)).toLocaleString()
                    : '—',
              },
              {
                key: 'actions',
                header: '',
                cell: (r) => (
                  <form action={revoke}>
                    <input type="hidden" name="id" value={String(r.id)} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Disable
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
