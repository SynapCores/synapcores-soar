'use server';
import { createUser, type CreateUserInput } from '@synapcores/app-framework/auth/server-actions';
export async function register(input: CreateUserInput): Promise<{ id: string }> {
  const user = await createUser(input);
  return { id: user.id };
}
