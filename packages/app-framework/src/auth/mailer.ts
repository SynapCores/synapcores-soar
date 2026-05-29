/**
 * Outbound email adapter for magic links + password reset + invites.
 *
 * In dev (no MAIL_PROVIDER), the adapter logs the URL to stdout so
 * the developer can copy/paste it. In production, set MAIL_PROVIDER
 * = 'resend' | 'ses' | 'smtp' and the appropriate credentials.
 *
 * Phase 2 ships the dev adapter only; the real providers can be added
 * later without app code changes (apps don't import these — they
 * import the higher-level `sendMagicLink`/`sendInvite` helpers).
 */

import 'server-only';

export type MailEnvelope = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface MailProvider {
  send(env: MailEnvelope): Promise<void>;
}

class ConsoleProvider implements MailProvider {
  async send(env: MailEnvelope): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      '\n────────────────────────────────────────────\n' +
        `📧 [dev mail] → ${env.to}\n` +
        `   subject: ${env.subject}\n` +
        `   body:\n${env.text
          .split('\n')
          .map((l) => '     ' + l)
          .join('\n')}\n` +
        '────────────────────────────────────────────\n',
    );
  }
}

let cached: MailProvider | null = null;

export function getMailer(): MailProvider {
  if (cached) return cached;
  const provider = process.env.MAIL_PROVIDER ?? 'console';
  switch (provider) {
    case 'console':
      cached = new ConsoleProvider();
      return cached;
    // Future: 'resend' | 'ses' | 'smtp' — same MailProvider interface.
    default:
      // eslint-disable-next-line no-console
      console.warn(
        `[mailer] Unknown MAIL_PROVIDER='${provider}'; falling back to console adapter.`,
      );
      cached = new ConsoleProvider();
      return cached;
  }
}

// ─── application-shaped wrappers ─────────────────────────────────────────

export async function sendMagicLink(
  email: string,
  url: string,
  appName: string,
): Promise<void> {
  await getMailer().send({
    to: email,
    subject: `Sign in to ${appName}`,
    text: `Click the link below to sign in. It expires in 10 minutes.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
  });
}

export async function sendPasswordReset(
  email: string,
  url: string,
  appName: string,
): Promise<void> {
  await getMailer().send({
    to: email,
    subject: `Reset your ${appName} password`,
    text: `We received a request to reset your password. Click below to set a new one (expires in 30 minutes):\n\n${url}\n\nIf you didn't request this, you can ignore this email — your password won't change.`,
  });
}

export async function sendTenantInvite(opts: {
  to: string;
  inviterName: string;
  workspaceName: string;
  url: string;
  appName: string;
}): Promise<void> {
  await getMailer().send({
    to: opts.to,
    subject: `${opts.inviterName} invited you to ${opts.workspaceName} on ${opts.appName}`,
    text: `${opts.inviterName} has invited you to join the ${opts.workspaceName} workspace on ${opts.appName}.\n\nAccept the invitation:\n${opts.url}\n\nThe invitation expires in 7 days.`,
  });
}
