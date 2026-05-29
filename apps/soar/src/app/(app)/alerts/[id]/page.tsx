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
} from '@synapcores/app-framework';
import {
  AppPageHeader as _Header,
  Input,
  Label,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { getAlert, type AlertSeverity, type AlertStatus } from '@/lib/soar-alerts';
import { runTriage } from '@/lib/triage';
import { dispatchAction } from '@/lib/actions/dispatcher';
void _Header;

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  info: 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30',
};
const STATUS_TONE: Record<AlertStatus, string> = {
  new: 'text-primary',
  triaged: 'text-blue-300',
  duplicate: 'text-muted-foreground',
  incident: 'text-red-400',
  closed: 'text-neutral-500',
};

export default async function AlertDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ action_ok?: string; action_err?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const alert = await getAlert(session.tenant.id, id);
  if (!alert) notFound();

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title={alert.title}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium uppercase ${SEVERITY_TONE[alert.severity]}`}
            >
              {alert.severity}
            </span>
            <span>·</span>
            <span>Source: {alert.source}</span>
            <span>·</span>
            <span>Status: <span className={STATUS_TONE[alert.status]}>{alert.status}</span></span>
            <span>·</span>
            <span>Received: {new Date(alert.created_at).toLocaleString()}</span>
          </span>
        }
        actions={
          <Link
            href="/alerts"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            ← Back
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground whitespace-pre-wrap">
          {alert.description || (
            <span className="text-muted-foreground italic">
              (upstream system didn&apos;t include a description)
            </span>
          )}
        </CardContent>
      </Card>

      {alert.status === 'duplicate' && alert.dup_of && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Marked duplicate</CardTitle>
            <CardDescription>{alert.status_reason}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/alerts/${alert.dup_of}`}
              className="text-sm text-primary hover:underline"
            >
              View the original alert →
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Raw upstream payload</CardTitle>
          <CardDescription>What the connector handed us.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto text-xs rounded-md bg-black/40 p-3">
            {JSON.stringify(alert.raw_payload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triage</CardTitle>
          <CardDescription>
            Status: <span className="text-foreground">{alert.status}</span>
            {alert.triaged_at && (
              <> · last triaged {new Date(alert.triaged_at).toLocaleString()}</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {alert.status_reason && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-semibold text-primary mb-1">Verdict</p>
              <p>{alert.status_reason}</p>
            </div>
          )}
          {alert.status === 'new' && (
            <form action={dispatchTriage}>
              <input type="hidden" name="id" value={alert.id} />
              <Button type="submit">Run Tier-1 triage agent</Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Dispatches AGENT_RUN(&apos;tier1-triage&apos;) on the engine.
                Falls back to a deterministic rule-based triage when no
                LLM is configured (dev mode).
              </p>
            </form>
          )}
        </CardContent>
      </Card>

      {sp.action_ok && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          {sp.action_ok === 'notify' && 'Slack notification dispatched.'}
          {sp.action_ok === 'ticket' && 'ServiceNow ticket queued.'}
          {sp.action_ok === 'isolate_queued' &&
            'Endpoint isolation queued for human approval (HBR action).'}
        </div>
      )}
      {sp.action_err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {sp.action_err === 'empty' && 'Please fill in the required field.'}
          {sp.action_err === 'device' && 'A device id is required to isolate.'}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>
            Non-HBR actions fire immediately. HBR actions (isolate, disable,
            revoke, block) route through the approval queue (
            <Link href="/approvals" className="text-primary hover:underline">
              /approvals
            </Link>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form action={notifySlack} className="space-y-2">
            <Label htmlFor="message">Notify Slack</Label>
            <Input
              id="message"
              name="message"
              defaultValue={`SOAR alert: ${alert.title} (${alert.severity})`}
              placeholder="What should we post?"
            />
            <input type="hidden" name="alert_id" value={alert.id} />
            <Button type="submit" variant="outline" size="sm">
              Post to Slack
            </Button>
          </form>

          <form action={openTicket} className="space-y-2">
            <Label htmlFor="summary">Open ticket</Label>
            <Input
              id="summary"
              name="summary"
              defaultValue={alert.title}
              placeholder="Ticket summary"
            />
            <input type="hidden" name="alert_id" value={alert.id} />
            <Button type="submit" variant="outline" size="sm">
              File in ServiceNow
            </Button>
          </form>

          <form action={isolateEndpoint} className="space-y-2">
            <Label htmlFor="device_id" className="text-amber-400">
              Isolate endpoint (HBR — needs approval)
            </Label>
            <Input
              id="device_id"
              name="device_id"
              placeholder="CrowdStrike device id (aid)"
            />
            <input type="hidden" name="alert_id" value={alert.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            >
              Request isolation
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

async function dispatchTriage(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  await runTriage(session.tenant.id, id);
  redirect(`/alerts/${id}`);
}

async function notifySlack(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const alertId = String(formData.get('alert_id') ?? '');
  const message = String(formData.get('message') ?? '').trim();
  if (!message) redirect(`/alerts/${alertId}?action_err=empty`);
  await dispatchAction({
    actionId: 'notify_channel',
    args: { message },
    ctx: {
      tenantId: session.tenant.id,
      invokedBy: session.user.id,
      invokedByType: 'analyst',
      alertId,
    },
  });
  redirect(`/alerts/${alertId}?action_ok=notify`);
}

async function openTicket(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const alertId = String(formData.get('alert_id') ?? '');
  const summary = String(formData.get('summary') ?? '').trim();
  if (!summary) redirect(`/alerts/${alertId}?action_err=empty`);
  await dispatchAction({
    actionId: 'create_ticket',
    args: { short_description: summary, priority: 3 },
    ctx: {
      tenantId: session.tenant.id,
      invokedBy: session.user.id,
      invokedByType: 'analyst',
      alertId,
    },
  });
  redirect(`/alerts/${alertId}?action_ok=ticket`);
}

async function isolateEndpoint(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const alertId = String(formData.get('alert_id') ?? '');
  const deviceId = String(formData.get('device_id') ?? '').trim();
  if (!deviceId) redirect(`/alerts/${alertId}?action_err=device`);
  await dispatchAction({
    actionId: 'isolate_endpoint',
    args: { device_id: deviceId },
    ctx: {
      tenantId: session.tenant.id,
      invokedBy: session.user.id,
      invokedByType: 'analyst',
      alertId,
    },
  });
  redirect(`/alerts/${alertId}?action_ok=isolate_queued`);
}
