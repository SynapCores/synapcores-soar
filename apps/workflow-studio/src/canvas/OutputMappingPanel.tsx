'use client';

// OutputMappingPanel — FR-38 output mapping UI.
// Shows edge connections with source→target data type info.
// Allows users to set explicit column-to-field mappings for ROWSET→ANY edges.

import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';
import type { DataType } from '@synapcores/workflow-types';

const DATA_TYPE_COLOR: Record<DataType | string, string> = {
  TEXT:    'text-green-400 bg-green-900/30 border-green-800',
  INT:     'text-blue-400 bg-blue-900/30 border-blue-800',
  FLOAT:   'text-blue-400 bg-blue-900/30 border-blue-800',
  VECTOR:  'text-purple-400 bg-purple-900/30 border-purple-800',
  JSON:    'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  ROWSET:  'text-cyan-400 bg-cyan-900/30 border-cyan-800',
  BOOLEAN: 'text-orange-400 bg-orange-900/30 border-orange-800',
  ANY:     'text-slate-400 bg-slate-800 border-slate-700',
};

interface EdgeMapping {
  edgeId: string;
  sourceLabel: string;
  targetLabel: string;
  dataType: DataType | string;
  columnMap: Array<{ from: string; to: string }>;
}

export function OutputMappingPanel() {
  const { outputMappingOpen, toggleOutputMapping, nodes, edges, setEdges } =
    useWorkflowStore(useShallow((s) => ({
      outputMappingOpen: s.outputMappingOpen,
      toggleOutputMapping: s.toggleOutputMapping,
      nodes: s.nodes,
      edges: s.edges,
      setEdges: s.setEdges,
    })));

  // Build edge mapping view
  const edgeMappings: EdgeMapping[] = edges.map((e) => {
    const srcNode = nodes.find((n) => n.id === e.source);
    const tgtNode = nodes.find((n) => n.id === e.target);
    return {
      edgeId: e.id,
      sourceLabel: srcNode?.data.label ?? e.source.slice(0, 8),
      targetLabel: tgtNode?.data.label ?? e.target.slice(0, 8),
      dataType: e.dataType ?? 'ANY',
      columnMap: (() => {
        try {
          return (JSON.parse(e.label ?? '[]') as Array<{ from: string; to: string }>);
        } catch {
          return [];
        }
      })(),
    };
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [fromCol, setFromCol] = useState('');
  const [toField, setToField] = useState('');

  const selectedMapping = edgeMappings.find((m) => m.edgeId === selected);

  function addMapping() {
    if (!selected || !fromCol.trim() || !toField.trim()) return;
    const edge = edges.find((e) => e.id === selected);
    if (!edge) return;

    const existing = (() => {
      try {
        return JSON.parse(edge.label ?? '[]') as Array<{ from: string; to: string }>;
      } catch {
        return [];
      }
    })();

    const updated = [...existing, { from: fromCol.trim(), to: toField.trim() }];
    setEdges(edges.map((e) => e.id === selected ? { ...e, label: JSON.stringify(updated) } : e));
    setFromCol('');
    setToField('');
  }

  function removeMapping(edgeId: string, idx: number) {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const existing = (() => {
      try {
        return JSON.parse(edge.label ?? '[]') as Array<{ from: string; to: string }>;
      } catch {
        return [];
      }
    })();
    const updated = existing.filter((_, i) => i !== idx);
    setEdges(edges.map((e) => e.id === edgeId ? { ...e, label: JSON.stringify(updated) } : e));
  }

  if (!outputMappingOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleOutputMapping(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Output mapping"
    >
      <div className="w-full max-w-2xl mx-4 bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Output Mapping</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Map output columns from one node to input fields of the next
            </p>
          </div>
          <button
            onClick={() => toggleOutputMapping(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Edge list */}
          <div className="w-56 border-r border-slate-800 overflow-y-auto flex-shrink-0">
            {edges.length === 0 ? (
              <div className="px-4 py-8 text-xs text-slate-600 text-center">
                No edges on canvas
              </div>
            ) : (
              edgeMappings.map((m) => (
                <button
                  key={m.edgeId}
                  onClick={() => setSelected(m.edgeId)}
                  className={cn(
                    'w-full px-3 py-2.5 text-left text-xs transition-colors border-b border-slate-800',
                    selected === m.edgeId ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-800/50',
                  )}
                >
                  <div className="flex items-center gap-1 font-medium truncate">
                    <span className="truncate max-w-[60px]">{m.sourceLabel}</span>
                    <ArrowRight className="h-3 w-3 flex-shrink-0 text-slate-600" />
                    <span className="truncate max-w-[60px]">{m.targetLabel}</span>
                  </div>
                  <span
                    className={cn(
                      'mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded border font-mono',
                      DATA_TYPE_COLOR[m.dataType] ?? DATA_TYPE_COLOR.ANY,
                    )}
                  >
                    {m.dataType}
                  </span>
                  {m.columnMap.length > 0 && (
                    <span className="ml-1 text-[9px] text-blue-400">{m.columnMap.length} mapped</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Mapping editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!selected ? (
              <div className="text-xs text-slate-600 text-center py-12">
                Select an edge to configure its column mappings
              </div>
            ) : selectedMapping ? (
              <>
                <div className="text-xs text-slate-500">
                  <span className="text-slate-300">{selectedMapping.sourceLabel}</span>
                  {' '}<ArrowRight className="inline h-3 w-3" />{' '}
                  <span className="text-slate-300">{selectedMapping.targetLabel}</span>
                  <span
                    className={cn(
                      'ml-2 px-1.5 py-0.5 rounded border font-mono text-[9px]',
                      DATA_TYPE_COLOR[selectedMapping.dataType] ?? DATA_TYPE_COLOR.ANY,
                    )}
                  >
                    {selectedMapping.dataType}
                  </span>
                </div>

                {/* Existing mappings */}
                {selectedMapping.columnMap.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedMapping.columnMap.map((cm, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs bg-slate-800 rounded px-3 py-1.5">
                        <code className="text-green-400 flex-1">{cm.from}</code>
                        <ArrowRight className="h-3 w-3 text-slate-600 flex-shrink-0" />
                        <code className="text-blue-400 flex-1">{cm.to}</code>
                        <button
                          onClick={() => removeMapping(selected, idx)}
                          className="text-slate-600 hover:text-red-400 transition-colors"
                          aria-label="Remove mapping"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new mapping */}
                <div className="flex items-center gap-2">
                  <input
                    value={fromCol}
                    onChange={(e) => setFromCol(e.target.value)}
                    placeholder="source column"
                    className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                    aria-label="Source column"
                  />
                  <ArrowRight className="h-3.5 w-3.5 text-slate-600 flex-shrink-0" />
                  <input
                    value={toField}
                    onChange={(e) => setToField(e.target.value)}
                    placeholder="target field / variable"
                    className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                    aria-label="Target field"
                    onKeyDown={(e) => e.key === 'Enter' && addMapping()}
                  />
                  <button
                    onClick={addMapping}
                    disabled={!fromCol.trim() || !toField.trim()}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                </div>

                <p className="text-[10px] text-slate-600">
                  Mappings are stored as edge labels and used during test mode to resolve variable references.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
