import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@synapcores/app-framework';
import { ShieldCheck } from 'lucide-react';
import { signIn } from '@/lib/auth';
import { getSession } from '@/lib/session';

/**
 * Login page. Server-rendered; uses Auth.js `signIn('credentials', ...)`
 * as a server action so credentials never round-trip through the
 * client-side network.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) {
    redirect(session.tenant ? '/dashboard' : '/onboard');
  }

  async function login(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/',
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">SynapCores SOAR</CardTitle>
          <CardDescription>
            Sign in to your workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={login} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Forgot?
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {sp.error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {decodeURIComponent(sp.error)}
              </div>
            )}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            No account yet?{' '}
            <Link href="/register" className="text-primary hover:underline">
              Start a workspace
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
