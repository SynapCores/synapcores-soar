import { AppPageHeader, DataTable } from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { getAdminClient } from '@synapcores/app-framework/db/server';

interface ActionRow {
  id: string;
  action: string;
  target: string | null;
  state: string;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export default async function ActionsLedgerPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const db = getAdminClient();
  const result = await db.sql<ActionRow>(
    `SELECT id, action, target, state, requested_by, requested_at,
            completed_at, error_message
       FROM aml_actions
      WHERE tenant_id = $1
      ORDER BY requested_at DESC
      LIMIT 200`,
    [session.tenant.id],
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Actions"
        description="Every external action the AML system has dispatched — analysts, agents, and post-approval HBR flows."
      />
      <DataTable
        rows={result.rows}
        rowKey={(r) => r.id}
        emptyState="No actions yet."
        columns={[
          {
            key: 'requested_at',
            header: 'When',
            cell: (r) => (
              <span className="whitespace-nowrap text-muted-foreground text-xs">
                {new Date(r.requested_at).toLocaleString()}
              </span>
            ),
          },
          {
            key: 'action',
            header: 'Action',
            cell: (r) => <code className="text-primary">{r.action}</code>,
          },
          {
            key: 'target',
            header: 'Target',
            cell: (r) => r.target ?? '—',
            className: 'font-mono text-xs',
          },
          { key: 'requested_by', header: 'By' },
          {
            key: 'state',
            header: 'State',
            cell: (r) => {
              const tone =
                r.state === 'completed'
                  ? 'text-green-400'
                  : r.state === 'awaiting_approval'
                    ? 'text-amber-400'
                    : r.state === 'approved'
                      ? 'text-primary'
                      : r.state === 'failed' || r.state === 'rejected'
                        ? 'text-destructive'
                        : 'text-foreground';
              return <span className={tone}>{r.state}</span>;
            },
          },
          {
            key: 'error_message',
            header: 'Note',
            cell: (r) => (
              <span className="text-xs text-muted-foreground">
                {r.error_message ?? '—'}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
