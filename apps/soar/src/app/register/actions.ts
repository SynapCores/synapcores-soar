'use server';

import {
  createUser,
  type CreateUserInput,
} from '@synapcores/app-framework/auth/server-actions';

/**
 * Thin app-side wrapper around the framework's createUser. Kept as a
 * separate file so the `'use server'` directive cleanly scopes the
 * exported actions.
 */
export async function register(input: CreateUserInput): Promise<{ id: string }> {
  const user = await createUser(input);
  return { id: user.id };
}
