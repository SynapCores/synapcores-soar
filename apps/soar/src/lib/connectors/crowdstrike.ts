/**
 * CrowdStrike Falcon connector — receives detections via Workflow webhook.
 *
 * Falcon's Streaming API is outbound (the engine has to PULL). The
 * easier integration is Falcon Workflows → "Send via webhook":
 *
 *   1. CrowdStrike console → Workflows → New workflow
 *   2. Trigger: "New detection" / "Updated detection"
 *   3. Action: "Send via webhook" → POST → <synapcores>/api/v1/connectors/crowdstrike
 *      Headers: Authorization: Bearer <token>
 *      Body shape: Falcon detection JSON
 *
 * Schema map: behaviors[*], device.hostname, severity (1-5), description.
 */

import 'server-only';
import type { IngestAlertInput, AlertSeverity } from '../soar-alerts';

interface CrowdStrikeBehavior {
  description?: string;
  filename?: string;
  technique?: string;
  tactic?: string;
}

interface CrowdStrikeDetection {
  detection_id?: string;
  cid?: string;
  severity?: number;
  severity_name?: string;
  status?: string;
  description?: string;
  device?: {
    hostname?: string;
    device_id?: string;
    platform_name?: string;
  };
  behaviors?: CrowdStrikeBehavior[];
}

export function parseCrowdStrikeAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

export function mapCrowdStrikePayload(
  raw: CrowdStrikeDetection,
  tenantId: string,
): IngestAlertInput | null {
  const hostname = raw.device?.hostname ?? 'unknown-host';
  const tactic =
    raw.behaviors?.[0]?.tactic ?? raw.behaviors?.[0]?.technique ?? 'detection';
  const title = `CrowdStrike: ${tactic} on ${hostname}`.slice(0, 240);
  const desc = [
    raw.description,
    ...(raw.behaviors ?? [])
      .map((b) => `• ${b.description ?? b.technique ?? b.filename ?? ''}`)
      .filter(Boolean),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return {
    tenantId,
    source: 'crowdstrike',
    sourceAlertId: raw.detection_id,
    severity: normalizeCrowdStrikeSeverity(raw.severity, raw.severity_name),
    title,
    description: desc,
    rawPayload: raw,
  };
}

function normalizeCrowdStrikeSeverity(
  num?: number,
  name?: string,
): AlertSeverity {
  // Falcon scores severity 1 (Informational) — 5 (Critical).
  if (typeof num === 'number') {
    if (num >= 5) return 'critical';
    if (num >= 4) return 'high';
    if (num >= 3) return 'medium';
    if (num >= 2) return 'low';
    return 'info';
  }
  const s = String(name ?? '').toLowerCase();
  if (s.startsWith('crit')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  return 'info';
}
