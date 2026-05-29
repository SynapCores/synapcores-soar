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
import { getTransaction, type TxStatus, type TxFlags } from '@/lib/aml-transactions';

const STATUS_TONE: Record<TxStatus, string> = {
  new: 'text-primary',
  triaged: 'text-blue-300',
  sar_candidate: 'text-red-400 font-semibold',
  cleared: 'text-neutral-500',
  duplicate: 'text-muted-foreground',
};

function describeFlags(flags: TxFlags | null): string[] {
  if (!flags) return [];
  const out: string[] = [];
  if (flags.structuring) out.push('Structuring pattern — 3+ sub-CTR transactions in the last 24h.');
  if (flags.velocity) out.push('Velocity — aggregated transaction value above the 24h threshold.');
  if (flags.cross_border_cash) out.push('Cross-border cash movement — high-risk vector.');
  if (flags.ctr_threshold) out.push('Above the Currency Transaction Report threshold.');
  if (flags.round_number) out.push('Round-number amount — possible layering tell.');
  return out;
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { id } = await params;
  const tx = await getTransaction(session.tenant.id, id);
  if (!tx) notFound();

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title={`${tx.currency} ${Number(tx.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>Source: {tx.source}</span>
            <span>·</span>
            <span>Type: {tx.type}</span>
            <span>·</span>
            <span>Status: <span className={STATUS_TONE[tx.status as TxStatus]}>{tx.status}</span></span>
            <span>·</span>
            <span>{new Date(tx.ts).toLocaleString()}</span>
          </span>
        }
        actions={
          <Link href="/transactions" className="text-sm text-muted-foreground hover:text-primary">
            ← Back
          </Link>
        }
      />

      {tx.status_reason && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle>Triage rationale</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{tx.status_reason}</p>
            {describeFlags(tx.flags).length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-muted-foreground text-xs space-y-1">
                {describeFlags(tx.flags).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Counterparty</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>From customer: <code>{tx.from_customer ?? '—'}</code></p>
          <p>From account: <code>{tx.from_account ?? '—'}</code></p>
          <p>To counterparty: <code>{tx.to_counterparty ?? '—'}</code></p>
          <p>To country: <code>{tx.to_country ?? '—'}</code></p>
          {tx.narrative && (
            <p className="pt-2">
              Narrative: <span className="text-muted-foreground italic">{tx.narrative}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw upstream payload</CardTitle>
          <CardDescription>What the connector handed us.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto text-xs rounded-md bg-black/40 p-3">
            {JSON.stringify(tx.raw_payload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SAR drafting</CardTitle>
          <CardDescription>
            Phase 3 wires the <code>sar-drafter</code> agent — it walks the UBO
            graph, retrieves similar prior SARs, and produces a jurisdiction-
            specific draft narrative.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Phase 2 ships ingest + behavioral flagging only.
        </CardContent>
      </Card>
    </div>
  );
}
