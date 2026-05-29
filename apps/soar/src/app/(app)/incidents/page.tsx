import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { listAlerts } from '@/lib/soar-alerts';

/**
 * Incidents — alerts the triage agent has escalated to true-positive.
 * Phase 5 keeps it simple: status='incident' alerts ARE the incidents.
 * Phase 6+ properly threads multiple alerts into soar_incidents and
 * adds case timelines.
 */
export default async function IncidentsPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const incidents = await listAlerts({
    tenantId: session.tenant.id,
    status: 'incident',
    limit: 200,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Incidents"
        description="Alerts the triage agent escalated. Each row will become a full case with timeline + playbook execution in Phase 7."
      />

      {incidents.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No open incidents</CardTitle>
            <CardDescription>
              When triage decides an alert is a true-positive, it lands here.
              Try the &ldquo;Run Tier-1 triage&rdquo; button on a high-severity
              alert to see one promoted.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DataTable
          rows={incidents}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'created_at',
              header: 'Opened',
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
                <span className="uppercase text-xs font-medium">{r.severity}</span>
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
              key: 'status_reason',
              header: 'Triage rationale',
              cell: (r) => (
                <span className="text-xs text-muted-foreground">
                  {r.status_reason ?? '—'}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
