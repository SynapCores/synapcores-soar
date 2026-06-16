import 'server-only';

import { createHash } from 'node:crypto';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  CompilationResult,
  NodeType,
} from '@synapcores/workflow-types';

type NodeData = WorkflowNode['data'];

interface BaseNodeDataExt {
  disabled?: boolean;
  label: string;
  nodeType: string;
}

// ── Indentation helper ────────────────────────────────────────────────────────
const indent = (code: string, spaces = 2): string =>
  code.split('\n').map(l => (l.trim() ? ' '.repeat(spaces) + l : l)).join('\n');

// ── Utilities ─────────────────────────────────────────────────────────────────
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
}

function escapeSql(val: string): string {
  return val.replace(/'/g, "''");
}

// ── Topological sort of workflow nodes ────────────────────────────────────────
function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: WorkflowNode[] = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0);
  const result: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighborId of (adj.get(node.id) ?? [])) {
      const deg = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, deg);
      if (deg === 0) {
        const neighbor = nodes.find(n => n.id === neighborId);
        if (neighbor) queue.push(neighbor);
      }
    }
  }

  // fallback on cycles — return original order
  return result.length === nodes.length ? result : nodes;
}

// ── Per-node step-run tracking helper ─────────────────────────────────────────
// Emits INSERT + UPDATE for workflow_step_runs tracking.
// Wraps the body statement with step tracking.
function withStepTracking(node: WorkflowNode, bodyLines: string): string {
  const sid = sanitizeId(node.id);
  const nodeType = node.data.nodeType;
  return [
    `-- [STEP START] ${nodeType}: ${node.data.label}`,
    `INSERT INTO workflow_step_runs (id, run_id, node_id, node_type, status, started_at)`,
    `  VALUES (CONCAT('step_', @_run_id, '_${sid}'), @_run_id, '${node.id}', '${nodeType}', 'running', NOW());`,
    bodyLines,
    `UPDATE workflow_step_runs SET status = 'success', ended_at = NOW()`,
    `  WHERE id = CONCAT('step_', @_run_id, '_${sid}');`,
    `-- [STEP END]`,
  ].join('\n');
}

// ── Per-node SQL emitters ──────────────────────────────────────────────────────

function emitRowEventTrigger(_node: WorkflowNode): string {
  return '-- [RowEventTrigger: handled at trigger level]';
}

function emitMemoryStore(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'MemoryStore' }>;
  const ns = escapeSql(d.namespace || 'default');
  const content = d.contentExpr || '@input';
  const meta = d.metadataExpr ? `, ${d.metadataExpr}` : ', NULL';
  const sid = sanitizeId(node.id);
  const body = `SET @memory_store_${sid} = MEMORY_STORE('${ns}', ${content}${meta});`;
  return withStepTracking(node, body);
}

function emitMemoryRecall(node: WorkflowNode): string {
  // Workaround playbook: MEMORY_RECALL is a confirmed live primitive (v1.8.5-ce).
  // Use MEMORY_RECALL() direct call into a variable.
  // Temp-table pattern (INSERT INTO _wf_<runid>_step_N) deferred to v0.2.0
  // when engine guarantees dynamic table creation in procedures.
  const d = node.data as Extract<NodeData, { nodeType: 'MemoryRecall' }>;
  const ns = escapeSql(d.namespace || 'default');
  const query = d.queryExpr || '@query';
  const topK = d.topK ?? 5;
  const outVar = d.outputVariable || `@recall_${sanitizeId(node.id)}`;
  const body = `SET ${outVar} = MEMORY_RECALL('${ns}', ${query}, ${topK});`;
  return withStepTracking(node, body);
}

function emitAgentRun(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'AgentRun' }>;
  const prompt = escapeSql(d.promptTemplate || 'Perform the task.');
  const model = d.model ? `'${escapeSql(d.model)}'` : 'NULL';
  const tools = d.tools.length > 0 ? `'${escapeSql(d.tools.join(','))}'` : 'NULL';
  const outVar = d.outputVariable || `@agent_${sanitizeId(node.id)}`;
  const sid = sanitizeId(node.id);

  const body = [
    `SET ${outVar} = AGENT_RUN('${prompt}', ${model}, ${tools});`,
    `UPDATE workflow_step_runs SET output_json = JSON_OBJECT('result', ${outVar})`,
    `  WHERE id = CONCAT('step_', @_run_id, '_${sid}');`,
  ].join('\n');

  return withStepTracking(node, body);
}

