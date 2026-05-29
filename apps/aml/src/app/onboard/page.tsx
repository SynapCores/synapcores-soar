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
import { Landmark } from 'lucide-react';
import { requireSession } from '@/lib/session';
import { provisionWorkspace } from '@/app/onboard/actions';

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  if (session.tenant) redirect('/dashboard');

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const slug = String(formData.get('slug') ?? '').trim() || undefined;
    try {
      await provisionWorkspace({ name, slug });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      redirect(`/onboard?error=${encodeURIComponent(msg)}`);
    }
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <Landmark className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Create your workspace</CardTitle>
          <CardDescription>
            Your AML team&apos;s case files + audit trail. You can invite analysts after.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input id="name" name="name" type="text" required placeholder="Acme Bank Financial Crime" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL slug (optional)</Label>
              <Input id="slug" name="slug" type="text" placeholder="acme-bank-fc" pattern="[a-z0-9\-]{2,40}" />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, hyphens. Auto-derived from the name if blank.
              </p>
            </div>
            {sp.error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {decodeURIComponent(sp.error)}
              </div>
            )}
            <Button type="submit" className="w-full">Create workspace</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
