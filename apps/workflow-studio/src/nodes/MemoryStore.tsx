'use client';

import { type NodeProps } from '@xyflow/react';
import { Database } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { MemoryStoreData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: MemoryStoreData };

export function MemoryStoreNode({ data, selected }: Props) {
  return (
    <BaseNodeWrapper
      title="Memory Store"
      subtitle={data.namespace ? `ns: ${data.namespace}` : 'No namespace set'}
      icon={<Database className="h-3 w-3 text-blue-400" />}
      color="border-blue-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Content' }]}
      outputs={[{ id: 'output', label: 'Result' }]}
    >
      <div className="text-[10px] font-mono text-blue-300 truncate">
        {data.contentExpr || '@input'}
      </div>
      {data.metadataExpr && (
        <div className="text-[10px] text-slate-500 truncate">
          meta: {data.metadataExpr}
        </div>
      )}
    </BaseNodeWrapper>
  );
}
