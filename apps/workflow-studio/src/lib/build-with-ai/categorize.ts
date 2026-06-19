// Helpers that turn the wizard's free-text warnings + error strings into
// structured categories the UI can group + style. Kept as a separate module
// so the regex patterns live in one place and can be tweaked from harness
// data without touching the modal.

export type WarningSeverity = 'info' | 'warn' | 'error';

export type WarningCategory =
  | 'coercion'        // value was massaged into the schema's type
  | 'schema-skip'    // a node failed schema validation and was dropped
  | 'edge-orphan'    // edge dropped because endpoint missing
  | 'handle'         // unknown / unlabeled / cascaded handle
  | 'structural'     // missing trigger / missing return / multi-trigger
  | 'graph'          // back-edge, cycle, disconnected
  | 'duplicate'      // duplicate node id renamed
  | 'kind'           // kind alias applied
  | 'terminal'       // edge leaving Return / no-outputs node
  | 'other';

export interface CategorizedWarning {
  category: WarningCategory;
  severity: WarningSeverity;
  message: string;
  /** Root-cause llmId, when extractable from the warning. Used to collapse
   *  the 5 "dropped edge" cascades under their parent schema-skip. */
  rootNodeId?: string;
}

const PATTERNS: Array<{
  rx: RegExp;
  category: WarningCategory;
  severity: WarningSeverity;
  extractRoot?: (m: RegExpMatchArray) => string | undefined;
}> = [
  // Coercion (informational)
  { rx: /^Node "([^"]+)":\s+[A-Za-z]+\.\w+:\s+coerced/, category: 'coercion', severity: 'info', extractRoot: (m) => m[1] },
  { rx: /^Node "([^"]+)":\s+[A-Za-z]+\.\w+:\s+normalized/, category: 'coercion', severity: 'info', extractRoot: (m) => m[1] },
  { rx: /^Node "([^"]+)":\s+[A-Za-z]+\.\w+:\s+unknown/, category: 'coercion', severity: 'warn', extractRoot: (m) => m[1] },
  { rx: /^Node "([^"]+)":\s+[A-Za-z]+\.\w+:\s+.* defaulted/, category: 'coercion', severity: 'warn', extractRoot: (m) => m[1] },

  // Kind normalization
  { rx: /^Node "([^"]+)":\s+normalized kind/, category: 'kind', severity: 'info', extractRoot: (m) => m[1] },

  // Schema skip
  { rx: /^Skipped node "([^"]+)" \(kind=([^)]+)\):/, category: 'schema-skip', severity: 'error', extractRoot: (m) => m[1] },

  // Edge orphan caused by the above skip
  { rx: /^Dropped edge ([^ ]+)→([^ ]+) \(node not validated\)/, category: 'edge-orphan', severity: 'warn' },

  // Self-loop
  { rx: /^Dropped self-loop/, category: 'edge-orphan', severity: 'warn' },

  // Handle resolution
  { rx: /^Edge ([^→]+)→([^:]+): Unknown label/, category: 'handle', severity: 'warn' },
  { rx: /^Edge ([^→]+)→([^:]+): Unlabeled edge/, category: 'handle', severity: 'info' },

  // Terminal node had outgoing edges
  { rx: /\bis terminal — it has no outputs/, category: 'terminal', severity: 'warn' },

  // If branch coverage
  { rx: /If node "([^"]+)" is missing the/, category: 'structural', severity: 'warn', extractRoot: (m) => m[1] },
  { rx: /Duplicate "(true|false)" branch from If/, category: 'handle', severity: 'warn' },

  // Structural
  { rx: /^No trigger node/, category: 'structural', severity: 'warn' },
  { rx: /^Multiple trigger nodes/, category: 'structural', severity: 'warn' },
  { rx: /^No Return node/, category: 'structural', severity: 'warn' },

  // Graph integrity
  { rx: /^Possible back-edge/, category: 'graph', severity: 'warn' },
  { rx: /^No root node/, category: 'graph', severity: 'warn' },
  { rx: /^Node "([^"]+)" is disconnected/, category: 'graph', severity: 'warn', extractRoot: (m) => m[1] },

  // Duplicates
  { rx: /^Duplicate node id/, category: 'duplicate', severity: 'info' },
];

