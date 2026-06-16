'use client';

import { type NodeProps } from '@xyflow/react';
import { RefreshCcw } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { LoopData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: LoopData };

export function LoopNode({ data, selected }: Props) {
  const condPreview = data.condition
    ? data.condition.slice(0, 50) + (data.condition.length > 50 ? '…' : '')
    : 'No condition set';

  return (
    <BaseNodeWrapper
      title="Loop"
      subtitle={`max ${data.maxIterations ?? 100} iterations`}
      icon={<RefreshCcw className="h-3 w-3 text-orange-400" />}
      color="border-orange-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'In' }]}
      outputs={[
        { id: 'body', label: 'Loop body' },
        { id: 'done', label: 'After loop' },
      ]}
    >
      <div className="font-mono text-[10px] text-orange-300 line-clamp-2">
        WHILE {condPreview}
      </div>
      <div className="flex justify-between text-[9px] text-slate-500 pt-1">
        <span className="text-orange-400">↺ body</span>
        <span className="text-slate-400">✓ done</span>
      </div>
    </BaseNodeWrapper>
  );
}
