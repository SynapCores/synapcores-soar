import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowMeta,
  WorkflowDefinition,
  ValidationIssue,
} from '@synapcores/workflow-types';

// ── Snapshot for undo/redo ─────────────────────────────────────────────────────

interface WorkflowSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const DEFAULT_META: WorkflowMeta = {
  name: 'Untitled Workflow',
  description: '',
  tags: [],
  targetEngineId: 'default',
  minEngineVersion: '1.8.5',
};

// ── Clipboard snapshot ────────────────────────────────────────────────────────

interface ClipboardSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ── State + actions shape ──────────────────────────────────────────────────────

export interface WorkflowState {
  // ── Workflow data ──────────────────────────────────────────────────────────
  workflowId: string;
  version: number;
  workflowMeta: WorkflowMeta;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: 'draft' | 'compiled' | 'deployed' | 'archived';
  isDirty: boolean;

  // ── Undo / redo history ────────────────────────────────────────────────────
  history: WorkflowSnapshot[];
  historyIndex: number;

  // ── Clipboard ─────────────────────────────────────────────────────────────
  clipboard: ClipboardSnapshot | null;

  // ── UI state ───────────────────────────────────────────────────────────────
  selectedNodeId: string | null;
  selectedNodeIds: string[];       // multi-select
  inspectorOpen: boolean;
  paletteOpen: boolean;
  sqlPreviewOpen: boolean;
  templateGalleryOpen: boolean;
  finderOpen: boolean;             // ⌘F search-in-canvas
  sampleDataEditorOpen: boolean;   // FR-37 fixture editor
  outputMappingOpen: boolean;      // FR-38 output mapping

  // ── Read-only mode (FR-15) ─────────────────────────────────────────────────
  readOnly: boolean;

  // ── Sample data fixtures (FR-37) ──────────────────────────────────────────
  sampleData: Record<string, unknown>;

  // ── Validation ─────────────────────────────────────────────────────────────
  validationIssues: ValidationIssue[];
  isValidating: boolean;

  // ── Compilation ────────────────────────────────────────────────────────────
  compiledSql: string | null;
  compiledAt: string | null;

  // ── Engine connection ──────────────────────────────────────────────────────
  engineConnected: boolean;
  activeEngineId: string;