export function categorizeWarning(message: string): CategorizedWarning {
  for (const p of PATTERNS) {
    const m = message.match(p.rx);
    if (m) {
      return {
        category: p.category,
        severity: p.severity,
        message,
        rootNodeId: p.extractRoot?.(m),
      };
    }
  }
  return { category: 'other', severity: 'warn', message };
}

/**
 * Collapse cascaded "dropped edge" warnings under their schema-skip parent.
 * Returns a flat list ordered: schema-skip parents first (with cascade count),
 * then independent warnings.
 */
export interface WarningGroup {
  primary: CategorizedWarning;
  cascadeCount: number;
  cascadeMessages: string[];
}

export function groupWarnings(warnings: string[]): WarningGroup[] {
  const cat = warnings.map(categorizeWarning);

  // Find "Skipped node X" warnings and their llmId.
  const skipIds = new Set<string>();
  const skipByNode = new Map<string, CategorizedWarning>();
  for (const c of cat) {
    if (c.category === 'schema-skip' && c.rootNodeId) {
      skipIds.add(c.rootNodeId);
      skipByNode.set(c.rootNodeId, c);
    }
  }

  const cascadesByParent = new Map<string, string[]>();
  const independents: CategorizedWarning[] = [];

  for (const c of cat) {
    if (c.category === 'schema-skip') continue; // primaries handled below
    if (c.category === 'edge-orphan') {
      // Try to attribute to a skipped parent node.
      const m = c.message.match(/Dropped edge ([^→]+)→([^ ]+)/);
      const src = m?.[1];
      const tgt = m?.[2];
      const parent =
        (src && skipIds.has(src) && src) ||
        (tgt && skipIds.has(tgt) && tgt) ||
        undefined;
      if (parent) {
        const arr = cascadesByParent.get(parent) ?? [];
        arr.push(c.message);
        cascadesByParent.set(parent, arr);
        continue;
      }
    }
    independents.push(c);
  }

  const groups: WarningGroup[] = [];
  for (const [id, primary] of skipByNode) {
    groups.push({
      primary,
      cascadeCount: cascadesByParent.get(id)?.length ?? 0,
      cascadeMessages: cascadesByParent.get(id) ?? [],
    });
  }
  for (const c of independents) {
    groups.push({ primary: c, cascadeCount: 0, cascadeMessages: [] });
  }

  // Severity order: error > warn > info.
  const sevRank: Record<WarningSeverity, number> = { error: 0, warn: 1, info: 2 };
  groups.sort((a, b) => sevRank[a.primary.severity] - sevRank[b.primary.severity]);
  return groups;
}

// ── Suggested refinement prompts derived from active warnings ────────────────

/**
 * One actionable suggestion — clicking it pre-fills the Refine input with a
 * targeted instruction so the user doesn't have to author their own follow-up.
 * Driven entirely by what's in the warning list, so suggestions only show up
 * when they're relevant.
 */
export interface RefinementSuggestion {
  label: string;       // chip text
  instruction: string; // what we drop into the Refine input
}

