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
} from '../ui';
import {
  acceptInvitation,
  previewInvitation,
  userExistsForEmail,
} from '../auth/invitations';
import type { Session } from '../auth/types';

async function getSession(): Promise<Session | null> {
  const raw = await auth();
  if (!raw) return null;
  return (raw as unknown as { framework: Session | null }).framework ?? null;
}

export function makeAcceptInvitePage() {
  async function accept(formData: FormData): Promise<void> {
    'use server';
    const session = await getSession();
    if (!session) redirect('/login');
    const token = String(formData.get('token') ?? '');
    try {
      await acceptInvitation(token, session.user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Accept failed.';
      redirect(`/accept-invite/${encodeURIComponent(token)}?err=${encodeURIComponent(msg)}`);
    }
    redirect('/dashboard?ok=invite-accepted');
  }

  return async function AcceptInvitePage({
    params,
    searchParams,
  }: {
    params: Promise<{ token: string }>;
    searchParams?: Promise<{ err?: string }>;
  }) {
    const { token } = await params;
    const sp = (await searchParams) ?? {};
    const session = await getSession();
    const preview = await previewInvitation(token);

    if (!preview) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Invitation not valid</CardTitle>
              <CardDescription>
                This link is expired, already used, or doesn&apos;t exist.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }

    // Not signed in? Bounce to register/login first.
    if (!session) {
      const exists = await userExistsForEmail(preview.email);
      const next = `/accept-invite/${encodeURIComponent(token)}`;
      const target = exists
        ? `/login?callbackUrl=${encodeURIComponent(next)}`
        : `/register?callbackUrl=${encodeURIComponent(next)}`;
      redirect(target);
    }

    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto">
        <AppPageHeader
          title={`Join ${preview.tenantName}`}
          description={`You've been invited as a ${preview.role}.`}
        />
        {sp.err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2 mb-4">
            {decodeURIComponent(sp.err)}
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Accept invitation</CardTitle>
            <CardDescription>
              You&apos;ll be added to the workspace as <strong>{preview.role}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={accept}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className="w-full">
                Join {preview.tenantName}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  };
}