function emitSqlQuery(node: WorkflowNode): string {
  // Workaround: execute inline SQL directly. Do NOT use `INTO TABLE @var`
  // which has uncertain engine support. Output variable captures row count / scalar.
  const d = node.data as Extract<NodeData, { nodeType: 'SqlQuery' }>;
  const sql = (d.sql || 'SELECT 1').trim().replace(/;$/, '');
  const body = `${sql};`;
  return withStepTracking(node, body);
}

function emitHttpRequest(node: WorkflowNode): string {
  // Workaround playbook: Node proxy makes the HTTP call directly.
  // Compiler emits:
  //   1. A marker comment: -- HTTP_EGRESS_CALLOUT step_<n>
  //   2. An INSERT into workflow_step_runs with status='pending_http'
  //      containing the URL/method/headers so the proxy knows what to call.
  //   3. A variable set to NULL — the proxy fills it via UPDATE.
  const d = node.data as Extract<NodeData, { nodeType: 'HttpRequest' }>;
  const outVar = d.outputVariable || `@http_${sanitizeId(node.id)}`;
  const method = escapeSql(d.method || 'GET');
  const url = escapeSql(d.url || '');
  const headers = escapeSql(JSON.stringify(d.headers || {}));
  const body = d.bodyExpr ? escapeSql(d.bodyExpr) : '';
  const sid = sanitizeId(node.id);
  const timeoutMs = d.timeoutMs ?? 30000;

  const lines = [
    `-- HTTP_EGRESS_CALLOUT step_${sid}`,
    `-- Method: ${d.method || 'GET'}`,
    `-- URL: ${d.url || '(unset)'}`,
    `-- Timeout: ${timeoutMs}ms`,
    `-- Node proxy will execute this HTTP call and write back to workflow_step_runs.output_json`,
    `INSERT INTO workflow_step_runs (id, run_id, node_id, node_type, status, input_json, started_at)`,
    `  VALUES (`,
    `    CONCAT('step_', @_run_id, '_${sid}'),`,
    `    @_run_id,`,
    `    '${node.id}',`,
    `    'HttpRequest',`,
    `    'pending_http',`,
    `    '${JSON.stringify({ method: d.method, url: d.url, headers: d.headers, body: d.bodyExpr, timeoutMs }).replace(/'/g, "''")}',`,
    `    NOW()`,
    `  );`,
    `SET ${outVar} = NULL; -- filled by node proxy after HTTP call completes`,
  ].join('\n');

  return lines;
}

function emitIf(node: WorkflowNode, edges: WorkflowEdge[], allNodes: WorkflowNode[]): string {
  const d = node.data as Extract<NodeData, { nodeType: 'If' }>;
  const condition = d.condition || 'TRUE';
  const trueEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'true');
  const falseEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'false');

  const trueTarget = trueEdge ? allNodes.find(n => n.id === trueEdge.target) : null;
  const falseTarget = falseEdge ? allNodes.find(n => n.id === falseEdge.target) : null;

  const trueBranch = trueTarget
    ? indent(emitNode(trueTarget, edges, allNodes), 2)
    : '  -- (no true branch)';
  const falseBranch = falseTarget
    ? indent(emitNode(falseTarget, edges, allNodes), 2)
    : '  -- (no false branch)';

  return `-- If: ${node.data.label}\nIF ${condition} THEN\n${trueBranch}\nELSE\n${falseBranch}\nEND IF;`;
}

function emitSwitch(node: WorkflowNode, edges: WorkflowEdge[], allNodes: WorkflowNode[]): string {
  const d = node.data as Extract<NodeData, { nodeType: 'Switch' }>;
  const expr = d.expression || '@value';

  let caseBody = '';
  for (const c of d.cases) {
    const caseEdge = edges.find(e => e.source === node.id && e.sourceHandle === c.value);
    const target = caseEdge ? allNodes.find(n => n.id === caseEdge.target) : null;
    const body = target
      ? indent(emitNode(target, edges, allNodes), 4)
      : '    -- (no handler)';
    caseBody += `  WHEN '${escapeSql(c.value)}' THEN\n${body}\n`;
  }

  if (d.defaultCase) {
    const defaultEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'default');
    const target = defaultEdge ? allNodes.find(n => n.id === defaultEdge.target) : null;
    const body = target
      ? indent(emitNode(target, edges, allNodes), 4)
      : '    -- (no default handler)';
    caseBody += `  ELSE\n${body}\n`;
  }

  return `-- Switch: ${node.data.label}\nCASE ${expr}\n${caseBody}END CASE;`;
}

