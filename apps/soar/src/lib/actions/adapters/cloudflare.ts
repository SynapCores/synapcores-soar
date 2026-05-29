/**
 * Cloudflare adapter — block an IP via a custom WAF rule.
 *
 * Integration shape:
 *   {
 *     "api_token": "...",
 *     "zone_id":   "..."
 *   }
 *
 * Uses the firewall-rules + filters API.
 * HBR — blocking an upstream IP can cut off legitimate traffic.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

interface CFCfg {
  api_token?: string;
  zone_id?: string;
}

export interface BlockIpInput {
  ip: string;
  /** Human-readable note for the WAF rule. */
  note?: string;
}

export const cloudflareBlockIpAdapter: ActionAdapter<BlockIpInput> = {
  provider: 'cloudflare',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'cloudflare')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'cloudflare');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Cloudflare integration not configured.',
      };
    }
    const cfg = integration.secret_payload as CFCfg;
    if (!cfg.api_token || !cfg.zone_id) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Cloudflare integration missing api_token or zone_id.',
      };
    }
    if (!/^[0-9a-fA-F.:]+$/.test(input.ip)) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: `Refusing to block malformed IP "${input.ip}".`,
      };
    }

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.api_token}`,
    };

    try {
      // 1) create a filter expression
      const filterRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zone_id)}/filters`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify([
            {
              expression: `(ip.src eq ${input.ip})`,
              description: `SOAR block: ${input.note ?? 'no note'}`,
              paused: false,
            },
          ]),
        },
      );
      const filterBody = (await filterRes.json()) as {
        result?: Array<{ id: string }>;
        success?: boolean;
        errors?: unknown;
      };
      if (!filterRes.ok || !filterBody.success || !filterBody.result?.[0]?.id) {
        return {
          ok: false,
          responsePayload: filterBody,
          errorMessage: 'Cloudflare filter create failed.',
        };
      }
      const filterId = filterBody.result[0].id;

      // 2) attach a firewall rule with action=block
      const ruleRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zone_id)}/firewall/rules`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify([
            {
              action: 'block',
              filter: { id: filterId },
              description: `SOAR ${ctx.invokedByType}=${ctx.invokedBy} blocked ${input.ip}`,
            },
          ]),
        },
      );
      const ruleBody = (await ruleRes.json()) as Record<string, unknown>;
      await stampIntegrationUsed(integration.id);
      return {
        ok: ruleRes.ok,
        responsePayload: { filter: filterBody, rule: ruleBody },
        errorMessage: ruleRes.ok
          ? undefined
          : `Cloudflare rule create returned HTTP ${ruleRes.status}`,
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
