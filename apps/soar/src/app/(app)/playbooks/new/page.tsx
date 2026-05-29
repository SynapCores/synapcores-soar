import { redirect } from 'next/navigation';
import Link from 'next/link';
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
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { PlaybookSchema, savePlaybook } from '@/lib/playbooks';
import { PLAYBOOK_TEMPLATES } from '@/lib/playbook-examples';

async function create(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const raw = String(formData.get('json') ?? '').trim();
  let parsed;
  try {
    parsed = PlaybookSchema.parse(JSON.parse(raw));
  } catch (err) {
    redirect(
      `/playbooks/new?err=${encodeURIComponent(
        err instanceof Error ? err.message : 'parse failed',
      )}`,
    );
  }
  const saved = await savePlaybook({
    tenantId: session.tenant.id,
    createdBy: session.user.id,
    def: parsed,
  });
  redirect(`/playbooks/${saved.id}?ok=created`);
}

export default async function NewPlaybookPage({
  searchParams,
}: {
  searchParams?: Promise<{ template?: string; err?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const template = sp.template ? PLAYBOOK_TEMPLATES[sp.template] : null;
  const seed = JSON.stringify(
    template ?? {
      name: 'My playbook',
      description: '',
      match_when: { severity: ['critical', 'high'] },
      steps: [
        {
          type: 'action',
          name: 'Notify SOC',
          action: 'notify_channel',
          args: { message: 'Alert triaged — see SOAR for details.' },
        },
      ],
    },
    null,
    2,
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title={template ? `New playbook from "${template.name}"` : 'New playbook'}
        description="Paste or edit the playbook JSON. Schema-validated on save. Visit the detail page after save to run a dry-run before enabling."
        actions={
          <Link
            href="/playbooks"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            ← All playbooks
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Start from a template, then edit. Each template references the
            action ids from the Phase 6 registry.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(PLAYBOOK_TEMPLATES).map(([key, def]) => (
            <Link
              key={key}
              href={`/playbooks/new?template=${encodeURIComponent(key)}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary"
            >
              {def.name}
            </Link>
          ))}
        </CardContent>
      </Card>

      {sp.err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {decodeURIComponent(sp.err)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Playbook JSON</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={create} className="space-y-3">
            <Label htmlFor="json">Definition</Label>
            <textarea
              id="json"
              name="json"
              required
              rows={22}
              defaultValue={seed}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            />
            <Button type="submit">Save playbook</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
