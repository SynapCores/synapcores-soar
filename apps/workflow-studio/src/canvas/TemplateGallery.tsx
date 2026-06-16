'use client';

import { X } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@synapcores/workflow-types';

// ── Template definitions ──────────────────────────────────────────────────────

type TemplateBase = Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>;

interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  definition: TemplateBase;
}

const T1_NODES: WorkflowNode[] = [
  { id: 't1-n1', type: 'RowEventTrigger', position: { x: 0, y: 200 }, data: { nodeType: 'RowEventTrigger', label: 'New Ticket', table: 'support_tickets', event: 'INSERT', condition: undefined, outputColumns: [], disabled: false } },
  { id: 't1-n2', type: 'MemoryRecall', position: { x: 260, y: 200 }, data: { nodeType: 'MemoryRecall', label: 'KB Lookup', namespace: 'support_kb', queryExpr: '@NEW.description', topK: 5, outputVariable: '@context', disabled: false } },
  { id: 't1-n3', type: 'AgentRun', position: { x: 520, y: 200 }, data: { nodeType: 'AgentRun', label: 'Resolve Ticket', promptTemplate: 'Resolve this support ticket using the knowledge base context:\n\nTicket: @NEW.description\n\nContext: @context\n\nProvide a clear resolution.', model: 'local', tools: ['query_database'], outputVariable: '@agent_result', disabled: false } },
  { id: 't1-n4', type: 'SqlQuery', position: { x: 780, y: 200 }, data: { nodeType: 'SqlQuery', label: 'Update Ticket', sql: "UPDATE support_tickets SET status='resolved', response=@agent_result WHERE id=@NEW.id", outputVariable: '@update_result', bindParams: {}, disabled: false } },
  { id: 't1-n5', type: 'Return', position: { x: 1040, y: 200 }, data: { nodeType: 'Return', label: 'Done', expression: '@agent_result', returnType: 'TEXT', disabled: false } },
];

const T1_EDGES: WorkflowEdge[] = [
  { id: 't1-e1', source: 't1-n1', target: 't1-n2', animated: false },
  { id: 't1-e2', source: 't1-n2', target: 't1-n3', animated: false },
  { id: 't1-e3', source: 't1-n3', target: 't1-n4', animated: false },
  { id: 't1-e4', source: 't1-n4', target: 't1-n5', animated: false },
];

const T2_NODES: WorkflowNode[] = [
  { id: 't2-n1', type: 'RowEventTrigger', position: { x: 0, y: 200 }, data: { nodeType: 'RowEventTrigger', label: 'Email Alert', table: 'email_alerts', event: 'INSERT', condition: undefined, outputColumns: [], disabled: false } },
  { id: 't2-n2', type: 'AgentRun', position: { x: 260, y: 200 }, data: { nodeType: 'AgentRun', label: 'Analyze Email', promptTemplate: 'Analyze this email for phishing indicators. Reply with HIGH, MEDIUM, or LOW risk and reasons.\n\nEmail: @NEW.body\nFrom: @NEW.sender', model: 'local', tools: ['query_database'], outputVariable: '@agent_result', disabled: false } },
  { id: 't2-n3', type: 'If', position: { x: 520, y: 200 }, data: { nodeType: 'If', label: 'High Risk?', condition: "@agent_result LIKE '%HIGH%'", disabled: false } },
  { id: 't2-n4', type: 'Approval', position: { x: 780, y: 80 }, data: { nodeType: 'Approval', label: 'Confirm Block', title: 'High-confidence phishing detected', message: 'Agent flagged this email as HIGH risk. Approve to block sender.', timeoutMs: 86400000, disabled: false } },
  { id: 't2-n5', type: 'SqlQuery', position: { x: 780, y: 320 }, data: { nodeType: 'SqlQuery', label: 'Mark Clean', sql: "UPDATE email_alerts SET verdict='clean', score=@agent_result WHERE id=@NEW.id", outputVariable: '@r', bindParams: {}, disabled: false } },
];

const T2_EDGES: WorkflowEdge[] = [
  { id: 't2-e1', source: 't2-n1', target: 't2-n2', animated: false },
  { id: 't2-e2', source: 't2-n2', target: 't2-n3', animated: false },
  { id: 't2-e3', source: 't2-n3', target: 't2-n4', sourceHandle: 'true', animated: false },
  { id: 't2-e4', source: 't2-n3', target: 't2-n5', sourceHandle: 'false', animated: false },
];

