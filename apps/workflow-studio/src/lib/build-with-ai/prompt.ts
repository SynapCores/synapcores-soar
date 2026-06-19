/**
 * System prompt for the "Build with AI" wizard.
 *
 * Tuned for native qwen2.5-coder:7b on CPU — short, one few-shot example,
 * explicit handle vocabulary so the model wires branches correctly. The
 * GENERATE call also passes response_format=json so output is constrained
 * to a JSON value; the prompt still says "JSON object" as belt-and-braces.
 */

const NODE_KINDS = `
Available node kinds. Each \`data\` object must include the listed fields.

- RowEventTrigger: {label, table, event:"INSERT"|"UPDATE"|"DELETE", condition?}
- MemoryStore:     {label, namespace, contentExpr, metadataExpr?}
- MemoryRecall:    {label, namespace, queryExpr, topK, outputVariable}
- AgentRun:        {label, promptTemplate, outputVariable, model?, temperature?}
- SqlQuery:        {label, sql, outputVariable, bindParams?}
- HttpRequest:     {label, method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE", url, headers?, bodyExpr?, outputVariable}
- If:              {label, condition}
- Switch:          {label, expression, cases:[{value,label?}], defaultCase?}
- Loop:            {label, condition, maxIterations?}  // maxIterations must be an integer literal (e.g. 1000), NOT a template expression
- Approval:        {label, title?, message, timeoutMs?}
- SetVariable:     {label, assignments:[{variable,expression}]}
- Return:          {label, expression, returnType?}
`.trim();

// Branch handle vocabulary — the LLM must use these EXACT strings as the
// edge `label` so the canvas wires the right port. This table is canonical;
// the post-processor only accepts synonyms when the node has exactly one
// branching meaning (yes/no for If, etc.).
const BRANCH_HANDLES = `
Branching nodes — \`edge.label\` must be one of:

- If:       "true" | "false"
- Switch:   the case value string (e.g. "premium", "basic"); use "default" for the fallthrough
- Loop:     "body" (each iteration) | "done" (after the loop ends)
- Approval: "approved" | "rejected" | "timed_out"

Non-branching nodes (RowEventTrigger / Memory* / Agent* / Sql* / Http* /
SetVariable) have ONE output — emit edges from them without a \`label\`.
Return has no outgoing edges.
`.trim();

const FEW_SHOT = `
EXAMPLE
User: "When a new row lands in 'orders' with status='flagged', call fraud
API at https://fraud.example.com/score, route high-risk (>0.8) to manual
approval; on rejection, return 'blocked'; on timeout, return 'review_later'."

Output:
{
  "name": "Flagged order fraud routing",
  "description": "Score flagged orders; route high-risk to approval.",
  "nodes": [
    {"id":"n1","kind":"RowEventTrigger","data":{"label":"New flagged order","table":"orders","event":"INSERT","condition":"status = 'flagged'"}},
    {"id":"n2","kind":"HttpRequest","data":{"label":"Score","method":"POST","url":"https://fraud.example.com/score","bodyExpr":"JSON_OBJECT('id', @input.id)","outputVariable":"@score"}},
    {"id":"n3","kind":"If","data":{"label":"High risk?","condition":"@score.risk > 0.8"}},
    {"id":"n4","kind":"Approval","data":{"label":"Review","message":"Order @input.id scored @score.risk"}},
    {"id":"n5","kind":"Return","data":{"label":"Auto-pass","expression":"'auto_passed'"}},
    {"id":"n6","kind":"Return","data":{"label":"Approved","expression":"'approved'"}},
    {"id":"n7","kind":"Return","data":{"label":"Blocked","expression":"'blocked'"}},
    {"id":"n8","kind":"Return","data":{"label":"Review later","expression":"'review_later'"}}
  ],
  "edges": [
    {"source":"n1","target":"n2"},
    {"source":"n2","target":"n3"},
    {"source":"n3","target":"n4","label":"true"},
    {"source":"n3","target":"n5","label":"false"},
    {"source":"n4","target":"n6","label":"approved"},
    {"source":"n4","target":"n7","label":"rejected"},
    {"source":"n4","target":"n8","label":"timed_out"}
  ]
}
`.trim();

