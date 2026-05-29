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
import { Scale } from 'lucide-react';
import { signIn } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { requestMagicLink } from '@/app/login/actions';

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
    await signIn('credentials', { email, password, redirectTo: '/' });
  }

  async function magicLinkLogin(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    await requestMagicLink(email);
    redirect('/login/verify');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <Scale className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">SynapCores AML</CardTitle>
          <CardDescription>Sign in to your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
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
              />
            </div>
            {sp.error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {decodeURIComponent(sp.error)}
              </div>
            )}
            <Button type="submit" formAction={login} className="w-full">
              Sign in
            </Button>

            <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="submit"
              formAction={magicLinkLogin}
              variant="outline"
              className="w-full"
              formNoValidate
            >
              Email me a sign-in link
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              No password needed — uses your email above.
            </p>
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
