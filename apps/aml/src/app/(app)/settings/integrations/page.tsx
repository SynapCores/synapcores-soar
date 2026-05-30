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
  listIntegrations,
  removeIntegration,
  saveIntegration,
} from '@/lib/actions/integrations';

const PROVIDER_HINTS: Record<string, string> = {
  slack: '{"webhook_url":"https://hooks.slack.com/services/T.../B.../..."}',
  servicenow:
    '{"instance_url":"https://acme.service-now.com","user":"...","password":"...","table":"sn_si_incident"}',
  complyadvantage: '{"api_key":"...","fuzziness":0.6}',
  'fincen-bsa':
    '{"endpoint":"https://bsa-efiling-prod...","client_id":"...","client_secret":"...","filer_id":"..."}',
  'core-banking':
    '{"endpoint":"https://corebanking.acme.com","api_token":"...","auth_header":"Authorization"}',
  webhook:
    '{"url":"https://example.com/aml","secret_header":"X-AML-Auth","secret_value":"..."}',
};
const PROVIDERS = Object.keys(PROVIDER_HINTS);

async function add(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const provider = String(formData.get('provider') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim() || provider;
  const secretJson = String(formData.get('secret_payload') ?? '').trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(secretJson);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  } catch {
    redirect('/settings/integrations?err=bad_json');
  }
  await saveIntegration({
    tenantId: session.tenant.id,
    provider,
    label,
    secretPayload: parsed,
  });
  redirect('/settings/integrations?ok=added');
}

async function remove(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  await removeIntegration(id);
  redirect('/settings/integrations?ok=removed');
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const integrations = await listIntegrations(session.tenant.id);

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="Integrations"
        description="External systems this workspace is wired to. Credentials never leave your engine."
      />

      {sp.ok === 'added' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Integration saved.
        </div>
      )}
      {sp.ok === 'removed' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
          Integration removed.
        </div>
      )}
      {sp.err === 'bad_json' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          The secret payload must be valid JSON.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add an integration</CardTitle>
          <CardDescription>
            Pick the provider, paste the provider-shape JSON payload. Hint
            templates render in the textarea placeholder as you choose.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={add} className="space-y-4">
            <div className="grid sm:grid-cols-[200px_1fr] gap-3">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <select
                  id="provider"
                  name="provider"
                  defaultValue="complyadvantage"
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
                  placeholder="Acme Bank — ComplyAdvantage prod"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret_payload">Secret payload (JSON)</Label>
              <textarea
                id="secret_payload"
                name="secret_payload"
                required
                rows={4}
                placeholder={PROVIDER_HINTS.complyadvantage}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Provider-specific shape. Examples:{' '}
                <code>{PROVIDER_HINTS.complyadvantage}</code>,{' '}
                <code>{PROVIDER_HINTS['fincen-bsa']}</code>
              </p>
            </div>
            <Button type="submit">Save integration</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active integrations</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={integrations}
            rowKey={(r) => r.id}
            emptyState="No integrations yet."
            columns={[
              { key: 'provider', header: 'Provider' },
              { key: 'label', header: 'Label' },
              {
                key: 'enabled',
                header: 'State',
                cell: (r) =>
                  r.enabled ? (
                    <span className="text-green-400">Enabled</span>
                  ) : (
                    <span className="text-muted-foreground">Disabled</span>
                  ),
              },
              {
                key: 'last_used_at',
                header: 'Last used',
                cell: (r) =>
                  r.last_used_at
                    ? new Date(String(r.last_used_at)).toLocaleString()
                    : '—',
              },
              {
                key: 'actions',
                header: '',
                cell: (r) => (
                  <form action={remove}>
                    <input type="hidden" name="id" value={String(r.id)} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
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
