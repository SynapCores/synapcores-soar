/**
 * AML action registry.
 *
 * AML-specific actions: file_sar (HBR), freeze_account (HBR),
 * request_eddr (non-HBR EDD request), escalate_to_l2 (non-HBR),
 * screen_customer (non-HBR), notify_channel (non-HBR).
 *
 * Personas reference these action ids in their tool lists; the
 * dispatcher resolves them here.
 */

import 'server-only';
import { z } from 'zod';

import type { ActionAdapter, ActionDef } from './types';
import { slackNotifyAdapter } from './adapters/slack';
import { genericWebhookAdapter } from './adapters/generic-webhook';
import { complyAdvantageScreenAdapter } from './adapters/complyadvantage';
import { fincenBsaFileSarAdapter } from './adapters/fincen-bsa';
import { coreBankingFreezeAccountAdapter } from './adapters/core-banking';

// ─── Definitions ────────────────────────────────────────────────────────

const notifyChannelAction: ActionDef<{ message: string; channel?: string }> = {
  id: 'notify_channel',
  description: 'Post a message to a configured notification channel (Slack / webhook).',
  schema: z.object({
    message: z.string().min(1).max(4000),
    channel: z.string().optional(),
  }),
  hbr: false,
  adapters: [
    slackNotifyAdapter as ActionAdapter<{ message: string; channel?: string }>,
    genericWebhookAdapter as unknown as ActionAdapter<{ message: string; channel?: string }>,
  ],
};

const screenCustomerAction: ActionDef<{ search_term: string; filters?: Record<string, unknown> }> = {
  id: 'screen_customer',
  description:
    'Run sanctions / PEP / adverse-media screening against the configured provider.',
  schema: z.object({
    search_term: z.string().min(1).max(200),
    filters: z.record(z.unknown()).optional(),
  }),
  hbr: false,
  adapters: [complyAdvantageScreenAdapter],
};

const fileSarAction: ActionDef<{
  sar_id: string;
  narrative: string;
  jurisdiction: string;
}> = {
  id: 'file_sar',
  description: 'Submit an approved SAR to the regulator. ALWAYS HBR.',
  schema: z.object({
    sar_id: z.string().min(1),
    narrative: z.string().min(50),
    jurisdiction: z.enum(['us-fincen', 'uk-nca', 'au-austrac', 'ca-fintrac', 'eu-goaml']),
  }),
  hbr: true,
  adapters: [fincenBsaFileSarAdapter],
};

const freezeAccountAction: ActionDef<{
  account_number: string;
  reason_code: string;
  note?: string;
}> = {
  id: 'freeze_account',
  description: 'Place a hold on a customer account at the core banking system.',
  schema: z.object({
    account_number: z.string().min(1),
    reason_code: z.string().min(1).max(40),
    note: z.string().max(400).optional(),
  }),
  hbr: true,
  adapters: [coreBankingFreezeAccountAdapter],
};

const requestEddrAction: ActionDef<{ customer_id: string; reason: string }> = {
  id: 'request_eddr',
  description: 'Open an Enhanced Due Diligence Review request against a customer.',
  schema: z.object({
    customer_id: z.string().min(1),
    reason: z.string().min(1).max(400),
  }),
  hbr: false,
  // EDD requests get fulfilled via the webhook adapter to the customer's
  // case-management system; production wires a dedicated adapter.
  adapters: [
    genericWebhookAdapter as unknown as ActionAdapter<{ customer_id: string; reason: string }>,
  ],
};

const escalateAction: ActionDef<{ case_id: string; note: string }> = {
  id: 'escalate_to_l2',
  description: 'Hand the case to a senior analyst.',
  schema: z.object({
    case_id: z.string().min(1),
    note: z.string().min(1).max(400),
  }),
  hbr: false,
  adapters: [
    slackNotifyAdapter as unknown as ActionAdapter<{ case_id: string; note: string }>,
    genericWebhookAdapter as unknown as ActionAdapter<{ case_id: string; note: string }>,
  ],
};

// ─── Registry ────────────────────────────────────────────────────────────

export const ACTIONS: Record<string, ActionDef<unknown>> = {
  notify_channel: notifyChannelAction as ActionDef<unknown>,
  screen_customer: screenCustomerAction as ActionDef<unknown>,
  file_sar: fileSarAction as ActionDef<unknown>,
  freeze_account: freezeAccountAction as ActionDef<unknown>,
  request_eddr: requestEddrAction as ActionDef<unknown>,
  escalate_to_l2: escalateAction as ActionDef<unknown>,
};

export function listActionIds(): string[] {
  return Object.keys(ACTIONS);
}

export function getActionDef(id: string): ActionDef<unknown> | null {
  return ACTIONS[id] ?? null;
}
