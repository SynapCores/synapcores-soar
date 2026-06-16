'use client';

import { Handle, Position } from '@xyflow/react';
import { cn } from '@synapcores/app-framework/ui';

export interface BaseNodeHandleSpec {
  id: string;
  label?: string;
}

export interface BaseNodeProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: string;
  selected?: boolean;
  children?: React.ReactNode;
  inputs?: BaseNodeHandleSpec[];
  outputs?: BaseNodeHandleSpec[];
}

export function BaseNodeWrapper({
  title,
  subtitle,
  icon,
  color = 'border-slate-600',
  selected,
  children,
  inputs = [{ id: 'input', label: '' }],
  outputs = [{ id: 'output', label: '' }],
}: BaseNodeProps) {
  // Derive a lighter bg from the border color token for the header
  const headerBg = color
    .replace('border-', 'bg-')
    .replace('/40', '/10')
    .replace('/50', '/10');

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-slate-900 shadow-lg min-w-[200px] max-w-[280px] transition-all',
        color,
        selected && 'ring-2 ring-white/30 ring-offset-1 ring-offset-slate-950',
      )}
    >
      {/* Input handles */}
      {inputs.map((inp, i) => (
        <Handle
          key={inp.id}
          id={inp.id}
          type="target"
          position={Position.Left}
          style={{
            top:
              inputs.length === 1
                ? '50%'
                : `${((i + 1) * 100) / (inputs.length + 1)}%`,
          }}
          className="!w-3 !h-3 !bg-slate-600 !border-slate-400"
          title={inp.label}
        />
      ))}

      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-t-md border-b border-slate-700',
          headerBg,
        )}
      >
        {icon && (
          <span className="shrink-0 text-current opacity-80">{icon}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-100 truncate">
            {title}
          </div>
          {subtitle && (
            <div className="text-[10px] text-slate-400 truncate">{subtitle}</div>
          )}
        </div>
      </div>

      {/* Body */}
      {children && (
        <div className="px-3 py-2 text-xs text-slate-400 space-y-1">
          {children}
        </div>
      )}

      {/* Output handles */}
      {outputs.map((out, i) => (
        <Handle
          key={out.id}
          id={out.id}
          type="source"
          position={Position.Right}
          style={{
            top:
              outputs.length === 1
                ? '50%'
                : `${((i + 1) * 100) / (outputs.length + 1)}%`,
          }}
          className="!w-3 !h-3 !bg-blue-500 !border-blue-400"
          title={out.label}
        />
      ))}
    </div>
  );
}
