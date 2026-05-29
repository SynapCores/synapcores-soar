import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { Activity, AlertCircle, FileLock2, Users } from 'lucide-react';
import { requireSession } from '@/lib/session';

/**
 * AML landing dashboard. Phase 1 ships the shell; Phase 2 wires
 * live counts (open transactions, alerts in review, SAR drafts,
 * sanctions hits).
 */
export default async function DashboardPage() {
  const session = await requireSession();

  const stats = [
    { label: 'Transactions monitored', value: '—', icon: <Activity className="h-5 w-5 text-primary" /> },
    { label: 'Open cases', value: '—', icon: <AlertCircle className="h-5 w-5 text-primary" /> },
    { label: 'SAR drafts', value: '—', icon: <FileLock2 className="h-5 w-5 text-primary" /> },
    { label: 'Analysts online', value: '—', icon: <Users className="h-5 w-5 text-primary" /> },
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
            Phase 1 ships the auth + tenancy + framework UI shell. Phase 2
            wires the transaction-monitoring webhook at{' '}
            <code className="text-primary">/api/v1/aml/transactions</code> +
            structuring detection + the cases UI. Phase 3 wires the SAR-
            drafter agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You&apos;re looking at the AML Phase 1 framework shell.
        </CardContent>
      </Card>
    </div>
  );
}
