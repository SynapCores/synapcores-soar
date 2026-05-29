import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { listAlerts, type AlertSeverity, type AlertStatus } from '@/lib/soar-alerts';

const STATUS_OPTIONS: Array<AlertStatus | 'all'> = [
  'all',
  'new',
  'triaged',
  'duplicate',
  'incident',
  'closed',
];
const SEVERITY_OPTIONS: Array<AlertSeverity | 'all'> = [
  'all',
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

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
  incident: 'text-red-400 font-semibold',
  closed: 'text-neutral-500',
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; severity?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const status = (STATUS_OPTIONS.includes(sp.status as AlertStatus | 'all')
    ? (sp.status as AlertStatus | 'all')
    : 'all') as AlertStatus | 'all';
  const severity = (SEVERITY_OPTIONS.includes(sp.severity as AlertSeverity | 'all')
    ? (sp.severity as AlertSeverity | 'all')
    : 'all') as AlertSeverity | 'all';

  const alerts = await listAlerts({
    tenantId: session.tenant.id,
    status,
    severity,
    limit: 200,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Alerts"
        description="Every alert your SIEM/EDR has sent in. Duplicates auto-close; the rest queue for the triage agent."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label htmlFor="status" className="text-xs text-muted-foreground">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={status}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="severity"
                className="text-xs text-muted-foreground"
              >
                Severity
              </label>
              <select
                id="severity"
                name="severity"
                defaultValue={severity}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      <DataTable
        rows={alerts}
        rowKey={(r) => r.id}
        emptyState={
          <div>
            <p>No alerts match yet.</p>
            <p className="mt-2 text-xs">
              Webhook your SIEM at{' '}
              <code className="text-primary">POST /api/v1/soar/alerts</code>{' '}
              with a Bearer key from{' '}
              <Link href="/settings/api-keys" className="underline">
                /settings/api-keys
              </Link>
              .
            </p>
          </div>
        }
        columns={[
          {
            key: 'created_at',
            header: 'Received',
            cell: (r) => (
              <span className="whitespace-nowrap text-muted-foreground text-xs">
                {new Date(r.created_at).toLocaleString()}
              </span>
            ),
          },
          {
            key: 'severity',
            header: 'Sev',
            cell: (r) => (
              <span
                className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium uppercase ${SEVERITY_TONE[r.severity as AlertSeverity]}`}
              >
                {r.severity}
              </span>
            ),
          },
          { key: 'source', header: 'Source' },
          {
            key: 'title',
            header: 'Title',
            cell: (r) => (
              <Link
                href={`/alerts/${r.id}`}
                className="text-foreground hover:text-primary"
              >
                {r.title}
              </Link>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <span className={`${STATUS_TONE[r.status as AlertStatus]} text-sm`}>
                {r.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
