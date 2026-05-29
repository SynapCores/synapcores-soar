'use server';

import {
  redeemAuthToken,
  setUserPassword,
} from '@synapcores/app-framework/auth/server-actions';

export async function redeemPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  const userId = await redeemAuthToken(token, 'password-reset');
  await setUserPassword(userId, newPassword);
}
