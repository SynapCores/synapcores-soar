import { notFound, redirect } from 'next/navigation';
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
import {
  deletePlaybook,
  getPlaybook,
  PlaybookSchema,
  savePlaybook,
  simulatePlaybook,
} from '@/lib/playbooks';
import type { AlertSeverity, AlertStatus } from '@/lib/soar-alerts';

const SEVERITIES: AlertSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

async function update(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  const raw = String(formData.get('json') ?? '').trim();
  let parsed;
  try {
    parsed = PlaybookSchema.parse(JSON.parse(raw));
  } catch (err) {
    redirect(
      `/playbooks/${id}?err=${encodeURIComponent(
        err instanceof Error ? err.message : 'parse failed',
      )}`,
    );
  }
  await savePlaybook({
    tenantId: session.tenant.id,
    createdBy: session.user.id,
    def: parsed,
    id,
  });
  redirect(`/playbooks/${id}?ok=updated`);
}

async function remove(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  await deletePlaybook(session.tenant.id, id);
  redirect('/playbooks');
}

export default async function PlaybookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    ok?: string;
    err?: string;
    sim_severity?: string;
    sim_source?: string;
  }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const playbook = await getPlaybook(session.tenant.id, id);
  if (!playbook) notFound();

  const fixtureSeverity = (SEVERITIES.includes(sp.sim_severity as AlertSeverity)
    ? sp.sim_severity
    : 'high') as AlertSeverity;
  const fixtureSource = sp.sim_source ?? 'crowdstrike';

  const sim = simulatePlaybook(
    {
      name: playbook.name,
      description: playbook.description ?? undefined,
      match_when:
        (playbook.match_when as Record<string, unknown> | undefined) ?? undefined,
      steps: playbook.steps,
      enabled: playbook.enabled,
    },
    {
      severity: fixtureSeverity,
      source: fixtureSource,
      title: 'simulated alert',
      status: 'new' as AlertStatus,
    },
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title={playbook.name}
        description={
          <>
            v{playbook.version} · updated{' '}
            {new Date(playbook.updated_at).toLocaleString()}
          </>
        }
        actions={
          <Link
            href="/playbooks"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            ← All
          </Link>
        }
      />

      {sp.ok === 'created' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Playbook created. Try a dry-run below before enabling.
        </div>
      )}
      {sp.ok === 'updated' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Saved.
        </div>
      )}
      {sp.err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {decodeURIComponent(sp.err)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dry-run / simulation</CardTitle>
          <CardDescription>
            Walks the playbook against a fixture alert and shows what each
            step WOULD do. Nothing is dispatched. HBR actions show as
            &ldquo;would pause for approval&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="sim_severity" className="text-xs">
                Fixture severity
              </Label>
              <select
                id="sim_severity"
                name="sim_severity"
                defaultValue={fixtureSeverity}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sim_source" className="text-xs">
                Fixture source
              </Label>
              <Input
                id="sim_source"
                name="sim_source"
                defaultValue={fixtureSource}
                placeholder="crowdstrike"
                className="h-9 w-44"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Re-run
            </Button>
          </form>

          <div
            className={
              sim.matches
                ? 'rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm'
                : 'rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm'
            }
          >
            {sim.matches ? (
              <span className="text-green-300">Matches</span>
            ) : (
              <span className="text-amber-300">Skipped (match_when)</span>
            )}
            : {sim.match_reason}
          </div>

          {sim.steps.length > 0 && (
            <ol className="space-y-2 text-sm">
              {sim.steps.map((s, i) => {
                const tone =
                  s.decision === 'would_fire'
                    ? 'border-primary/40'
                    : s.decision === 'would_pause_for_approval'
                      ? 'border-amber-500/40'
                      : s.decision === 'would_skip'
                        ? 'border-muted-foreground/40'
                        : 'border-border';
                const tag =
                  s.decision === 'would_fire'
                    ? <span className="text-primary text-xs">▶ would fire</span>
                    : s.decision === 'would_pause_for_approval'
                      ? <span className="text-amber-400 text-xs">⏸ would pause for approval</span>
                      : s.decision === 'would_skip'
                        ? <span className="text-muted-foreground text-xs">⊘ would skip</span>
                        : <span className="text-muted-foreground text-xs">📝 note</span>;
                return (
                  <li
                    key={`${i}-${s.name}`}
                    className={`rounded-md border px-3 py-2 ${tone}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {i + 1}.
                      </span>
                      <span className="font-semibold">{s.name}</span>
                      {tag}
                    </div>
                    {s.action && (
                      <code className="block text-xs text-muted-foreground mt-1">
                        {s.action}({JSON.stringify(s.args ?? {})})
                      </code>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.reason}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
          <CardDescription>
            Save to bump the version. Use the dry-run above to verify before
            enabling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={update} className="space-y-3">
            <input type="hidden" name="id" value={playbook.id} />
            <textarea
              id="json"
              name="json"
              required
              rows={20}
              defaultValue={JSON.stringify(
                {
                  name: playbook.name,
                  description: playbook.description,
                  match_when: playbook.match_when,
                  steps: playbook.steps,
                  enabled: playbook.enabled,
                },
                null,
                2,
              )}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            />
            <div className="flex items-center gap-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={remove}>
            <input type="hidden" name="id" value={playbook.id} />
            <Button
              type="submit"
              variant="outline"
              className="text-destructive border-destructive/40"
            >
              Delete playbook
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
