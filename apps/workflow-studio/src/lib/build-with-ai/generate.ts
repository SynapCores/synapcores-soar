import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  WorkflowDefinitionSchema,
  WorkflowNodeDataSchema,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowEdge,
} from '@synapcores/workflow-types';
import { getAdminEngineClient } from '@/lib/engine-client';
import {
  BUILD_WITH_AI_SYSTEM_PROMPT,
  buildRefinePrompt,
} from './prompt';

// ── The simplified shape the LLM emits ────────────────────────────────────────

const LlmNodeSchema = z.object({
  id: z.string().min(1).max(32),
  kind: z.string().min(1),
  data: z.record(z.unknown()),
});

const LlmEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
});

const LlmWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  nodes: z.array(LlmNodeSchema).min(1).max(60),
  edges: z.array(LlmEdgeSchema).max(120),
});

const LlmErrorSchema = z.object({ error: z.string().min(1) });

const LlmResponseSchema = z.union([LlmWorkflowSchema, LlmErrorSchema]);

// ── Public input ──────────────────────────────────────────────────────────────

export interface GenerateRequest {
  /** Free-form description of what the user wants. */
  prompt: string;
  /** Optional previous workflow for refine mode. */
  previousWorkflow?: WorkflowDefinition;
  /** Optional refinement instruction (used iff previousWorkflow is set). */
  refinement?: string;
}

export type GenerateResult =
  | {
      ok: true;
      workflow: WorkflowDefinition;
      summary: string;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      /** Raw LLM output, for debugging in dev. */
      raw?: string;
    };

// ── The entry point ───────────────────────────────────────────────────────────

