import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { Activity, AlertCircle, FileLock2, ShieldAlert } from 'lucide-react';
import { requireSession } from '@/lib/session';
import { transactionCounts } from '@/lib/aml-transactions';

export default async function DashboardPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const counts = await transactionCounts(session.tenant.id);

  const stats = [
    {
      label: 'Transactions monitored',
      value: counts.total,
      icon: <Activity className="h-5 w-5 text-primary" />,
    },
    {
      label: 'SAR candidates',
      value: counts.sar_candidate,
      icon: <ShieldAlert className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Triaged',
      value: counts.triaged,
      icon: <AlertCircle className="h-5 w-5 text-primary" />,
    },
    {
      label: 'Auto-deduped',
      value: counts.duplicate,
      icon: <FileLock2 className="h-5 w-5 text-primary" />,
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
            Wire your core banking / payment rail to{' '}
            <code className="text-primary">/api/v1/aml/transactions</code> with
            a Bearer key from{' '}
            <a href="/settings/api-keys" className="text-primary hover:underline">
              /settings/api-keys
            </a>
            . Structuring / velocity / cross-border-cash auto-flag for triage.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {counts.sar_candidate > 0 ? (
            <>
              You have{' '}
              <a
                href="/cases"
                className="text-foreground font-semibold hover:text-primary"
              >
                {counts.sar_candidate} SAR candidate
                {counts.sar_candidate === 1 ? '' : 's'}
              </a>{' '}
              to review.
            </>
          ) : (
            'No SAR candidates yet.'
          )}
        </CardContent>
      </Card>
    </div>
  );
}
