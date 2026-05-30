/**
 * Core-banking freeze adapter — submit a freeze/hold instruction.
 *
 * Integration shape (provider='core-banking'):
 *   {
 *     "endpoint":   "https://corebanking.acme.com",
 *     "api_token":  "...",
 *     "auth_header": "Authorization"   // or "X-API-Key" depending on vendor
 *   }
 *
 * Production deployments wire this to FIS, Fiserv, Jack Henry, Mambu,
 * Thought Machine, or a custom core. The contract here matches the
 * common REST shape: POST /accounts/{id}/holds.
 *
 * HBR. Freezing a customer account has real customer impact.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface FreezeAccountInput {
  account_number: string;
  /** Reason code passed to the core (e.g. 'AML_HOLD', 'SAR_CANDIDATE'). */
  reason_code: string;
  /** Human-readable analyst note. */
  note?: string;
}

export const coreBankingFreezeAccountAdapter: ActionAdapter<FreezeAccountInput> = {
  provider: 'core-banking',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'core-banking')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'core-banking');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'core-banking integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      endpoint?: string;
      api_token?: string;
      auth_header?: string;
    };
    if (!cfg.endpoint || !cfg.api_token) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'core-banking integration is missing endpoint or api_token.',
      };
    }

    const authHeader = cfg.auth_header ?? 'Authorization';
    const authValue =
      authHeader.toLowerCase() === 'authorization'
        ? `Bearer ${cfg.api_token}`
        : cfg.api_token;

    try {
      const res = await fetch(
        `${cfg.endpoint.replace(/\/+$/, '')}/accounts/${encodeURIComponent(input.account_number)}/holds`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            [authHeader]: authValue,
          },
          body: JSON.stringify({
            reason_code: input.reason_code,
            note:
              input.note ??
              `Frozen by SynapCores AML · ${ctx.invokedByType}=${ctx.invokedBy}` +
                (ctx.sarId ? ` · sar=${ctx.sarId}` : '') +
                (ctx.caseId ? ` · case=${ctx.caseId}` : ''),
            requested_by: ctx.invokedBy,
            requested_by_type: ctx.invokedByType,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok,
        responsePayload: body,
        errorMessage: res.ok
          ? undefined
          : `core-banking freeze returned HTTP ${res.status}`,
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
