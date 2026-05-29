import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '../routes/auth';
import {
  AppPageHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../ui';
import { setUserPassword } from '../auth/users';
import { getAdminClient } from '../db/server';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

async function updateProfileName(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  if (!session) redirect('/login');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;
  const db = getAdminClient();
  await db.sql(
    `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`,
    [name, session.user.id],
  );
}

async function changePassword(formData: FormData): Promise<void> {
  'use server';
  const session = await getSession();
  if (!session) redirect('/login');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) {
    redirect('/settings/profile?err=mismatch');
  }
  await setUserPassword(session.user.id, password);
  redirect('/settings/profile?ok=password');
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const sp = (await searchParams) ?? {};

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <AppPageHeader
        title="Profile"
        description="Your name, email, and password."
      />

      {sp.ok === 'password' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Password updated.
        </div>
      )}
      {sp.err === 'mismatch' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          New password and confirmation don&apos;t match.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your email is the identifier for SSO + invitations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateProfileName} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={session.user.email} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={session.user.name ?? ''}
                placeholder="Jane Doe"
              />
            </div>
            <Button type="submit">Save name</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>At least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={changePassword} className="space-y-4">
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
            <Button type="submit">Change password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
