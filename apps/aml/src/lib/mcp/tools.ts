/**
 * AML MCP tools — read-only surfaces an external examiner
 * (FFIEC / OCC / FinCEN / NYDFS / FCA) can hit via Claude / Cursor /
 * any MCP-compatible client.
 *
 * Every call audit-logs to aml_audit_log with actor_type='mcp_token'.
 *
 * SCOPE: SELECT-only. No mutation. No cross-tenant access.
 */

import 'server-only';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { writeAmlAudit } from '../aml-transactions';

export interface McpToolContext {
  tenantId: string;
  tokenId: string;
  auditorLabel: string;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  exec(args: Record<string, unknown>, ctx: McpToolContext): Promise<unknown>;
}

const queryAuditLog: McpToolDef = {
  name: 'query_audit_log',
  description:
    'Query the AML audit log for this tenant. Filter by action prefix and/or actor type.',
  inputSchema: {
    type: 'object',
    properties: {
      action_prefix: { type: 'string' },
      actor_type: {
        type: 'string',
        enum: ['analyst', 'agent', 'system', 'mcp_token'],
      },
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const db = getAdminClient();
    const actorType = typeof args.actor_type === 'string' ? args.actor_type : null;
    const actionPrefix =
      typeof args.action_prefix === 'string' ? args.action_prefix : null;

    let rows;
    if (actionPrefix && actorType) {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, transaction_id, case_id, sar_id
           FROM aml_audit_log
          WHERE tenant_id = $1 AND action LIKE $2 AND actor_type = $3
          ORDER BY event_id DESC LIMIT $4`,
        [ctx.tenantId, `${actionPrefix}%`, actorType, limit],
      );
    } else if (actionPrefix) {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, transaction_id, case_id, sar_id
           FROM aml_audit_log
          WHERE tenant_id = $1 AND action LIKE $2
          ORDER BY event_id DESC LIMIT $3`,
        [ctx.tenantId, `${actionPrefix}%`, limit],
      );
    } else if (actorType) {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, transaction_id, case_id, sar_id
           FROM aml_audit_log
          WHERE tenant_id = $1 AND actor_type = $2
          ORDER BY event_id DESC LIMIT $3`,
        [ctx.tenantId, actorType, limit],
      );
    } else {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, transaction_id, case_id, sar_id
           FROM aml_audit_log
          WHERE tenant_id = $1
          ORDER BY event_id DESC LIMIT $2`,
        [ctx.tenantId, limit],
      );
    }
    return { events: rows.rows };
  },
};

const queryTransactions: McpToolDef = {
  name: 'query_transactions',
  description: 'List transactions. Filter by status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['new', 'triaged', 'sar_candidate', 'cleared', 'duplicate'],
      },
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const status = typeof args.status === 'string' ? args.status : null;
    const rows = status
      ? await db.sql(
          `SELECT id, source, source_tx_id, from_customer, to_counterparty,
                  to_country, amount_usd, currency, type, status, status_reason,
                  flags, ts
             FROM aml_transactions
            WHERE tenant_id = $1 AND status = $2
            ORDER BY ts DESC LIMIT $3`,
          [ctx.tenantId, status, limit],
        )
      : await db.sql(
          `SELECT id, source, source_tx_id, from_customer, to_counterparty,
                  to_country, amount_usd, currency, type, status, status_reason,
                  flags, ts
             FROM aml_transactions
            WHERE tenant_id = $1
            ORDER BY ts DESC LIMIT $2`,
          [ctx.tenantId, limit],
        );
    return { transactions: rows.rows };
  },
};

const queryCases: McpToolDef = {
  name: 'query_cases',
  description: 'List cases (SAR-candidate roll-ups + open investigations).',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', default: 50, maximum: 500 } },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const rows = await db.sql(
      `SELECT id, title, severity, status, primary_customer, primary_tx,
              opened_at, closed_at, summary
         FROM aml_cases
        WHERE tenant_id = $1
        ORDER BY opened_at DESC LIMIT $2`,
      [ctx.tenantId, limit],
    );
    return { cases: rows.rows };
  },
};

const querySars: McpToolDef = {
  name: 'query_sars',
  description: 'List SARs (drafts + filed). Filter by status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'review', 'approved', 'filed', 'rejected'] },
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const status = typeof args.status === 'string' ? args.status : null;
    const rows = status
      ? await db.sql(
          `SELECT id, case_id, jurisdiction, status, drafted_by, approved_by,
                  filed_by, filed_at, regulator_ack_id, created_at, updated_at
             FROM aml_sars
            WHERE tenant_id = $1 AND status = $2
            ORDER BY created_at DESC LIMIT $3`,
          [ctx.tenantId, status, limit],
        )
      : await db.sql(
          `SELECT id, case_id, jurisdiction, status, drafted_by, approved_by,
                  filed_by, filed_at, regulator_ack_id, created_at, updated_at
             FROM aml_sars
            WHERE tenant_id = $1
            ORDER BY created_at DESC LIMIT $2`,
          [ctx.tenantId, limit],
        );
    return { sars: rows.rows };
  },
};

const queryScreeningHits: McpToolDef = {
  name: 'query_screening_hits',
  description:
    'List sanctions / PEP / adverse-media hits with resolution status.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'true_positive', 'false_positive'] },
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const status = typeof args.status === 'string' ? args.status : null;
    const rows = status
      ? await db.sql(
          `SELECT id, customer_id, transaction_id, list_name, matched_name,
                  match_score, status, resolved_by, resolved_at, created_at
             FROM aml_sanctions_hits
            WHERE tenant_id = $1 AND status = $2
            ORDER BY created_at DESC LIMIT $3`,
          [ctx.tenantId, status, limit],
        )
      : await db.sql(
          `SELECT id, customer_id, transaction_id, list_name, matched_name,
                  match_score, status, resolved_by, resolved_at, created_at
             FROM aml_sanctions_hits
            WHERE tenant_id = $1
            ORDER BY created_at DESC LIMIT $2`,
          [ctx.tenantId, limit],
        );
    return { hits: rows.rows };
  },
};

const verifyChain: McpToolDef = {
  name: 'verify_chain',
  description:
    "Cryptographically verify the AML audit chain. Returns chain_ok: true when the immutable log hasn't been tampered with.",
  inputSchema: { type: 'object', properties: {} },
  async exec(_args, _ctx) {
    const db = getAdminClient();
    try {
      const ok = await db.sqlScalar<boolean>(
        `SELECT VERIFY_CHAIN('aml_audit_log')`,
      );
      return { chain_ok: !!ok };
    } catch (err) {
      return {
        chain_ok: null,
        note:
          "VERIFY_CHAIN isn't available on this engine version. Run it manually to confirm integrity.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const AML_MCP_TOOLS: McpToolDef[] = [
  queryAuditLog,
  queryTransactions,
  queryCases,
  querySars,
  queryScreeningHits,
  verifyChain,
];

export function findTool(name: string): McpToolDef | null {
  return AML_MCP_TOOLS.find((t) => t.name === name) ?? null;
}

export async function auditMcpCall(opts: {
  tenantId: string;
  tokenId: string;
  auditorLabel: string;
  toolName: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
}): Promise<void> {
  await writeAmlAudit({
    tenantId: opts.tenantId,
    actorId: opts.tokenId,
    actorType: 'mcp_token',
    action: `mcp.tool.${opts.toolName}`,
    payload: {
      auditor_label: opts.auditorLabel,
      args: opts.args,
      ok: opts.ok,
      duration_ms: opts.durationMs,
    },
  });
}