const RULES = `
Rules:
- Output ONE JSON object, no prose, no markdown.
- Top-level keys: name, description, nodes, edges.
- Each node: {id, kind, data}. id like "n1","n2"; ids MUST be unique.
- \`kind\` is case-sensitive and must match the list exactly. Do not invent kinds.
- Each edge: {source, target, label?}. \`label\` follows the branch vocabulary above.
- Must start with one RowEventTrigger; every leaf path must end in Return.
- Do not self-loop (source !== target).
- Cover every branch of If/Loop/Approval — omitted branches will warn.

Verb / tool mapping — map intent to the available kinds:
- "notify", "alert", "ping", "tell", "post", "send a message", "email",
  "page someone", "DM", "send SMS", "send text"
                                  → HttpRequest with a webhook placeholder
- "Slack", "Teams", "Discord", "Twilio", "SendGrid", "Mailgun",
  "Pagerduty", "Opsgenie", "Webhook", any 3rd-party SaaS name
                                  → HttpRequest with that vendor's typical
                                    webhook URL (placeholder if unknown)
- "Kafka", "Kinesis", "SQS", "RabbitMQ", "NATS", message bus / queue
                                  → HttpRequest to the queue's HTTP API,
                                    or a placeholder
                                    https://kafka.example.com/produce
- "S3", "GCS", "Azure Blob", "upload to", "store file", "object storage"
                                  → HttpRequest to the storage's HTTP API
                                    (PUT/POST with bodyExpr the content)
- "ask the LLM", "summarize",
  "classify", "extract", "draft"  → AgentRun
- "store", "remember", "save in memory",
  "record in memory"              → MemoryStore (engine's vector memory,
                                    NOT external storage)
- "recall", "look up", "find",
  "search history", "get last N"  → MemoryRecall (engine's vector memory)
- "query", "lookup row",
  "join table", "SELECT"          → SqlQuery
- "wait for approval", "review",
  "human in the loop", "sign-off" → Approval
- "if", "when … then", "branch"   → If
- "for each", "loop over",
  "iterate"                       → Loop
- "set", "assign", "compute"      → SetVariable

Critical: MemoryStore / MemoryRecall are for the engine's own short-term
agent memory, NOT for cloud storage. Anything written to or read from a
remote system is HttpRequest.

Missing details — ALWAYS prefer a working draft over an error:
- Unknown Slack/webhook URL → use "https://hooks.slack.com/services/REPLACE_ME".
- Unknown HTTP endpoint → use "https://api.example.com/v1/REPLACE_ME".
- Unknown email/SMS provider → use HttpRequest to a placeholder webhook URL,
  with bodyExpr describing the message. Do NOT bail — every "send" or
  "notify" verb maps to HttpRequest.
- Unknown LLM model → omit \`model\` (the engine default is used).
- Unknown table → invent a sensible name (orders, customers, events, ...).
- Unknown condition → write a literal the user can edit (e.g.
  "status = 'flagged'", "@score.risk > 0.8").
- Unknown SQL → write a placeholder SELECT the user can fill in.
- Vague trigger ("when something happens", "every day") → use a
  RowEventTrigger on a placeholder table named "events" with event INSERT.

Emit {"error":"<reason>"} ONLY when the request fundamentally cannot be
modeled with the available kinds even with placeholders — e.g. "render a
PDF then upload to Google Drive" (no drive/file kind exists). Missing
parameters, ambiguous wording, and "send/notify" verbs are NEVER grounds
for an error — placeholders are required.
`.trim();

export const BUILD_WITH_AI_SYSTEM_PROMPT = [
  'You design SynapCores Workflow Studio workflows from natural language.',
  '',
  NODE_KINDS,
  '',
  BRANCH_HANDLES,
  '',
  FEW_SHOT,
  '',
  RULES,
].join('\n');

export function buildRefinePrompt(
  previousWorkflow: unknown,
  refinement: string,
): string {
  // The refine call is a fresh round-trip — the LLM doesn't carry context
  // from the original generate call — so we re-attach the rules block here
  // too, otherwise the model drifts back to default formatting.
  return [
    'You are refining an existing SynapCores Workflow Studio workflow.',
    '',
    BRANCH_HANDLES,
    '',
    RULES,
    '',
    'Previous workflow:',
    JSON.stringify(previousWorkflow, null, 2),
    '',
    'Change: ' + refinement,
    '',
    'Emit the revised workflow as one JSON object. Keep node ids stable where',
    'possible, add new ids like "n9","n10" for additions, drop removed ones.',
  ].join('\n');
}
