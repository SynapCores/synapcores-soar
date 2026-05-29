import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';

/**
 * Magic-link click handler. The user lands here after clicking the
 * link in their email. We hand the token to the `magic-link` Auth.js
 * provider; on success they're redirected to the root (which bounces
 * to /onboard or /dashboard).
 */
export default async function MagicLinkClickPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    redirect('/login?error=' + encodeURIComponent('Missing token.'));
  }
  // signIn throws a NEXT_REDIRECT internally — keep it bare here.
  await signIn('magic-link', { token, redirectTo: '/' });
  return null;
}
