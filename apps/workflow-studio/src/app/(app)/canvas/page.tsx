import { Suspense } from 'react';
import { WorkflowCanvas } from '@/canvas/WorkflowCanvas';

export default function CanvasPage() {
  return (
    <div className="h-[calc(100vh-57px)] flex overflow-hidden">
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-slate-400">
            Loading canvas...
          </div>
        }
      >
        <WorkflowCanvas />
      </Suspense>
    </div>
  );
}
