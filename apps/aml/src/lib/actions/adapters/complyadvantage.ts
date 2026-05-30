/**
 * ComplyAdvantage screen adapter — sanctions / PEP / adverse-media
 * screening via the ComplyAdvantage Search v3 API.
 *
 * Integration shape (provider='complyadvantage'):
 *   {
 *     "api_key":  "...",
 *     "fuzziness": 0.6
 *   }
 *
 * POST https://api.complyadvantage.com/searches?api_key=...
 *   body: { search_term, fuzziness, filters: {...} }
 *
 * Not HBR — screening is read-only. The investigator (a human or the
 * sanctions-investigator agent) decides true/false-positive afterwards.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface ScreenCustomerInput {
  /** Subject's display name as it appears on the wire. */
  search_term: string;
  /** Restrict screening to selected lists. */
  filters?: Record<string, unknown>;
}

export const complyAdvantageScreenAdapter: ActionAdapter<ScreenCustomerInput> = {
  provider: 'complyadvantage',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'complyadvantage')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'complyadvantage');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'ComplyAdvantage integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      api_key?: string;
      fuzziness?: number;
    };
    if (!cfg.api_key) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'ComplyAdvantage integration is missing api_key.',
      };
    }
    try {
      const res = await fetch(
        `https://api.complyadvantage.com/searches?api_key=${encodeURIComponent(cfg.api_key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            search_term: input.search_term,
            fuzziness: cfg.fuzziness ?? 0.6,
            filters: input.filters ?? {},
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
          : `ComplyAdvantage returned HTTP ${res.status}`,
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
