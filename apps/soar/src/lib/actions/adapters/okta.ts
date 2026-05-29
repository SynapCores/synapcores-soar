/**
 * Okta adapters — disable user + revoke sessions. Both are HBR.
 *
 * Integration shape:
 *   {
 *     "org_url":   "https://acme.okta.com",
 *     "api_token": "00..."
 *   }
 *
 * Endpoints used:
 *   POST /api/v1/users/{userId}/lifecycle/suspend  (disable)
 *   DELETE /api/v1/users/{userId}/sessions         (revoke sessions)
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

interface OktaCfg {
  org_url?: string;
  api_token?: string;
}

function resolveOkta(payload: Record<string, unknown> | null): {
  orgUrl: string;
  token: string;
} | null {
  const cfg = (payload ?? {}) as OktaCfg;
  const orgUrl = String(cfg.org_url ?? '').replace(/\/+$/, '');
  const token = String(cfg.api_token ?? '');
  if (!orgUrl.startsWith('https://') || !token) return null;
  return { orgUrl, token };
}

async function oktaCall(
  url: string,
  token: string,
  method: 'POST' | 'DELETE',
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `SSWS ${token}`,
      accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export interface DisableOktaUserInput {
  /** Okta user id or email. The adapter passes it straight through;
   *  the API accepts either. */
  user_id: string;
}

export const oktaDisableUserAdapter: ActionAdapter<DisableOktaUserInput> = {
  provider: 'okta',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'okta')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'okta');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Okta integration not configured.',
      };
    }
    const cfg = resolveOkta(integration.secret_payload);
    if (!cfg) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Okta integration missing org_url or api_token.',
      };
    }
    const url = `${cfg.orgUrl}/api/v1/users/${encodeURIComponent(input.user_id)}/lifecycle/suspend`;
    try {
      const r = await oktaCall(url, cfg.token, 'POST');
      await stampIntegrationUsed(integration.id);
      return {
        ok: r.ok,
        responsePayload: r.body,
        errorMessage: r.ok ? undefined : `Okta suspend returned HTTP ${r.status}`,
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

export interface RevokeOktaSessionsInput {
  user_id: string;
  oauthTokens?: boolean; // also revoke OAuth tokens
}

export const oktaRevokeSessionsAdapter: ActionAdapter<RevokeOktaSessionsInput> = {
  provider: 'okta',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'okta')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'okta');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Okta integration not configured.',
      };
    }
    const cfg = resolveOkta(integration.secret_payload);
    if (!cfg) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Okta integration missing org_url or api_token.',
      };
    }
    const qs = input.oauthTokens ? '?oauthTokens=true' : '';
    const url = `${cfg.orgUrl}/api/v1/users/${encodeURIComponent(input.user_id)}/sessions${qs}`;
    try {
      const r = await oktaCall(url, cfg.token, 'DELETE');
      await stampIntegrationUsed(integration.id);
      return {
        ok: r.ok,
        responsePayload: r.body,
        errorMessage: r.ok
          ? undefined
          : `Okta session revoke returned HTTP ${r.status}`,
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
