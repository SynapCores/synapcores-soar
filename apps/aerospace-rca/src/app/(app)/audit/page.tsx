import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';

import { hashChain, listEvidence } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const rows = hashChain(await listEvidence());
  return (
    <div className="p-6 md:p-8 space-y-6">
      <AppPageHeader
        title="Evidence chain"
        description="Append-only. Engine rejects UPDATE / DELETE. SHA-256 chain on top for visual chain-of-custody."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent entries</CardTitle>
          <CardDescription>Last 500 rows · most recent first</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs">
            {rows.length === 0 && (
              <p className="text-muted-foreground">
                Empty. Run the demo or click a Run-Agent button on an anomaly detail page.
              </p>
            )}
            {rows.map((r) => (
              <div key={r.id} className="rounded border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-primary">{r.action}</span>
                  <span className="text-muted-foreground">{new Date(r.ts).toISOString()}</span>
                </div>
                <div className="text-muted-foreground">{r.actor} → {r.target_id}</div>
                <div className="text-foreground/80 truncate">{r.details}</div>
                <div className="text-[10px] text-muted-foreground">
                  hash {r.hash.slice(0, 16)}… prev {r.prev_hash.slice(0, 16)}…
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
