/**
 * Starter playbook templates. Operator picks one as the seed when
 * creating a new playbook.
 */

import type { PlaybookDef } from './playbooks';

export const PLAYBOOK_TEMPLATES: Record<string, PlaybookDef> = {
  'IR-Phishing-Click': {
    name: 'IR Phishing Click',
    description:
      'When a phishing-click alert lands, notify the SOC, isolate the host, disable the user, and file a ticket.',
    match_when: { source: 'crowdstrike' },
    steps: [
      {
        type: 'action',
        name: 'Notify SOC channel',
        action: 'notify_channel',
        args: {
          message:
            'CrowdStrike alert escalated — phishing click in progress. Triage now.',
        },
      },
      {
        type: 'action',
        name: 'Open SecOps ticket',
        action: 'create_ticket',
        args: {
          short_description: 'CrowdStrike — phishing click',
          priority: 2,
        },
      },
      {
        type: 'branch',
        name: 'Severity gate',
        when: { severity: ['critical', 'high'] },
        then: [
          {
            type: 'action',
            name: 'Isolate the endpoint',
            action: 'isolate_endpoint',
            args: { device_id: '<resolve from asset graph>' },
          },
          {
            type: 'action',
            name: 'Disable the user',
            action: 'disable_user',
            args: { user_id: '<resolve from identity graph>' },
          },
        ],
        else: [
          {
            type: 'note',
            name: 'Low severity — let analyst decide',
            text:
              'Medium / Low / Info: queue for human review, no auto-containment.',
          },
        ],
      },
    ],
  },

  'AUTH-Impossible-Travel': {
    name: 'AUTH Impossible Travel',
    description:
      "Okta impossible-travel signal — block the IP, revoke active sessions, notify the user's manager.",
    match_when: { source: 'okta' },
    steps: [
      {
        type: 'action',
        name: 'Notify SOC',
        action: 'notify_channel',
        args: {
          message: 'Okta impossible-travel signal — investigating.',
        },
      },
      {
        type: 'action',
        name: 'Revoke active sessions',
        action: 'revoke_sessions',
        args: { user_id: '<resolve from alert>', oauthTokens: true },
      },
      {
        type: 'note',
        name: 'Manager loop',
        text:
          "Phase 11 will add a Slack DM step to the user's manager with the geolocation breakdown.",
      },
    ],
  },
};
