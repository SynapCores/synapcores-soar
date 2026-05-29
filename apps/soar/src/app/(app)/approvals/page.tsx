import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  AppPageHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@synapcores/app-framework';
import { ShieldAlert } from 'lucide-react';
import { requireSession } from '@/lib/session';
import {
  listPendingApprovals,
  resolveApproval,
} from '@/lib/actions/approvals';

async function approve(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const approvalId = String(formData.get('approval_id') ?? '');
  const note = String(formData.get('note') ?? '').trim() || undefined;
  const result = await resolveApproval({
    approvalId,
    decision: 'approved',
    decidedByUserId: session.user.id,
    decisionNote: note,
  });
  if (!result.ok) {
    redirect(
      `/approvals?err=${encodeURIComponent(result.errorMessage ?? 'approve failed')}`,
    );
  }
  redirect(`/approvals?ok=approved&state=${result.newState ?? 'completed'}`);
}

async function reject(formData: FormData): Promise<void> {
  'use server';
  const session = await requireSession();
  if (!session.tenant) return;
  const approvalId = String(formData.get('approval_id') ?? '');
  const note = String(formData.get('note') ?? '').trim() || undefined;
  const result = await resolveApproval({
    approvalId,
    decision: 'rejected',
    decidedByUserId: session.user.id,
    decisionNote: note,
  });
  if (!result.ok) {
    redirect(
      `/approvals?err=${encodeURIComponent(result.errorMessage ?? 'reject failed')}`,
    );
  }
  redirect('/approvals?ok=rejected');
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string; state?: string }>;
}) {
  const session = await requireSession();
  if (!session.tenant) return null;
  const sp = (await searchParams) ?? {};
  const pending = await listPendingApprovals(session.tenant.id);

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <AppPageHeader
        title="Approvals"
        description="High-blast-radius actions waiting on a human decision. Approve to fire; reject to stop with a recorded reason."
      />

      {sp.ok === 'approved' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 text-sm px-3 py-2">
          Approved — action fired ({sp.state ?? 'completed'}).
        </div>
      )}
      {sp.ok === 'rejected' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm px-3 py-2">
          Rejected — recorded in audit log.
        </div>
      )}
      {sp.err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {decodeURIComponent(sp.err)}
        </div>
      )}

      {pending.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing pending</CardTitle>
            <CardDescription>
              When an analyst or agent requests an HBR action (isolate, disable,
              revoke, block), it lands here for human go/no-go.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        pending.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
                <div>
                  <CardTitle className="text-base">
                    <code className="text-primary">{p.action}</code>
                    {p.target && (
                      <span className="ml-2 text-muted-foreground text-sm font-mono">
                        → {p.target}
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Requested by {p.requested_by} ·{' '}
                    {new Date(p.requested_at).toLocaleString()}
                    {p.alert_id && (
                      <>
                        {' · '}
                        <Link
                          href={`/alerts/${p.alert_id}`}
                          className="text-primary hover:underline"
                        >
                          source alert
                        </Link>
                      </>
                    )}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Show full request payload</summary>
                <pre className="mt-2 rounded-md bg-black/40 p-3 overflow-x-auto">
                  {JSON.stringify(p.request_payload, null, 2)}
                </pre>
              </details>

              <form className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                <input type="hidden" name="approval_id" value={p.id} />
                <div className="space-y-1">
                  <label
                    htmlFor={`note-${p.id}`}
                    className="text-xs text-muted-foreground"
                  >
                    Decision note (optional)
                  </label>
                  <Input
                    id={`note-${p.id}`}
                    name="note"
                    placeholder="Verified with on-call · ticketed"
                  />
                </div>
                <Button type="submit" formAction={approve}>
                  Approve &amp; fire
                </Button>
                <Button
                  type="submit"
                  formAction={reject}
                  variant="outline"
                  className="text-destructive border-destructive/40"
                >
                  Reject
                </Button>
              </form>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
