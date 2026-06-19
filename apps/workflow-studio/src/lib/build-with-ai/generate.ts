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

// ── Per-node-type handle vocabulary ──────────────────────────────────────────
//
// The canvas nodes declare these handle ids; sourceHandle must match exactly
// or React Flow either drops the edge or lands it on the default port (which
// produces the silent-mis-wiring bug we hit before).

interface HandleSpec {
  /** Output handle ids the node component actually declares. */
  outputs: readonly string[];
  /** LLM label synonyms → canonical handle id (lowercased keys). */
  synonyms: Record<string, string>;
}

const NODE_HANDLES: Record<string, HandleSpec> = {
  RowEventTrigger: { outputs: ['output'], synonyms: {} },
  MemoryStore: { outputs: ['output'], synonyms: {} },
  MemoryRecall: { outputs: ['output'], synonyms: {} },
  AgentRun: { outputs: ['output'], synonyms: {} },
  SqlQuery: { outputs: ['output'], synonyms: {} },
  HttpRequest: { outputs: ['output'], synonyms: {} },
  SetVariable: { outputs: ['output'], synonyms: {} },
  Return: { outputs: [], synonyms: {} },
  If: {
    outputs: ['true', 'false'],
    synonyms: {
      yes: 'true',
      pass: 'true',
      passed: 'true',
      ok: 'true',
      success: 'true',
      high: 'true',
      'high-risk': 'true',
      hit: 'true',
      no: 'false',
      fail: 'false',
      failed: 'false',
      low: 'false',
      'low-risk': 'false',
      miss: 'false',
    },
  },
  Loop: {
    outputs: ['body', 'done'],
    synonyms: {
      iterate: 'body',
      each: 'body',
      iteration: 'body',
      finished: 'done',
      end: 'done',
      after: 'done',
      complete: 'done',
    },
  },
  Approval: {
    outputs: ['approved', 'rejected', 'timed_out'],
    synonyms: {
      approve: 'approved',
      accept: 'approved',
      accepted: 'approved',
      yes: 'approved',
      reject: 'rejected',
      deny: 'rejected',
      denied: 'rejected',
      no: 'rejected',
      timeout: 'timed_out',
      'timed-out': 'timed_out',
      expired: 'timed_out',
    },
  },
  // Switch: case values are dynamic. The post-processor doesn't normalize
  // them — the LLM is told to emit the case value verbatim. `default` is
  // accepted as the fallthrough label.
  Switch: {
    outputs: [],
    synonyms: {},
  },
};

// Title-case-ish synonyms for the `kind` field — handles "approval" or
// "approval_gate" coming back from a sloppy model.
const KIND_ALIASES: Record<string, string> = {
  roweventtrigger: 'RowEventTrigger',
  row_event_trigger: 'RowEventTrigger',
  rowevent: 'RowEventTrigger',
  trigger: 'RowEventTrigger',
  memorystore: 'MemoryStore',
  memory_store: 'MemoryStore',
  store: 'MemoryStore',
  memoryrecall: 'MemoryRecall',
  memory_recall: 'MemoryRecall',
  recall: 'MemoryRecall',
  agentrun: 'AgentRun',
  agent_run: 'AgentRun',
  agent: 'AgentRun',
  sqlquery: 'SqlQuery',
  sql_query: 'SqlQuery',
  sql: 'SqlQuery',
  httprequest: 'HttpRequest',
  http_request: 'HttpRequest',
  http: 'HttpRequest',
  if: 'If',
  ifelse: 'If',
  'if-else': 'If',
  if_else: 'If',
  branch: 'If',
  switch: 'Switch',
  case: 'Switch',
  loop: 'Loop',
  while: 'Loop',
  foreach: 'Loop',
  approval: 'Approval',
  approval_gate: 'Approval',
  approvalgate: 'Approval',
  approve: 'Approval',
  setvariable: 'SetVariable',
  set_variable: 'SetVariable',
  set: 'SetVariable',
  assign: 'SetVariable',
  return: 'Return',
  'return-value': 'Return',
};

