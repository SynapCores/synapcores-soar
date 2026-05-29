import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { getAlert, type AlertSeverity, type AlertStatus } from '@/lib/soar-alerts';

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
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { id } = await params;
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
            Agent dispatch lands in Phase 6 — verdict + tool trace will
            render here.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The Phase 4 build only ingests + dedups. Click triage on the
          alert and the Phase 6 agent will populate this card.
        </CardContent>
      </Card>
    </div>
  );
}