  // ── Actions ───────────────────────────────────────────────────────────────
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (node: WorkflowNode) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<WorkflowNode['data']>) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  toggleInspector: (open?: boolean) => void;
  togglePalette: (open?: boolean) => void;
  toggleSqlPreview: (open?: boolean) => void;
  toggleTemplateGallery: (open?: boolean) => void;
  toggleFinder: (open?: boolean) => void;
  toggleSampleDataEditor: (open?: boolean) => void;
  toggleOutputMapping: (open?: boolean) => void;
  setReadOnly: (v: boolean) => void;
  setSampleData: (data: Record<string, unknown>) => void;
  setValidationIssues: (issues: ValidationIssue[]) => void;
  setIsValidating: (v: boolean) => void;
  setCompiledSql: (sql: string, compiledAt?: string) => void;
  setEngineConnected: (connected: boolean, engineId?: string) => void;
  loadWorkflow: (def: WorkflowDefinition) => void;
  newWorkflow: () => void;
  setWorkflowMeta: (meta: Partial<WorkflowMeta>) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  // Clipboard
  copySelected: () => void;
  pasteClipboard: (offset?: { x: number; y: number }) => void;
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState>()(
  immer((set, get) => ({
    // ── Initial data ─────────────────────────────────────────────────────────
    workflowId: crypto.randomUUID(),
    version: 1,
    workflowMeta: { ...DEFAULT_META },
    nodes: [],
    edges: [],
    status: 'draft',
    isDirty: false,

    history: [],
    historyIndex: -1,

    clipboard: null,

    selectedNodeId: null,
    selectedNodeIds: [],
    inspectorOpen: false,
    paletteOpen: true,
    sqlPreviewOpen: false,
    templateGalleryOpen: false,
    finderOpen: false,
    sampleDataEditorOpen: false,
    outputMappingOpen: false,

    readOnly: false,
    sampleData: {},

    validationIssues: [],
    isValidating: false,

    compiledSql: null,
    compiledAt: null,

    engineConnected: false,
    activeEngineId: 'default',

    // ── Node / edge mutations ─────────────────────────────────────────────────

    setNodes: (nodes) =>
      set((s) => {
        s.nodes = nodes as typeof s.nodes;
        s.isDirty = true;
      }),

    setEdges: (edges) =>
      set((s) => {
        s.edges = edges as typeof s.edges;
        s.isDirty = true;
      }),

    addNode: (node) =>
      set((s) => {
        get().pushHistory();
        s.nodes.push(node as typeof s.nodes[0]);
        s.isDirty = true;
      }),

    removeNode: (id) =>
      set((s) => {
        get().pushHistory();
        s.nodes = s.nodes.filter((n) => n.id !== id);
        s.edges = s.edges.filter((e) => e.source !== id && e.target !== id);
        if (s.selectedNodeId === id) s.selectedNodeId = null;
        s.isDirty = true;
      }),

    updateNodeData: (id, data) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === id);
        if (node) {
          Object.assign(node.data, data);
          s.isDirty = true;
        }
      }),

    addEdge: (edge) =>
      set((s) => {
        // Prevent duplicate edges between the same source handle and target handle
        const dup = s.edges.find(
          (e) =>
            e.source === edge.source &&
            e.target === edge.target &&
            e.sourceHandle === edge.sourceHandle &&
            e.targetHandle === edge.targetHandle,
        );
        if (!dup) {
          s.edges.push(edge as typeof s.edges[0]);
          s.isDirty = true;
        }
      }),

    removeEdge: (id) =>
      set((s) => {
        s.edges = s.edges.filter((e) => e.id !== id);
        s.isDirty = true;
      }),

    // ── Selection ─────────────────────────────────────────────────────────────

    selectNode: (id) =>
      set((s) => {
        s.selectedNodeId = id;
        if (id) {
          if (!s.selectedNodeIds.includes(id)) s.selectedNodeIds = [id];
        } else {
          s.selectedNodeIds = [];
        }
      }),

    setSelectedNodeIds: (ids) =>
      set((s) => {
        s.selectedNodeIds = ids;
        s.selectedNodeId = ids[0] ?? null;
      }),

    // ── UI toggles ────────────────────────────────────────────────────────────

    toggleInspector: (open) =>
      set((s) => {
        s.inspectorOpen = open !== undefined ? open : !s.inspectorOpen;
      }),

    togglePalette: (open) =>
      set((s) => {
        s.paletteOpen = open !== undefined ? open : !s.paletteOpen;
      }),

    toggleSqlPreview: (open) =>
      set((s) => {
        s.sqlPreviewOpen = open !== undefined ? open : !s.sqlPreviewOpen;
      }),

    toggleTemplateGallery: (open) =>
      set((s) => {
        s.templateGalleryOpen = open !== undefined ? open : !s.templateGalleryOpen;
      }),

    toggleFinder: (open) =>
      set((s) => {
        s.finderOpen = open !== undefined ? open : !s.finderOpen;
      }),

    toggleSampleDataEditor: (open) =>
      set((s) => {
        s.sampleDataEditorOpen = open !== undefined ? open : !s.sampleDataEditorOpen;
      }),

    toggleOutputMapping: (open) =>
      set((s) => {
        s.outputMappingOpen = open !== undefined ? open : !s.outputMappingOpen;
      }),

    setReadOnly: (v) =>
      set((s) => {
        s.readOnly = v;
      }),

    setSampleData: (data) =>
      set((s) => {
        s.sampleData = data as typeof s.sampleData;
        s.isDirty = true;
      }),

    // ── Validation ────────────────────────────────────────────────────────────

    setValidationIssues: (issues) =>
      set((s) => {
        s.validationIssues = issues as typeof s.validationIssues;
      }),

    setIsValidating: (v) =>
      set((s) => {
        s.isValidating = v;
      }),

    // ── Compilation ───────────────────────────────────────────────────────────

    setCompiledSql: (sql, compiledAt) =>
      set((s) => {
        s.compiledSql = sql;
        s.compiledAt = compiledAt ?? new Date().toISOString();
        s.status = 'compiled';
      }),

    // ── Engine ────────────────────────────────────────────────────────────────

    setEngineConnected: (connected, engineId) =>
      set((s) => {
        s.engineConnected = connected;
        if (engineId) s.activeEngineId = engineId;
      }),

    // ── Workflow lifecycle ────────────────────────────────────────────────────

    loadWorkflow: (def) =>
      set((s) => {
        s.workflowId = def.id;
        s.version = def.version;
        s.workflowMeta = def.meta as typeof s.workflowMeta;
        s.nodes = def.nodes as typeof s.nodes;
        s.edges = def.edges as typeof s.edges;
        s.status = 'draft';
        s.isDirty = false;
        s.history = [];
        s.historyIndex = -1;
        s.selectedNodeId = null;
        s.selectedNodeIds = [];
        s.clipboard = null;
        s.inspectorOpen = false;
        s.finderOpen = false;
        s.compiledSql = null;
        s.compiledAt = null;
        s.validationIssues = [];
        s.sampleData = {};
      }),

    newWorkflow: () =>
      set((s) => {
        s.workflowId = crypto.randomUUID();
        s.version = 1;
        s.workflowMeta = { ...DEFAULT_META };
        s.nodes = [];
        s.edges = [];
        s.status = 'draft';
        s.isDirty = false;
        s.history = [];
        s.historyIndex = -1;
        s.selectedNodeId = null;
        s.selectedNodeIds = [];
        s.clipboard = null;
        s.inspectorOpen = false;
        s.finderOpen = false;
        s.compiledSql = null;
        s.compiledAt = null;
        s.validationIssues = [];
        s.sampleData = {};
      }),

    setWorkflowMeta: (meta) =>
      set((s) => {
        Object.assign(s.workflowMeta, meta);
        s.isDirty = true;
      }),

    // ── History ───────────────────────────────────────────────────────────────

    pushHistory: () => {
      const { nodes, edges, history, historyIndex } = get();
      const snapshot: WorkflowSnapshot = {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      };
      set((s) => {
        // Trim any redo entries beyond current index
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(snapshot);
        // Cap at 50 snapshots
        if (newHistory.length > 50) newHistory.shift();
        s.history = newHistory;
        s.historyIndex = newHistory.length - 1;
      });
    },

    undo: () => {
      const { historyIndex, history } = get();
      if (historyIndex <= 0) return;
      const prev = history[historyIndex - 1];
      if (!prev) return;
      set((s) => {
        s.nodes = prev.nodes as typeof s.nodes;
        s.edges = prev.edges as typeof s.edges;
        s.historyIndex = historyIndex - 1;
        s.isDirty = true;
      });
    },

    redo: () => {
      const { historyIndex, history } = get();
      if (historyIndex >= history.length - 1) return;
      const next = history[historyIndex + 1];
      if (!next) return;
      set((s) => {
        s.nodes = next.nodes as typeof s.nodes;
        s.edges = next.edges as typeof s.edges;
        s.historyIndex = historyIndex + 1;
        s.isDirty = true;
      });
    },

    // ── Clipboard (FR-12) ─────────────────────────────────────────────────────

    copySelected: () => {
      const { nodes, edges, selectedNodeIds } = get();
      if (selectedNodeIds.length === 0) return;
      const copiedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
      const copiedEdges = edges.filter(
        (e) => selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target),
      );
      set((s) => {
        s.clipboard = {
          nodes: JSON.parse(JSON.stringify(copiedNodes)) as typeof copiedNodes,
          edges: JSON.parse(JSON.stringify(copiedEdges)) as typeof copiedEdges,
        };
      });
    },

    pasteClipboard: (offset = { x: 40, y: 40 }) => {
      const { clipboard } = get();
      if (!clipboard || clipboard.nodes.length === 0) return;

      // Remap IDs so pasted nodes don't conflict
      const idMap = new Map<string, string>();
      const pastedNodes: WorkflowNode[] = clipboard.nodes.map((n) => {
        const newId = crypto.randomUUID();
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
        };
      });
      const pastedEdges: WorkflowEdge[] = clipboard.edges.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      }));

      get().pushHistory();
      set((s) => {
        s.nodes.push(...(pastedNodes as typeof s.nodes));
        s.edges.push(...(pastedEdges as typeof s.edges));
        s.selectedNodeIds = pastedNodes.map((n) => n.id);
        s.selectedNodeId = pastedNodes[0]?.id ?? null;
        s.isDirty = true;
      });
    },
  })),
);
