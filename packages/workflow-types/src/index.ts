import { z } from 'zod';

// ── Port/edge data types ──────────────────────────────────────────────────────

export const DataTypeSchema = z.enum(['TEXT', 'INT', 'FLOAT', 'VECTOR', 'JSON', 'ROWSET', 'BOOLEAN', 'ANY']);
export type DataType = z.infer<typeof DataTypeSchema>;

// ── Node port definitions (for typed edge validation) ─────────────────────────

export const PortSchema = z.object({
  id: z.string(),
  label: z.string(),
  dataType: DataTypeSchema,
});
export type Port = z.infer<typeof PortSchema>;

// ── Base node data (all nodes share this) ─────────────────────────────────────

export const BaseNodeDataSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  comment: z.string().optional(),
  disabled: z.boolean().default(false),
});

// ── All 12 node type data schemas ─────────────────────────────────────────────

export const RowEventTriggerDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('RowEventTrigger'),
  table: z.string().default(''),
  event: z.enum(['INSERT', 'UPDATE', 'DELETE', 'INSERT_OR_UPDATE']).default('INSERT'),
  condition: z.string().optional(),
  outputColumns: z.array(z.string()).default([]),
});
export type RowEventTriggerData = z.infer<typeof RowEventTriggerDataSchema>;

export const MemoryStoreDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('MemoryStore'),
  namespace: z.string().default(''),
  contentExpr: z.string().default('@input'),
  metadataExpr: z.string().optional(),
});
export type MemoryStoreData = z.infer<typeof MemoryStoreDataSchema>;

export const MemoryRecallDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('MemoryRecall'),
  namespace: z.string().default(''),
  queryExpr: z.string().default('@query'),
  topK: z.number().int().min(1).max(100).default(5),
  outputVariable: z.string().default('@results'),
});
export type MemoryRecallData = z.infer<typeof MemoryRecallDataSchema>;

export const AgentRunDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('AgentRun'),
  promptTemplate: z.string().default(''),
  model: z.string().default(''),
  tools: z.array(z.string()).default([]),
  outputVariable: z.string().default('@agent_result'),
  maxTokens: z.number().int().optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type AgentRunData = z.infer<typeof AgentRunDataSchema>;

export const SqlQueryDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('SqlQuery'),
  sql: z.string().default(''),
  outputVariable: z.string().default('@query_result'),
  bindParams: z.record(z.string()).default({}),
});
export type SqlQueryData = z.infer<typeof SqlQueryDataSchema>;

export const HttpRequestDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('HttpRequest'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string().default(''),
  headers: z.record(z.string()).default({}),
  bodyExpr: z.string().optional(),
  outputVariable: z.string().default('@http_result'),
  timeoutMs: z.number().int().default(30000),
});
export type HttpRequestData = z.infer<typeof HttpRequestDataSchema>;

export const IfDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('If'),
  condition: z.string().default(''),
});
export type IfData = z.infer<typeof IfDataSchema>;

export const SwitchDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('Switch'),
  expression: z.string().default(''),
  cases: z.array(z.object({
    value: z.string(),
    label: z.string().optional(),
  })).default([]),
  defaultCase: z.boolean().default(true),
});
export type SwitchData = z.infer<typeof SwitchDataSchema>;

export const LoopDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('Loop'),
  condition: z.string().default(''),
  maxIterations: z.number().int().default(100),
});
export type LoopData = z.infer<typeof LoopDataSchema>;

export const ApprovalDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('Approval'),
  title: z.string().default('Approval Required'),
  message: z.string().default(''),
  timeoutMs: z.number().int().default(86400000),
});
export type ApprovalData = z.infer<typeof ApprovalDataSchema>;

export const SetVariableDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('SetVariable'),
  assignments: z.array(z.object({
    variable: z.string(),
    expression: z.string(),
  })).default([]),
});
export type SetVariableData = z.infer<typeof SetVariableDataSchema>;

export const ReturnDataSchema = BaseNodeDataSchema.extend({
  nodeType: z.literal('Return'),
  expression: z.string().default(''),
  returnType: DataTypeSchema.default('ANY'),
});
export type ReturnData = z.infer<typeof ReturnDataSchema>;

// ── Union of all node data types ──────────────────────────────────────────────

export const WorkflowNodeDataSchema = z.discriminatedUnion('nodeType', [
  RowEventTriggerDataSchema,
  MemoryStoreDataSchema,
  MemoryRecallDataSchema,
  AgentRunDataSchema,
  SqlQueryDataSchema,
  HttpRequestDataSchema,
  IfDataSchema,
  SwitchDataSchema,
  LoopDataSchema,
  ApprovalDataSchema,
  SetVariableDataSchema,
  ReturnDataSchema,
]);
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
export type NodeType = WorkflowNodeData['nodeType'];

