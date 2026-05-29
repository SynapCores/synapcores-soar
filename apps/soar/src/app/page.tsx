import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

/**
 * Root — bounce to /login (no session), /onboard (no tenant), or /dashboard.
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.tenant) redirect('/onboard');
  redirect('/dashboard');
}
