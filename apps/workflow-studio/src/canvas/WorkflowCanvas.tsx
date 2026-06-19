'use client';

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge as rfAddEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '@/store/workflow-store';
import { NODE_TYPES } from '@/nodes';
import { NodePalette } from './NodePalette';
import { NodeInspector } from './NodeInspector';
import { ValidationPanel } from './ValidationPanel';
import { SqlPreviewPane } from './SqlPreviewPane';
import { TemplateGallery } from './TemplateGallery';
import { ToolBar } from './ToolBar';
import { NodeFinder } from './NodeFinder';
import { SampleDataEditor } from './SampleDataEditor';
import { OutputMappingPanel } from './OutputMappingPanel';
import { BuildWithAiModal } from './BuildWithAiModal';
import { useAutosave } from '@/lib/autosave';
import type { WorkflowNode, WorkflowEdge, DataType } from '@synapcores/workflow-types';
import { NODE_CATEGORIES } from '@synapcores/workflow-types';

// ── Typed edge port definitions ────────────────────────────────────────────────
// Maps node type → { output: DataType[], input: DataType[] }
// ANY means "accepts any type"

const NODE_PORT_TYPES: Record<string, { output: DataType; input: DataType }> = {
  RowEventTrigger: { output: 'ROWSET', input: 'ANY' },
  MemoryStore:     { output: 'TEXT',   input: 'ANY' },
  MemoryRecall:    { output: 'ROWSET', input: 'TEXT' },
  AgentRun:        { output: 'TEXT',   input: 'ANY' },
  SqlQuery:        { output: 'ROWSET', input: 'ANY' },
  HttpRequest:     { output: 'JSON',   input: 'ANY' },
  If:              { output: 'ANY',    input: 'ANY' },
  Switch:          { output: 'ANY',    input: 'ANY' },
  Loop:            { output: 'ANY',    input: 'ANY' },
  Approval:        { output: 'ANY',    input: 'ANY' },
  SetVariable:     { output: 'ANY',    input: 'ANY' },
  Return:          { output: 'ANY',    input: 'ANY' },
};

function isTypedEdgeCompatible(
  sourceNodeType: string,
  targetNodeType: string,
): boolean {
  const src = NODE_PORT_TYPES[sourceNodeType];
  const tgt = NODE_PORT_TYPES[targetNodeType];
  if (!src || !tgt) return true; // unknown — allow
  if (src.output === 'ANY' || tgt.input === 'ANY') return true;
  return src.output === tgt.input;
}

// ── WorkflowCanvas ─────────────────────────────────────────────────────────────

