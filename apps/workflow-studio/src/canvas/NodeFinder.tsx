'use client';

// NodeFinder — FR-14 search-in-canvas modal (⌘F / Ctrl+F)
// Shows a fuzzy-filtered list of nodes by label/type.
// Clicking a result selects + highlights that node.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { NODE_CATEGORIES } from '@synapcores/workflow-types';
import type { WorkflowNode } from '@synapcores/workflow-types';

function getNodeIcon(nodeType: string): string {
  return NODE_CATEGORIES.find((c) => c.nodeType === nodeType)?.icon ?? 'Box';
}

function getNodeColor(nodeType: string): string {
  return NODE_CATEGORIES.find((c) => c.nodeType === nodeType)?.color ?? 'bg-slate-500/20 border-slate-500/40';
}

function matchesQuery(node: WorkflowNode, q: string): boolean {
  const query = q.toLowerCase().trim();
  if (!query) return true;
  const label = node.data.label.toLowerCase();
  const type = node.data.nodeType.toLowerCase();
  return label.includes(query) || type.includes(query);
}

export function NodeFinder() {
  const finderOpen = useWorkflowStore((s) => s.finderOpen);
  const toggleFinder = useWorkflowStore((s) => s.toggleFinder);
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const toggleInspector = useWorkflowStore((s) => s.toggleInspector);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = nodes.filter((n) => matchesQuery(n, query));

  // Reset on open
  useEffect(() => {
    if (finderOpen) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [finderOpen]);

  // Keep active index in bounds
  useEffect(() => {
    setActiveIdx((idx) => Math.min(idx, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const handleSelect = useCallback(
    (node: WorkflowNode) => {
      selectNode(node.id);
      toggleInspector(true);
      toggleFinder(false);
    },
    [selectNode, toggleInspector, toggleFinder],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleFinder(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const node = filtered[activeIdx];
        if (node) handleSelect(node);
      }
    },
    [toggleFinder, filtered, activeIdx, handleSelect],
  );

  if (!finderOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleFinder(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Find node"
    >
      <div className="w-full max-w-md mx-4 bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60">
          <Search className="h-4 w-4 text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes by label or type..."
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
            aria-label="Search nodes"
          />
          <button
            onClick={() => toggleFinder(false)}
            className="text-slate-600 hover:text-slate-400 transition-colors"
            aria-label="Close finder"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto" role="listbox" aria-label="Node search results">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-600">
              {query ? 'No nodes match your search' : 'No nodes on canvas'}
            </div>
          ) : (
            filtered.map((node, idx) => (
              <button
                key={node.id}
                role="option"
                aria-selected={idx === activeIdx}
                onClick={() => handleSelect(node)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  idx === activeIdx ? 'bg-slate-800' : 'hover:bg-slate-800/60',
                )}
              >
                <span
                  className={cn(
                    'flex-shrink-0 w-2 h-2 rounded-full',
                    getNodeColor(node.data.nodeType).includes('yellow') ? 'bg-yellow-500' :
                    getNodeColor(node.data.nodeType).includes('blue') ? 'bg-blue-500' :
                    getNodeColor(node.data.nodeType).includes('purple') ? 'bg-purple-500' :
                    getNodeColor(node.data.nodeType).includes('green') ? 'bg-green-500' :
                    getNodeColor(node.data.nodeType).includes('orange') ? 'bg-orange-500' :
                    getNodeColor(node.data.nodeType).includes('red') ? 'bg-red-500' :
                    'bg-slate-500',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{node.data.label}</div>
                  <div className="text-[10px] text-slate-500">{node.data.nodeType}</div>
                </div>
                {node.data.disabled && (
                  <span className="text-[10px] text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded">
                    disabled
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-600">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">Enter</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          <span className="ml-auto">{filtered.length} of {nodes.length} nodes</span>
        </div>
      </div>
    </div>
  );
}
