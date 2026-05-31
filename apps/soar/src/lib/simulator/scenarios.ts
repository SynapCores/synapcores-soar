/**
 * Canonical demo scenarios. Deterministic — same scenario_id always
 * emits the same event sequence (modulo timestamps + uuids).
 *
 * The Definition-of-Done sequence is the `compromised-session` scenario:
 * suspicious login → IAM escalation → endpoint malware → cloudtrail
 * policy change → service degradation → analyst approves → remediation.
 */
import type { Scenario } from './types';

const compromisedSession: Scenario = {
  scenario_id: 'demo-compromised-session-001',
  name: 'Compromised user session → privilege escalation',
  description:
    'The canonical SOAR demo scenario: legitimate user credentials stolen, ' +
    "attacker logs in from new IP, escalates the user's IAM role, " +
    'malware fires on the same endpoint, cloud audit logs the role change, ' +
    'a downstream service errors. Analyst approves containment, system ' +
    'executes, incident closes, resolution becomes future memory.',
  events: [
    {
      event_type: 'auth.login_failed',
      source: 'okta',
      severity: 'low',
      entity_type: 'user',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: { ip: '203.0.113.42', country: 'RO', reason: 'invalid_password' },
    },
    {
      event_type: 'auth.login_failed',
      source: 'okta',
      severity: 'low',
      entity_type: 'user',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: { ip: '203.0.113.42', country: 'RO', reason: 'invalid_password' },
    },
    {
      event_type: 'auth.login_success_suspicious',
      source: 'okta',
      severity: 'high',
      entity_type: 'user',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: {
        ip: '203.0.113.42',
        country: 'RO',
        risk_score: 0.91,
        last_login_country: 'US',
      },
    },
    {
      event_type: 'iam.role_escalated',
      source: 'aws-iam',
      severity: 'high',
      entity_type: 'account',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: {
        old_role: 'developer',
        new_role: 'org-admin',
        elapsed_seconds_since_login: 217,
      },
    },
    {
      event_type: 'endpoint.malware_alert',
      source: 'crowdstrike',
      severity: 'critical',
      entity_type: 'asset',
      entity_id: 'host-alice-mbp',
      correlation_id: 'cor-001',
      payload: {
        signature: 'Trojan.MacOS.Stealer.A',
        process: 'curl',
        user: 'alice',
      },
    },
    {
      event_type: 'cloudtrail.policy_changed',
      source: 'aws-cloudtrail',
      severity: 'high',
      entity_type: 'account',
      entity_id: 'aws-prod-1',
      correlation_id: 'cor-001',
      payload: {
        change: 'AttachUserPolicy',
        target: 'alice@acme.example',
        policy_arn: 'arn:aws:iam::aws:policy/AdministratorAccess',
      },
    },
    {
      event_type: 'service.error_rate_spike',
      source: 'prometheus',
      severity: 'medium',
      entity_type: 'service',
      entity_id: 'checkout-api',
      correlation_id: 'cor-001',
      payload: { error_rate_pct: 12.4, baseline_pct: 0.3, window_seconds: 60 },
    },
    {
      event_type: 'customer.impact_detected',
      source: 'datadog-synthetics',
      severity: 'high',
      entity_type: 'service',
      entity_id: 'checkout-api',
      correlation_id: 'cor-001',
      payload: { affected_tx_estimate: 1840, last_5min: true },
    },
    {
      event_type: 'analyst.action_approved',
      source: 'soar-ui',
      severity: 'medium',
      entity_type: 'user',
      entity_id: 'analyst-bob@acme.example',
      correlation_id: 'cor-001',
      payload: {
        actions: ['revoke_user_session', 'disable_user_account', 'isolate_endpoint'],
        approval_latency_seconds: 47,
      },
    },
    {
      event_type: 'remediation.executed',
      source: 'soar-dispatcher',
      severity: 'medium',
      entity_type: 'user',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: {
        actions_executed: 3,
        actions_failed: 0,
      },
    },
    {
      event_type: 'incident.closed',
      source: 'soar-dispatcher',
      severity: 'low',
      entity_type: 'user',
      entity_id: 'alice@acme.example',
      correlation_id: 'cor-001',
      payload: {
        outcome: 'true_positive',
        mttd_seconds: 240,
        mttr_seconds: 312,
      },
    },
  ],
};

const deploymentRegression: Scenario = {
  scenario_id: 'demo-deployment-regression-001',
  name: 'Bad deployment → service degradation',
  description:
    'Deployment ships, error rate climbs, customer impact detected. ' +
    'Analyst approves rollback, system reverts the bad release, incident closes.',
  events: [
    {
      event_type: 'deployment.completed',
      source: 'github',
      severity: 'low',
      entity_type: 'deployment',
      entity_id: 'checkout-api-v2.7.3',
      correlation_id: 'cor-002',
      payload: { commit_sha: 'abc1234', author: 'dev@acme.example' },
    },
    {
      event_type: 'service.error_rate_spike',
      source: 'prometheus',
      severity: 'high',
      entity_type: 'service',
      entity_id: 'checkout-api',
      correlation_id: 'cor-002',
      payload: { error_rate_pct: 18.0, baseline_pct: 0.3, window_seconds: 60 },
    },
    {
      event_type: 'customer.impact_detected',
      source: 'datadog-synthetics',
      severity: 'high',
      entity_type: 'service',
      entity_id: 'checkout-api',
      correlation_id: 'cor-002',
      payload: { affected_tx_estimate: 4210, last_5min: true },
    },
    {
      event_type: 'analyst.action_approved',
      source: 'soar-ui',
      severity: 'medium',
      entity_type: 'user',
      entity_id: 'analyst-bob@acme.example',
      correlation_id: 'cor-002',
      payload: {
        actions: ['rollback_deployment', 'notify_channel'],
        approval_latency_seconds: 31,
      },
    },
    {
      event_type: 'remediation.executed',
      source: 'soar-dispatcher',
      severity: 'medium',
      entity_type: 'deployment',
      entity_id: 'checkout-api-v2.7.3',
      correlation_id: 'cor-002',
      payload: { actions_executed: 2, actions_failed: 0 },
    },
    {
      event_type: 'incident.closed',
      source: 'soar-dispatcher',
      severity: 'low',
      entity_type: 'service',
      entity_id: 'checkout-api',
      correlation_id: 'cor-002',
      payload: { outcome: 'true_positive', mttd_seconds: 92, mttr_seconds: 198 },
    },
  ],
};

export const SCENARIOS: Record<string, Scenario> = {
  [compromisedSession.scenario_id]: compromisedSession,
  [deploymentRegression.scenario_id]: deploymentRegression,
};

export function listScenarios(): Scenario[] {
  return Object.values(SCENARIOS);
}

export function getScenario(scenarioId: string): Scenario | undefined {
  return SCENARIOS[scenarioId];
}
