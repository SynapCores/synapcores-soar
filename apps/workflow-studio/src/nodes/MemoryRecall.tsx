'use client';

import { type NodeProps } from '@xyflow/react';
import { Search } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { MemoryRecallData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: MemoryRecallData };

export function MemoryRecallNode({ data, selected }: Props) {
  return (
    <BaseNodeWrapper
      title="Memory Recall"
      subtitle={data.namespace ? `ns: ${data.namespace}` : 'No namespace set'}
      icon={<Search className="h-3 w-3 text-blue-400" />}
      color="border-blue-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Query' }]}
      outputs={[{ id: 'output', label: 'Results' }]}
    >
      <div className="text-[10px] font-mono text-blue-300 truncate">
        {data.queryExpr || '@query'}
      </div>
      <div className="text-[10px] text-slate-500">
        top {data.topK ?? 5} results → {data.outputVariable || '@results'}
      </div>
    </BaseNodeWrapper>
  );
}
