import { AppPageHeader } from '@synapcores/app-framework';
import { RunTimeline } from '@/runs/RunTimeline';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-6">
      <AppPageHeader
        title={`Run ${id.slice(0, 8)}`}
        description="Step-by-step execution timeline"
      />
      <RunTimeline runId={id} />
    </div>
  );
}
