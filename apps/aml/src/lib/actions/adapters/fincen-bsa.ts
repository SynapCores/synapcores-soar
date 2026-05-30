/**
 * FinCEN BSA E-Filing adapter — submit an approved SAR.
 *
 * Integration shape (provider='fincen-bsa'):
 *   {
 *     "endpoint":  "https://bsa-efiling-prod...",  // or sandbox
 *     "client_id": "...",
 *     "client_secret": "...",
 *     "filer_id":  "..."   // your institution's BSA filer ID
 *   }
 *
 * HBR by definition — once filed, a SAR cannot be unfiled. The
 * dispatcher routes through the approval queue first.
 *
 * Note: production deployments should plumb the SAR narrative
 * through the FinCEN XSD schema (form 111). Phase 4 ships the
 * adapter surface + an integration shape that's swap-in compatible
 * with the real production endpoint; the XSD marshaling adds in
 * the customer's first deployment.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface FileSarInput {
  sar_id: string;
  /** Final analyst-approved narrative. */
  narrative: string;
  /** us-fincen | uk-nca | au-austrac | ca-fintrac | eu-goaml */
  jurisdiction: string;
}

export const fincenBsaFileSarAdapter: ActionAdapter<FileSarInput> = {
  provider: 'fincen-bsa',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'fincen-bsa')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'fincen-bsa');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'FinCEN BSA E-Filing integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      endpoint?: string;
      client_id?: string;
      client_secret?: string;
      filer_id?: string;
    };
    if (
      !cfg.endpoint ||
      !cfg.client_id ||
      !cfg.client_secret ||
      !cfg.filer_id
    ) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage:
          'FinCEN BSA integration is missing one of: endpoint, client_id, client_secret, filer_id.',
      };
    }
    if (input.jurisdiction !== 'us-fincen') {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: `FinCEN BSA E-Filing only accepts us-fincen jurisdiction (got: ${input.jurisdiction}).`,
      };
    }

    try {
      // Production note: the real endpoint accepts FinCEN form 111
      // XML against the BSA E-Filing schema. This adapter posts a
      // JSON envelope mirroring the customer-side payload; XSD
      // marshaling drops in via a separate transformer.
      const basicAuth = Buffer.from(
        `${cfg.client_id}:${cfg.client_secret}`,
      ).toString('base64');
      const res = await fetch(`${cfg.endpoint.replace(/\/+$/, '')}/sars`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          filer_id: cfg.filer_id,
          sar_id: input.sar_id,
          narrative: input.narrative,
          submitted_by: ctx.invokedBy,
          submitted_by_type: ctx.invokedByType,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok,
        responsePayload: body,
        errorMessage: res.ok
          ? undefined
          : `FinCEN BSA returned HTTP ${res.status}`,
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
