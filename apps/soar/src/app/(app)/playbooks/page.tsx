import Link from 'next/link';
import {
  AppPageHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { listPlaybooks } from '@/lib/playbooks';

export default async function PlaybooksPage() {
  const session = await requireSession();
  if (!session.tenant) return null;
  const playbooks = await listPlaybooks(session.tenant.id);

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="Playbooks"
        description="The recipes the incident-responder agent executes. Dry-run before enabling."
        actions={
          <Button asChild>
            <Link href="/playbooks/new">New playbook</Link>
          </Button>
        }
      />

      {playbooks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Create a playbook from a starter template (IR-Phishing-Click,
              AUTH-Impossible-Travel) or from scratch. Every playbook is a
              JSON DAG of action calls + branches; the editor validates the
              shape on save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/playbooks/new">New playbook</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          rows={playbooks}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (r) => (
                <Link
                  href={`/playbooks/${r.id}`}
                  className="text-foreground hover:text-primary"
                >
                  {r.name}
                </Link>
              ),
            },
            {
              key: 'description',
              header: 'Description',
              cell: (r) => (
                <span className="text-xs text-muted-foreground">
                  {r.description ?? '—'}
                </span>
              ),
            },
            {
              key: 'enabled',
              header: 'State',
              cell: (r) =>
                r.enabled ? (
                  <span className="text-green-400">Enabled</span>
                ) : (
                  <span className="text-muted-foreground">Disabled</span>
                ),
            },
            {
              key: 'version',
              header: 'Version',
              cell: (r) => <code>v{String(r.version)}</code>,
            },
            {
              key: 'updated_at',
              header: 'Updated',
              cell: (r) => new Date(String(r.updated_at)).toLocaleString(),
            },
          ]}
        />
      )}
    </div>
  );
}
