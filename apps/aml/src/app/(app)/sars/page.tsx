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
import { listSars } from '@/lib/sar-drafter';

const STATUS_TONE: Record<string, string> = {
  draft: 'text-amber-300',
  review: 'text-blue-300',
  approved: 'text-green-400',
  filed: 'text-primary font-semibold',
  rejected: 'text-destructive',
};

export default async function SarsPage() {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sars = await listSars(session.tenant.id);

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="SARs"
        description="Drafted, reviewed, approved, and filed Suspicious Activity Reports. Run the sar-drafter agent from a transaction detail page to start a new one."
      />
      {sars.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No SARs yet</CardTitle>
            <CardDescription>
              Click into a SAR-candidate transaction and run the{' '}
              <code>sar-drafter</code> agent. The agent retrieves similar prior
              SARs, walks the UBO graph, and applies the jurisdiction-specific
              template. Fallback is deterministic — works without an LLM
              configured.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DataTable
          rows={sars}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'created_at',
              header: 'Drafted',
              cell: (r) => (
                <span className="whitespace-nowrap text-muted-foreground text-xs">
                  {new Date(String(r.created_at)).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'jurisdiction',
              header: 'Jurisdiction',
              cell: (r) => <code className="text-xs">{r.jurisdiction as string}</code>,
            },
            {
              key: 'drafted_by',
              header: 'Drafted by',
              cell: (r) => <code className="text-xs">{(r.drafted_by as string) ?? '—'}</code>,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <span
                  className={`${STATUS_TONE[String(r.status)] ?? ''} text-sm`}
                >
                  {r.status as string}
                </span>
              ),
            },
            {
              key: 'id',
              header: '',
              cell: (r) => (
                <Link
                  href={`/sars/${r.id}`}
                  className="text-primary text-xs hover:underline"
                >
                  Open →
                </Link>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
