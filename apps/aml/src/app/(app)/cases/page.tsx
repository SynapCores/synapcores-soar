import Link from 'next/link';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { listTransactions } from '@/lib/aml-transactions';

/**
 * Cases: transactions the rules engine escalated as SAR-candidates.
 * Phase 2 keeps it simple — status='sar_candidate' transactions ARE
 * the case rows. Phase 3 promotes them into proper aml_cases with
 * timelines + multi-tx aggregation + SAR drafting.
 */
export default async function CasesPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const sarCandidates = await listTransactions({
    tenantId: session.tenant.id,
    status: 'sar_candidate',
    limit: 200,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Cases"
        description="Transactions the rules engine escalated to SAR-candidate. Phase 3 wires the sar-drafter agent + full case-file shape."
      />

      {sarCandidates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No open cases</CardTitle>
            <CardDescription>
              When the structuring / velocity / cross-border-cash detector
              flags a transaction, it lands here. Try the seed-demo script
              to see a case materialize.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DataTable
          rows={sarCandidates}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'ts',
              header: 'Opened',
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
            { key: 'from_customer', header: 'Customer' },
            { key: 'to_counterparty', header: 'Counterparty' },
            {
              key: 'status_reason',
              header: 'Triage rationale',
              cell: (r) => (
                <Link
                  href={`/transactions/${r.id}`}
                  className="text-foreground hover:text-primary text-xs"
                >
                  {r.status_reason ?? '—'}
                </Link>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
