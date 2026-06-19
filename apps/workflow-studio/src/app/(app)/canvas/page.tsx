'use client';

import dynamic from 'next/dynamic';

// The canvas component owns a Zustand store with object-returning selectors.
// React 19's getServerSnapshot infinite-loop guard fires when those object
// snapshots aren't reference-stable across server/hydration calls, so we skip
// SSR entirely and let the client paint the React Flow canvas after mount.
const WorkflowCanvas = dynamic(
  () => import('@/canvas/WorkflowCanvas').then((m) => m.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        Loading canvas...
      </div>
    ),
  },
);

export default function CanvasPage() {
  return (
    <div className="h-[calc(100vh-57px)] flex overflow-hidden">
      <WorkflowCanvas />
    </div>
  );
}
