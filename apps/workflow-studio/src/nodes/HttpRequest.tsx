'use client';

import { type NodeProps } from '@xyflow/react';
import { Globe } from 'lucide-react';
import { BaseNodeWrapper } from './BaseNode';
import type { HttpRequestData } from '@synapcores/workflow-types';

type Props = NodeProps & { data: HttpRequestData };

const METHOD_COLORS: Record<HttpRequestData['method'], string> = {
  GET: 'text-green-400',
  POST: 'text-blue-400',
  PUT: 'text-yellow-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
};

export function HttpRequestNode({ data, selected }: Props) {
  const urlPreview = data.url
    ? data.url.slice(0, 50) + (data.url.length > 50 ? '…' : '')
    : 'No URL set';

  return (
    <BaseNodeWrapper
      title="HTTP Request"
      subtitle={data.url ? urlPreview : 'No URL configured'}
      icon={<Globe className="h-3 w-3 text-green-400" />}
      color="border-green-500/40"
      selected={selected}
      inputs={[{ id: 'input', label: 'Body / Params' }]}
      outputs={[{ id: 'output', label: 'Response' }]}
    >
      <div className="flex items-center gap-1.5">
        <span className={`font-mono text-[10px] font-bold ${METHOD_COLORS[data.method] ?? 'text-slate-300'}`}>
          {data.method}
        </span>
        <span className="font-mono text-[10px] text-slate-400 truncate">
          {urlPreview}
        </span>
      </div>
      <div className="text-[10px] text-slate-500">
        timeout: {(data.timeoutMs ?? 30000) / 1000}s → {data.outputVariable || '@http_result'}
      </div>
    </BaseNodeWrapper>
  );
}