// ── Canvas node (extends React Flow node shape) ───────────────────────────────

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: WorkflowNodeDataSchema,
  width: z.number().optional(),
  height: z.number().optional(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

// ── Canvas edge ───────────────────────────────────────────────────────────────

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  dataType: DataTypeSchema.optional(),
  label: z.string().optional(),
  animated: z.boolean().default(false),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

// ── Workflow metadata ──────────────────────────────────────────────────────────

export const WorkflowMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  owner: z.string().optional(),
  tags: z.array(z.string()).default([]),
  targetEngineId: z.string().default('default'),
  targetEngineVersion: z.string().optional(),
  minEngineVersion: z.string().default('1.8.5'),
});
export type WorkflowMeta = z.infer<typeof WorkflowMetaSchema>;

// ── Full workflow definition ───────────────────────────────────────────────────

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1).default(1),
  meta: WorkflowMetaSchema,
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  viewport: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    zoom: z.number().default(1),
  }).default({ x: 0, y: 0, zoom: 1 }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ── Validation result ──────────────────────────────────────────────────────────

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  severity: 'error' | 'warning';
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ── Compilation output ─────────────────────────────────────────────────────────

export interface CompilationResult {
  workflowId: string;
  version: number;
  sql: string;
  procedureName: string;
  triggerNames: string[];
  engineMinVersion: string;
  compiledAt: string;
  hash: string;
}

// ── Run record shapes ──────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum(['running', 'success', 'error', 'cancelled', 'awaiting_approval']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export interface WorkflowRun {
  id: string;
  workflowId: string;
  version: number;
  triggerKind: string | null;
  triggerData: string | null;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

export interface WorkflowStepRun {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: NodeType;
  status: RunStatus;
  inputJson: string | null;
  outputJson: string | null;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

// ── Template ──────────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  previewDescription: string;
  definition: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>;
}

// ── Node category metadata (for the palette) ──────────────────────────────────

export interface NodeCategoryEntry {
  category: 'Triggers' | 'Memory' | 'Agents' | 'Actions' | 'Control Flow' | 'I/O';
  nodeType: NodeType;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export const NODE_CATEGORIES: NodeCategoryEntry[] = [
  { category: 'Triggers', nodeType: 'RowEventTrigger', label: 'Row Event Trigger', description: 'Fire when a row is inserted, updated, or deleted', icon: 'Zap', color: 'bg-yellow-500/20 border-yellow-500/40' },
  { category: 'Memory', nodeType: 'MemoryStore', label: 'Memory Store', description: 'Store content in vector memory', icon: 'Database', color: 'bg-blue-500/20 border-blue-500/40' },
  { category: 'Memory', nodeType: 'MemoryRecall', label: 'Memory Recall', description: 'Retrieve semantically similar memories', icon: 'Search', color: 'bg-blue-500/20 border-blue-500/40' },
  { category: 'Agents', nodeType: 'AgentRun', label: 'Agent Run', description: 'Execute an AI agent with tools', icon: 'Bot', color: 'bg-purple-500/20 border-purple-500/40' },
  { category: 'Actions', nodeType: 'SqlQuery', label: 'SQL Query', description: 'Run a SQL statement', icon: 'Table2', color: 'bg-green-500/20 border-green-500/40' },
  { category: 'Actions', nodeType: 'HttpRequest', label: 'HTTP Request', description: 'Call an external HTTP endpoint', icon: 'Globe', color: 'bg-green-500/20 border-green-500/40' },
  { category: 'Control Flow', nodeType: 'If', label: 'If / Else', description: 'Branch on a condition', icon: 'GitBranch', color: 'bg-orange-500/20 border-orange-500/40' },
  { category: 'Control Flow', nodeType: 'Switch', label: 'Switch', description: 'Multi-way branch by value', icon: 'ListTree', color: 'bg-orange-500/20 border-orange-500/40' },
  { category: 'Control Flow', nodeType: 'Loop', label: 'Loop', description: 'Repeat while a condition is true', icon: 'RefreshCcw', color: 'bg-orange-500/20 border-orange-500/40' },
  { category: 'Control Flow', nodeType: 'Approval', label: 'Approval Gate', description: 'Pause and wait for human approval', icon: 'CheckCircle', color: 'bg-red-500/20 border-red-500/40' },
  { category: 'I/O', nodeType: 'SetVariable', label: 'Set Variable', description: 'Assign SQL expressions to variables', icon: 'Variable', color: 'bg-slate-500/20 border-slate-500/40' },
  { category: 'I/O', nodeType: 'Return', label: 'Return', description: 'Return a value from the procedure', icon: 'LogOut', color: 'bg-slate-500/20 border-slate-500/40' },
];
