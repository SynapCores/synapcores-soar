/**
 * CrowdStrike Falcon adapter — endpoint network containment.
 *
 * Integration shape:
 *   {
 *     "cloud":         "us-1" | "us-2" | "eu-1" | "us-gov-1",
 *     "client_id":     "...",
 *     "client_secret": "..."
 *   }
 *
 * Auth: OAuth2 client-credentials grant against /oauth2/token.
 * Endpoint: POST /devices/entities/devices-actions/v2?action_name=contain
 *
 * Always HBR — network-isolating a production host has high blast
 * radius. The dispatcher gates on approval.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

interface CSCfg {
  cloud?: string;
  client_id?: string;
  client_secret?: string;
}

const CLOUD_BASE: Record<string, string> = {
  'us-1': 'https://api.crowdstrike.com',
  'us-2': 'https://api.us-2.crowdstrike.com',
  'eu-1': 'https://api.eu-1.crowdstrike.com',
  'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
};

async function getCSToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<{ token?: string; error?: string }> {
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    return { error: `CrowdStrike OAuth returned HTTP ${res.status}` };
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    return { error: 'CrowdStrike OAuth returned no access_token' };
  }
  return { token: body.access_token };
}

export interface IsolateCrowdStrikeEndpointInput {
  /** CrowdStrike device id (aid). */
  device_id: string;
}

export const crowdStrikeIsolateAdapter: ActionAdapter<IsolateCrowdStrikeEndpointInput> = {
  provider: 'crowdstrike',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'crowdstrike')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'crowdstrike');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'CrowdStrike integration not configured.',
      };
    }
    const cfg = integration.secret_payload as CSCfg;
    const base = CLOUD_BASE[String(cfg.cloud ?? 'us-1')];
    if (!base || !cfg.client_id || !cfg.client_secret) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'CrowdStrike integration missing cloud/client_id/client_secret.',
      };
    }

    try {
      const tok = await getCSToken(base, cfg.client_id, cfg.client_secret);
      if (!tok.token) {
        return { ok: false, responsePayload: null, errorMessage: tok.error };
      }
      const res = await fetch(
        `${base}/devices/entities/devices-actions/v2?action_name=contain`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${tok.token}`,
          },
          body: JSON.stringify({
            ids: [input.device_id],
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
          : `CrowdStrike contain returned HTTP ${res.status}`,
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
