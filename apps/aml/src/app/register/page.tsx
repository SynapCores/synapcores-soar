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
import { register } from '@/app/register/actions';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) {
    redirect(session.tenant ? '/dashboard' : '/onboard');
  }

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const name = String(formData.get('name') ?? '').trim() || null;
    try {
      await register({ email, password, name: name ?? undefined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      redirect(`/register?error=${encodeURIComponent(msg)}`);
    }
    await signIn('credentials', { email, password, redirectTo: '/' });
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
          <CardTitle className="text-2xl">Start a workspace</CardTitle>
          <CardDescription>Create your SynapCores AML account</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" type="text" autoComplete="name" placeholder="Jane Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@bank.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            {sp.error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {decodeURIComponent(sp.error)}
              </div>
            )}
            <Button type="submit" className="w-full">Create account</Button>
          </form>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">Sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
