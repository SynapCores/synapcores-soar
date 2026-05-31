/**
 * Demo event simulator — Requirement 2 of the SOAR Demo Completion doc.
 *
 * Generates a full incident sequence locally. Modes: webhook, file, kafka.
 * Deterministic replay supported via the `scenario_id` field.
 */

/** Event types per Req 2. */
export type EventType =
  | 'auth.login_failed'
  | 'auth.login_success_suspicious'
  | 'iam.role_escalated'
  | 'endpoint.malware_alert'
  | 'cloudtrail.policy_changed'
  | 'service.error_rate_spike'
  | 'deployment.completed'
  | 'customer.impact_detected'
  | 'analyst.action_approved'
  | 'remediation.executed'
  | 'incident.closed';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type EntityType =
  | 'user'
  | 'asset'
  | 'service'
  | 'deployment'
  | 'ip'
  | 'account';

/** Canonical event shape required by Req 2. */
export interface SimEvent {
  event_id: string;
  event_type: EventType;
  timestamp: string; // ISO-8601
  source: string;
  severity: Severity;
  entity_type: EntityType;
  entity_id: string;
  correlation_id: string;
  payload: Record<string, unknown>;
}

export interface Scenario {
  scenario_id: string;
  name: string;
  description: string;
  events: Omit<SimEvent, 'event_id' | 'timestamp'>[];
}

export type SimulatorMode = 'webhook' | 'file' | 'kafka';

export interface SimulatorConfig {
  /** Where to POST events when mode='webhook'. */
  webhookUrl?: string;
  /** Bearer token for the webhook target. */
  webhookToken?: string;
  /** Where to write JSON-lines when mode='file'. */
  filePath?: string;
  /** Kafka broker + topic when mode='kafka' (Enterprise only). */
  kafkaBrokers?: string;
  kafkaTopic?: string;
  /** Pacing between events, in ms. Default 800. */
  intervalMs?: number;
  /** Deterministic seed for replay. */
  seed?: number;
}