function emitLoop(node: WorkflowNode, edges: WorkflowEdge[], allNodes: WorkflowNode[]): string {
  const d = node.data as Extract<NodeData, { nodeType: 'Loop' }>;
  const condition = d.condition || 'FALSE';
  const maxIter = d.maxIterations ?? 100;
  const bodyEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'body');
  const target = bodyEdge ? allNodes.find(n => n.id === bodyEdge.target) : null;
  const body = target
    ? indent(emitNode(target, edges, allNodes), 2)
    : '  -- (empty loop body)';
  const iterVar = `@_loop_iter_${sanitizeId(node.id)}`;

  return `-- Loop: ${node.data.label}\nSET ${iterVar} = 0;\nWHILE ${condition} AND ${iterVar} < ${maxIter} LOOP\n${body}\n  SET ${iterVar} = ${iterVar} + 1;\nEND LOOP;`;
}

function emitApproval(node: WorkflowNode): string {
  // SOAR approval pattern: insert into workflow_approval_queue with state='awaiting',
  // then RETURN. Second trigger on workflow_approval_queue fires when state changes.
  const d = node.data as Extract<NodeData, { nodeType: 'Approval' }>;
  const title = escapeSql(d.title || 'Approval Required');
  const message = escapeSql(d.message || '');
  const approvalId = sanitizeId(node.id);
  const timeoutMs = d.timeoutMs ?? 86400000;
  return [
    `-- Approval Gate: ${node.data.label}`,
    `-- Title: ${title}`,
    `-- Message: ${message}`,
    `-- Timeout: ${timeoutMs}ms`,
    `INSERT INTO workflow_approval_queue (id, run_id, node_id, state, requested_at)`,
    `  VALUES (CONCAT('apr_', '${approvalId}', '_', @_run_id), @_run_id, '${node.id}', 'awaiting', NOW());`,
    `UPDATE workflow_runs SET status = 'awaiting_approval' WHERE id = @_run_id;`,
    `-- Procedure returns here; second trigger on workflow_approval_queue resumes on state change.`,
    `RETURN;`,
  ].join('\n');
}

function emitSetVariable(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'SetVariable' }>;
  if (!d.assignments.length) return `-- Set Variable: ${node.data.label} (no assignments)`;
  const body = d.assignments.map(a => `SET ${a.variable} = ${a.expression};`).join('\n');
  return withStepTracking(node, body);
}

function emitReturn(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'Return' }>;
  const expr = d.expression || 'NULL';
  // Update run status BEFORE RETURN — the trailing success-UPDATE at the
  // procedure foot is dead code once RETURN fires.
  return [
    `-- Return: ${node.data.label}`,
    `UPDATE workflow_runs SET status = 'success', ended_at = NOW()`,
    `  WHERE id = @_run_id AND status = 'running';`,
    `RETURN ${expr};`,
  ].join('\n');
}

// ── Main node dispatch ────────────────────────────────────────────────────────

function emitNode(node: WorkflowNode, edges: WorkflowEdge[], allNodes: WorkflowNode[]): string {
  if ((node.data as BaseNodeDataExt).disabled) {
    return `-- [DISABLED] ${node.data.label}`;
  }

  const type = node.data.nodeType as NodeType;
  switch (type) {
    case 'RowEventTrigger': return emitRowEventTrigger(node);
    case 'MemoryStore':     return emitMemoryStore(node);
    case 'MemoryRecall':    return emitMemoryRecall(node);
    case 'AgentRun':        return emitAgentRun(node);
    case 'SqlQuery':        return emitSqlQuery(node);
    case 'HttpRequest':     return emitHttpRequest(node);
    case 'If':              return emitIf(node, edges, allNodes);
    case 'Switch':          return emitSwitch(node, edges, allNodes);
    case 'Loop':            return emitLoop(node, edges, allNodes);
    case 'Approval':        return emitApproval(node);
    case 'SetVariable':     return emitSetVariable(node);
    case 'Return':          return emitReturn(node);
    default: {
      const _exhaustive: never = type;
      return `-- Unknown node type: ${_exhaustive}`;
    }
  }
}

// ── Trigger DDL emitter ───────────────────────────────────────────────────────

