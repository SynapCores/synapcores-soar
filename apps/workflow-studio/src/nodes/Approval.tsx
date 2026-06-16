'use client';

import { type NodeProps } from '@xyflow/react';
import { CheckCircle } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { ApprovalData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: ApprovalData };

function formatTimeout(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`;
  return `${m}m`;
}

export function ApprovalNode({ data, selected }: Props) {
  return (
    <BaseNodeWrapper
      title="Approval Gate"
      subtitle={data.title || 'Approval Required'}
      icon={<CheckCircle className="h-3 w-3 text-red-400" />}
      color="border-red-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Request' }]}
      outputs={[
        { id: 'approved', label: 'Approved' },
        { id: 'rejected', label: 'Rejected' },
        { id: 'timed_out', label: 'Timed out' },
      ]}
    >
      {data.message && (
        <div className="text-[10px] text-slate-300 italic line-clamp-2">
          {data.message}
        </div>
      )}
      <div className="text-[10px] text-slate-500">
        Timeout: {formatTimeout(data.timeoutMs ?? 86400000)}
      </div>
      <div className="flex flex-col gap-0.5 text-[9px] pt-1">
        <span className="text-green-400">✓ approved</span>
        <span className="text-red-400">✗ rejected</span>
        <span className="text-slate-400">⏱ timed_out</span>
      </div>
    </BaseNodeWrapper>
  );
}