const T3_NODES: WorkflowNode[] = [
  { id: 't3-n1', type: 'RowEventTrigger', position: { x: 0, y: 200 }, data: { nodeType: 'RowEventTrigger', label: 'Transaction', table: 'transactions', event: 'INSERT_OR_UPDATE', condition: undefined, outputColumns: [], disabled: false } },
  { id: 't3-n2', type: 'MemoryRecall', position: { x: 260, y: 200 }, data: { nodeType: 'MemoryRecall', label: 'Fraud Patterns', namespace: 'fraud_patterns', queryExpr: '@NEW.merchant_id', topK: 10, outputVariable: '@patterns', disabled: false } },
  { id: 't3-n3', type: 'AgentRun', position: { x: 520, y: 200 }, data: { nodeType: 'AgentRun', label: 'Score Risk', promptTemplate: 'Score the fraud risk 0-100 for this transaction. Reply with only the integer score.\n\nTransaction: amount=@NEW.amount merchant=@NEW.merchant_id\nHistorical patterns: @patterns', model: 'local', tools: [], outputVariable: '@agent_result', disabled: false } },
  { id: 't3-n4', type: 'SqlQuery', position: { x: 780, y: 200 }, data: { nodeType: 'SqlQuery', label: 'Write Score', sql: 'UPDATE transactions SET fraud_score=CAST(@agent_result AS INT) WHERE id=@NEW.id', outputVariable: '@r', bindParams: {}, disabled: false } },
  { id: 't3-n5', type: 'Return', position: { x: 1040, y: 200 }, data: { nodeType: 'Return', label: 'Done', expression: '@agent_result', returnType: 'INT', disabled: false } },
];

const T3_EDGES: WorkflowEdge[] = [
  { id: 't3-e1', source: 't3-n1', target: 't3-n2', animated: false },
  { id: 't3-e2', source: 't3-n2', target: 't3-n3', animated: false },
  { id: 't3-e3', source: 't3-n3', target: 't3-n4', animated: false },
  { id: 't3-e4', source: 't3-n4', target: 't3-n5', animated: false },
];

const T4_NODES: WorkflowNode[] = [
  { id: 't4-n1', type: 'RowEventTrigger', position: { x: 0, y: 200 }, data: { nodeType: 'RowEventTrigger', label: 'New Incident', table: 'incidents', event: 'INSERT', condition: undefined, outputColumns: [], disabled: false } },
  { id: 't4-n2', type: 'MemoryStore', position: { x: 260, y: 200 }, data: { nodeType: 'MemoryStore', label: 'Store Incident', namespace: 'incident_history', contentExpr: '@NEW.description', disabled: false } },
  { id: 't4-n3', type: 'MemoryRecall', position: { x: 520, y: 200 }, data: { nodeType: 'MemoryRecall', label: 'Runbook Lookup', namespace: 'runbook_kb', queryExpr: '@NEW.title', topK: 5, outputVariable: '@runbook', disabled: false } },
  { id: 't4-n4', type: 'AgentRun', position: { x: 780, y: 200 }, data: { nodeType: 'AgentRun', label: 'Generate IR Plan', promptTemplate: 'Using the following runbook context, generate a detailed incident response plan.\n\nIncident: @NEW.description\nSeverity: @NEW.severity\nRunbook: @runbook', model: 'local', tools: ['query_database', 'http_request'], outputVariable: '@ir_plan', disabled: false } },
  { id: 't4-n5', type: 'SqlQuery', position: { x: 1040, y: 200 }, data: { nodeType: 'SqlQuery', label: 'Save Response', sql: "INSERT INTO incident_responses (id, incident_id, response, created_at) VALUES (gen_random_uuid(), @NEW.id, @ir_plan, NOW())", outputVariable: '@r', bindParams: {}, disabled: false } },
  { id: 't4-n6', type: 'Return', position: { x: 1300, y: 200 }, data: { nodeType: 'Return', label: 'Done', expression: '@ir_plan', returnType: 'TEXT', disabled: false } },
];

const T4_EDGES: WorkflowEdge[] = [
  { id: 't4-e1', source: 't4-n1', target: 't4-n2', animated: false },
  { id: 't4-e2', source: 't4-n2', target: 't4-n3', animated: false },
  { id: 't4-e3', source: 't4-n3', target: 't4-n4', animated: false },
  { id: 't4-e4', source: 't4-n4', target: 't4-n5', animated: false },
  { id: 't4-e5', source: 't4-n5', target: 't4-n6', animated: false },
];

