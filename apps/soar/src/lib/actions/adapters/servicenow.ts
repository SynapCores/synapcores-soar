/**
 * ServiceNow adapter — opens a security incident in your SecOps instance.
 *
 * Integration shape:
 *   {
 *     "instance_url": "https://acme.service-now.com",
 *     "user": "soar-bot",
 *     "password": "...",
 *     "table": "sn_si_incident"
 *   }
 *
 * Auth: HTTP Basic over HTTPS (per ServiceNow REST docs). For OAuth
 * production deploys, swap to a token grant — the adapter contract
 * doesn't change.
 *
 * Not HBR — opening a ticket is always safe.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface CreateServiceNowTicketInput {
  short_description: string;
  description?: string;
  /** ServiceNow priority code 1 (Critical) — 5 (Planning). */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** Optional override of the table the row goes into. */
  table?: string;
}

export const serviceNowTicketAdapter: ActionAdapter<CreateServiceNowTicketInput> = {
  provider: 'servicenow',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'servicenow')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'servicenow');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'ServiceNow integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      instance_url?: string;
      user?: string;
      password?: string;
      table?: string;
    };
    const instanceUrl = String(cfg.instance_url ?? '').replace(/\/+$/, '');
    if (!instanceUrl.startsWith('https://')) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'ServiceNow integration is missing instance_url.',
      };
    }
    const user = String(cfg.user ?? '');
    const password = String(cfg.password ?? '');
    if (!user || !password) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'ServiceNow integration is missing credentials.',
      };
    }

    const table = input.table ?? cfg.table ?? 'incident';
    const url = `${instanceUrl}/api/now/table/${encodeURIComponent(table)}`;
    const basicAuth = Buffer.from(`${user}:${password}`).toString('base64');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          short_description: input.short_description,
          description:
            input.description ??
            `Opened by SynapCores SOAR · invoked by ${ctx.invokedByType}=${ctx.invokedBy}` +
              (ctx.incidentId ? ` · incident=${ctx.incidentId}` : '') +
              (ctx.alertId ? ` · alert=${ctx.alertId}` : ''),
          urgency: priorityToServiceNowUrgency(input.priority),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok,
        responsePayload: body,
        errorMessage: res.ok
          ? undefined
          : `ServiceNow returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

function priorityToServiceNowUrgency(p?: 1 | 2 | 3 | 4 | 5): number {
  // SN urgency is 1 (High) — 3 (Low). Map our 1–5 down.
  if (!p) return 3;
  if (p <= 2) return 1;
  if (p === 3) return 2;
  return 3;
}
