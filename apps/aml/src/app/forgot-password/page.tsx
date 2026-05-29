import Link from 'next/link';
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
import { Mail } from 'lucide-react';
import { requestPasswordReset } from '@/app/forgot-password/actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const sp = await searchParams;

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    await requestPasswordReset(email);
    const { redirect } = await import('next/navigation');
    redirect('/forgot-password?sent=1');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <Mail className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription>
            {sp.sent
              ? 'If an account exists for that email, we sent a reset link. It expires in 30 minutes.'
              : "Enter your email and we'll send you a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sp.sent ? (
            <Link href="/login" className="block text-center text-sm text-primary hover:underline">
              Back to sign in
            </Link>
          ) : (
            <form action={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <Button type="submit" className="w-full">Send reset link</Button>
              <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-primary">
                Back to sign in
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
