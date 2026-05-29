import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';

export default async function MagicLinkClickPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/login?error=' + encodeURIComponent('Missing token.'));
  await signIn('magic-link', { token, redirectTo: '/' });
  return null;
}
