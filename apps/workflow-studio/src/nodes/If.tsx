'use client';

import { type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { IfData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: IfData };

export function IfNode({ data, selected }: Props) {
  const condPreview = data.condition
    ? data.condition.slice(0, 60) + (data.condition.length > 60 ? '…' : '')
    : 'No condition set';

  return (
    <BaseNodeWrapper
      title="If / Else"
      subtitle={data.condition ? condPreview : 'No condition'}
      icon={<GitBranch className="h-3 w-3 text-orange-400" />}
      color="border-orange-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'In' }]}
      outputs={[
        { id: 'true', label: 'True' },
        { id: 'false', label: 'False' },
      ]}
    >
      <div className="font-mono text-[10px] text-orange-300 leading-relaxed line-clamp-2">
        {condPreview}
      </div>
      <div className="flex justify-between text-[9px] text-slate-500 pt-1">
        <span className="text-green-400">✓ true</span>
        <span className="text-red-400">✗ false</span>
      </div>
    </BaseNodeWrapper>
  );
}
