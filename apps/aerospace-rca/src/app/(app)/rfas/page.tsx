import {
  AppPageHeader,
  Card,
  DataTable,
  type DataTableColumn,
} from '@synapcores/app-framework';

import { db } from '@/lib/db';
import type { RFA } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function loadRFAs(filter: 'all' | 'open' | 'stale90'): Promise<RFA[]> {
  const where =
    filter === 'open'
      ? "WHERE status IN ('open','in-review')"
      : filter === 'stale90'
      ? "WHERE status IN ('open','in-review') AND days_open > 90"
      : '';
  const result = await db().sql<RFA>(
    `SELECT id, opened_ts, program, subsystem, title, description, owner, status,
            days_open, related_anomaly_id, related_part_id
       FROM rfas ${where}
      ORDER BY days_open DESC LIMIT 200`,
  );
  return result.rows;
}

export default async function RFAsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const sp = await searchParams;
  const f = (sp.f === 'open' || sp.f === 'stale90' ? sp.f : 'all') as
    | 'all'
    | 'open'
    | 'stale90';
  const rows = await loadRFAs(f);

  const departed = await db().sql<{ email: string }>(
    `SELECT email FROM departed_employees`,
  );
  const departedSet = new Set(departed.rows.map((r) => r.email));

  const columns: DataTableColumn<RFA>[] = [
    { key: 'id', header: 'ID', cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: 'program', header: 'Program' },
    { key: 'subsystem', header: 'Subsystem' },
    { key: 'status', header: 'Status' },
    {
      key: 'days_open',
      header: 'Days open',
      cell: (r) => (
        <span
          className={
            r.days_open > 365
              ? 'text-destructive font-semibold'
              : r.days_open > 90
              ? 'text-primary font-semibold'
              : 'text-muted-foreground'
          }
        >
          {r.days_open}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (r) => (
        <span
          className={
            departedSet.has(r.owner) ? 'text-destructive font-mono text-xs' : 'font-mono text-xs'
          }
        >
          {r.owner}
          {departedSet.has(r.owner) ? ' · DEPARTED' : ''}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      cell: (r) => <span className="text-xs">{r.title}</span>,
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <AppPageHeader
        title="Requests for Action"
        description="The NASA OIG IG-26-004 audit shape — open + aging + cross-program owners."
      />
      <Card className="p-4">
        <div className="flex gap-3 text-sm">
          {(['all', 'open', 'stale90'] as const).map((k) => (
            <a
              key={k}
              href={`/rfas${k === 'all' ? '' : `?f=${k}`}`}
              className={
                'rounded px-2 py-1 ' +
                (f === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')
              }
            >
              {k === 'all' ? 'all' : k === 'open' ? 'open' : '> 90 days'}
            </a>
          ))}
        </div>
      </Card>
      <DataTable<RFA>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyState="No RFAs."
      />
    </div>
  );
}
