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
import { KeyRound } from 'lucide-react';
import { redeemPasswordReset } from '@/app/reset-password/[token]/actions';

/**
 * Set a new password using a one-time reset token. The token comes
 * from the URL — we never expose it client-side.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');
    if (password !== confirm) {
      redirect(`/reset-password/${token}?error=${encodeURIComponent('Passwords do not match.')}`);
    }
    try {
      await redeemPasswordReset(token, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed.';
      redirect(`/reset-password/${token}?error=${encodeURIComponent(msg)}`);
    }
    redirect('/login?reset=ok');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <KeyRound className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            Pick something strong. You&apos;ll use this every time you sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {sp.error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {decodeURIComponent(sp.error)}
              </div>
            )}
            <Button type="submit" className="w-full">
              Save new password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
