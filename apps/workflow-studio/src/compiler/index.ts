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

// ── Per-node SQL emitters ──────────────────────────────────────────────────────

function emitRowEventTrigger(_node: WorkflowNode): string {
  return '-- [RowEventTrigger: handled at trigger level]';
}

function emitMemoryStore(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'MemoryStore' }>;
  const ns = d.namespace || 'default';
  const content = d.contentExpr || '@input';
  const meta = d.metadataExpr ? `, ${d.metadataExpr}` : ', NULL';
  return `-- Memory Store: ${d.label}\nSELECT MEMORY_STORE('${ns}', ${content}${meta}) INTO @memory_store_${sanitizeId(node.id)};`;
}

function emitMemoryRecall(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'MemoryRecall' }>;
  const ns = d.namespace || 'default';
  const query = d.queryExpr || '@query';
  const topK = d.topK ?? 5;
  const outVar = d.outputVariable || `@recall_${sanitizeId(node.id)}`;
  return `-- Memory Recall: ${d.label}\nSELECT * FROM MEMORY_RECALL('${ns}', ${query}, ${topK}) INTO TABLE ${outVar};`;
}

function emitAgentRun(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'AgentRun' }>;
  const prompt = (d.promptTemplate || 'Perform the task.').replace(/'/g, "''");
  const model = d.model ? `'${d.model}'` : 'NULL';
  const tools = d.tools.length > 0 ? `'${d.tools.join(',')}'` : 'NULL';
  const outVar = d.outputVariable || `@agent_${sanitizeId(node.id)}`;
  return `-- Agent Run: ${d.label}\nSELECT AGENT_RUN('${prompt}', ${model}, ${tools}) INTO ${outVar};`;
}

function emitSqlQuery(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'SqlQuery' }>;
  const outVar = d.outputVariable || `@sql_${sanitizeId(node.id)}`;
  const sql = (d.sql || 'SELECT 1').trim().replace(/;$/, '');
  return `-- SQL Query: ${d.label}\n${sql} INTO TABLE ${outVar};`;
}

function emitHttpRequest(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'HttpRequest' }>;
  const outVar = d.outputVariable || `@http_${sanitizeId(node.id)}`;
  const method = d.method || 'GET';
  const url = d.url.replace(/'/g, "''");
  const headers = JSON.stringify(d.headers || {}).replace(/'/g, "''");
  const body = d.bodyExpr ? d.bodyExpr : 'NULL';
  return `-- HTTP Request: ${d.label}\nCALL execute_http_request('${method}', '${url}', '${headers}', ${body}) INTO ${outVar};`;
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

  return `-- If: ${d.label}\nIF ${condition} THEN\n${trueBranch}\nELSE\n${falseBranch}\nEND IF;`;
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
    caseBody += `  WHEN '${c.value.replace(/'/g, "''")}' THEN\n${body}\n`;
  }

  if (d.defaultCase) {
    const defaultEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'default');
    const target = defaultEdge ? allNodes.find(n => n.id === defaultEdge.target) : null;
    const body = target
      ? indent(emitNode(target, edges, allNodes), 4)
      : '    -- (no default handler)';
    caseBody += `  ELSE\n${body}\n`;
  }

  return `-- Switch: ${d.label}\nCASE ${expr}\n${caseBody}END CASE;`;
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

  return `-- Loop: ${d.label}\nSET ${iterVar} = 0;\nWHILE ${condition} AND ${iterVar} < ${maxIter} LOOP\n${body}\n  SET ${iterVar} = ${iterVar} + 1;\nEND LOOP;`;
}

function emitApproval(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'Approval' }>;
  const title = d.title.replace(/'/g, "''");
  const message = d.message.replace(/'/g, "''");
  const approvalId = sanitizeId(node.id);
  return [
    `-- Approval Gate: ${d.label}`,
    `INSERT INTO workflow_approval_queue (id, run_id, node_id, state, requested_at)`,
    `  VALUES (CONCAT('apr_', '${approvalId}', '_', NOW()), @_run_id, '${node.id}', 'awaiting', NOW());`,
    `-- Procedure returns here; second trigger on workflow_approval_queue resumes on state change.`,
    `-- Title: ${title}`,
    `-- Message: ${message}`,
    `RETURN;`,
  ].join('\n');
}

function emitSetVariable(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'SetVariable' }>;
  if (!d.assignments.length) return `-- Set Variable: ${d.label} (no assignments)`;
  return d.assignments.map(a => `SET ${a.variable} = ${a.expression};`).join('\n');
}

