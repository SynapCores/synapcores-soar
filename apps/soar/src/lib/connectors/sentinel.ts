/**
 * Microsoft Sentinel connector — receives incidents via Logic App.
 *
 * Customer setup in Azure:
 *   1. Sentinel → Automation → Create Logic App rule
 *   2. Trigger: "When Microsoft Sentinel incident is created/updated"
 *   3. Action: HTTP → POST → <synapcores>/api/v1/connectors/sentinel
 *      Headers: Authorization: Bearer <token>
 *      Body: @triggerBody()
 *
 * Sentinel's incident JSON is well-documented; we map the fields we
 * care about and stash the raw under raw_payload.
 */

import 'server-only';
import type { IngestAlertInput, AlertSeverity } from '../soar-alerts';

interface SentinelIncidentEntity {
  type?: string;
  properties?: Record<string, unknown>;
}

interface SentinelIncident {
  id?: string;
  name?: string;
  properties?: {
    title?: string;
    description?: string;
    severity?: string;
    status?: string;
    incidentNumber?: number;
    createdTimeUtc?: string;
    additionalData?: { alertProductNames?: string[] };
    relatedEntities?: SentinelIncidentEntity[];
  };
}

export function parseSentinelAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

export function mapSentinelPayload(
  raw: SentinelIncident,
  tenantId: string,
): IngestAlertInput | null {
  const p = raw.properties ?? {};
  const title = String(p.title ?? `Sentinel incident #${p.incidentNumber ?? '?'}`).slice(0, 240);
  const description = String(p.description ?? '').slice(0, 4000);
  const severity = normalizeSentinelSeverity(p.severity);
  return {
    tenantId,
    source: 'microsoft-sentinel',
    sourceAlertId: typeof raw.name === 'string' ? raw.name : undefined,
    severity,
    title,
    description,
    rawPayload: raw,
  };
}

function normalizeSentinelSeverity(value: unknown): AlertSeverity {
  // Sentinel uses Informational | Low | Medium | High
  const s = String(value ?? '').toLowerCase();
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  if (s === 'low') return 'low';
  if (s.startsWith('info')) return 'info';
  return 'medium';
}
