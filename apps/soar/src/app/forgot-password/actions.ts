'use server';

import {
  findUserByEmail,
  mintAuthToken,
  sendPasswordReset,
} from '@synapcores/app-framework/auth/server-actions';

const APP_NAME = 'SynapCores SOAR';

/**
 * Always silently succeed at the API level (no account enumeration).
 * If the email exists, we mint a token + send the reset link.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;
  const { token } = await mintAuthToken(user.id, 'password-reset');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3001';
  const url = `${base}/reset-password/${encodeURIComponent(token)}`;
  await sendPasswordReset(user.email, url, APP_NAME);
}
