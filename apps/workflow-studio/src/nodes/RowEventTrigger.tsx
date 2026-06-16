'use client';

import { type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { RowEventTriggerData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: RowEventTriggerData };

const EVENT_LABELS: Record<RowEventTriggerData['event'], string> = {
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  INSERT_OR_UPDATE: 'INSERT / UPDATE',
};

export function RowEventTriggerNode({ data, selected }: Props) {
  return (
    <BaseNodeWrapper
      title="Row Event Trigger"
      subtitle={data.table ? `${EVENT_LABELS[data.event]} on ${data.table}` : 'No table configured'}
      icon={<Zap className="h-3 w-3 text-yellow-400" />}
      color="border-yellow-500/40"
      selected={selected}
      inputs={[]}
      outputs={[{ id: 'output', label: 'NEW row' }]}
    >
      {data.table ? (
        <div className="font-mono text-[10px] text-yellow-300 truncate">
          {data.table}
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 italic">No table set</div>
      )}
      {data.condition && (
        <div className="text-[10px] text-slate-500 truncate">
          WHEN {data.condition}
        </div>
      )}
    </BaseNodeWrapper>
  );
}
