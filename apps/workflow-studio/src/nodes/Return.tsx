'use client';

import { type NodeProps } from '@xyflow/react';
import { LogOut } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { ReturnData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: ReturnData };

export function ReturnNode({ data, selected }: Props) {
  const exprPreview = data.expression
    ? data.expression.slice(0, 60) + (data.expression.length > 60 ? '…' : '')
    : 'NULL';

  return (
    <BaseNodeWrapper
      title="Return"
      subtitle={`type: ${data.returnType ?? 'ANY'}`}
      icon={<LogOut className="h-3 w-3 text-slate-400" />}
      color="border-slate-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'In' }]}
      outputs={[]}
    >
      <div className="font-mono text-[10px] text-slate-300 line-clamp-2">
        RETURN {exprPreview}
      </div>
    </BaseNodeWrapper>
  );
}
