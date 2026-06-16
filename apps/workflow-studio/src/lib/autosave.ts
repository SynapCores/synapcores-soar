'use client';

// IndexedDB autosave hook — FR-9
// Uses idb-keyval for simple key/value persistence.
// Autosaves the current workflow definition on every change with a 800ms debounce.
// On mount, restores from the last saved draft if the store is still empty.

import { useEffect, useRef } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useWorkflowStore } from '@/store/workflow-store';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

const AUTOSAVE_KEY = 'workflow-studio:draft';
const AUTOSAVE_DEBOUNCE_MS = 800;

// ── Restore helper ─────────────────────────────────────────────────────────────
export async function restoreDraft(): Promise<WorkflowDefinition | null> {
  try {
    const stored = await idbGet<WorkflowDefinition>(AUTOSAVE_KEY);
    return stored ?? null;
  } catch {
    return null;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useAutosave() {
  const store = useWorkflowStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  // On first mount: restore draft if store is empty (no nodes yet)
  useEffect(() => {
    if (!isFirstMount.current) return;
    isFirstMount.current = false;

    if (store.nodes.length > 0) return; // already loaded via template/import

    void restoreDraft().then((draft) => {
      if (draft && draft.nodes.length > 0) {
        store.loadWorkflow(draft);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On every change: debounce + save
  useEffect(() => {
    if (!store.isDirty) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const def: WorkflowDefinition = {
        id: store.workflowId,
        version: store.version,
        meta: store.workflowMeta,
        nodes: store.nodes,
        edges: store.edges,
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      void idbSet(AUTOSAVE_KEY, def);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    store.isDirty,
    store.workflowId,
    store.version,
    store.workflowMeta,
    store.nodes,
    store.edges,
  ]);
}
