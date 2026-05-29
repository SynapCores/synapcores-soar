'use server';
import {
  findUserByEmail,
  mintAuthToken,
  sendPasswordReset,
} from '@synapcores/app-framework/auth/server-actions';
const APP_NAME = 'SynapCores AML';
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;
  const { token } = await mintAuthToken(user.id, 'password-reset');
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3003';
  const url = `${base}/reset-password/${encodeURIComponent(token)}`;
  await sendPasswordReset(user.email, url, APP_NAME);
}
