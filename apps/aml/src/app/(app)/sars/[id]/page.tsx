import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import {
  AppPageHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import {
  approveSar,
  getSar,
  updateSarNarrative,
} from '@/lib/sar-drafter';
import { dispatchAction } from '@/lib/actions/dispatcher';

async function saveDraft(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  const text = String(formData.get('narrative') ?? '').trim();
  if (!text) return;
  await updateSarNarrative(session.tenant.id, id, text);
  redirect(`/sars/${id}?ok=saved`);
}

async function approve(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  await approveSar(session.tenant.id, id, session.user.id);
  redirect(`/sars/${id}?ok=approved`);
}

async function fileWithRegulator(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const id = String(formData.get('id') ?? '');
  const sar = await getSar(session.tenant.id, id);
  if (!sar) redirect(`/sars/${id}?err=missing`);
  if (sar!.status !== 'approved') {
    redirect(`/sars/${id}?err=not_approved`);
  }
  const narrative = sar!.final_narrative ?? sar!.draft_narrative ?? '';
  await dispatchAction({
    actionId: 'file_sar',
    args: {
      sar_id: id,
      narrative,
      jurisdiction: sar!.jurisdiction,
    },
    ctx: {
      tenantId: session.tenant.id,
      invokedBy: session.user.id,
      invokedByType: 'analyst',
      sarId: id,
    },
  });
  redirect(`/sars/${id}?ok=filed_queued`);
}

export default async function SarDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ ok?: string; err?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const sar = await getSar(session.tenant.id, id);
  if (!sar) notFound();

  const text = sar.final_narrative ?? sar.draft_narrative ?? '';

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title={`SAR · ${sar.jurisdiction}`}
        description={
          <>
            <code className="text-xs">{sar.id.slice(0, 8)}</code> · status:{' '}
            <span className="text-foreground">{sar.status}</span> · drafted{' '}
            {new Date(sar.created_at).toLocaleString()}
            {sar.drafted_by && (
              <>
                {' '}
                by <code className="text-xs">{sar.drafted_by}</code>
              </>
            )}
          </>
        }
        actions={
          <Link href="/sars" className="text-sm text-muted-foreground hover:text-primary">
            ← All
          </Link>
        }
      />

      {sp.ok === 'saved' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Saved — status moved to <strong>review</strong>.
        </div>
      )}
      {sp.ok === 'approved' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Approved. Click <strong>File with regulator</strong> to dispatch
          the HBR file-with-FinCEN action.
        </div>
      )}
      {sp.ok === 'filed_queued' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
          Filing request queued for HBR approval. Resolve at{' '}
          <Link href="/approvals" className="text-primary hover:underline">
            /approvals
          </Link>
          .
        </div>
      )}
      {sp.err === 'not_approved' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          SAR must be approved before filing.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Narrative</CardTitle>
          <CardDescription>
            Edit the agent draft. Saving moves the SAR into <strong>review</strong>.
            Approving moves it into <strong>approved</strong>; Phase 4 adds the
            HBR file-with-FinCEN button.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveDraft} className="space-y-3">
            <input type="hidden" name="id" value={sar.id} />
            <textarea
              id="narrative"
              name="narrative"
              required
              rows={22}
              defaultValue={text}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save draft</Button>
              {sar.status !== 'approved' && sar.status !== 'filed' && (
                <Button
                  type="submit"
                  formAction={approve}
                  variant="outline"
                  className="border-green-500/40 text-green-300"
                >
                  Approve for filing
                </Button>
              )}
              {sar.status === 'approved' && (
                <Button
                  type="submit"
                  formAction={fileWithRegulator}
                  variant="outline"
                  className="border-amber-500/40 text-amber-300"
                >
                  File with regulator (HBR)
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {sar.status === 'approved' && (
        <Card>
          <CardHeader>
            <CardTitle>Filing</CardTitle>
            <CardDescription>
              Filing is HBR — routes through{' '}
              <Link href="/approvals" className="text-primary hover:underline">
                /approvals
              </Link>{' '}
              for a second-pair-of-eyes go/no-go before the regulator endpoint
              is called.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {sar.draft_narrative && sar.final_narrative && (
        <Card>
          <CardHeader>
            <CardTitle>Original agent draft</CardTitle>
            <CardDescription>What the agent produced before edits.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto text-xs rounded-md bg-black/40 p-3 whitespace-pre-wrap">
              {sar.draft_narrative}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
