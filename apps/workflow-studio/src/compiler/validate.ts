/**
 * Client-safe workflow validation.
 * No server-only imports — safe to use from 'use client' components.
 */

import type { WorkflowDefinition, ValidationIssue, ValidationResult } from '@synapcores/workflow-types';

export function validateWorkflow(wf: WorkflowDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

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
  }

  // At least one trigger
  const hasTrigger = wf.nodes.some((n) => n.data.nodeType === 'RowEventTrigger');
  if (!hasTrigger) {
    issues.push({ severity: 'warning', message: 'No trigger node — workflow will never fire automatically' });
  }

  // Disconnected nodes
  if (wf.nodes.length > 1) {
    const connectedIds = new Set([
      ...wf.edges.map((e) => e.source),
      ...wf.edges.map((e) => e.target),
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
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
