import { notFound } from 'next/navigation';
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
import { getAdminClient } from '@synapcores/app-framework/db/server';

interface CallRow {
  event_id: number;
  ts: string;
  action: string;
  payload: unknown;
}

export default async function McpSessionDetailPage({
  params,
}: {
  params: Promise<{ token_id: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { token_id } = await params;

  const db = getAdminClient();
  const tokenRes = await db.sql<{ label: string; expires_at: string; revoked_at: string | null }>(
    `SELECT label, expires_at, revoked_at
       FROM mcp_tokens
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [session.tenant.id, token_id],
  );
  const token = tokenRes.rows[0];
  if (!token) notFound();

  const calls = await db.sql<CallRow>(
    `SELECT event_id, ts, action, payload
       FROM aml_audit_log
      WHERE tenant_id = $1 AND actor_type = 'mcp_token' AND actor_id = $2
      ORDER BY event_id DESC
      LIMIT 500`,
    [session.tenant.id, token_id],
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl space-y-6">
      <AppPageHeader
        title={`Examiner session: ${token.label}`}
        description={`${calls.rowCount} tool call${calls.rowCount === 1 ? '' : 's'} recorded.`}
        actions={
          <Link href="/audit/mcp-sessions" className="text-sm text-muted-foreground hover:text-primary">
            ← All sessions
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token state</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {token.revoked_at
            ? `Revoked at ${new Date(token.revoked_at).toLocaleString()}.`
            : `Expires ${new Date(token.expires_at).toLocaleString()}.`}
        </CardContent>
      </Card>

      <DataTable
        rows={calls.rows}
        rowKey={(r) => String(r.event_id)}
        emptyState="This examiner hasn't made any calls yet."
        columns={[
          {
            key: 'ts',
            header: 'When',
            cell: (r) => (
              <span className="whitespace-nowrap text-muted-foreground text-xs">
                {new Date(r.ts).toLocaleString()}
              </span>
            ),
          },
          {
            key: 'action',
            header: 'Tool',
            cell: (r) => (
              <code className="text-primary">
                {String(r.action).replace(/^mcp\.tool\./, '')}
              </code>
            ),
          },
          {
            key: 'payload',
            header: 'Arguments',
            cell: (r) => {
              try {
                const p =
                  typeof r.payload === 'string'
                    ? (JSON.parse(r.payload) as Record<string, unknown>)
                    : (r.payload as Record<string, unknown>);
                return (
                  <code className="text-xs text-muted-foreground">
                    {JSON.stringify(p?.args ?? {})}
                  </code>
                );
              } catch {
                return '—';
              }
            },
          },
        ]}
      />
    </div>
  );
}
