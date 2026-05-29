/**
 * Okta System Log → Event Hook connector.
 *
 * Okta supports two ingestion patterns:
 *   - Event Hooks: outbound webhook on selected eventTypes
 *   - System Log API: poll-pull
 *
 * Phase 8 uses Event Hooks (push). Customer setup:
 *   1. Okta Admin → Workflow → Event Hooks → Create Event Hook
 *   2. URL: <synapcores>/api/v1/connectors/okta
 *      Auth header field: X-Synapcores-Auth, value: <token>
 *   3. Subscribe to eventTypes (user.session.start, user.account.lock,
 *      user.lifecycle.suspend, ...)
 *   4. Verify the endpoint (Okta sends a one-time challenge — we respond
 *      with the `verification` field)
 *
 * Schema map: each event row → one alert.
 */

import 'server-only';
import type { IngestAlertInput, AlertSeverity } from '../soar-alerts';

interface OktaEvent {
  eventType?: string;
  displayMessage?: string;
  severity?: string;
  uuid?: string;
  published?: string;
  actor?: { displayName?: string; alternateId?: string };
  client?: { ipAddress?: string; userAgent?: { rawUserAgent?: string } };
  outcome?: { result?: string; reason?: string };
}

export interface OktaEventHookPayload {
  // Outbound event hooks send this shape
  eventType?: string; // 'com.okta.event_hook'
  data?: { events?: OktaEvent[] };
  // One-time verification request looks like { verification: '...' }
  verification?: string;
}

export function parseOktaAuth(req: Request): string {
  // Okta lets the operator name the auth header. Convention: X-Synapcores-Auth.
  return req.headers.get('x-synapcores-auth') ?? '';
}

export function isOktaVerificationRequest(
  payload: OktaEventHookPayload,
): payload is OktaEventHookPayload & { verification: string } {
  return typeof payload.verification === 'string';
}

/**
 * Build the Okta endpoint-verification response. Okta sends GET with
 * `X-Okta-Verification-Challenge` and expects { verification: <same> }
 * back. (Or POST with `verification` field for one-time check.)
 */
export function buildOktaVerificationResponse(challenge: string): Response {
  return Response.json({ verification: challenge });
}

export function mapOktaPayloadToAlerts(
  raw: OktaEventHookPayload,
  tenantId: string,
): IngestAlertInput[] {
  const events = raw.data?.events ?? [];
  return events.map((evt) => {
    const actor = evt.actor?.alternateId ?? evt.actor?.displayName ?? 'unknown';
    const title = `Okta ${evt.eventType ?? 'event'} · ${actor}`.slice(0, 240);
    const description = [
      evt.displayMessage,
      evt.outcome?.result && `outcome: ${evt.outcome.result}`,
      evt.outcome?.reason && `reason: ${evt.outcome.reason}`,
      evt.client?.ipAddress && `ip: ${evt.client.ipAddress}`,
      evt.client?.userAgent?.rawUserAgent && `ua: ${evt.client.userAgent.rawUserAgent}`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    return {
      tenantId,
      source: 'okta',
      sourceAlertId: evt.uuid,
      severity: normalizeOktaSeverity(evt),
      title,
      description,
      rawPayload: evt,
    };
  });
}

function normalizeOktaSeverity(evt: OktaEvent): AlertSeverity {
  // Okta surfaces severity per event-type. Heuristic baseline:
  const s = String(evt.severity ?? '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'WARN') return 'medium';
  if (s === 'INFO') return 'info';
  // Higher-stakes default for sensitive event types
  const et = String(evt.eventType ?? '').toLowerCase();
  if (
    et.includes('user.account.lock') ||
    et.includes('user.account.privilege.grant') ||
    et.includes('mfa.bypass')
  ) {
    return 'high';
  }
  if (et.includes('user.session.start') && evt.outcome?.result === 'FAILURE') {
    return 'medium';
  }
  return 'low';
}