export function suggestRefinements(warnings: string[]): RefinementSuggestion[] {
  const suggestions: RefinementSuggestion[] = [];
  const has = (rx: RegExp) => warnings.some((w) => rx.test(w));
  const collect = (rx: RegExp) => warnings.filter((w) => rx.test(w));

  // No Return node
  if (has(/No Return node/i)) {
    suggestions.push({
      label: 'Add a Return node',
      instruction:
        'Append a Return node at the end of every leaf path so the workflow has a terminating value.',
    });
  }

  // Missing trigger
  if (has(/No trigger node/i)) {
    suggestions.push({
      label: 'Add a RowEventTrigger',
      instruction:
        'Add a RowEventTrigger at the start of the workflow so it has an entry point. Use a sensible table name and INSERT event.',
    });
  }

  // Multiple triggers
  if (has(/Multiple trigger nodes/i)) {
    suggestions.push({
      label: 'Collapse triggers into one',
      instruction:
        'Replace the multiple triggers with a single RowEventTrigger and route the rest of the workflow from there.',
    });
  }

  // If node missing branch
  const ifMissing = collect(/If node "([^"]+)" is missing the (true|false|true \+ false)/i);
  if (ifMissing.length > 0) {
    suggestions.push({
      label: 'Cover all If branches',
      instruction:
        'For every If node, emit BOTH a "true" edge AND a "false" edge so neither branch is dropped at runtime.',
    });
  }

  // Loop-handle confusion (LLM uses "body"/"done" on the wrong source)
  if (has(/Unknown label "(body|done)" on/i)) {
    suggestions.push({
      label: 'Fix loop branch labels',
      instruction:
        'Only the Loop node itself emits edges with label "body" (each iteration) and "done" (after the loop). All other edges from non-Loop nodes leave their label empty.',
    });
  }

  // Approval-handle confusion
  if (has(/Unknown label "(approved|rejected|timed_out)" on (?!Approval)/i)) {
    suggestions.push({
      label: 'Fix Approval branch labels',
      instruction:
        'Only the Approval node emits edges with label "approved", "rejected", or "timed_out". Other nodes do not use these labels.',
    });
  }

  // Coercion-default warnings (e.g. maxIterations defaulted)
  if (has(/maxIterations:.*defaulted to/i)) {
    suggestions.push({
      label: 'Set a real maxIterations',
      instruction:
        'Set Loop.maxIterations to an integer literal (e.g. 100, 1000). It must NOT be a template expression like "@input.items.length".',
    });
  }

  // Schema-skipped node — let the model try again with the schema in mind
  if (has(/^Skipped node/i)) {
    suggestions.push({
      label: 'Re-fit dropped nodes to the schema',
      instruction:
        'Re-emit any node whose required fields were skipped. Use the exact types from the schema (integers for numbers, booleans for booleans, the canonical enum values for returnType: TEXT/INT/FLOAT/VECTOR/JSON/ROWSET/BOOLEAN/ANY).',
    });
  }

  // Disconnected nodes
  if (has(/is disconnected from the trigger/i)) {
    suggestions.push({
      label: 'Connect orphan nodes',
      instruction:
        'Connect every node back into the main flow from the trigger; remove any node that has no incoming edge.',
    });
  }

  // Back-edge (non-Loop) — runtime would actually loop
  if (has(/^Possible back-edge/i)) {
    suggestions.push({
      label: 'Remove unintended cycles',
      instruction:
        'Replace any back-edge (an edge pointing to an earlier stage) with a forward edge. Only Loop nodes are allowed to receive back-edges from their own body.',
    });
  }

  // Terminal edges leaving Return
  if (has(/is terminal — it has no outputs/i)) {
    suggestions.push({
      label: 'Drop edges from Return',
      instruction:
        'Return nodes are terminal — remove any outgoing edges from a Return node.',
    });
  }

  return suggestions;
}

// ── Error classification (for the 422 path) ──────────────────────────────────

export type ErrorKind =
  | 'llm-bail'      // LLM returned {"error":"..."}
  | 'parse'         // we couldn't parse the LLM's JSON
  | 'schema'        // LLM JSON didn't match the schema
  | 'engine'        // engine 5xx / network
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  title: string;
  hint: string;
}

export function classifyError(error: string): ClassifiedError {
  if (/^Engine call failed:/i.test(error) || /engine \d{3}:/i.test(error)) {
    return {
      kind: 'engine',
      title: 'Engine could not be reached',
      hint: 'Check the SynapCores engine is running and the studio is pointed at it (SYNAPCORES_URL).',
    };
  }
  if (/JSON parse error/i.test(error) || /No JSON object found/i.test(error)) {
    return {
      kind: 'parse',
      title: 'The LLM output was malformed',
      hint: 'The model produced text we could not parse as JSON. Try again or restate the request more concretely.',
    };
  }
  if (/did not match the workflow schema/i.test(error)) {
    return {
      kind: 'schema',
      title: 'The LLM output did not match the workflow schema',
      hint: 'The structure was off (wrong field types or kinds). Restate the request, or refine an existing workflow.',
    };
  }
  if (/cannot be modeled/i.test(error) || /ambiguous/i.test(error) || /asks for a kind/i.test(error)) {
    return {
      kind: 'llm-bail',
      title: 'The AI could not model this request',
      hint: 'Re-state with concrete triggers (table name, condition), endpoints (URLs), and what to do on each branch.',
    };
  }
  return {
    kind: 'unknown',
    title: 'Generation failed',
    hint: 'Try again with a more specific prompt.',
  };
}