function emitReturn(node: WorkflowNode): string {
  const d = node.data as Extract<NodeData, { nodeType: 'Return' }>;
  const expr = d.expression || 'NULL';
  return `-- Return: ${d.label}\nRETURN ${expr};`;
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

// ── Main compile function ──────────────────────────────────────────────────────

export function compile(wf: WorkflowDefinition): CompilationResult {
  const shortId = wf.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '_');
  const procName = `wf_${shortId}_v${wf.version}`;

  const triggers = wf.nodes.filter(n => n.data.nodeType === 'RowEventTrigger');
  const bodyNodes = wf.nodes.filter(n => n.data.nodeType !== 'RowEventTrigger');

  // Topological sort — emit in dependency order
  const sorted = topoSort(bodyNodes, wf.edges);

  // Top-level = body nodes with no incoming edges from other body nodes
  const bodyNodeIds = new Set(bodyNodes.map(n => n.id));
  const incomingFromBody = new Set(
    wf.edges
      .filter(e => bodyNodeIds.has(e.source))
      .map(e => e.target),
  );

  const topLevel = sorted.filter(n => !incomingFromBody.has(n.id));

  const bodyStatements = topLevel
    .map(n => emitNode(n, wf.edges, wf.nodes))
    .join('\n\n');

  const header = [
    `-- Workflow: ${wf.meta.name}`,
    `-- Version: ${wf.version}`,
    `-- Generated by SynapCores Workflow Studio`,
    `-- Min engine version: ${wf.meta.minEngineVersion}`,
    `-- DO NOT EDIT — managed by workflow studio (id: ${wf.id})`,
    '',
  ].join('\n');

  const procedure = [
    `CREATE OR REPLACE PROCEDURE ${procName}(NEW JSON, OLD JSON)`,
    `BEGIN`,
    `  -- Studio variables`,
    `  DECLARE @_run_id TEXT;`,
    `  SET @_run_id = CONCAT('run_', '${shortId}', '_', NOW());`,
    `  INSERT INTO workflow_runs (id, workflow_id, version, trigger_kind, status, started_at)`,
    `    VALUES (@_run_id, '${wf.id}', ${wf.version}, 'trigger', 'running', NOW());`,
    ``,
    indent(bodyStatements, 2),
    ``,
    `  UPDATE workflow_runs SET status = 'success', ended_at = NOW() WHERE id = @_run_id;`,
    `END;`,
  ].join('\n');

  const triggerDDL = triggers.length > 0 ? '\n\n' + emitTriggers(procName, triggers) : '';

  const deployAudit = [
    ``,
    `-- Deploy audit (insert into workflow_deploys separately at deploy time)`,
  ].join('\n');

  const sql = header + procedure + triggerDDL + deployAudit;
  const hash = createHash('sha256').update(sql).digest('hex');
  const triggerNames = triggers.map(t => `trig_wf_${sanitizeId(t.id)}`);

  return {
    workflowId: wf.id,
    version: wf.version,
    sql,
    procedureName: procName,
    triggerNames,
    engineMinVersion: wf.meta.minEngineVersion,
    compiledAt: new Date().toISOString(),
    hash,
  };
}

// ── Workflow validator ────────────────────────────────────────────────────────

export function validateWorkflow(wf: WorkflowDefinition) {
  const issues: Array<{
    nodeId?: string;
    edgeId?: string;
    severity: 'error' | 'warning';
    message: string;
    field?: string;
  }> = [];

  if (!wf.meta.name.trim()) {
    issues.push({ severity: 'error', message: 'Workflow must have a name' });
  }

  for (const node of wf.nodes) {
    const d = node.data;

    if (d.nodeType === 'RowEventTrigger') {
      if (!d.table?.trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Trigger must specify a table', field: 'table' });
      }
    }
    if (d.nodeType === 'AgentRun') {
      if (!d.promptTemplate?.trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Agent Run must have a prompt template', field: 'promptTemplate' });
      }
    }
    if (d.nodeType === 'HttpRequest') {
      if (!d.url?.trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'HTTP Request must have a URL', field: 'url' });
      }
    }
    if (d.nodeType === 'SqlQuery') {
      if (!d.sql?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'SQL Query is empty', field: 'sql' });
      }
    }
    if (d.nodeType === 'If') {
      if (!d.condition?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'If node has no condition', field: 'condition' });
      }
    }
    if (d.nodeType === 'Loop') {
      if (!d.condition?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Loop node has no condition — will never execute body', field: 'condition' });
      }
    }
    if (d.nodeType === 'Switch') {
      if (!d.expression?.trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Switch node must have an expression', field: 'expression' });
      }
      if (d.cases.length === 0) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Switch node has no cases defined', field: 'cases' });
      }
    }
    if (d.nodeType === 'Return') {
      if (!d.expression?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Return node has no expression — will return NULL', field: 'expression' });
      }
    }
    if (d.nodeType === 'MemoryStore') {
      if (!d.namespace?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Memory Store should specify a namespace', field: 'namespace' });
      }
    }
    if (d.nodeType === 'MemoryRecall') {
      if (!d.namespace?.trim()) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Memory Recall should specify a namespace', field: 'namespace' });
      }
    }
  }

  // Check that at least one trigger exists
  const hasTrigger = wf.nodes.some(n => n.data.nodeType === 'RowEventTrigger');
  if (!hasTrigger) {
    issues.push({ severity: 'warning', message: 'No trigger node — workflow will never fire automatically' });
  }

  // Check for disconnected nodes
  if (wf.nodes.length > 1) {
    const connectedIds = new Set([
      ...wf.edges.map(e => e.source),
      ...wf.edges.map(e => e.target),
    ]);
    for (const node of wf.nodes) {
      if (!connectedIds.has(node.id)) {
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          message: `Node "${node.data.label}" is not connected to any other node`,
        });
      }
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}
