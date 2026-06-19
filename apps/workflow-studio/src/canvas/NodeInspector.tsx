'use client';

import { useEffect, useCallback } from 'react';
import { useForm, useFieldArray, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { X, Trash2, Plus } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import type { WorkflowNodeData } from '@synapcores/workflow-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturn<FieldValues, any, FieldValues>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500';
const textareaCls =
  'w-full px-2 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none font-mono leading-relaxed';
const selectCls =
  'w-full px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500';

// ── Per-nodeType form bodies ──────────────────────────────────────────────────

function RowEventTriggerForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Table">
        <input {...register('table')} className={inputCls} placeholder="my_table" />
      </Field>
      <Field label="Event">
        <select {...register('event')} className={selectCls}>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
          <option value="INSERT_OR_UPDATE">INSERT OR UPDATE</option>
        </select>
      </Field>
      <Field label="Condition (optional WHEN clause)">
        <textarea
          {...register('condition')}
          className={textareaCls}
          rows={2}
          placeholder="NEW.status = 'active'"
        />
      </Field>
    </>
  );
}

function AgentRunForm({ form }: { form: AnyForm }) {
  const { register } = form;
  const ALL_TOOLS = ['query_database', 'describe_table', 'memory_search', 'http_request'];
  return (
    <>
      <Field label="Model">
        <input {...register('model')} className={inputCls} placeholder="local" />
      </Field>
      <Field label="Prompt Template">
        <textarea
          {...register('promptTemplate')}
          className={textareaCls}
          rows={6}
          placeholder="Analyze @NEW.description and..."
        />
      </Field>
      <Field label="Tools">
        <div className="space-y-1">
          {ALL_TOOLS.map((t) => (
            <label key={t} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                value={t}
                {...register('tools')}
                className="accent-blue-500"
              />
              {t}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Output Variable">
        <input {...register('outputVariable')} className={inputCls} placeholder="@agent_result" />
      </Field>
      <Field label="Max Tokens (optional)">
        <input {...register('maxTokens', { valueAsNumber: true })} type="number" className={inputCls} />
      </Field>
      <Field label="Temperature (0–2)">
        <input
          {...register('temperature', { valueAsNumber: true })}
          type="number"
          step="0.1"
          min="0"
          max="2"
          className={inputCls}
        />
      </Field>
    </>
  );
}

function SqlQueryForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="SQL">
        <textarea
          {...register('sql')}
          className={cn(textareaCls, 'font-mono')}
          rows={6}
          placeholder="SELECT * FROM my_table WHERE id = @NEW.id"
        />
      </Field>
      <Field label="Output Variable">
        <input {...register('outputVariable')} className={inputCls} placeholder="@query_result" />
      </Field>
    </>
  );
}

function HttpRequestForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Method">
        <select {...register('method')} className={selectCls}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="URL">
        <input {...register('url')} className={inputCls} placeholder="https://api.example.com/..." />
      </Field>
      <Field label="Body Expression (optional)">
        <textarea {...register('bodyExpr')} className={textareaCls} rows={3} placeholder="@NEW::json" />
      </Field>
      <Field label="Timeout (ms)">
        <input {...register('timeoutMs', { valueAsNumber: true })} type="number" className={inputCls} />
      </Field>
      <Field label="Output Variable">
        <input {...register('outputVariable')} className={inputCls} placeholder="@http_result" />
      </Field>
    </>
  );
}

function MemoryStoreForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Namespace">
        <input {...register('namespace')} className={inputCls} placeholder="support_kb" />
      </Field>
      <Field label="Content Expression">
        <input {...register('contentExpr')} className={inputCls} placeholder="@NEW.description" />
      </Field>
    </>
  );
}

function MemoryRecallForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Namespace">
        <input {...register('namespace')} className={inputCls} placeholder="support_kb" />
      </Field>
      <Field label="Query Expression">
        <input {...register('queryExpr')} className={inputCls} placeholder="@NEW.description" />
      </Field>
      <Field label="Top K">
        <input {...register('topK', { valueAsNumber: true })} type="number" min={1} max={100} className={inputCls} />
      </Field>
      <Field label="Output Variable">
        <input {...register('outputVariable')} className={inputCls} placeholder="@results" />
      </Field>
    </>
  );
}

function IfForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <Field label="Condition">
      <input {...register('condition')} className={inputCls} placeholder="@agent_result LIKE '%HIGH%'" />
    </Field>
  );
}

function SwitchForm({ form }: { form: AnyForm }) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'cases' });
  return (
    <>
      <Field label="Expression">
        <input {...register('expression')} className={inputCls} placeholder="@agent_result" />
      </Field>
      <Field label="Cases">
        <div className="space-y-1.5">
          {fields.map((field, idx) => (
            <div key={field.id} className="flex items-center gap-1">
              <input
                {...register(`cases.${idx}.value`)}
                className={cn(inputCls, 'flex-1')}
                placeholder="value"
              />
              <input
                {...register(`cases.${idx}.label`)}
                className={cn(inputCls, 'flex-1')}
                placeholder="label (opt)"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="p-1 text-slate-500 hover:text-red-400 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => append({ value: '', label: '' })}
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add case
          </button>
        </div>
      </Field>
      <Field label="Default case">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" {...register('defaultCase')} className="accent-blue-500" />
          Include default (ELSE) branch
        </label>
      </Field>
    </>
  );
}

function LoopForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Condition">
        <input {...register('condition')} className={inputCls} placeholder="@counter < 10" />
      </Field>
      <Field label="Max Iterations">
        <input {...register('maxIterations', { valueAsNumber: true })} type="number" min={1} className={inputCls} />
      </Field>
    </>
  );
}

function ApprovalForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Title">
        <input {...register('title')} className={inputCls} placeholder="Approval Required" />
      </Field>
      <Field label="Message">
        <textarea {...register('message')} className={textareaCls} rows={3} placeholder="Please review and approve..." />
      </Field>
      <Field label="Timeout (ms)">
        <input {...register('timeoutMs', { valueAsNumber: true })} type="number" className={inputCls} />
      </Field>
    </>
  );
}

function SetVariableForm({ form }: { form: AnyForm }) {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'assignments' });
  return (
    <Field label="Assignments">
      <div className="space-y-1.5">
        {fields.map((field, idx) => (
          <div key={field.id} className="flex items-center gap-1">
            <input
              {...register(`assignments.${idx}.variable`)}
              className={cn(inputCls, 'flex-1 font-mono')}
              placeholder="@var"
            />
            <span className="text-slate-500 text-xs">=</span>
            <input
              {...register(`assignments.${idx}.expression`)}
              className={cn(inputCls, 'flex-1 font-mono')}
              placeholder="@value + 1"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="p-1 text-slate-500 hover:text-red-400 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => append({ variable: '', expression: '' })}
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add assignment
        </button>
      </div>
    </Field>
  );
}

function ReturnForm({ form }: { form: AnyForm }) {
  const { register } = form;
  return (
    <>
      <Field label="Expression">
        <input {...register('expression')} className={cn(inputCls, 'font-mono')} placeholder="@agent_result" />
      </Field>
      <Field label="Return Type">
        <select {...register('returnType')} className={selectCls}>
          {['TEXT', 'INT', 'FLOAT', 'JSON', 'BOOLEAN', 'ANY'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

// ── Main inspector component ──────────────────────────────────────────────────

export function NodeInspector() {
  const inspectorOpen = useWorkflowStore((s) => s.inspectorOpen);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const toggleInspector = useWorkflowStore((s) => s.toggleInspector);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const nodeData = selectedNode?.data as WorkflowNodeData | undefined;
  const nodeType = nodeData?.nodeType;

  const form = useForm<FieldValues>({
    defaultValues: (nodeData ?? {}) as FieldValues,
  });

  // Reset form when selected node changes
  useEffect(() => {
    if (nodeData) {
      form.reset(nodeData as Record<string, unknown>);
    }
  }, [selectedNodeId, nodeData, form]);

  // Sync form values to store in real-time
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (selectedNodeId && values) {
        updateNodeData(selectedNodeId, values as Partial<WorkflowNodeData>);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, selectedNodeId, updateNodeData]);

  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      removeNode(selectedNodeId);
      selectNode(null);
      toggleInspector(false);
    }
  }, [selectedNodeId, removeNode, selectNode, toggleInspector]);

  if (!inspectorOpen || !selectedNode || !nodeData) return null;

  const formBody = (() => {
    switch (nodeType) {
      case 'RowEventTrigger': return <RowEventTriggerForm form={form} />;
      case 'AgentRun':        return <AgentRunForm form={form} />;
      case 'SqlQuery':        return <SqlQueryForm form={form} />;
      case 'HttpRequest':     return <HttpRequestForm form={form} />;
      case 'MemoryStore':     return <MemoryStoreForm form={form} />;
      case 'MemoryRecall':    return <MemoryRecallForm form={form} />;
      case 'If':              return <IfForm form={form} />;
      case 'Switch':          return <SwitchForm form={form} />;
      case 'Loop':            return <LoopForm form={form} />;
      case 'Approval':        return <ApprovalForm form={form} />;
      case 'SetVariable':     return <SetVariableForm form={form} />;
      case 'Return':          return <ReturnForm form={form} />;
      default:                return <p className="text-xs text-slate-500">Unknown node type.</p>;
    }
  })();

  return (
    <div className="absolute right-0 top-0 bottom-0 z-25 flex flex-col w-72 bg-slate-900 border-l border-slate-700/60 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/60 bg-slate-900">
        <div>
          <p className="text-xs font-semibold text-slate-200">{nodeData.label || nodeType}</p>
          <p className="text-[10px] text-slate-500">{nodeType}</p>
        </div>
        <button
          onClick={() => toggleInspector(false)}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Common label field */}
      <div className="px-3 pt-3 pb-0">
        <Field label="Label">
          <input
            {...form.register('label')}
            className={inputCls}
            placeholder="Node label"
          />
        </Field>
      </div>

      {/* Type-specific fields */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {formBody}
      </div>

      {/* Footer actions */}
      <div className="px-3 py-2.5 border-t border-slate-700/60 flex items-center justify-between bg-slate-900">
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            {...form.register('disabled')}
            className="accent-orange-500"
          />
          Disabled
        </label>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Delete node
        </button>
      </div>
    </div>
  );
}
