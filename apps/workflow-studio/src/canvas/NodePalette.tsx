'use client';

import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightSm,
  Search,
  Zap,
  Database,
  Search as SearchIcon,
  Bot,
  Table2,
  Globe,
  GitBranch,
  ListTree,
  RefreshCcw,
  CheckCircle,
  Variable,
  LogOut,
} from 'lucide-react';
import { NODE_CATEGORIES } from '@synapcores/workflow-types';
import type { NodeCategoryEntry } from '@synapcores/workflow-types';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';

// ── Icon map ───────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-3.5 w-3.5" />,
  Database: <Database className="h-3.5 w-3.5" />,
  Search: <SearchIcon className="h-3.5 w-3.5" />,
  Bot: <Bot className="h-3.5 w-3.5" />,
  Table2: <Table2 className="h-3.5 w-3.5" />,
  Globe: <Globe className="h-3.5 w-3.5" />,
  GitBranch: <GitBranch className="h-3.5 w-3.5" />,
  ListTree: <ListTree className="h-3.5 w-3.5" />,
  RefreshCcw: <RefreshCcw className="h-3.5 w-3.5" />,
  CheckCircle: <CheckCircle className="h-3.5 w-3.5" />,
  Variable: <Variable className="h-3.5 w-3.5" />,
  LogOut: <LogOut className="h-3.5 w-3.5" />,
};

// ── Category color accent ──────────────────────────────────────────────────────

const CATEGORY_ACCENT: Record<string, string> = {
  Triggers: 'text-yellow-400',
  Memory: 'text-blue-400',
  Agents: 'text-purple-400',
  Actions: 'text-green-400',
  'Control Flow': 'text-orange-400',
  'I/O': 'text-slate-400',
};

// ── Single draggable node entry ────────────────────────────────────────────────

function PaletteEntry({ entry }: { entry: NodeCategoryEntry }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({ nodeType: entry.nodeType }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'flex items-start gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing',
        'border border-transparent hover:border-slate-600 hover:bg-slate-800/60',
        'transition-colors select-none',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          CATEGORY_ACCENT[entry.category] ?? 'text-slate-400',
        )}
      >
        {ICON_MAP[entry.icon] ?? <Zap className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-200 leading-tight truncate">
          {entry.label}
        </div>
        <div className="text-[10px] text-slate-500 leading-snug line-clamp-2">
          {entry.description}
        </div>
      </div>
    </div>
  );
}

// ── Collapsible category section ───────────────────────────────────────────────

function CategorySection({
  category,
  entries,
}: {
  category: string;
  entries: NodeCategoryEntry[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-400 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRightSm className="h-3 w-3" />
        )}
        {category}
      </button>
      {open && (
        <div className="space-y-0.5 px-1">
          {entries.map((e) => (
            <PaletteEntry key={e.nodeType} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main palette ───────────────────────────────────────────────────────────────

export function NodePalette() {
  const { paletteOpen, togglePalette } = useWorkflowStore(useShallow((s) => ({
    paletteOpen: s.paletteOpen,
    togglePalette: s.togglePalette,
  })));

  const [search, setSearch] = useState('');

  // Group + filter entries
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? NODE_CATEGORIES.filter(
          (e) =>
            e.label.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.nodeType.toLowerCase().includes(q),
        )
      : NODE_CATEGORIES;

    const map = new Map<string, NodeCategoryEntry[]>();
    for (const entry of filtered) {
      if (!map.has(entry.category)) map.set(entry.category, []);
      map.get(entry.category)!.push(entry);
    }
    return map;
  }, [search]);

  if (!paletteOpen) {
    return (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 z-20">
        <button
          onClick={() => togglePalette(true)}
          className="flex items-center justify-center w-6 h-12 bg-slate-800 border border-slate-700 rounded-r-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors shadow-lg"
          title="Open node palette"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute left-0 top-0 bottom-0 z-20 flex flex-col w-60 bg-slate-900 border-r border-slate-700/60 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-slate-700/60">
        <span className="text-xs font-semibold text-slate-300">Nodes</span>
        <button
          onClick={() => togglePalette(false)}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Collapse palette"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Grouped node list */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-1">
        {grouped.size === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-500 text-center">
            No nodes match &ldquo;{search}&rdquo;
          </p>
        ) : (
          Array.from(grouped.entries()).map(([cat, entries]) => (
            <CategorySection key={cat} category={cat} entries={entries} />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-slate-700/60 text-[10px] text-slate-600">
        Drag nodes onto the canvas
      </div>
    </div>
  );
}
