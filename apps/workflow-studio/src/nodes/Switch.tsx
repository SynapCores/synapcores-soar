'use client';

import { type NodeProps } from '@xyflow/react';
import { ListTree } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { SwitchData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: SwitchData };

export function SwitchNode({ data, selected }: Props) {
  const outputs = [
    ...data.cases.map(c => ({ id: c.value, label: c.label ?? c.value })),
    ...(data.defaultCase ? [{ id: 'default', label: 'default' }] : []),
  ];

  return (
    <BaseNodeWrapper
      title="Switch"
      subtitle={data.expression || 'No expression set'}
      icon={<ListTree className="h-3 w-3 text-orange-400" />}
      color="border-orange-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Value' }]}
      outputs={outputs.length > 0 ? outputs : [{ id: 'output', label: 'out' }]}
    >
      <div className="font-mono text-[10px] text-orange-300 truncate">
        CASE {data.expression || '…'}
      </div>
      <div className="text-[10px] text-slate-500">
        {data.cases.length} case{data.cases.length !== 1 ? 's' : ''}
        {data.defaultCase ? ' + default' : ''}
      </div>
    </BaseNodeWrapper>
  );
}