function normalizeKind(raw: string): string {
  // Strip whitespace + non-alphanumerics for the lookup key.
  const key = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return KIND_ALIASES[key] ?? raw;
}

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
      /** Raw LLM output — surfaced on success too so a debug harness can
       *  compare prompt → raw → parsed shape. The route only exposes this
       *  when NODE_ENV !== 'production'. */
      raw?: string;
    }
  | {
      ok: false;
      error: string;
      /** Raw LLM output, for debugging in dev. */
      raw?: string;
    };

// Min engine version that knows about every kind/option we emit. Bump in
// lockstep with the engine canary so old engines reject the workflow up
// front instead of failing weirdly mid-run.
const MIN_ENGINE_VERSION = '1.8.7';

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
    return { ok: false, error: validated.data.error, raw };
  }

  const llmWorkflow = validated.data;
  const { workflow, warnings } = expand(llmWorkflow, req.previousWorkflow);
  return {
    ok: true,
    workflow,
    summary: llmWorkflow.description || llmWorkflow.name,
    warnings,
    raw,
  };
}

// ── Engine call ───────────────────────────────────────────────────────────────

async function callEngineGenerate(prompt: string): Promise<string> {
  const baseUrl = (process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080').replace(/\/+$/, '');
  const apiKey = process.env.SYNAPCORES_API_KEY ?? '';

  // 300s — on CPU, qwen2.5-coder:7b emits ~5 tok/s. A 1024-token workflow
  // answer takes ~3 min. Cloud providers come back in 2-5s and this never
  // trips.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 300_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/query/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // v1.8.7 GENERATE options:
        //   max_tokens=2048 — room for ~12 node workflows
        //   temperature=0.2 — tight sampling so the model commits early
        //   top_p=0.95 — leave the long tail untruncated so it picks the
        //               right kind name when the leader is wrong
        //   seed=20260619 — reproducible takes for screenshot/demo runs
        //   response_format=json — engine applies a lazy JSON grammar so
        //                          output is a JSON value, no markdown
        //                          fences. The fallback parser stays in
        //                          place in case an older engine ignores
        //                          this option.
        sql:
          "SELECT GENERATE($1, json_object(" +
          "'max_tokens', 2048, " +
          "'temperature', 0.2, " +
          "'top_p', 0.95, " +
          "'seed', 20260619, " +
          "'response_format', 'json'" +
          ")) AS text",
        parameters: [prompt],
      }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`engine ${res.status}: ${body.slice(0, 300)}`);
  }
  const wire = (await res.json()) as {
    data?: { rows?: unknown[][] };
    error?: { message?: string };
  };
  if (wire.error) {
    throw new Error(wire.error.message ?? 'engine error');
  }
  const text = wire.data?.rows?.[0]?.[0];
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('engine returned no text');
  }
  return text;
}

