import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { listTransactions, type TxStatus, type TxFlags } from '@/lib/aml-transactions';

const STATUS_OPTIONS: Array<TxStatus | 'all'> = [
  'all',
  'new',
  'triaged',
  'sar_candidate',
  'cleared',
  'duplicate',
];

const STATUS_TONE: Record<TxStatus, string> = {
  new: 'text-primary',
  triaged: 'text-blue-300',
  sar_candidate: 'text-red-400 font-semibold',
  cleared: 'text-neutral-500',
  duplicate: 'text-muted-foreground',
};

function flagBadges(flags: TxFlags | null) {
  if (!flags) return '—';
  const items: string[] = [];
  if (flags.structuring) items.push('structuring');
  if (flags.velocity) items.push('velocity');
  if (flags.cross_border_cash) items.push('xb-cash');
  if (flags.ctr_threshold) items.push('CTR');
  if (flags.round_number) items.push('round');
  if (items.length === 0) return '—';
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((f) => (
        <span
          key={f}
          className="inline-flex px-1.5 py-0.5 rounded text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30"
        >
          {f}
        </span>
      ))}
    </div>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const status = (STATUS_OPTIONS.includes(sp.status as TxStatus | 'all')
    ? sp.status
    : 'all') as TxStatus | 'all';

  const txs = await listTransactions({
    tenantId: session.tenant.id,
    status,
    limit: 200,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Transactions"
        description="Every transaction ingested. Sub-CTR clusters, velocity, and cross-border cash auto-flag for triage."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label htmlFor="status" className="text-xs text-muted-foreground">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={status}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      <DataTable
        rows={txs}
        rowKey={(r) => r.id}
        emptyState={
          <div>
            <p>No transactions yet.</p>
            <p className="mt-2 text-xs">
              Webhook your core banking / payment rail at{' '}
              <code className="text-primary">POST /api/v1/aml/transactions</code>{' '}
              with a Bearer key from{' '}
              <Link href="/settings/api-keys" className="underline">
                /settings/api-keys
              </Link>
              .
            </p>
          </div>
        }
        columns={[
          {
            key: 'ts',
            header: 'When',
            cell: (r) => (
              <span className="whitespace-nowrap text-muted-foreground text-xs">
                {new Date(String(r.ts)).toLocaleString()}
              </span>
            ),
          },
          {
            key: 'amount_usd',
            header: 'Amount',
            cell: (r) =>
              `${r.currency} ${Number(r.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            className: 'font-mono',
          },
          { key: 'type', header: 'Type' },
          { key: 'source', header: 'Source' },
          {
            key: 'to_counterparty',
            header: 'Counterparty',
            cell: (r) => (
              <Link
                href={`/transactions/${r.id}`}
                className="text-foreground hover:text-primary"
              >
                {(r.to_counterparty as string) ?? '—'}
              </Link>
            ),
          },
          {
            key: 'flags',
            header: 'Flags',
            cell: (r) => flagBadges(r.flags),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <span className={`${STATUS_TONE[r.status as TxStatus]} text-sm`}>
                {r.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
