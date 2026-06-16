'use client';

import { type NodeProps } from '@xyflow/react';
import { Variable } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { SetVariableData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: SetVariableData };

export function SetVariableNode({ data, selected }: Props) {
  const assignments = data.assignments ?? [];

  return (
    <BaseNodeWrapper
      title="Set Variable"
      subtitle={
        assignments.length === 0
          ? 'No assignments'
          : `${assignments.length} assignment${assignments.length !== 1 ? 's' : ''}`
      }
      icon={<Variable className="h-3 w-3 text-slate-400" />}
      color="border-slate-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'In' }]}
      outputs={[{ id: 'output', label: 'Out' }]}
    >
      {assignments.slice(0, 4).map((a, i) => (
        <div key={i} className="font-mono text-[10px] text-slate-300 truncate">
          <span className="text-blue-300">{a.variable}</span>
          <span className="text-slate-500"> = </span>
          <span className="text-slate-300">{a.expression}</span>
        </div>
      ))}
      {assignments.length > 4 && (
        <div className="text-[10px] text-slate-500">
          +{assignments.length - 4} more
        </div>
      )}
    </BaseNodeWrapper>
  );
}
