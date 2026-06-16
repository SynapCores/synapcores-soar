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

  // ── UI state ───────────────────────────────────────────────────────────────
  selectedNodeId: string | null;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  sqlPreviewOpen: boolean;
  templateGalleryOpen: boolean;

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
  toggleInspector: (open?: boolean) => void;
  togglePalette: (open?: boolean) => void;
  toggleSqlPreview: (open?: boolean) => void;
  toggleTemplateGallery: (open?: boolean) => void;
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

    selectedNodeId: null,
    inspectorOpen: false,
    paletteOpen: true,
    sqlPreviewOpen: false,
    templateGalleryOpen: false,

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
        s.inspectorOpen = false;
        s.compiledSql = null;
        s.compiledAt = null;
        s.validationIssues = [];
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
        s.inspectorOpen = false;
        s.compiledSql = null;
        s.compiledAt = null;
        s.validationIssues = [];
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
  })),
);