const TEMPLATES: TemplateEntry[] = [
  {
    id: 'tpl-ticket-resolver',
    name: '15-Min Agent — Ticket Resolver',
    description: 'Automatically resolves support tickets using vector knowledge base context and an in-DB AI agent.',
    tags: ['support', 'agent', 'memory'],
    definition: {
      version: 1,
      meta: { name: 'Ticket Auto-Resolver', description: 'Resolve support tickets with KB context + AI agent', tags: ['support', 'agent'], targetEngineId: 'default', minEngineVersion: '1.8.5' },
      nodes: T1_NODES,
      edges: T1_EDGES,
      viewport: { x: 0, y: 0, zoom: 0.9 },
    },
  },
  {
    id: 'tpl-phishing-triage',
    name: 'Phishing Triage',
    description: 'AI-classifies incoming emails as HIGH / MEDIUM / LOW risk and routes HIGH-risk emails to a human approval gate.',
    tags: ['security', 'email', 'approval'],
    definition: {
      version: 1,
      meta: { name: 'Phishing Triage', description: 'AI email risk classification + human approval gate', tags: ['security', 'email'], targetEngineId: 'default', minEngineVersion: '1.8.5' },
      nodes: T2_NODES,
      edges: T2_EDGES,
      viewport: { x: 0, y: 0, zoom: 0.9 },
    },
  },
  {
    id: 'tpl-fraud-score',
    name: 'Fraud Risk Scorer',
    description: 'Scores every incoming transaction 0-100 for fraud risk using historical patterns recalled from vector memory.',
    tags: ['fraud', 'fintech', 'agent'],
    definition: {
      version: 1,
      meta: { name: 'Fraud Risk Scorer', description: 'Real-time fraud scoring with memory-augmented agent', tags: ['fraud', 'fintech'], targetEngineId: 'default', minEngineVersion: '1.8.5' },
      nodes: T3_NODES,
      edges: T3_EDGES,
      viewport: { x: 0, y: 0, zoom: 0.9 },
    },
  },
  {
    id: 'tpl-rag-incident',
    name: 'RAG Incident Responder',
    description: 'Generates a full incident response plan by recalling relevant runbooks from the vector knowledge base.',
    tags: ['devops', 'incident', 'rag'],
    definition: {
      version: 1,
      meta: { name: 'RAG Incident Responder', description: 'Runbook-augmented incident response plan generator', tags: ['devops', 'incident', 'rag'], targetEngineId: 'default', minEngineVersion: '1.8.5' },
      nodes: T4_NODES,
      edges: T4_EDGES,
      viewport: { x: 0, y: 0, zoom: 0.85 },
    },
  },
];

// ── Gallery card ──────────────────────────────────────────────────────────────

function TemplateCard({ tpl, onUse }: { tpl: TemplateEntry; onUse: () => void }) {
  return (
    <div className="flex flex-col rounded-lg border border-slate-700/60 bg-slate-800/60 hover:border-blue-600/50 hover:bg-slate-800/90 transition-colors overflow-hidden">
      {/* Mini node preview bar */}
      <div className="px-3 pt-3 pb-1 flex items-center gap-1.5 flex-wrap">
        {tpl.definition.nodes.slice(0, 5).map((n) => (
          <span
            key={n.id}
            className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-slate-900 border border-slate-700 text-slate-400"
          >
            {n.data.nodeType}
          </span>
        ))}
        {tpl.definition.nodes.length > 5 && (
          <span className="text-[9px] text-slate-600">+{tpl.definition.nodes.length - 5}</span>
        )}
      </div>

      <div className="px-3 pb-3 flex flex-col gap-2 flex-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{tpl.name}</h3>
          <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{tpl.description}</p>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {tpl.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-900/40"
            >
              {t}
            </span>
          ))}
        </div>

        {/* Use button */}
        <button
          onClick={onUse}
          className="mt-auto w-full py-1.5 text-xs font-medium text-blue-300 border border-blue-700/60 rounded hover:bg-blue-900/30 transition-colors"
        >
          Use Template
        </button>
      </div>
    </div>
  );
}

// ── Main gallery modal ────────────────────────────────────────────────────────

export function TemplateGallery() {
  const { templateGalleryOpen, toggleTemplateGallery, loadWorkflow } = useWorkflowStore((s) => ({
    templateGalleryOpen: s.templateGalleryOpen,
    toggleTemplateGallery: s.toggleTemplateGallery,
    loadWorkflow: s.loadWorkflow,
  }));

  if (!templateGalleryOpen) return null;

  const handleUse = (tpl: TemplateEntry) => {
    const now = new Date().toISOString();
    loadWorkflow({
      ...tpl.definition,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    toggleTemplateGallery(false);
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleTemplateGallery(false);
      }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Workflow Templates</h2>
            <p className="text-xs text-slate-400 mt-0.5">Start from a pre-built agentic workflow</p>
          </div>
          <button
            onClick={() => toggleTemplateGallery(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TEMPLATES.map((tpl) => (
            <TemplateCard key={tpl.id} tpl={tpl} onUse={() => handleUse(tpl)} />
          ))}
        </div>
      </div>
    </div>
  );
}