// ── JSON parsing — tolerant of markdown fences, chatter, trailing commas ─────

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let s = raw.trim();
  // Strip ``` fences and any "json" tag.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    return { ok: false, error: 'No JSON object found in LLM output.' };
  }
  const candidate = s.slice(first, last + 1);
  // Strict first.
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    // Fall through to the tolerant pass.
  }
  // Tolerant: drop trailing commas before } or ]. Small models do this
  // constantly when temperature is low and they trail off after the last
  // field.
  const repaired = candidate.replace(/,(\s*[}\]])/g, '$1');
  try {
    return { ok: true, value: JSON.parse(repaired) };
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

const LAYOUT_COL = 280;
const LAYOUT_ROW = 140;
const LAYOUT_MAX_TIER_WIDTH = 5; // siblings per tier before we wrap into a 2nd row

// ── Per-kind data coercion (LLM types are sloppy) ─────────────────────────────
//
// Small models routinely emit string-typed values where the schema needs a
// number / boolean / enum — "10" instead of 10, "default" or "true" instead
// of the boolean defaultCase, "string" instead of TEXT for returnType. Each
// of those drops the node AND every dependent edge, cascading 6 warnings
// from one root cause.
//
// We pre-coerce known fields per kind here, before Zod validation, and
// emit a single low-severity warning per coercion.

const COERCERS: Record<string, (data: Record<string, unknown>, warn: (m: string) => void) => Record<string, unknown>> = {
  Loop: (d, warn) => {
    const out = { ...d };
    if (typeof out.maxIterations === 'string') {
      const n = Number(out.maxIterations);
      if (Number.isFinite(n)) {
        warn(`Loop.maxIterations: coerced string "${out.maxIterations}" → ${n}.`);
        out.maxIterations = n;
      } else {
        // LLM emitted a template expression like "@input.items.length".
        // Fall back to a safe default; the condition handles the real limit.
        warn(`Loop.maxIterations: "${out.maxIterations}" is not a number, defaulted to 1000 (edit on canvas).`);
        out.maxIterations = 1000;
      }
    }
    return out;
  },
  Switch: (d, warn) => {
    const out = { ...d };
    // defaultCase is a boolean ("does the Switch have a default fallthrough?")
    // not a label. LLM often emits the case name here.
    if (typeof out.defaultCase === 'string') {
      const truthy = ['default', 'true', 'yes', 'else', 'fallback', 'fallthrough'];
      const v = String(out.defaultCase).toLowerCase().trim();
      const coerced = truthy.includes(v) || v.length > 0;
      warn(`Switch.defaultCase: coerced string "${out.defaultCase}" → ${coerced}.`);
      out.defaultCase = coerced;
    }
    // Cases array sometimes has number values where strings are expected.
    if (Array.isArray(out.cases)) {
      out.cases = out.cases.map((c) => {
        if (c && typeof c === 'object' && 'value' in c && typeof (c as { value: unknown }).value !== 'string') {
          return { ...(c as object), value: String((c as { value: unknown }).value) };
        }
        return c;
      });
    }
    return out;
  },
  Return: (d, warn) => {
    const out = { ...d };
    if (typeof out.returnType === 'string') {
      const valid = ['TEXT', 'INT', 'FLOAT', 'VECTOR', 'JSON', 'ROWSET', 'BOOLEAN', 'ANY'];
      const upper = out.returnType.toUpperCase();
      // Common mismappings.
      const aliases: Record<string, string> = {
        STRING: 'TEXT',
        INTEGER: 'INT',
        BOOL: 'BOOLEAN',
        NUMBER: 'FLOAT',
        OBJECT: 'JSON',
        ARRAY: 'ROWSET',
        NULL: 'ANY',
      };
      const mapped = aliases[upper] ?? upper;
      if (valid.includes(mapped)) {
        if (mapped !== out.returnType) {
          warn(`Return.returnType: coerced "${out.returnType}" → "${mapped}".`);
        }
        out.returnType = mapped;
      } else {
        warn(`Return.returnType: unknown "${out.returnType}", defaulted to ANY.`);
        out.returnType = 'ANY';
      }
    }
    return out;
  },
  HttpRequest: (d, warn) => {
    const out = { ...d };
    if (typeof out.method === 'string') {
      const upper = out.method.toUpperCase();
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) {
        if (upper !== out.method) {
          warn(`HttpRequest.method: normalized "${out.method}" → "${upper}".`);
        }
        out.method = upper;
      }
    }
    return out;
  },
  RowEventTrigger: (d, warn) => {
    const out = { ...d };
    if (typeof out.event === 'string') {
      const upper = out.event.toUpperCase();
      if (['INSERT', 'UPDATE', 'DELETE'].includes(upper)) {
        if (upper !== out.event) {
          warn(`RowEventTrigger.event: normalized "${out.event}" → "${upper}".`);
        }
        out.event = upper;
      }
    }
    return out;
  },
  MemoryRecall: (d, warn) => {
    const out = { ...d };
    if (typeof out.topK === 'string') {
      const n = Number(out.topK);
      if (Number.isFinite(n)) {
        warn(`MemoryRecall.topK: coerced string "${out.topK}" → ${n}.`);
        out.topK = n;
      }
    }
    return out;
  },
  AgentRun: (d, warn) => {
    const out = { ...d };
    if (typeof out.temperature === 'string') {
      const n = Number(out.temperature);
      if (Number.isFinite(n)) {
        warn(`AgentRun.temperature: coerced string "${out.temperature}" → ${n}.`);
        out.temperature = n;
      }
    }
    return out;
  },
  Approval: (d, warn) => {
    const out = { ...d };
    if (typeof out.timeoutMs === 'string') {
      // Common shorthand: "1h", "30m", "1d" → ms
      const m = out.timeoutMs.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
      if (m) {
        const n = Number(m[1]);
        const unit = (m[2] ?? 'ms').toLowerCase();
        const mult = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
        warn(`Approval.timeoutMs: coerced "${out.timeoutMs}" → ${n * mult}.`);
        out.timeoutMs = n * mult;
      } else {
        const n = Number(out.timeoutMs);
        if (Number.isFinite(n)) {
          out.timeoutMs = n;
        }
      }
    }
    return out;
  },
};

