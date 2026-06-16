import { AppPageHeader } from '@synapcores/app-framework';
import { RunsTable } from '@/runs/RunsTable';

export default function RunsPage() {
  return (
    <div className="p-6">
      <AppPageHeader
        title="Run History"
        description="Execution history for all deployed workflows"
      />
      <RunsTable />
    </div>
  );
}
