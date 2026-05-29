import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '../routes/auth';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from '../ui';
import { getAdminClient } from '../db/server';
import {
  FRAMEWORK_PERMISSIONS,
  PermissionError,
  requirePermission,
} from '../rbac';
import { ShieldCheck } from 'lucide-react';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

interface AuditPageRow {
  event_id: number;
  ts: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  target_id: string | null;
  payload: unknown;
}

export default async function AuditLogPage() {
  const session = await getSession();
  try {
    requirePermission(session, FRAMEWORK_PERMISSIONS.AUDIT_READ);
  } catch (e) {
    if (e instanceof PermissionError) {
      if (e.code === 'unauthenticated') redirect('/login');
      redirect('/dashboard?err=forbidden');
    }
    throw e;
  }
  if (!session!.tenant) redirect('/onboard');

  const db = getAdminClient();
  const result = await db.sql<AuditPageRow>(
    `SELECT event_id, ts, actor_id, actor_type, action, target_id, payload
       FROM framework_audit_log
      WHERE tenant_id = $1
      ORDER BY event_id DESC
      LIMIT 100`,
    [session!.tenant.id],
  );

  // Attempt to verify the chain. If the engine's VERIFY_CHAIN isn't
  // available we degrade gracefully.
  let chainStatus: 'verified' | 'failed' | 'unknown' = 'unknown';
  try {
    const chain = await db.sqlScalar<boolean>(
      `SELECT VERIFY_CHAIN('framework_audit_log')`,
    );
    chainStatus = chain ? 'verified' : 'failed';
  } catch {
    chainStatus = 'unknown';
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title="Audit log"
        description="Immutable record of every action — agent, analyst, system, and external auditor."
      />

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <ShieldCheck
            className={
              chainStatus === 'verified'
                ? 'h-6 w-6 text-green-400'
                : chainStatus === 'failed'
                  ? 'h-6 w-6 text-destructive'
                  : 'h-6 w-6 text-amber-400'
            }
          />
          <div>
            <CardTitle className="text-base">Chain verification</CardTitle>
            <CardDescription>
              {chainStatus === 'verified' &&
                'The audit chain is intact. No event has been tampered with.'}
              {chainStatus === 'failed' &&
                'Chain verification FAILED. Treat this audit log as suspect and escalate.'}
              {chainStatus === 'unknown' &&
                "VERIFY_CHAIN couldn't be evaluated against this engine. Run it manually to confirm integrity."}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <DataTable
        rows={result.rows}
        rowKey={(r) => String(r.event_id)}
        emptyState="No audited events yet."
        columns={[
          {
            key: 'event_id',
            header: 'ID',
            cell: (r) => <span className="text-muted-foreground">#{r.event_id}</span>,
            className: 'font-mono text-xs',
          },
          {
            key: 'ts',
            header: 'Timestamp',
            cell: (r) => new Date(r.ts).toLocaleString(),
            className: 'whitespace-nowrap',
          },
          { key: 'actor_type', header: 'Actor' },
          {
            key: 'action',
            header: 'Action',
            cell: (r) => <code className="text-primary">{r.action}</code>,
          },
          {
            key: 'target_id',
            header: 'Target',
            cell: (r) => r.target_id ?? '—',
            className: 'font-mono text-xs',
          },
        ]}
      />
    </div>
  );
}
