import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { Activity, AlertCircle, ShieldAlert, Users } from 'lucide-react';
import { requireSession } from '@/lib/session';
import { alertCounts } from '@/lib/soar-alerts';

export default async function DashboardPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const counts = await alertCounts(session.tenant.id);

  const stats = [
    {
      label: 'New alerts',
      value: counts.new,
      icon: <ShieldAlert className="h-5 w-5 text-primary" />,
    },
    {
      label: 'In incidents',
      value: counts.incident,
      icon: <Activity className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Auto-deduped',
      value: counts.duplicate,
      icon: <AlertCircle className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Closed total',
      value: counts.closed,
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
          {session.tenant.name} · {session.role}
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
            Point your SIEM/EDR webhook at{' '}
            <code className="text-primary">/api/v1/soar/alerts</code> with a
            Bearer API key from /settings/api-keys. Duplicates auto-close;
            the rest queue for the Phase 6 triage agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You have <span className="text-foreground font-semibold">
            {counts.total}
          </span>{' '}
          alert{counts.total === 1 ? '' : 's'} on record.
        </CardContent>
      </Card>
    </div>
  );
}
