import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import type { Session } from '@synapcores/app-framework';

export async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
