'use client';

import { type NodeProps } from '@xyflow/react';
import { Bot } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { AgentRunData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: AgentRunData };

export function AgentRunNode({ data, selected }: Props) {
  const promptPreview = data.promptTemplate
    ? data.promptTemplate.slice(0, 60) + (data.promptTemplate.length > 60 ? '…' : '')
    : 'No prompt set';

  return (
    <BaseNodeWrapper
      title="Agent Run"
      subtitle={data.model || 'No model set'}
      icon={<Bot className="h-3 w-3 text-purple-400" />}
      color="border-purple-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Context' }]}
      outputs={[{ id: 'output', label: 'Result' }]}
    >
      <div className="text-[10px] text-slate-300 italic leading-relaxed line-clamp-2">
        {promptPreview}
      </div>
      {data.tools.length > 0 && (
        <div className="text-[10px] text-purple-400">
          Tools: {data.tools.slice(0, 3).join(', ')}
          {data.tools.length > 3 ? ` +${data.tools.length - 3}` : ''}
        </div>
      )}
      <div className="text-[10px] text-slate-500">
        → {data.outputVariable || '@agent_result'}
      </div>
    </BaseNodeWrapper>
  );
}
