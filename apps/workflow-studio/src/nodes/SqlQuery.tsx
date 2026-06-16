'use client';

import { type NodeProps } from '@xyflow/react';
import { Table2 } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { SqlQueryData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: SqlQueryData };

export function SqlQueryNode({ data, selected }: Props) {
  const sqlPreview = data.sql
    ? data.sql.slice(0, 70) + (data.sql.length > 70 ? '…' : '')
    : 'No SQL set';

  return (
    <BaseNodeWrapper
      title="SQL Query"
      subtitle={data.outputVariable || '@query_result'}
      icon={<Table2 className="h-3 w-3 text-green-400" />}
      color="border-green-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Params' }]}
      outputs={[{ id: 'output', label: 'Rowset' }]}
    >
      <div className="font-mono text-[10px] text-green-300 leading-relaxed line-clamp-3 whitespace-pre-wrap break-all">
        {sqlPreview}
      </div>
      {Object.keys(data.bindParams ?? {}).length > 0 && (
        <div className="text-[10px] text-slate-500">
          {Object.keys(data.bindParams!).length} bind param(s)
        </div>
      )}
    </BaseNodeWrapper>
  );
}
