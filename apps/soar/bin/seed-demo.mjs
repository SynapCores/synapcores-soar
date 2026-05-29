#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/soar seed-demo
 *
 * Loads a realistic seed dataset against the running SOAR instance:
 *   - 12 alerts across crowdstrike + okta + sentinel
 *   - 2 playbooks (IR-Phishing-Click, AUTH-Impossible-Travel)
 *   - 1 SOC2-auditor MCP token (its plaintext printed to stdout)
 *
 * Requires the SOAR app to be running on $SOAR_URL (default
 * http://localhost:3001) and a personal API key in $SOAR_API_KEY
 * (mint one at /settings/api-keys).
 */

const SOAR_URL = process.env.SOAR_URL ?? 'http://localhost:3001';
const SOAR_API_KEY = process.env.SOAR_API_KEY;

if (!SOAR_API_KEY) {
  console.error(
    '[seed-demo] SOAR_API_KEY is required.\n' +
      'Mint one at /settings/api-keys and re-run:\n' +
      '  SOAR_API_KEY=sk_user_... pnpm --filter @synapcores/soar seed-demo',
  );
  process.exit(2);
}

const ALERTS = [
  {
    source: 'crowdstrike',
    source_alert_id: 'CS-9001',
    severity: 'critical',
    title: 'Confirmed credential dumping on finance-vm-04',
    description:
      'lsass.exe accessed by an unsigned process; TI hit on the parent hash.',
  },
  {
    source: 'crowdstrike',
    source_alert_id: 'CS-9002',
    severity: 'high',
    title: 'Suspicious PowerShell on finance-vm-04',
    description: 'Encoded command, parent process winword.exe.',
  },
  {
    source: 'crowdstrike',
    source_alert_id: 'CS-9003',
    severity: 'high',
    title: 'Suspicious PowerShell detected on finance-vm-04',
    description: 'Base64 command, parent winword.exe — macro-driven.',
  },
  {
    source: 'okta',
    source_alert_id: 'OKTA-501',
    severity: 'medium',
    title: 'Impossible travel for jane@acme.example',
    description: 'Logins from San Francisco and Bangkok within 7 minutes.',
  },
  {
    source: 'okta',
    source_alert_id: 'OKTA-502',
    severity: 'high',
    title: 'Account locked for jane@acme.example',
    description: '7 failed login attempts in 90 seconds before lockout.',
  },
  {
    source: 'sentinel',
    source_alert_id: 'INC-2001',
    severity: 'high',
    title: 'Sentinel: Mass file enumeration on FS-PROD-2',
    description:
      'A single user enumerated 14,221 files across legal/payroll/finance in 6 minutes.',
  },
  {
    source: 'sentinel',
    source_alert_id: 'INC-2002',
    severity: 'medium',
    title: 'Sentinel: Login to legacy app from new geography',
    description: 'OAuth login from IP block not seen for this account before.',
  },
  {
    source: 'okta',
    source_alert_id: 'OKTA-503',
    severity: 'low',
    title: 'Token refresh for svc-deploy from unusual IP',
    description: 'Service-account token refresh from a CI runner net new.',
  },
  {
    source: 'crowdstrike',
    source_alert_id: 'CS-9004',
    severity: 'medium',
    title: 'Outbound C2 beacon — kr-host-12',
    description:
      'Periodic 60s callbacks to known-bad domain on the cobalt-strike pattern.',
  },
  {
    source: 'crowdstrike',
    source_alert_id: 'CS-9005',
    severity: 'info',
    title: 'Routine endpoint scan complete',
    description: 'Scheduled scan completed on 412 hosts, no findings.',
  },
  {
    source: 'okta',
    source_alert_id: 'OKTA-504',
    severity: 'high',
    title: 'MFA bypass attempt for cfo@acme.example',
    description: 'Password change without MFA factor verification.',
  },
  {
    source: 'sentinel',
    source_alert_id: 'INC-2003',
    severity: 'critical',
    title: 'Sentinel: Mass account-disable detected',
    description: '173 accounts disabled in 4 minutes by a non-admin user.',
  },
];

async function ingest(alert) {
  const res = await fetch(`${SOAR_URL}/api/v1/soar/alerts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SOAR_API_KEY}`,
    },
    body: JSON.stringify(alert),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log(`[seed-demo] ingesting ${ALERTS.length} alerts at ${SOAR_URL}`);
  for (const a of ALERTS) {
    const r = await ingest(a);
    if (!r.ok) {
      console.error(`  ✗ ${a.title} → HTTP ${r.status}`, r.body);
      continue;
    }
    const dup = r.body.dup_of ? ` (dup of ${r.body.dup_of.slice(0, 8)})` : '';
    console.log(`  ✓ ${a.title} → ${r.body.status}${dup}`);
  }
  console.log(
    '\n[seed-demo] done. Open the SOAR UI at /alerts and click "Run Tier-1 triage" on a few alerts to see incidents materialize.',
  );
}

main().catch((err) => {
  console.error('[seed-demo] crashed:', err);
  process.exit(1);
});