function emitTriggers(procName: string, triggers: WorkflowNode[]): string {
  return triggers
    .map(t => {
      const d = t.data as Extract<NodeData, { nodeType: 'RowEventTrigger' }>;
      const table = d.table || 'unknown_table';
      const events = d.event === 'INSERT_OR_UPDATE' ? 'INSERT OR UPDATE' : d.event;
      const condition = d.condition ? `\n  WHEN (${d.condition})` : '';
      const triggerName = `trig_wf_${sanitizeId(t.id)}`;
      return [
        `CREATE OR REPLACE TRIGGER ${triggerName}`,
        `  AFTER ${events} ON ${table}`,
        `  FOR EACH ROW${condition}`,
        `  EXECUTE PROCEDURE ${procName}(NEW, OLD);`,
      ].join('\n');
    })
    .join('\n\n');
}

// ── Schema bootstrap (workflow tracking tables) ────────────────────────────────

export function emitBootstrapDDL(): string {
  return [
    `-- Workflow Studio schema bootstrap`,
    `-- Run once on first connection to the target engine`,
    ``,
    `CREATE TABLE IF NOT EXISTS workflow_definitions (`,
    `  id           TEXT PRIMARY KEY,`,
    `  name         TEXT NOT NULL,`,
    `  description  TEXT,`,
    `  version      INT  NOT NULL DEFAULT 1,`,
    `  definition   TEXT NOT NULL,`,
    `  compiled_sql TEXT,`,
    `  status       TEXT NOT NULL DEFAULT 'draft',`,
    `  owner        TEXT,`,
    `  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`,
    `  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    `);`,
    ``,
    `CREATE TABLE IF NOT EXISTS workflow_versions (`,
    `  id           TEXT PRIMARY KEY,`,
    `  workflow_id  TEXT NOT NULL,`,
    `  version      INT  NOT NULL,`,
    `  definition   TEXT NOT NULL,`,
    `  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,`,
    `  created_by   TEXT`,
    `);`,
    ``,
    `CREATE TABLE IF NOT EXISTS workflow_runs (`,
    `  id           TEXT PRIMARY KEY,`,
    `  workflow_id  TEXT NOT NULL,`,
    `  version      INT  NOT NULL,`,
    `  trigger_kind TEXT,`,
    `  trigger_data TEXT,`,
    `  status       TEXT NOT NULL,`,
    `  started_at   TIMESTAMP,`,
    `  ended_at     TIMESTAMP,`,
    `  error        TEXT`,
    `);`,
    ``,
    `CREATE TABLE IF NOT EXISTS workflow_step_runs (`,
    `  id           TEXT PRIMARY KEY,`,
    `  run_id       TEXT NOT NULL,`,
    `  node_id      TEXT NOT NULL,`,
    `  node_type    TEXT NOT NULL,`,
    `  status       TEXT NOT NULL,`,
    `  input_json   TEXT,`,
    `  output_json  TEXT,`,
    `  started_at   TIMESTAMP,`,
    `  ended_at     TIMESTAMP,`,
    `  error        TEXT`,
    `);`,
    ``,
    `CREATE TABLE IF NOT EXISTS workflow_approval_queue (`,
    `  id           TEXT PRIMARY KEY,`,
    `  run_id       TEXT NOT NULL,`,
    `  node_id      TEXT NOT NULL,`,
    `  state        TEXT NOT NULL,`,
    `  requested_at TIMESTAMP,`,
    `  decided_at   TIMESTAMP,`,
    `  decided_by   TEXT,`,
    `  reason       TEXT`,
    `);`,
    ``,
    `-- workflow_deploys uses IMMUTABLE TABLE for audit chain`,
    `CREATE IMMUTABLE TABLE IF NOT EXISTS workflow_deploys (`,
    `  id           TEXT PRIMARY KEY,`,
    `  workflow_id  TEXT NOT NULL,`,
    `  version      INT  NOT NULL,`,
    `  engine_url   TEXT NOT NULL,`,
    `  deployed_by  TEXT,`,
    `  deployed_at  TIMESTAMP,`,
    `  objects_json TEXT`,
    `);`,
  ].join('\n');
}

// ── Main compile function ──────────────────────────────────────────────────────

export function compile(wf: WorkflowDefinition): CompilationResult {
  const shortId = wf.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '_');
  const procName = `wf_${shortId}_v${wf.version}`;

  const triggers = wf.nodes.filter(n => n.data.nodeType === 'RowEventTrigger');
  const bodyNodes = wf.nodes.filter(n => n.data.nodeType !== 'RowEventTrigger');

  // Topological sort — emit in dependency order
  const sorted = topoSort(bodyNodes, wf.edges);

  // Nodes that are emitted INLINE by a branching parent (If/Switch/Loop).
  // These must NOT be emitted again at the sequential level — the parent
  // node's emitNode() call recurses into them.
  const branchInlinedIds = new Set<string>();
  for (const n of bodyNodes) {
    const type = n.data.nodeType;
    if (type === 'If') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id && (e2.sourceHandle === 'true' || e2.sourceHandle === 'false'))) {
        branchInlinedIds.add(e.target);
      }
    } else if (type === 'Switch') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id)) {
        branchInlinedIds.add(e.target);
      }
    } else if (type === 'Loop') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id && e2.sourceHandle === 'body')) {
        branchInlinedIds.add(e.target);
      }
    }
  }

  // Emit all sorted body nodes that are not owned by a branching parent.
  // For a linear chain A→B→C→D this emits all 4 in topological order.
  // For an If node the If is emitted (and recurses into its branches inline)
  // but the branch targets are excluded from this list.
  const emitNodes = sorted.filter(n => !branchInlinedIds.has(n.id));

  const bodyStatements = emitNodes
    .map(n => emitNode(n, wf.edges, wf.nodes))
    .join('\n\n');

  const header = [
    `-- Workflow: ${wf.meta.name}`,
    `-- Version: ${wf.version}`,
    `-- Generated by SynapCores Workflow Studio`,
    `-- Min engine version: ${wf.meta.minEngineVersion}`,
    `-- DO NOT EDIT — managed by workflow studio (id: ${wf.id})`,
    `-- Compiled at: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  const procedure = [
    `CREATE OR REPLACE PROCEDURE ${procName}(NEW JSON, OLD JSON)`,
    `BEGIN`,
    `  -- Studio run tracking variables`,
    `  DECLARE @_run_id TEXT;`,
    `  SET @_run_id = CONCAT('run_', '${shortId}', '_', REPLACE(CAST(NOW() AS TEXT), ' ', 'T'));`,
    `  INSERT INTO workflow_runs (id, workflow_id, version, trigger_kind, trigger_data, status, started_at)`,
    `    VALUES (@_run_id, '${wf.id}', ${wf.version}, 'trigger', CAST(NEW AS TEXT), 'running', NOW());`,
    ``,
    indent(bodyStatements, 2),
    ``,
    `  -- Mark run as success if not already marked (approval sets awaiting_approval)`,
    `  UPDATE workflow_runs SET status = 'success', ended_at = NOW()`,
    `    WHERE id = @_run_id AND status = 'running';`,
    `END;`,
  ].join('\n');

  const triggerDDL = triggers.length > 0 ? '\n\n' + emitTriggers(procName, triggers) : '';

  const deployAudit = [
    ``,
    `-- Deploy audit INSERT is executed separately at deploy time via Node proxy`,
    `-- INSERT INTO workflow_deploys (id, workflow_id, version, engine_url, deployed_at, objects_json)`,
    `--   VALUES ('<deploy_id>', '${wf.id}', ${wf.version}, '<engine_url>', NOW(), '<objects_json>');`,
  ].join('\n');

  const sql = header + procedure + triggerDDL + deployAudit;
  const hash = createHash('sha256').update(sql).digest('hex');
  const triggerNames = triggers.map(t => `trig_wf_${sanitizeId(t.id)}`);

  // Build individual trigger SQL statements for clean engine execution
  const triggerSqlList = triggers.map(t => {
    const d = t.data as Extract<NodeData, { nodeType: 'RowEventTrigger' }>;
    const table = d.table || 'unknown_table';
    const events = d.event === 'INSERT_OR_UPDATE' ? 'INSERT OR UPDATE' : d.event;
    const condition = d.condition ? `\n  WHEN (${d.condition})` : '';
    const triggerName = `trig_wf_${sanitizeId(t.id)}`;
    return [
      `CREATE OR REPLACE TRIGGER ${triggerName}`,
      `  AFTER ${events} ON ${table}`,
      `  FOR EACH ROW${condition}`,
      `  EXECUTE PROCEDURE ${procName}(NEW, OLD);`,
    ].join('\n');
  });

  return {
    workflowId: wf.id,
    version: wf.version,
    sql,
    procedureSql: procedure,  // just the procedure block
    triggerSqlList,            // individual trigger statements
    procedureName: procName,
    triggerNames,
    engineMinVersion: wf.meta.minEngineVersion,
    compiledAt: new Date().toISOString(),
    hash,
  };
}

export { validateWorkflow } from './validate';
