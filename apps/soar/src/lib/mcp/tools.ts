/**
 * SOAR MCP tools — read-only surfaces an external auditor / examiner
 * can hit via Claude / Cursor / any MCP-compatible client.
 *
 * Every call is dispatched here from the MCP HTTP endpoint AFTER
 * resolving the bearer token to a tenant. Every tool execution writes
 * a soar_audit_log row with actor_type='mcp_token'.
 *
 * SCOPE: all tools are SELECT-only. There is NO mutation surface
 * exposed — auditors cannot change state, cannot dispatch actions,
 * cannot peek at other tenants. (Tenant id is bound at token mint;
 * tools cannot widen it.)
 */

import 'server-only';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { writeSoarAudit } from '../soar-alerts';

export interface McpToolContext {
  tenantId: string;
  tokenId: string;
  /** Auditor label from the mcp_tokens row — what we show in audit. */
  auditorLabel: string;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  exec(args: Record<string, unknown>, ctx: McpToolContext): Promise<unknown>;
}

const queryAuditLog: McpToolDef = {
  name: 'query_audit_log',
  description:
    "Query the SOAR audit log. Returns the most recent events for this tenant. Filter by action prefix (e.g. 'action.', 'alert.') or actor_type ('analyst' | 'agent' | 'system' | 'mcp_token').",
  inputSchema: {
    type: 'object',
    properties: {
      action_prefix: { type: 'string', description: 'Match any action starting with this prefix.' },
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
        `SELECT event_id, ts, actor_id, actor_type, action, alert_id, incident_id
           FROM soar_audit_log
          WHERE tenant_id = $1 AND action LIKE $2 AND actor_type = $3
          ORDER BY event_id DESC LIMIT $4`,
        [ctx.tenantId, `${actionPrefix}%`, actorType, limit],
      );
    } else if (actionPrefix) {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, alert_id, incident_id
           FROM soar_audit_log
          WHERE tenant_id = $1 AND action LIKE $2
          ORDER BY event_id DESC LIMIT $3`,
        [ctx.tenantId, `${actionPrefix}%`, limit],
      );
    } else if (actorType) {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, alert_id, incident_id
           FROM soar_audit_log
          WHERE tenant_id = $1 AND actor_type = $2
          ORDER BY event_id DESC LIMIT $3`,
        [ctx.tenantId, actorType, limit],
      );
    } else {
      rows = await db.sql(
        `SELECT event_id, ts, actor_id, actor_type, action, alert_id, incident_id
           FROM soar_audit_log
          WHERE tenant_id = $1
          ORDER BY event_id DESC LIMIT $2`,
        [ctx.tenantId, limit],
      );
    }
    return { events: rows.rows };
  },
};

const queryAlerts: McpToolDef = {
  name: 'query_alerts',
  description:
    "List alerts. Filter by status ('new' | 'triaged' | 'duplicate' | 'incident' | 'closed') and/or severity.",
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['new', 'triaged', 'duplicate', 'incident', 'closed'] },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const status = typeof args.status === 'string' ? args.status : null;
    const severity = typeof args.severity === 'string' ? args.severity : null;

    let rows;
    if (status && severity) {
      rows = await db.sql(
        `SELECT id, source, severity, title, status, status_reason, created_at, triaged_at
           FROM soar_alerts
          WHERE tenant_id = $1 AND status = $2 AND severity = $3
          ORDER BY created_at DESC LIMIT $4`,
        [ctx.tenantId, status, severity, limit],
      );
    } else if (status) {
      rows = await db.sql(
        `SELECT id, source, severity, title, status, status_reason, created_at, triaged_at
           FROM soar_alerts
          WHERE tenant_id = $1 AND status = $2
          ORDER BY created_at DESC LIMIT $3`,
        [ctx.tenantId, status, limit],
      );
    } else if (severity) {
      rows = await db.sql(
        `SELECT id, source, severity, title, status, status_reason, created_at, triaged_at
           FROM soar_alerts
          WHERE tenant_id = $1 AND severity = $2
          ORDER BY created_at DESC LIMIT $3`,
        [ctx.tenantId, severity, limit],
      );
    } else {
      rows = await db.sql(
        `SELECT id, source, severity, title, status, status_reason, created_at, triaged_at
           FROM soar_alerts
          WHERE tenant_id = $1
          ORDER BY created_at DESC LIMIT $2`,
        [ctx.tenantId, limit],
      );
    }
    return { alerts: rows.rows };
  },
};

const queryIncidents: McpToolDef = {
  name: 'query_incidents',
  description:
    'List incidents (alerts the triage agent escalated to true-positive). Returns title, severity, triage rationale, opened-at.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const rows = await db.sql(
      `SELECT id, source, severity, title, status_reason, created_at, triaged_at
         FROM soar_alerts
        WHERE tenant_id = $1 AND status = 'incident'
        ORDER BY created_at DESC LIMIT $2`,
      [ctx.tenantId, limit],
    );
    return { incidents: rows.rows };
  },
};

const listActions: McpToolDef = {
  name: 'list_actions',
  description:
    'List actions the SOAR system has dispatched: by analyst, by agent, and after approval.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', default: 50, maximum: 500 },
    },
  },
  async exec(args, ctx) {
    const db = getAdminClient();
    const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500);
    const rows = await db.sql(
      `SELECT id, action, target, state, requested_by, requested_at,
              completed_at, error_message
         FROM soar_actions
        WHERE tenant_id = $1
        ORDER BY requested_at DESC LIMIT $2`,
      [ctx.tenantId, limit],
    );
    return { actions: rows.rows };
  },
};

const verifyChain: McpToolDef = {
  name: 'verify_chain',
  description:
    "Cryptographically verify the SOAR audit chain. Returns chain_ok: true if the immutable log hasn't been tampered with. This is the call examiners make to assert the audit trail is defensible.",
  inputSchema: { type: 'object', properties: {} },
  async exec(_args, _ctx) {
    const db = getAdminClient();
    try {
      const ok = await db.sqlScalar<boolean>(
        `SELECT VERIFY_CHAIN('soar_audit_log')`,
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

export const SOAR_MCP_TOOLS: McpToolDef[] = [
  queryAuditLog,
  queryAlerts,
  queryIncidents,
  listActions,
  verifyChain,
];

export function findTool(name: string): McpToolDef | null {
  return SOAR_MCP_TOOLS.find((t) => t.name === name) ?? null;
}

/** Audit every MCP tool call. */
export async function auditMcpCall(opts: {
  tenantId: string;
  tokenId: string;
  auditorLabel: string;
  toolName: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
}): Promise<void> {
  await writeSoarAudit({
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
