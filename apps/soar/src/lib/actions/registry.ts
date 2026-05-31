/**
 * SOAR action registry + dispatcher.
 *
 * The personas reference action ids in their tool lists; the dispatcher
 * looks them up here. Apps/operators register custom actions by adding
 * them to ACTIONS at boot — the registry isn't sealed.
 */

import 'server-only';
import { z } from 'zod';

import type { ActionAdapter, ActionDef } from './types';
import { slackNotifyAdapter } from './adapters/slack';
import { serviceNowTicketAdapter } from './adapters/servicenow';
import { oktaDisableUserAdapter, oktaRevokeSessionsAdapter } from './adapters/okta';
import { crowdStrikeIsolateAdapter } from './adapters/crowdstrike';
import { cloudflareBlockIpAdapter } from './adapters/cloudflare';
import { genericWebhookAdapter } from './adapters/generic-webhook';

// ─── Action definitions ──────────────────────────────────────────────────

const notifyChannelAction: ActionDef<{ message: string; channel?: string }> = {
  id: 'notify_channel',
  description: 'Post a message to a configured notification channel.',
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

const createTicketAction: ActionDef<{
  short_description: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}> = {
  id: 'create_ticket',
  description: 'Open a ticket in your IT-service management system.',
  schema: z.object({
    short_description: z.string().min(1).max(160),
    description: z.string().optional(),
    priority: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]).optional(),
  }),
  hbr: false,
  adapters: [serviceNowTicketAdapter],
};

const disableUserAction: ActionDef<{ user_id: string }> = {
  id: 'disable_user',
  description: 'Suspend an identity to halt active sessions and prevent new ones.',
  schema: z.object({ user_id: z.string().min(1) }),
  hbr: true,
  adapters: [oktaDisableUserAdapter],
};

const revokeSessionsAction: ActionDef<{ user_id: string; oauthTokens?: boolean }> = {
  id: 'revoke_sessions',
  description: 'Invalidate all of an identity\'s active sessions.',
  schema: z.object({
    user_id: z.string().min(1),
    oauthTokens: z.boolean().optional(),
  }),
  hbr: true,
  adapters: [oktaRevokeSessionsAdapter],
};

const isolateEndpointAction: ActionDef<{ device_id: string }> = {
  id: 'isolate_endpoint',
  description: 'Network-contain an endpoint so it can\'t reach attacker C2.',
  schema: z.object({ device_id: z.string().min(1) }),
  hbr: true,
  adapters: [crowdStrikeIsolateAdapter],
};

const blockIpAction: ActionDef<{ ip: string; note?: string }> = {
  id: 'block_ip',
  description: 'Block an IP at the edge.',
  schema: z.object({
    ip: z.string().min(7),
    note: z.string().max(200).optional(),
  }),
  hbr: true,
  adapters: [cloudflareBlockIpAdapter],
};

// ─── v0.2.0 actions (SOAR Demo Completion Req 7) ─────────────────────────

const rollbackDeploymentAction: ActionDef<{ deployment_id: string; reason?: string }> = {
  id: 'rollback_deployment',
  description: 'Revert a deployment to the previously-known-good version.',
  schema: z.object({
    deployment_id: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  hbr: true,
  adapters: [], // wired by per-tenant integrations (GitHub/Argo/Spinnaker)
};

const attachEvidencePackAction: ActionDef<{
  incident_id: string;
  artefact_count?: number;
}> = {
  id: 'attach_evidence_pack',
  description:
    'Assemble alerts + audit-slice + transaction timeline as a tamper-evident pack.',
  schema: z.object({
    incident_id: z.string().min(1),
    artefact_count: z.number().int().positive().optional(),
  }),
  hbr: false,
  adapters: [], // handled in-process by evidence-collector persona
};

const closeIncidentAction: ActionDef<{
  incident_id: string;
  final_root_cause: string;
  final_resolution: string;
  status: 'true_positive' | 'false_positive' | 'inconclusive';
}> = {
  id: 'close_incident',
  description:
    'Close the incident, save final state as future memory (closed-loop learning).',
  schema: z.object({
    incident_id: z.string().min(1),
    final_root_cause: z.string().min(1),
    final_resolution: z.string().min(1),
    status: z.enum(['true_positive', 'false_positive', 'inconclusive']),
  }),
  hbr: false,
  adapters: [], // handled in-process by ../learning/close-incident.ts
};

const markRelatedAlertsAction: ActionDef<{
  incident_id: string;
  alert_ids: string[];
}> = {
  id: 'mark_related_alerts',
  description: 'Link a set of alerts to an existing incident.',
  schema: z.object({
    incident_id: z.string().min(1),
    alert_ids: z.array(z.string()).min(1),
  }),
  hbr: false,
  adapters: [], // handled in-process
};

// ─── Registry ────────────────────────────────────────────────────────────

export const ACTIONS: Record<string, ActionDef<unknown>> = {
  notify_channel: notifyChannelAction as ActionDef<unknown>,
  create_ticket: createTicketAction as ActionDef<unknown>,
  disable_user: disableUserAction as ActionDef<unknown>,
  revoke_sessions: revokeSessionsAction as ActionDef<unknown>,
  isolate_endpoint: isolateEndpointAction as ActionDef<unknown>,
  block_ip: blockIpAction as ActionDef<unknown>,
  // v0.2.0 additions
  rollback_deployment: rollbackDeploymentAction as ActionDef<unknown>,
  attach_evidence_pack: attachEvidencePackAction as ActionDef<unknown>,
  close_incident: closeIncidentAction as ActionDef<unknown>,
  mark_related_alerts: markRelatedAlertsAction as ActionDef<unknown>,
};

export function listActionIds(): string[] {
  return Object.keys(ACTIONS);
}

export function getActionDef(id: string): ActionDef<unknown> | null {
  return ACTIONS[id] ?? null;
}
