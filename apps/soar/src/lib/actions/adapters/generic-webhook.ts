/**
 * Generic webhook adapter — fires arbitrary JSON to a configured URL.
 *
 * Integration shape:
 *   {
 *     "url":              "https://webhook.example.com/soar",
 *     "secret_header":    "X-SOAR-Auth",          // optional
 *     "secret_value":     "..."                   // optional
 *   }
 *
 * Use case: customers wire SOAR to their own automations (n8n, Zapier,
 * a custom rest endpoint, internal ChatOps). HBR off by default —
 * operator can mark a specific webhook HBR by setting `hbr: true` in
 * the payload.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface NotifyGenericInput {
  message: string;
  /** Arbitrary structured payload. Merged with default envelope. */
  data?: Record<string, unknown>;
}

export const genericWebhookAdapter: ActionAdapter<NotifyGenericInput> = {
  provider: 'webhook',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'webhook')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'webhook');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Generic webhook integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      url?: string;
      secret_header?: string;
      secret_value?: string;
    };
    if (!cfg.url) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Generic webhook integration missing url.',
      };
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.secret_header && cfg.secret_value) {
      headers[cfg.secret_header] = cfg.secret_value;
    }
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: input.message,
          source: 'synapcores-soar',
          tenant_id: ctx.tenantId,
          invoked_by: ctx.invokedBy,
          invoked_by_type: ctx.invokedByType,
          incident_id: ctx.incidentId,
          alert_id: ctx.alertId,
          data: input.data ?? null,
        }),
      });
      const body = await res.text();
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok,
        responsePayload: { status: res.status, body: body.slice(0, 1024) },
        errorMessage: res.ok ? undefined : `Webhook returned HTTP ${res.status}`,
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
