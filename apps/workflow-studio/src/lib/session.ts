/**
 * Resolve the framework session shape from the Auth.js raw session.
 * Server-only.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import type { Session } from '@synapcores/app-framework';

export async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

/** Throws (redirect to /login) if there's no session. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