function coerceData(
  kind: string,
  data: Record<string, unknown>,
  warn: (m: string) => void,
): Record<string, unknown> {
  const fn = COERCERS[kind];
  return fn ? fn(data, warn) : data;
}

function expand(
  llm: LlmWorkflow,
  previous: WorkflowDefinition | undefined,
): { workflow: WorkflowDefinition; warnings: string[] } {
  const warnings: string[] = [];

  // ── 1. Deduplicate LLM ids ─────────────────────────────────────────────────
  // The Map(...) constructor silently overwrites duplicates, which makes
  // edges resolve to the wrong UUID. Detect and rename so every node keeps a
  // unique handle in the resulting workflow.
  const seenIds = new Set<string>();
  const renames = new Map<number, string>(); // index → new llm id
  for (let i = 0; i < llm.nodes.length; i++) {
    let id = llm.nodes[i].id;
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}_${suffix}`)) suffix++;
      const renamed = `${id}_${suffix}`;
      warnings.push(`Duplicate node id "${id}" renamed to "${renamed}".`);
      renames.set(i, renamed);
      id = renamed;
    }
    seenIds.add(id);
  }
  // Apply the renames and remap any edges that referenced the duplicate.
  // A duplicate-source edge can only target the LATER occurrence since the
  // first wins seenIds — but we have no way to know intent, so we leave edge
  // sources/targets pointing at the FIRST occurrence (the un-renamed one).
  const liveNodes = llm.nodes.map((n, i) =>
    renames.has(i) ? { ...n, id: renames.get(i)! } : n,
  );

  // ── 2. Validate each node, normalizing kind first ─────────────────────────
  const validatedNodes: { llmId: string; node: WorkflowNode }[] = [];
  for (const n of liveNodes) {
    const normalizedKind = normalizeKind(n.kind);
    if (normalizedKind !== n.kind) {
      warnings.push(
        `Node "${n.id}": normalized kind "${n.kind}" → "${normalizedKind}".`,
      );
    }
    const coerced = coerceData(normalizedKind, n.data, (m) => warnings.push(`Node "${n.id}": ${m}`));
    const dataWithKind = { nodeType: normalizedKind, ...coerced };
    const parsed = WorkflowNodeDataSchema.safeParse(dataWithKind);
    if (!parsed.success) {
      warnings.push(
        `Skipped node "${n.id}" (kind=${normalizedKind}): ` +
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
        // React Flow looks this up in NODE_TYPES — must be the kind string
        // (RowEventTrigger / If / Approval / etc.), not a generic 'workflow'
        // or the default unstyled rectangle renders instead of our component.
        type: normalizedKind,
        position: { x: 0, y: 0 },
        data: parsed.data,
      },
    });
  }

  if (validatedNodes.length === 0) {
    throw new Error(
      `All nodes failed schema validation. Warnings: ${warnings.join(' | ')}`,
    );
  }

  // Build llm-id → (uuid, node-type) index used by the edge pass and layout.
  const nodeIndex = new Map<string, { uuid: string; type: string }>(
    validatedNodes.map((v) => [v.llmId, { uuid: v.node.id, type: v.node.type as string }]),
  );

  // ── 3. Filter edges: drop self-loops + missing endpoints up front ─────────
  const liveEdges: { source: string; target: string; label?: string }[] = [];
  for (const e of llm.edges) {
    if (e.source === e.target) {
      warnings.push(`Dropped self-loop ${e.source} → ${e.target}.`);
      continue;
    }
    if (!nodeIndex.has(e.source) || !nodeIndex.has(e.target)) {
      warnings.push(`Dropped edge ${e.source}→${e.target} (node not validated).`);
      continue;
    }
    liveEdges.push(e);
  }

  // ── 4. Topological-ish rank layout, with fallback for missing roots ───────
  const sources = new Set(validatedNodes.map((v) => v.llmId));
  const targets = new Set(liveEdges.map((e) => e.target));
  let roots = [...sources].filter((id) => !targets.has(id));
  // No roots → cycles or LLM forgot the trigger. Pick the RowEventTrigger
  // if one exists; otherwise pick the alphabetically-first node so the
  // layout still spreads instead of collapsing on (0,0).
  if (roots.length === 0) {
    warnings.push(
      'No root node — graph appears to contain a cycle or every node has incoming edges. Layout will start from the first node.',
    );
    const triggers = validatedNodes.filter((v) => v.node.type === 'RowEventTrigger');
    const fallback = triggers[0] ?? validatedNodes[0];
    roots = [fallback.llmId];
  }
  const rank = new Map<string, number>(roots.map((id) => [id, 0]));
  const queue: string[] = [...roots];
  // Track BFS visits to detect cycles structurally — the `cur < next` guard
  // already prevents infinite loops, but we want to surface the cycle.
  const visitCount = new Map<string, number>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visitCount.set(id, (visitCount.get(id) ?? 0) + 1);
    if ((visitCount.get(id) ?? 0) > validatedNodes.length) {
      // Bail; we've already issued the no-root warning if applicable.
      break;
    }
    const myRank = rank.get(id) ?? 0;
    for (const edge of liveEdges) {
      if (edge.source !== id) continue;
      const cur = rank.get(edge.target);
      const next = myRank + 1;
      if (cur === undefined || cur < next) {
        rank.set(edge.target, next);
        queue.push(edge.target);
      }
    }
  }
  // Any node still without a rank is orphaned — drop it on its own pseudo-tier
  // below the main chain so it doesn't pile up at (0,0).
  const maxRankedTier = Math.max(0, ...Array.from(rank.values()));
  let orphanTier = maxRankedTier + 1;
  for (const v of validatedNodes) {
    if (!rank.has(v.llmId)) {
      warnings.push(`Node "${v.llmId}" is disconnected from the trigger.`);
      rank.set(v.llmId, orphanTier);
      orphanTier++;
    }
  }

  // ── 5. Cycle detection (warning only) ─────────────────────────────────────
  // A back-edge is one whose source's rank is >= target's. Loops are SUPPOSED
  // to produce back-edges by their nature — the body subgraph returns to the
  // Loop node every iteration. We suppress back-edges where either endpoint
  // is a Loop, since any edge to/from a Loop inside the body cycle is
  // expected and shouldn't alarm the user.
  for (const e of liveEdges) {
    const srcR = rank.get(e.source) ?? -1;
    const tgtR = rank.get(e.target) ?? -1;
    if (srcR >= 0 && tgtR >= 0 && srcR >= tgtR) {
      const srcType = nodeIndex.get(e.source)?.type;
      const tgtType = nodeIndex.get(e.target)?.type;
      const involvesLoop = srcType === 'Loop' || tgtType === 'Loop';
      if (!involvesLoop) {
        warnings.push(
          `Possible back-edge ${e.source} → ${e.target} (rank ${srcR} → ${tgtR}); the runtime may loop.`,
        );
      }
    }
  }

  // ── 6. Tier-aware placement with width wrapping ───────────────────────────
  const tiers = new Map<number, string[]>();
  for (const v of validatedNodes) {
    const r = rank.get(v.llmId) ?? 0;
    const t = tiers.get(r) ?? [];
    t.push(v.llmId);
    tiers.set(r, t);
  }
  for (const [r, ids] of tiers) {
    // Wide tiers wrap so 10 siblings don't push ±1260 px off-screen.
    const cols = Math.min(ids.length, LAYOUT_MAX_TIER_WIDTH);
    ids.forEach((llmId, idx) => {
      const node = validatedNodes.find((v) => v.llmId === llmId);
      if (!node) return;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const offset =
        cols === 1 ? 0 : (col - (cols - 1) / 2) * LAYOUT_COL;
      node.node.position = {
        x: 400 + offset,
        y: 80 + r * LAYOUT_ROW + row * LAYOUT_ROW,
      };
    });
  }

  // ── 7. Resolve a label to the actual handle id on the source node ─────────
  const resolveSourceHandle = (
    sourceType: string,
    label: string | undefined,
  ): { handle: string | null; warning: string | null } => {
    const spec = NODE_HANDLES[sourceType];
    if (!spec) return { handle: null, warning: null };
    // Terminal node (no outputs declared) — Return is the only one. Edges
    // leaving it are structurally wrong; surface a warning so the user sees
    // why the runtime would ignore them.
    if (spec.outputs.length === 0 && sourceType !== 'Switch') {
      return {
        handle: null,
        warning: `${sourceType} is terminal — it has no outputs, this edge will not fire at runtime.`,
      };
    }
    if (!label) {
      // Unlabeled edge on a branching node = land on the first handle and warn.
      if (spec.outputs.length > 1) {
        return {
          handle: spec.outputs[0],
          warning: `Unlabeled edge from ${sourceType}; defaulted to "${spec.outputs[0]}".`,
        };
      }
      // Switch with no labels at all — same fallback.
      return { handle: null, warning: null };
    }
    const lower = label.toLowerCase().trim();
    // Exact match against declared outputs (case-insensitive).
    const exact = spec.outputs.find((o) => o.toLowerCase() === lower);
    if (exact) return { handle: exact, warning: null };
    // Synonym map (per-source-type only).
    const mapped = spec.synonyms[lower];
    if (mapped) return { handle: mapped, warning: null };
    // Switch case values are dynamic — pass through verbatim, the node
    // will render the edge label even if the handle id doesn't exist.
    if (sourceType === 'Switch') {
      return { handle: label, warning: null };
    }
    // No match — fall back to first declared handle and warn loudly.
    return {
      handle: spec.outputs[0] ?? null,
      warning: `Unknown label "${label}" on ${sourceType}; expected ${spec.outputs.join(' | ')}.`,
    };
  };

  // ── 8. Build the edges ────────────────────────────────────────────────────
  const edges: WorkflowEdge[] = [];
  // Track If branch coverage so we can warn about missing/duplicate branches.
  const ifBranchSeen = new Map<string, Set<string>>(); // llmId → set of branches taken
  for (const e of liveEdges) {
    const src = nodeIndex.get(e.source)!;
    const tgt = nodeIndex.get(e.target)!;
    const { handle, warning } = resolveSourceHandle(src.type, e.label);
    if (warning) warnings.push(`Edge ${e.source}→${e.target}: ${warning}`);
    if (src.type === 'If' && handle) {
      const taken = ifBranchSeen.get(e.source) ?? new Set<string>();
      if (taken.has(handle)) {
        warnings.push(
          `Duplicate "${handle}" branch from If "${e.source}" — second edge ignored at runtime.`,
        );
      }
      taken.add(handle);
      ifBranchSeen.set(e.source, taken);
    }
    edges.push({
      id: randomUUID(),
      source: src.uuid,
      target: tgt.uuid,
      sourceHandle: handle,
      targetHandle: 'input',
      label: e.label,
      animated: false,
    });
  }
  // Warn on If nodes that didn't cover both branches.
  for (const v of validatedNodes) {
    if (v.node.type !== 'If') continue;
    const taken = ifBranchSeen.get(v.llmId) ?? new Set<string>();
    if (!taken.has('true') || !taken.has('false')) {
      const missing = ['true', 'false'].filter((b) => !taken.has(b));
      warnings.push(
        `If node "${v.llmId}" is missing the ${missing.join(' + ')} branch${missing.length > 1 ? 'es' : ''}.`,
      );
    }
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
      minEngineVersion: previous?.meta.minEngineVersion ?? MIN_ENGINE_VERSION,
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

  // Structural warnings — non-blocking, surfaced in the wizard preview.
  const triggers = validatedNodes.filter(
    (v) => v.node.type === 'RowEventTrigger',
  );
  if (triggers.length === 0) {
    warnings.push('No trigger node — workflow has no entry point.');
  } else if (triggers.length > 1) {
    warnings.push(`Multiple trigger nodes (${triggers.length}) — only the first fires.`);
  }
  const returns = validatedNodes.filter((v) => v.node.type === 'Return');
  if (returns.length === 0) {
    warnings.push('No Return node — workflow has no terminating leaf.');
  }

  return { workflow: final.data, warnings };
}