export function WorkflowCanvas() {
  // Wire autosave
  useAutosave();

  // Individual primitive selectors only. Returning an object via useShallow
  // trips React 19's "getSnapshot should be cached" guard (memoization isn't
  // stable across the SSR/hydration boundary), which produces an infinite
  // render loop and leaves the page stuck on the loading fallback.
  const storeNodes = useWorkflowStore((s) => s.nodes);
  const storeEdges = useWorkflowStore((s) => s.edges);
  const nodes = storeNodes;
  const edges = storeEdges;
  const storeSetNodes = useWorkflowStore((s) => s.setNodes);
  const storeSetEdges = useWorkflowStore((s) => s.setEdges);
  const addNode = useWorkflowStore((s) => s.addNode);
  const storeAddEdge = useWorkflowStore((s) => s.addEdge);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const storeRemoveEdge = useWorkflowStore((s) => s.removeEdge);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const setSelectedNodeIds = useWorkflowStore((s) => s.setSelectedNodeIds);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const toggleInspector = useWorkflowStore((s) => s.toggleInspector);
  const paletteOpen = useWorkflowStore((s) => s.paletteOpen);
  const readOnly = useWorkflowStore((s) => s.readOnly);
  const copySelected = useWorkflowStore((s) => s.copySelected);
  const pasteClipboard = useWorkflowStore((s) => s.pasteClipboard);
  const toggleFinder = useWorkflowStore((s) => s.toggleFinder);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const version = useWorkflowStore((s) => s.version);
  const workflowMeta = useWorkflowStore((s) => s.workflowMeta);

  // ── Local React Flow state synced with store ─────────────────────────────

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(storeNodes as Node[]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(storeEdges as Edge[]);

  // Sync store → local when store changes externally (e.g. load workflow, undo/redo)
  useEffect(() => {
    setRfNodes(storeNodes as Node[]);
  }, [storeNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(storeEdges as Edge[]);
  }, [storeEdges, setRfEdges]);

  // ── Push local changes back to store ─────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
    },
    [onEdgesChange],
  );

  // Sync node positions / deletions back to store after React Flow processes them
  const handleNodeDragStop = useCallback(
    (_: MouseEvent | TouchEvent, node: Node) => {
      if (readOnly) return;
      const wfNode = storeNodes.find((n) => n.id === node.id);
      if (wfNode) {
        storeSetNodes(
          storeNodes.map((n) =>
            n.id === node.id ? { ...n, position: node.position } : n,
          ),
        );
      }
    },
    [storeNodes, storeSetNodes, readOnly],
  );

  // ── Connection handling (with typed edge rejection FR-4) ──────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;

      // Typed edge rejection (FR-4)
      const sourceNode = storeNodes.find((n) => n.id === connection.source);
      const targetNode = storeNodes.find((n) => n.id === connection.target);
      if (sourceNode && targetNode) {
        const compatible = isTypedEdgeCompatible(
          sourceNode.data.nodeType,
          targetNode.data.nodeType,
        );
        if (!compatible) {
          // Announce the rejection via console (no blocking alert — keeps UX smooth)
          // The ValidationPanel will surface this after validate is clicked
          console.warn(
            `[edge-reject] ${sourceNode.data.nodeType} → ${targetNode.data.nodeType}: incompatible data types`,
          );
          return; // reject the connection
        }
      }

      // Determine edge data type
      const edgeDataType: DataType =
        (sourceNode ? NODE_PORT_TYPES[sourceNode.data.nodeType]?.output : undefined) ?? 'ANY';

      const newEdge: WorkflowEdge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        dataType: edgeDataType,
        animated: false,
      };
      setRfEdges((eds) => rfAddEdge({ ...newEdge } as Edge, eds));
      storeAddEdge(newEdge);
    },
    [setRfEdges, storeAddEdge, storeNodes, readOnly],
  );

  // ── Node selection ────────────────────────────────────────────────────────

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (readOnly) return;
      selectNode(node.id);
      toggleInspector(true);
    },
    [selectNode, toggleInspector, readOnly],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Selection change → sync selectedNodeIds
  const onSelectionChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) => {
      setSelectedNodeIds(selNodes.map((n) => n.id));
    },
    [setSelectedNodeIds],
  );

  // ── Global keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    const isMac = navigator.platform.includes('Mac');

    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // ⌘S / Ctrl+S — Save (compile + trigger engine save)
      if (modKey && e.key === 's') {
        e.preventDefault();
        // Trigger compile via the toolbar's API call
        const def = {
          id: workflowId,
          version,
          meta: workflowMeta,
          nodes: storeNodes,
          edges: storeEdges,
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        void fetch(`/api/v1/workflows/${workflowId}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(def),
        });
        return;
      }

      // ⌘F / Ctrl+F — Find node
      if (modKey && e.key === 'f') {
        e.preventDefault();
        toggleFinder(true);
        return;
      }

      // ⌘Z / Ctrl+Z — Undo
      if (modKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      // ⌘⇧Z / Ctrl+Y — Redo
      if ((modKey && e.shiftKey && e.key === 'z') || (modKey && e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // ⌘C / Ctrl+C — Copy selected
      if (modKey && e.key === 'c' && !isInput) {
        copySelected();
        return;
      }

      // ⌘V / Ctrl+V — Paste
      if (modKey && e.key === 'v' && !isInput) {
        if (!readOnly) pasteClipboard();
        return;
      }

      // Delete / Backspace — delete selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && !readOnly) {
        if (selectedNodeId) {
          removeNode(selectedNodeId);
          setRfNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedNodeId,
    removeNode,
    setRfNodes,
    toggleFinder,
    copySelected,
    pasteClipboard,
    undo,
    redo,
    readOnly,
    workflowId,
    version,
    workflowMeta,
    storeNodes,
    storeEdges,
  ]);

  // ── Drag-and-drop from palette ────────────────────────────────────────────

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/reactflow');
      if (!raw) return;
      try {
        const { nodeType } = JSON.parse(raw) as { nodeType: string };
        const bounds = event.currentTarget.getBoundingClientRect();
        const position = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };

        // Build sensible defaults for the node type
        const catEntry = NODE_CATEGORIES.find((c) => c.nodeType === nodeType);
        const newNode: WorkflowNode = {
          id: crypto.randomUUID(),
          type: nodeType,
          position,
          data: {
            nodeType: nodeType as WorkflowNode['data']['nodeType'],
            label: catEntry?.label ?? nodeType,
            disabled: false,
          } as WorkflowNode['data'],
        };
        addNode(newNode);
        setRfNodes((ns) => [...ns, newNode as Node]);
      } catch {
        // malformed drag data — ignore
      }
    },
    [addNode, setRfNodes, readOnly],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = readOnly ? 'none' : 'move';
  }, [readOnly]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
      {/* Vivid floating orbs — mirrors the gateway WelcomeSplash atmosphere. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-10 left-10 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl animate-pulse" />
        <div className="absolute top-32 right-24 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute bottom-20 left-1/3 h-48 w-48 rounded-full bg-indigo-500/25 blur-3xl animate-pulse [animation-delay:2s]" />
        <div className="absolute bottom-32 right-16 h-44 w-44 rounded-full bg-sky-400/20 blur-3xl animate-pulse [animation-delay:500ms]" />
        <div className="absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/15 blur-3xl animate-pulse [animation-delay:1500ms]" />
      </div>
      {/* Dot-grid overlay — same as gateway hero. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.18) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Toolbar at very top */}
      <div className="absolute top-0 left-0 right-0 z-30">
        <ToolBar />
      </div>

      {/* React Flow canvas — fill below toolbar */}
      <div className="absolute top-[44px] left-0 right-0 bottom-0">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={onPaneClick}
          onSelectionChange={onSelectionChange}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={NODE_TYPES}
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          defaultEdgeOptions={{
            style: { stroke: '#94a3b8', strokeWidth: 1.5 },
            markerEnd: { type: 'arrowclosed' as const, color: '#94a3b8' },
          }}
          style={{ background: 'transparent' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(255,255,255,0.06)"
          />
          <Controls
            className="!bottom-16 !left-[264px]"
            showInteractive={false}
          />
          <MiniMap
            className="!bottom-16 !right-2 !bg-slate-900 !border-slate-700"
            nodeColor="#1e40af"
            maskColor="rgba(2,6,23,0.7)"
          />
        </ReactFlow>
      </div>

      {/* Read-only banner */}
      {readOnly && (
        <div className="absolute top-[44px] left-0 right-0 z-40 bg-amber-900/80 border-b border-amber-700/60 px-4 py-1 text-center text-xs text-amber-300 font-medium">
          Read-only mode — viewing workflow as auditor/compliance role
        </div>
      )}

      {/* Node palette overlay — left side */}
      <div className="absolute top-[44px] left-0 bottom-0 z-20 pointer-events-none">
        <div className="pointer-events-auto h-full">
          <NodePalette />
        </div>
      </div>

      {/* Node inspector overlay — right side */}
      <div className="absolute top-[44px] right-0 bottom-0 z-25 pointer-events-none">
        <div className="pointer-events-auto h-full">
          <NodeInspector />
        </div>
      </div>

      {/* SQL preview pane — right side (above inspector) */}
      <div className="absolute top-[44px] right-0 bottom-0 z-30 pointer-events-none">
        <div className="pointer-events-auto h-full">
          <SqlPreviewPane />
        </div>
      </div>

      {/* Validation panel — bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
        <div className="pointer-events-auto">
          <ValidationPanel />
        </div>
      </div>

      {/* Template gallery modal */}
      <TemplateGallery />

      {/* Node finder modal (⌘F) */}
      <NodeFinder />

      {/* Sample data editor modal (FR-37) */}
      <SampleDataEditor />

      {/* Output mapping panel (FR-38) */}
      <OutputMappingPanel />

      {/* Build-with-AI wizard modal */}
      <BuildWithAiModal />
    </div>
  );
}
