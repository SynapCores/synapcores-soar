/**
 * Splunk HTTP Event Collector connector.
 *
 * Splunk supports outbound HEC where alerts get POSTed at a URL.
 * Customer setup in Splunk:
 *   1. Settings → Data inputs → HTTP Event Collector → New Token
 *   2. Receiving URL: <synapcores>/api/v1/connectors/splunk
 *      with header `Authorization: Splunk <token>` or `Authorization: Bearer <token>`
 *
 * Our schema map:
 *   { event: {severity?, message, source?, _raw?, ...}, sourcetype?, host? }
 *
 * Splunk also supports a "raw" indexer-acknowledgment format; we accept
 * either shape and normalize.
 */

import 'server-only';
import type { IngestAlertInput, AlertSeverity } from '../soar-alerts';

interface SplunkPayload {
  event?: Record<string, unknown> | string;
  sourcetype?: string;
  host?: string;
  time?: number;
  index?: string;
}

export function parseSplunkAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Splunk ')) return auth.slice(7).trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

export function mapSplunkPayload(
  raw: SplunkPayload,
  tenantId: string,
): IngestAlertInput | null {
  const event = raw.event;
  if (!event) return null;
  // Two cases: event is a JSON object OR a raw string.
  let title = '';
  let description = '';
  let severity: AlertSeverity = 'medium';
  let sourceAlertId: string | undefined;

  if (typeof event === 'object' && event !== null) {
    const obj = event as Record<string, unknown>;
    title = String(obj.title ?? obj.message ?? obj.event ?? obj.name ?? '').slice(0, 240);
    description = String(obj.description ?? obj._raw ?? obj.message ?? '').slice(0, 4000);
    severity = normalizeSplunkSeverity(obj.severity ?? obj.priority);
    sourceAlertId = typeof obj.event_id === 'string' ? obj.event_id : undefined;
  } else if (typeof event === 'string') {
    title = event.slice(0, 240);
    description = event.slice(0, 4000);
  } else {
    return null;
  }

  if (!title) title = `Splunk event from ${raw.sourcetype ?? 'unknown sourcetype'}`;

  return {
    tenantId,
    source: 'splunk',
    sourceAlertId,
    severity,
    title,
    description,
    rawPayload: raw,
  };
}

function normalizeSplunkSeverity(value: unknown): AlertSeverity {
  if (typeof value === 'string') {
    const s = value.toLowerCase();
    if (s.startsWith('crit')) return 'critical';
    if (s.startsWith('high')) return 'high';
    if (s.startsWith('med')) return 'medium';
    if (s.startsWith('low')) return 'low';
    if (s.startsWith('info')) return 'info';
  }
  if (typeof value === 'number') {
    if (value >= 80) return 'critical';
    if (value >= 60) return 'high';
    if (value >= 40) return 'medium';
    if (value >= 20) return 'low';
    return 'info';
  }
  return 'medium';
}
