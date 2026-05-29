/**
 * Slack adapter — sends a message to a configured incoming-webhook URL.
 *
 * Integration shape (saved at /settings/integrations as provider='slack'):
 *   { "webhook_url": "https://hooks.slack.com/services/T.../B.../..." }
 *
 * Not HBR — notify is always safe.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface NotifySlackInput {
  message: string;
  /** Optional override of the default channel (Slack incoming webhooks
   *  ignore this unless the workspace allows channel overrides). */
  channel?: string;
}

export const slackNotifyAdapter: ActionAdapter<NotifySlackInput> = {
  provider: 'slack',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'slack')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'slack');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Slack integration not configured for this tenant.',
      };
    }
    const webhookUrl = String(
      (integration.secret_payload as { webhook_url?: string }).webhook_url ?? '',
    );
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Slack integration is missing a valid webhook_url.',
      };
    }

    try {
      const body: Record<string, unknown> = { text: input.message };
      if (input.channel) body.channel = input.channel;
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok && text === 'ok',
        responsePayload: { status: res.status, body: text },
        errorMessage: res.ok ? undefined : `Slack returned HTTP ${res.status}`,
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
