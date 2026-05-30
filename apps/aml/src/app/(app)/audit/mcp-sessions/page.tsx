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
import { getAdminClient } from '@synapcores/app-framework/db/server';

interface McpTokenSummary {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

interface McpSessionAggregate {
  token_id: string;
  label: string;
  state: 'active' | 'expired' | 'revoked';
  expires_at: string;
  call_count: number;
  last_call: string | null;
}

export default async function McpSessionsPage() {
  const session = await requireSession();
  if (!session.tenant) return null;

  const db = getAdminClient();
  const tokens = await db.sql<McpTokenSummary>(
    `SELECT id, label, created_at, expires_at, revoked_at, last_used_at
       FROM mcp_tokens
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [session.tenant.id],
  );

  const aggregates: McpSessionAggregate[] = await Promise.all(
    tokens.rows.map(async (t) => {
      const count = await db.sqlScalar<number>(
        `SELECT COUNT(*) FROM aml_audit_log
          WHERE tenant_id = $1 AND actor_type = 'mcp_token' AND actor_id = $2`,
        [session.tenant!.id, t.id],
      );
      const lastResult = await db.sql<{ ts: string }>(
        `SELECT ts FROM aml_audit_log
          WHERE tenant_id = $1 AND actor_type = 'mcp_token' AND actor_id = $2
          ORDER BY event_id DESC LIMIT 1`,
        [session.tenant!.id, t.id],
      );
      const last = lastResult.rows[0]?.ts ?? null;
      const state: McpSessionAggregate['state'] =
        t.revoked_at !== null
          ? 'revoked'
          : new Date(t.expires_at) < new Date()
            ? 'expired'
            : 'active';
      return {
        token_id: t.id,
        label: t.label,
        state,
        expires_at: t.expires_at,
        call_count: Number(count ?? 0),
        last_call: last,
      };
    }),
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="MCP examiner sessions"
        description="Every external examiner that's been minted a token, plus their per-token query count + last activity. Click a token to see every individual tool call."
      />

      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
          <CardDescription>
            Hand the examiner this URL + their token (from{' '}
            <Link href="/settings/mcp-tokens" className="text-primary hover:underline">
              /settings/mcp-tokens
            </Link>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md bg-black/40 px-3 py-2 text-sm">
            {process.env.NEXTAUTH_URL ?? 'http://localhost:3003'}/api/v1/mcp
          </code>
          <p className="text-xs text-muted-foreground mt-2">
            JSON-RPC 2.0 over POST. Auth: <code>Authorization: Bearer mcp_...</code>.
            6 read-only tools: query_audit_log, query_transactions,
            query_cases, query_sars, query_screening_hits, verify_chain.
          </p>
        </CardContent>
      </Card>

      <DataTable
        rows={aggregates}
        rowKey={(r) => r.token_id}
        emptyState={
          <span>
            No tokens minted yet. Mint one at{' '}
            <Link href="/settings/mcp-tokens" className="text-primary underline">
              /settings/mcp-tokens
            </Link>
            .
          </span>
        }
        columns={[
          {
            key: 'label',
            header: 'Examiner',
            cell: (r) => (
              <Link
                href={`/audit/mcp-sessions/${r.token_id}`}
                className="text-foreground hover:text-primary"
              >
                {r.label}
              </Link>
            ),
          },
          {
            key: 'state',
            header: 'State',
            cell: (r) =>
              r.state === 'active' ? (
                <span className="text-green-400">Active</span>
              ) : r.state === 'expired' ? (
                <span className="text-amber-400">Expired</span>
              ) : (
                <span className="text-muted-foreground">Revoked</span>
              ),
          },
          {
            key: 'expires_at',
            header: 'Expires',
            cell: (r) => new Date(r.expires_at).toLocaleDateString(),
          },
          { key: 'call_count', header: 'Calls' },
          {
            key: 'last_call',
            header: 'Last query',
            cell: (r) => (r.last_call ? new Date(r.last_call).toLocaleString() : '—'),
          },
        ]}
      />
    </div>
  );
}