export async function generateWorkflow(req: GenerateRequest): Promise<GenerateResult> {
  if (!req.prompt || req.prompt.trim().length < 4) {
    return { ok: false, error: 'Prompt is too short.' };
  }

  const userMessage =
    req.previousWorkflow && req.refinement
      ? buildRefinePrompt(req.previousWorkflow, req.refinement)
      : req.prompt;

  const fullPrompt =
    `${BUILD_WITH_AI_SYSTEM_PROMPT}\n\nUSER REQUEST:\n${userMessage}\n\nOUTPUT JSON:`;

  let raw: string;
  try {
    raw = await callEngineGenerate(fullPrompt);
  } catch (e) {
    return { ok: false, error: `Engine call failed: ${describeError(e)}` };
  }

  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, raw };
  }

  const validated = LlmResponseSchema.safeParse(parsed.value);
  if (!validated.success) {
    return {
      ok: false,
      error: `LLM output did not match the workflow schema: ${validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      raw,
    };
  }

  if ('error' in validated.data) {
    return { ok: false, error: validated.data.error };
  }

  const llmWorkflow = validated.data;
  const { workflow, warnings } = expand(llmWorkflow, req.previousWorkflow);
  return {
    ok: true,
    workflow,
    summary: llmWorkflow.description || llmWorkflow.name,
    warnings,
  };
}

// ── Engine call ───────────────────────────────────────────────────────────────

async function callEngineGenerate(prompt: string): Promise<string> {
  const client = getAdminEngineClient();
  // Use GENERATE_TEXT — the engine routes to the configured AI provider
  // (native qwen2.5-coder:7b by default; [query.ai_service] in
  // gateway.toml overrides to OpenAI / Anthropic / etc.).
  // Pass the prompt as a bind param so quotes/newlines aren't a hazard.
  const result = await client.sql<{ text: string }>(
    "SELECT GENERATE_TEXT(:prompt, JSON_OBJECT('response_format', 'json')) AS text",
    [prompt],
  );
  const row = result.rows[0];
  if (!row || typeof row.text !== 'string' || row.text.length === 0) {
    throw new Error('Engine returned no text.');
  }
  return row.text;
}

// ── JSON parsing — be tolerant of model markdown fences + chatter ─────────────

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Strip ``` fences first, then locate the first '{' and last '}'.
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    return { ok: false, error: 'No JSON object found in LLM output.' };
  }
  const candidate = s.slice(first, last + 1);
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${describeError(e)}` };
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── Expand: layout + UUIDs + WorkflowDefinition shape ─────────────────────────

interface LlmWorkflow {
  name: string;
  description: string;
  nodes: { id: string; kind: string; data: Record<string, unknown> }[];
  edges: { source: string; target: string; label?: string }[];
}

function expand(
  llm: LlmWorkflow,
  previous: WorkflowDefinition | undefined,
): { workflow: WorkflowDefinition; warnings: string[] } {
  const warnings: string[] = [];

  // Validate every node's data against the discriminated union — this is
  // where we catch hallucinated kinds and missing required fields.
  const validatedNodes: { llmId: string; node: WorkflowNode }[] = [];
  for (const n of llm.nodes) {
    const dataWithKind = { nodeType: n.kind, ...n.data };
    const parsed = WorkflowNodeDataSchema.safeParse(dataWithKind);
    if (!parsed.success) {
      warnings.push(
        `Skipped node "${n.id}" (kind=${n.kind}): ` +
          parsed.error.issues
            .slice(0, 2)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
      );
      continue;
    }
    const uuid = randomUUID();
    validatedNodes.push({
      llmId: n.id,
      node: {
        id: uuid,
        type: 'workflow',
        position: { x: 0, y: 0 },
        data: parsed.data,
      },
    });
  }

  if (validatedNodes.length === 0) {
    // Every node failed validation — surface as an error upstream.
    throw new Error(
      `All nodes failed schema validation. Warnings: ${warnings.join(' | ')}`,
    );
  }

  // Auto-layout: simple top-down chain with horizontal branching at If/Switch
  // nodes. Coordinates are advisory — the user can rearrange after applying.
  const idMap = new Map(validatedNodes.map((v) => [v.llmId, v.node.id]));
  const COL = 280;
  const ROW = 140;
  // Compute a rank per node via topological BFS from triggers.
  const sources = new Set(validatedNodes.map((v) => v.llmId));
  const targets = new Set(llm.edges.map((e) => e.target));
  const roots = [...sources].filter((id) => !targets.has(id));
  const rank = new Map<string, number>(roots.map((id) => [id, 0]));
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const myRank = rank.get(id) ?? 0;
    for (const edge of llm.edges) {
      if (edge.source !== id) continue;
      const cur = rank.get(edge.target);
      const next = myRank + 1;
      if (cur === undefined || cur < next) {
        rank.set(edge.target, next);
        queue.push(edge.target);
      }
    }
  }
  // Tier-aware horizontal placement.
  const tiers = new Map<number, string[]>();
  for (const v of validatedNodes) {
    const r = rank.get(v.llmId) ?? 0;
    const t = tiers.get(r) ?? [];
    t.push(v.llmId);
    tiers.set(r, t);
  }
  for (const [r, ids] of tiers) {
    ids.forEach((llmId, idx) => {
      const node = validatedNodes.find((v) => v.llmId === llmId);
      if (!node) return;
      const offset = ids.length === 1 ? 0 : (idx - (ids.length - 1) / 2) * COL;
      node.node.position = { x: 200 + offset, y: 80 + r * ROW };
    });
  }

  // Edges: resolve llmId → UUID, drop any that reference missing nodes.
  const edges: WorkflowEdge[] = [];
  for (const e of llm.edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) {
      warnings.push(`Dropped edge ${e.source}→${e.target} (node not validated).`);
      continue;
    }
    edges.push({
      id: randomUUID(),
      source,
      target,
      sourceHandle: e.label ? `out-${e.label}` : null,
      targetHandle: null,
      label: e.label,
      animated: false,
    });
  }

  const now = new Date().toISOString();
  const workflow: WorkflowDefinition = {
    id: previous?.id ?? randomUUID(),
    version: previous?.version ?? 1,
    meta: {
      name: llm.name,
      description: llm.description,
      tags: previous?.meta.tags ?? [],
      targetEngineId: previous?.meta.targetEngineId ?? 'default',
      minEngineVersion: previous?.meta.minEngineVersion ?? '1.8.6',
    },
    nodes: validatedNodes.map((v) => v.node),
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  // Final pass through the full WorkflowDefinition schema as belt-and-braces.
  const final = WorkflowDefinitionSchema.safeParse(workflow);
  if (!final.success) {
    throw new Error(
      `Expanded workflow failed schema: ${final.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  // Soft warnings on structural shape (not blocking, just informational).
  const triggers = validatedNodes.filter(
    (v) => v.node.data.nodeType === 'RowEventTrigger',
  );
  if (triggers.length === 0) {
    warnings.push('No trigger node — workflow has no entry point.');
  } else if (triggers.length > 1) {
    warnings.push(`Multiple trigger nodes (${triggers.length}) — only the first fires.`);
  }
  const returns = validatedNodes.filter(
    (v) => v.node.data.nodeType === 'Return',
  );
  if (returns.length === 0) {
    warnings.push('No Return node — workflow has no terminating leaf.');
  }

  return { workflow: final.data, warnings };
}
