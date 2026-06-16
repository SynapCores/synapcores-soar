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
  Panel,
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
import type { WorkflowNode, WorkflowEdge } from '@synapcores/workflow-types';

// ── WorkflowCanvas ─────────────────────────────────────────────────────────────

export function WorkflowCanvas() {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    setNodes: storeSetNodes,
    setEdges: storeSetEdges,
    addNode,
    addEdge: storeAddEdge,
    removeNode,
    removeEdge,
    selectNode,
    selectedNodeId,
    toggleInspector,
    paletteOpen,
  } = useWorkflowStore((s) => ({
    nodes: s.nodes,
    edges: s.edges,
    setNodes: s.setNodes,
    setEdges: s.setEdges,
    addNode: s.addNode,
    addEdge: s.addEdge,
    removeNode: s.removeNode,
    removeEdge: s.removeEdge,
    selectNode: s.selectNode,
    selectedNodeId: s.selectedNodeId,
    toggleInspector: s.toggleInspector,
    paletteOpen: s.paletteOpen,
  }));

  // ── Local React Flow state synced with store ─────────────────────────────

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges as Edge[]);

  // Sync store → local when store changes externally (e.g. load workflow, undo/redo)
  useEffect(() => {
    setNodes(storeNodes as Node[]);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges as Edge[]);
  }, [storeEdges, setEdges]);

  // ── Push local changes back to store ─────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // After applying changes to local state, sync to store on the next tick
      // We do a controlled sync: just mirror the final state
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
      // Update position in store
      const wfNode = storeNodes.find((n) => n.id === node.id);
      if (wfNode) {
        storeSetNodes(
          storeNodes.map((n) =>
            n.id === node.id ? { ...n, position: node.position } : n,
          ),
        );
      }
    },
    [storeNodes, storeSetNodes],
  );

  // ── Connection handling ───────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const newEdge: WorkflowEdge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        animated: false,
      };
      setEdges((eds) => rfAddEdge({ ...newEdge } as Edge, eds));
      storeAddEdge(newEdge);
    },
    [setEdges, storeAddEdge],
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
      selectNode(node.id);
      toggleInspector(true);
    },
    [selectNode, toggleInspector],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // ── Keyboard: delete selected nodes ──────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only fire if not focused on an input
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (selectedNodeId) {
          removeNode(selectedNodeId);
          setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, removeNode, setNodes]);

  // ── Drag-and-drop from palette ────────────────────────────────────────────

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
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
        const newNode: WorkflowNode = {
          id: crypto.randomUUID(),
          type: nodeType,
          position,
          data: {
            nodeType: nodeType as WorkflowNode['data']['nodeType'],
            label: nodeType,
            disabled: false,
          } as WorkflowNode['data'],
        };
        addNode(newNode);
        setNodes((ns) => [...ns, newNode as Node]);
      } catch {
        // malformed drag data — ignore
      }
    },
    [addNode, setNodes],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // ── Palette offset for React Flow container ───────────────────────────────
  // When palette is open we offset nodes, but React Flow handles its own viewport

  return (
    <div className="relative h-full w-full bg-slate-950">
      {/* Toolbar at very top */}
      <div className="absolute top-0 left-0 right-0 z-30">
        <ToolBar />
      </div>

      {/* React Flow canvas — fill below toolbar */}
      <div className="absolute top-[44px] left-0 right-0 bottom-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={onPaneClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={NODE_TYPES}
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            style: { stroke: '#475569', strokeWidth: 1.5 },
            markerEnd: { type: 'arrowclosed' as const, color: '#475569' },
          }}
          style={{ background: '#020617' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#1e293b"
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
    </div>
  );
}
