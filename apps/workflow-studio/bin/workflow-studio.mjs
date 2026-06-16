#!/usr/bin/env node
/**
 * Workflow Studio CLI
 *
 * Commands:
 *   workflow-studio start              — start the Next.js server
 *   workflow-studio compile <file>     — compile workflow JSON to SQL (prints to stdout)
 *   workflow-studio compile <file> --out <output.sql>  — write SQL to file
 *   workflow-studio deploy <file>      — compile + deploy via REST API
 *   workflow-studio bootstrap          — run DB bootstrap
 *   workflow-studio validate <file>    — validate workflow JSON and print issues
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [, , command, ...args] = process.argv;

async function readWorkflowFile(path) {
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text);
}

// ── Inline compiler (mirrors src/compiler/index.ts — no Next.js dependency) ──

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
}

function escapeSql(val) {
  return val.replace(/'/g, "''");
}

function indent(code, spaces = 2) {
  return code.split('\n').map(l => (l.trim() ? ' '.repeat(spaces) + l : l)).join('\n');
}

function topoSort(nodes, edges) {
  const inDegree = new Map();
  const adj = new Map();
  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const queue = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0);
  const result = [];
  while (queue.length > 0) {
    const node = queue.shift();
    result.push(node);
    for (const nid of (adj.get(node.id) ?? [])) {
      const deg = (inDegree.get(nid) ?? 0) - 1;
      inDegree.set(nid, deg);
      if (deg === 0) { const nb = nodes.find(n => n.id === nid); if (nb) queue.push(nb); }
    }
  }
  return result.length === nodes.length ? result : nodes;
}

function withStepTracking(node, bodyLines) {
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

function emitNode(node, edges, allNodes) {
  if (node.data.disabled) return `-- [DISABLED] ${node.data.label}`;
  const d = node.data;
  const sid = sanitizeId(node.id);

  switch (d.nodeType) {
    case 'RowEventTrigger':
      return '-- [RowEventTrigger: handled at trigger level]';

    case 'MemoryStore': {
      const ns = escapeSql(d.namespace || 'default');
      const content = d.contentExpr || '@input';
      const meta = d.metadataExpr ? `, ${d.metadataExpr}` : ', NULL';
      return withStepTracking(node, `SET @memory_store_${sid} = MEMORY_STORE('${ns}', ${content}${meta});`);
    }

    case 'MemoryRecall': {
      const ns = escapeSql(d.namespace || 'default');
      const query = d.queryExpr || '@query';
      const topK = d.topK ?? 5;
      const outVar = d.outputVariable || `@recall_${sid}`;
      return withStepTracking(node, `SET ${outVar} = MEMORY_RECALL('${ns}', ${query}, ${topK});`);
    }

    case 'AgentRun': {
      const prompt = escapeSql(d.promptTemplate || 'Perform the task.');
      const model = d.model ? `'${escapeSql(d.model)}'` : 'NULL';
      const tools = d.tools?.length > 0 ? `'${escapeSql(d.tools.join(','))}'` : 'NULL';
      const outVar = d.outputVariable || `@agent_${sid}`;
      const body = [
        `SET ${outVar} = AGENT_RUN('${prompt}', ${model}, ${tools});`,
        `UPDATE workflow_step_runs SET output_json = JSON_OBJECT('result', ${outVar})`,
        `  WHERE id = CONCAT('step_', @_run_id, '_${sid}');`,
      ].join('\n');
      return withStepTracking(node, body);
    }

    case 'SqlQuery': {
      const sql = (d.sql || 'SELECT 1').trim().replace(/;$/, '');
      return withStepTracking(node, `${sql};`);
    }

    case 'HttpRequest': {
      const outVar = d.outputVariable || `@http_${sid}`;
      const method = escapeSql(d.method || 'GET');
      const url = escapeSql(d.url || '');
      const inputJson = JSON.stringify({
        method: d.method, url: d.url, headers: d.headers, body: d.bodyExpr, timeoutMs: d.timeoutMs
      }).replace(/'/g, "''");
      return [
        `-- HTTP_EGRESS_CALLOUT step_${sid}`,
        `-- Method: ${d.method || 'GET'} | URL: ${d.url || '(unset)'} | Timeout: ${d.timeoutMs ?? 30000}ms`,
        `-- Node proxy executes HTTP call; writes result to workflow_step_runs.output_json`,
        `INSERT INTO workflow_step_runs (id, run_id, node_id, node_type, status, input_json, started_at)`,
        `  VALUES (CONCAT('step_', @_run_id, '_${sid}'), @_run_id, '${node.id}', 'HttpRequest', 'pending_http', '${inputJson}', NOW());`,
        `SET ${outVar} = NULL; -- proxy fills this via output_json`,
      ].join('\n');
    }

    case 'If': {
      const condition = d.condition || 'TRUE';
      const trueEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'true');
      const falseEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'false');
      const trueTarget = trueEdge ? allNodes.find(n => n.id === trueEdge.target) : null;
      const falseTarget = falseEdge ? allNodes.find(n => n.id === falseEdge.target) : null;
      const trueBranch = trueTarget ? indent(emitNode(trueTarget, edges, allNodes), 2) : '  -- (no true branch)';
      const falseBranch = falseTarget ? indent(emitNode(falseTarget, edges, allNodes), 2) : '  -- (no false branch)';
      return `-- If: ${d.label}\nIF ${condition} THEN\n${trueBranch}\nELSE\n${falseBranch}\nEND IF;`;
    }

    case 'Switch': {
      const expr = d.expression || '@value';
      let caseBody = '';
      for (const c of d.cases || []) {
        const caseEdge = edges.find(e => e.source === node.id && e.sourceHandle === c.value);
        const target = caseEdge ? allNodes.find(n => n.id === caseEdge.target) : null;
        const body = target ? indent(emitNode(target, edges, allNodes), 4) : '    -- (no handler)';
        caseBody += `  WHEN '${escapeSql(c.value)}' THEN\n${body}\n`;
      }
      if (d.defaultCase) {
        const defaultEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'default');
        const target = defaultEdge ? allNodes.find(n => n.id === defaultEdge.target) : null;
        caseBody += `  ELSE\n${target ? indent(emitNode(target, edges, allNodes), 4) : '    -- (no default)'}\n`;
      }
      return `-- Switch: ${d.label}\nCASE ${expr}\n${caseBody}END CASE;`;
    }

    case 'Loop': {
      const condition = d.condition || 'FALSE';
      const maxIter = d.maxIterations ?? 100;
      const bodyEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'body');
      const target = bodyEdge ? allNodes.find(n => n.id === bodyEdge.target) : null;
      const iterVar = `@_loop_iter_${sid}`;
      const bodyCode = target ? indent(emitNode(target, edges, allNodes), 2) : '  -- (empty)';
      return `-- Loop: ${d.label}\nSET ${iterVar} = 0;\nWHILE ${condition} AND ${iterVar} < ${maxIter} LOOP\n${bodyCode}\n  SET ${iterVar} = ${iterVar} + 1;\nEND LOOP;`;
    }

    case 'Approval': {
      const title = escapeSql(d.title || 'Approval Required');
      const message = escapeSql(d.message || '');
      return [
        `-- Approval Gate: ${d.label}`,
        `-- Title: ${title} | Timeout: ${d.timeoutMs ?? 86400000}ms`,
        `INSERT INTO workflow_approval_queue (id, run_id, node_id, state, requested_at)`,
        `  VALUES (CONCAT('apr_', '${sid}', '_', @_run_id), @_run_id, '${node.id}', 'awaiting', NOW());`,
        `UPDATE workflow_runs SET status = 'awaiting_approval' WHERE id = @_run_id;`,
        `RETURN;`,
      ].join('\n');
    }

    case 'SetVariable': {
      if (!d.assignments?.length) return `-- Set Variable: ${d.label} (no assignments)`;
      const body = d.assignments.map(a => `SET ${a.variable} = ${a.expression};`).join('\n');
      return withStepTracking(node, body);
    }

    case 'Return': {
      const expr = d.expression || 'NULL';
      // Update run status BEFORE RETURN — the trailing success-UPDATE at the
      // procedure foot is dead code once RETURN fires.
      return [
        `-- Return: ${d.label}`,
        `UPDATE workflow_runs SET status = 'success', ended_at = NOW()`,
        `  WHERE id = @_run_id AND status = 'running';`,
        `RETURN ${expr};`,
      ].join('\n');
    }

    default:
      return `-- Unknown node type: ${d.nodeType}`;
  }
}

function emitTriggers(procName, triggers) {
  return triggers.map(t => {
    const d = t.data;
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
  }).join('\n\n');
}

function compileWorkflow(wf) {
  const shortId = wf.id.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '_');
  const procName = `wf_${shortId}_v${wf.version}`;
  const triggers = wf.nodes.filter(n => n.data.nodeType === 'RowEventTrigger');
  const bodyNodes = wf.nodes.filter(n => n.data.nodeType !== 'RowEventTrigger');
  const sorted = topoSort(bodyNodes, wf.edges);

  // Nodes emitted inline by a branching parent (If/Switch/Loop). These must
  // NOT appear in the sequential emit list — the parent's emitNode() recurses
  // into them. For a linear chain A→B→C→D all four ARE emitted in order.
  const branchInlinedIds = new Set();
  for (const n of bodyNodes) {
    if (n.data.nodeType === 'If') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id && (e2.sourceHandle === 'true' || e2.sourceHandle === 'false'))) {
        branchInlinedIds.add(e.target);
      }
    } else if (n.data.nodeType === 'Switch') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id)) {
        branchInlinedIds.add(e.target);
      }
    } else if (n.data.nodeType === 'Loop') {
      for (const e of wf.edges.filter(e2 => e2.source === n.id && e2.sourceHandle === 'body')) {
        branchInlinedIds.add(e.target);
      }
    }
  }

  const emitNodes = sorted.filter(n => !branchInlinedIds.has(n.id));
  const bodyStatements = emitNodes.map(n => emitNode(n, wf.edges, wf.nodes)).join('\n\n');

  const header = [
    `-- Workflow: ${wf.meta?.name}`,
    `-- Version: ${wf.version}`,
    `-- Generated by SynapCores Workflow Studio (CLI)`,
    `-- Min engine version: ${wf.meta?.minEngineVersion ?? '1.8.5'}`,
    `-- DO NOT EDIT — managed by workflow studio (id: ${wf.id})`,
    `-- Compiled at: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  const procedure = [
    `CREATE OR REPLACE PROCEDURE ${procName}(NEW JSON, OLD JSON)`,
    `BEGIN`,
    `  DECLARE @_run_id TEXT;`,
    `  SET @_run_id = CONCAT('run_', '${shortId}', '_', REPLACE(CAST(NOW() AS TEXT), ' ', 'T'));`,
    `  INSERT INTO workflow_runs (id, workflow_id, version, trigger_kind, trigger_data, status, started_at)`,
    `    VALUES (@_run_id, '${wf.id}', ${wf.version}, 'trigger', CAST(NEW AS TEXT), 'running', NOW());`,
    '',
    indent(bodyStatements, 2),
    '',
    `  UPDATE workflow_runs SET status = 'success', ended_at = NOW()`,
    `    WHERE id = @_run_id AND status = 'running';`,
    `END;`,
  ].join('\n');

  const triggerDDL = triggers.length > 0 ? '\n\n' + emitTriggers(procName, triggers) : '';
  const sql = header + procedure + triggerDDL;
  const hash = createHash('sha256').update(sql).digest('hex');
  return { sql, procName, triggerNames: triggers.map(t => `trig_wf_${sanitizeId(t.id)}`), hash };
}

// ── Validate ──────────────────────────────────────────────────────────────────

function validateWorkflow(wf) {
  const issues = [];
  if (!wf.meta?.name?.trim()) issues.push({ severity: 'error', message: 'Workflow must have a name' });
  for (const node of wf.nodes ?? []) {
    const d = node.data;
    if (d.nodeType === 'RowEventTrigger' && !d.table?.trim())
      issues.push({ nodeId: node.id, severity: 'error', message: 'Trigger must specify a table' });
    if (d.nodeType === 'AgentRun' && !d.promptTemplate?.trim())
      issues.push({ nodeId: node.id, severity: 'error', message: 'Agent Run must have a prompt template' });
    if (d.nodeType === 'HttpRequest' && !d.url?.trim())
      issues.push({ nodeId: node.id, severity: 'error', message: 'HTTP Request must have a URL' });
  }
  if (!(wf.nodes ?? []).some(n => n.data.nodeType === 'RowEventTrigger'))
    issues.push({ severity: 'warning', message: 'No trigger node — workflow will never fire automatically' });
  return { valid: issues.filter(i => i.severity === 'error').length === 0, issues };
}

// ── Command dispatch ──────────────────────────────────────────────────────────

switch (command) {
  case 'start':
  case undefined: {
    await import('./server.js').catch(() => {
      console.error('[workflow-studio] Production server not found. Run: pnpm build first.');
      process.exit(1);
    });
    break;
  }

  case 'compile': {
    const inputFile = args.find(a => !a.startsWith('--'));
    const outIdx = args.indexOf('--out');
    const outFile = outIdx !== -1 ? args[outIdx + 1] : null;

    if (!inputFile) {
      console.error('Usage: workflow-studio compile <workflow.json> [--out output.sql]');
      process.exit(1);
    }

    const wf = await readWorkflowFile(inputFile);

    // Validate first
    const validation = validateWorkflow(wf);
    if (!validation.valid) {
      console.error('[compile] Validation errors:');
      for (const issue of validation.issues) {
        console.error(`  [${issue.severity}] ${issue.nodeId ? `Node ${issue.nodeId}: ` : ''}${issue.message}`);
      }
      process.exit(1);
    }

    if (validation.issues.some(i => i.severity === 'warning')) {
      console.warn('[compile] Warnings:');
      for (const issue of validation.issues.filter(i => i.severity === 'warning')) {
        console.warn(`  [warn] ${issue.message}`);
      }
    }

    const { sql, procName, triggerNames, hash } = compileWorkflow(wf);

    if (outFile) {
      await writeFile(outFile, sql, 'utf-8');
      console.log(`[compile] Wrote ${sql.length} bytes to ${outFile}`);
      console.log(`[compile] Procedure: ${procName}`);
      if (triggerNames.length > 0) console.log(`[compile] Triggers: ${triggerNames.join(', ')}`);
      console.log(`[compile] SHA256: ${hash}`);
    } else {
      process.stdout.write(sql + '\n');
      process.stderr.write(`-- Procedure: ${procName}\n`);
      if (triggerNames.length > 0) process.stderr.write(`-- Triggers: ${triggerNames.join(', ')}\n`);
      process.stderr.write(`-- SHA256: ${hash}\n`);
    }
    break;
  }

  case 'validate': {
    if (!args[0]) {
      console.error('Usage: workflow-studio validate <workflow.json>');
      process.exit(1);
    }
    const wf = await readWorkflowFile(args[0]);
    const result = validateWorkflow(wf);
    if (result.valid) {
      console.log('[validate] OK — no errors');
    } else {
      console.error('[validate] FAILED:');
    }
    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? '[ERROR]' : '[WARN] ';
      console.log(`  ${prefix} ${issue.nodeId ? `Node ${issue.nodeId}: ` : ''}${issue.message}`);
    }
    process.exit(result.valid ? 0 : 1);
    break;
  }

  case 'deploy': {
    if (!args[0]) {
      console.error('Usage: workflow-studio deploy <workflow.json>');
      process.exit(1);
    }
    const wf = await readWorkflowFile(args[0]);
    const studioUrl = process.env.STUDIO_URL ?? 'http://localhost:3010';
    const apiKey = process.env.STUDIO_API_KEY ?? '';

    console.log(`[deploy] Deploying "${wf.meta?.name}" to Studio at ${studioUrl}...`);
    const res = await fetch(`${studioUrl}/api/v1/workflows/${wf.id}/deploy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ definition: wf }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error('[deploy] Failed:', body.error ?? res.status);
      if (body.issues) {
        for (const issue of body.issues) {
          console.error(`  [${issue.severity}] ${issue.message}`);
        }
      }
      process.exit(1);
    }
    console.log('[deploy] Success!');
    console.log(`  Deploy ID:  ${body.deployId}`);
    console.log(`  Procedure:  ${body.procedureName}`);
    if (body.triggerNames?.length > 0) {
      console.log(`  Triggers:   ${body.triggerNames.join(', ')}`);
    }
    console.log(`  Hash:       ${body.hash}`);
    break;
  }

  case 'bootstrap': {
    await import('./bootstrap.mjs').catch(async () => {
      await import('./bin/bootstrap.mjs');
    });
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: workflow-studio <start|compile|validate|deploy|bootstrap>');
    console.error('');
    console.error('Commands:');
    console.error('  compile <file.json> [--out output.sql]  Compile workflow to SQL');
    console.error('  validate <file.json>                    Validate workflow JSON');
    console.error('  deploy <file.json>                      Deploy via Studio REST API');
    console.error('  start                                   Start the Studio server');
    console.error('  bootstrap                               Initialize engine schema');
    process.exit(1);
}
