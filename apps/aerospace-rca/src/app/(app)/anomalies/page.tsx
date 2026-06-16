import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  DataTable,
  type DataTableColumn,
} from '@synapcores/app-framework';

import { listAnomalies } from '@/lib/anomalies';
import type { Anomaly } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROGRAMS = ['all', 'BE-4', 'BE-3', 'NG', 'NS', 'HLS'];
const SEVERITIES = ['all', 'critical', 'major', 'minor', 'observation'];

export default async function AnomaliesPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; severity?: string }>;
}) {
  const sp = await searchParams;
  const program = sp.program ?? 'all';
  const severity = sp.severity ?? 'all';
  const rows = await listAnomalies({ program, severity, limit: 200 });

  const columns: DataTableColumn<Anomaly>[] = [
    {
      key: 'id',
      header: 'ID',
      cell: (a) => (
        <Link href={`/anomalies/${a.id}`} className="text-primary hover:underline font-mono text-xs">
          {a.id}
        </Link>
      ),
    },
    { key: 'ts', header: 'When', cell: (a) => new Date(a.ts).toISOString().slice(0, 10) },
    { key: 'program', header: 'Program' },
    { key: 'subsystem', header: 'Subsystem' },
    { key: 'unit_id', header: 'Unit' },
    {
      key: 'severity',
      header: 'Severity',
      cell: (a) => (
        <span
          className={
            a.severity === 'critical'
              ? 'text-destructive font-semibold'
              : a.severity === 'major'
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }
        >
          {a.severity}
        </span>
      ),
    },
    { key: 'status', header: 'Status' },
    {
      key: 'title',
      header: 'Title',
      cell: (a) => <span className="text-xs">{a.title}</span>,
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <AppPageHeader
        title="Anomalies"
        description={`${rows.length} rows · vector-indexed for "have we seen this before?"`}
      />

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <span className="text-muted-foreground">Program:</span>
          {PROGRAMS.map((p) => (
            <Link
              key={p}
              href={{
                pathname: '/anomalies',
                query: { ...(p !== 'all' ? { program: p } : {}), ...(severity !== 'all' ? { severity } : {}) },
              }}
              className={
                'rounded px-2 py-1 ' +
                (program === p ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground')
              }
            >
              {p}
            </Link>
          ))}
          <span className="ml-4 text-muted-foreground">Severity:</span>
          {SEVERITIES.map((s) => (
            <Link
              key={s}
              href={{
                pathname: '/anomalies',
                query: { ...(program !== 'all' ? { program } : {}), ...(s !== 'all' ? { severity: s } : {}) },
              }}
              className={
                'rounded px-2 py-1 ' +
                (severity === s ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground')
              }
            >
              {s}
            </Link>
          ))}
        </div>
      </Card>

      <DataTable<Anomaly>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyState="No anomalies match the current filter."
      />
    </div>
  );
}
