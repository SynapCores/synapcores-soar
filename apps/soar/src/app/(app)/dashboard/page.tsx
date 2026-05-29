import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { Activity, ShieldAlert, Users, AlertCircle } from 'lucide-react';
import { requireSession } from '@/lib/session';

/**
 * SOAR landing dashboard. Phase 1: stat cards + welcome banner.
 *
 * Phase 4 will replace the stat numbers with live counts:
 *   - open alerts (status='new')
 *   - active incidents (status IN ('investigating','responding'))
 *   - approvals waiting (approval_queue WHERE state='pending')
 *   - SLA breaches today
 */
export default async function DashboardPage() {
  const session = await requireSession();

  const stats = [
    {
      label: 'Open alerts',
      value: '—',
      icon: <ShieldAlert className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Active incidents',
      value: '—',
      icon: <Activity className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Pending approvals',
      value: '—',
      icon: <AlertCircle className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Analysts online',
      value: '—',
      icon: <Users className="h-5 w-5 text-primary" />,
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {session.user.name ?? session.user.email}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {session.tenant?.name ?? 'No workspace selected'} · {session.role}
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
              {s.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Wire your SIEM&apos;s webhook at <code>/v1/soar/alerts</code> and
            the triage agent goes to work. Phase 4 of the SOAR build is
            adding the ingest endpoint + agent dispatch — you&apos;re looking
            at the Phase 1 framework shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="text-primary font-semibold">Next up:</span>{' '}
            Alert ingest endpoint, dedup pipeline, investigation graph
            view.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
