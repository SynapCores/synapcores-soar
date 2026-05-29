'use server';

import {
  findUserByEmail,
  mintAuthToken,
  sendMagicLink,
} from '@synapcores/app-framework/auth/server-actions';

const APP_NAME = 'SynapCores AML';

export async function requestMagicLink(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;
  const { token } = await mintAuthToken(user.id, 'magic-link');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';
  const url = `${base}/login/magic?token=${encodeURIComponent(token)}`;
  await sendMagicLink(user.email, url, APP_NAME);
}
