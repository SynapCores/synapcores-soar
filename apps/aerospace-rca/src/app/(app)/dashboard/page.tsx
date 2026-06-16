import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import Link from 'next/link';
import { Activity, AlertCircle, FileLock2, Rocket } from 'lucide-react';

import { counts } from '@/lib/anomalies';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function fetchOldRfaCount(): Promise<number> {
  const n = await db().sqlScalar<number>(
    `SELECT COUNT(*) FROM rfas WHERE status IN ('open','in-review') AND days_open > 90`,
  );
  return Number(n ?? 0);
}

async function fetchEvidenceCount(): Promise<number> {
  const n = await db().sqlScalar<number>(`SELECT COUNT(*) FROM evidence_chain`);
  return Number(n ?? 0);
}

async function similarHitsThisWeek(): Promise<number> {
  // Proxy: rows in agent_runs persona='reliability_engineer' in the last 7 days.
  // For demo freshness it counts as "this week".
  const n = await db().sqlScalar<number>(
    `SELECT COUNT(*) FROM agent_runs
      WHERE persona = 'reliability_engineer'
        AND ts > NOW() - INTERVAL '7 days'`,
  );
  return Number(n ?? 0);
}

export default async function DashboardPage() {
  const [c, oldRfas, evidence] = await Promise.all([
    counts(),
    fetchOldRfaCount(),
    fetchEvidenceCount(),
  ]);
  // similarHitsThisWeek may fail if the engine doesn't support NOW() - INTERVAL.
  let recallHits = 0;
  try {
    recallHits = await similarHitsThisWeek();
  } catch {
    recallHits = 0;
  }

  const stats = [
    {
      label: 'Open anomalies',
      value: c.open + c.investigating,
      icon: <AlertCircle className="h-5 w-5 text-primary" />,
      hint: `${c.investigating} investigating, ${c.open} open`,
    },
    {
      label: 'Vector recall hits / week',
      value: recallHits,
      icon: <Activity className="h-5 w-5 text-primary" />,
      hint: 'Reliability Engineer agent runs',
    },
    {
      label: 'RFAs open > 90 days',
      value: oldRfas,
      icon: <Rocket className="h-5 w-5 text-primary" />,
      hint: 'OIG IG-26-004 audit-signal range',
    },
    {
      label: 'Evidence-chain entries',
      value: evidence,
      icon: <FileLock2 className="h-5 w-5 text-primary" />,
      hint: 'Immutable; UPDATE-rejected',
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Aerospace anomaly investigation memory
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          One engine. {c.total} anomalies. {Object.keys(c.by_program).length} programs.
          Vector + graph + agent + immutable audit, all in one SQL surface.
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
              <p className="text-xs text-muted-foreground mt-1">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        {Object.entries(c.by_program)
          .sort((a, b) => b[1] - a[1])
          .map(([prog, n]) => (
            <Card key={prog}>
              <CardHeader>
                <CardTitle className="text-base">{prog}</CardTitle>
                <CardDescription>{n} anomalies in this program</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <Link
                  href={`/anomalies?program=${encodeURIComponent(prog)}`}
                  className="text-primary hover:underline"
                >
                  See {prog} anomalies →
                </Link>
              </CardContent>
            </Card>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run the demo</CardTitle>
          <CardDescription>
            Five acts in ~70 seconds.{' '}
            <Link href="/demo" className="text-primary hover:underline">
              /demo
            </Link>{' '}
            — every query runs live against the engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Act 1: anomaly ingest · Act 2: vector recall across 28 months ·
          Act 3: graph reveals supplier fingerprint · Act 4: agent finds RFA
          bureaucracy fault line · Act 5: tamper-evident evidence export.
        </CardContent>
      </Card>
    </div>
  );
}
