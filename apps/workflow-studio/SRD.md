# SynapCores Workflow Studio — Software Requirements

**Document ID:** SRD-WS-v1.0
**Status:** Approved for sprint execution
**Owner:** SynapCores Solutions Engineering
**Target artifact:** `@synapcores/workflow-studio@0.1.0`
**Date:** 2026-06-16

---

## 0. TL;DR

A separate Next.js application — sibling to `aerospace-rca`, `aml`, `soar`, `telemetry-bridge` in `synapcores-apps/apps/` — that provides a visual drag-and-drop authoring + execution surface for SynapCores agentic workflows. Compiles canvas-built flows down to SQL (triggers + stored procedures + AGENT_RUN calls) and deploys to a target SynapCores engine via the existing `@synapcores/sdk`.

**Architecture: Browser → Next.js Node proxy → SynapCores engine.** The Node proxy holds the API key and engine URL; the browser never sees either.

**Off-cycle release.** Minimum compatible engine: **v1.8.5-ce**. Best-experience engine: **v1.9.0-ce** (full Postgres PL parity).

---

## 1. Purpose and scope

### 1.1 Purpose

Provide a low-code authoring surface that lets non-engineers compose agentic workflows out of SynapCores' shipped primitives (`AGENT_RUN`, `MEMORY_*`, triggers, stored procedures, recipes, `IMMUTABLE TABLE`, `execute_http_request`), then deploy and operate them against a running engine.

### 1.2 In scope (v0.1.0)

- Visual workflow authoring (canvas + node palette)
- Compilation of visual workflow → SQL DDL (triggers + procedures)
- Deploy / undeploy to a target engine via the Node proxy
- Live execution observation (run history + per-step timeline)
- Workflow versioning + JSON import/export
- Single-user, single-engine, single-tenant per session
- Apache-2.0 license, self-hosted

### 1.3 Out of scope (v0.1.0 — deferred to v0.2.0+)

- Cron / scheduled triggers (waits on engine scheduler — currently no scheduler in v1.9.x)
- Multi-tenant or multi-engine routing within one session
- OIDC / SAML SSO (API key auth only in v0.1.0)
- Real-time multi-user collaboration on the same canvas
- Third-party node SDK / workflow marketplace
- Mobile / responsive layout for canvas
- Hosted SaaS — self-hosted only

---

## 2. Personas + primary journey

| Persona | Goal | Why workflow studio matters |
|---|---|---|
| **Solution Engineer / Demo Builder** | Build a customer-specific agent flow in 30 min for a call | Drag, deploy, screen-share live |
| **Operations Analyst** (security, fraud, finance) | Author + own runbook agents without a dev | Skip the engineering ticket; iterate themselves |
| **Backend Developer** | Generate SQL scaffolding visually, then hand-edit | Compiler must round-trip; what they see is what gets shipped |
| **Operator / SRE** | Watch what production agents are doing, debug failures | Execution viewer with per-step trace |
| **Auditor / Compliance** | Review who deployed what, when, against which engine | Deploy audit log via IMMUTABLE TABLE |

**The 15-Min-Agent demo journey** (primary acceptance scenario):
1. Open studio → connect to engine via API key (entered into Node proxy settings panel)
2. Drag `Trigger: New row in support_tickets` → `Memory recall: past issues` → `Agent: resolve with model X` → `Action: update row + audit log`
3. Press **Test** → inject sample row → see the agent execute step-by-step
4. Press **Deploy** → studio compiles + pushes SQL → confirmation
5. Watch the **Runs** tab — every fire shows up live

---

## 3. Architecture

### 3.1 Three-layer model

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (canvas, inspector, runs view)                          │
│  - React 18 + React Flow v12 + Zustand                           │
│  - HOLDS: canvas state, draft autosave, UI session cookie        │
│  - SEES: studio's own REST + WS only — never the engine URL,     │
│    never the API key                                             │
└──────────────────────────────┬───────────────────────────────────┘
                               │  http://studio.local/api/* + WS
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Node proxy = Next.js server (App Router server actions + WS    │
│  proxy handler)                                                  │
│  - @synapcores/sdk (Node SDK 0.5.0+)                             │
│  - HOLDS: engine URL, API key, WS-to-engine connection           │
│  - DOES: compile workflow JSON → SQL, deploy, query runs,       │
│    proxy live execution WS frames back to browser                │
│  - REUSE: lift Node proxy bits from /home/devops/IP/GPT/         │
│    synapcores-agent/widget (widget v2 Sprint 2 Phase B, #327)    │
└──────────────────────────────┬───────────────────────────────────┘
                               │  Bearer API key
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  SynapCores engine (v1.8.5-ce+)                                  │
│  REST: /v1/query/execute, /v1/recipes/execute                    │
│  WS:   /v1/chat/ws + ticket exchange                             │
│  Shipped primitives consumed: AGENT_RUN, MEMORY_*,               │
│  CREATE TRIGGER, CREATE PROCEDURE, IMMUTABLE TABLE,              │
│  execute_http_request (already in trigger_executor.rs:837)       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Tech stack

- **Framework:** Next.js 15 App Router, TypeScript 5
- **Canvas:** `@xyflow/react` (React Flow v12) — most mature production canvas library
- **State:** Zustand for canvas + UI state
- **Forms:** React Hook Form + Zod
- **Styling:** Tailwind v4 (matches synapcores-apps convention)
- **Engine I/O:** `@synapcores/sdk@^0.5.0` — **imported only in Next.js server components and route handlers; never in client components.** Bundle analyzer CI gates this.
- **WS:** native browser WebSocket → Next.js proxy → engine WS (Node proxy reuses widget v2 Phase B reconnect logic)
- **Persistence (drafts):** IndexedDB via `idb-keyval` (browser-side draft autosave only)
- **Persistence (workflows + runs):** engine-side tables, via SDK
- **Secrets store:** Node proxy local file `~/.workflow-studio/credentials` (mode 0600) or `SYNAPCORES_API_KEY` env var
- **Build:** Turbopack (Next 15 default)
- **License:** Apache-2.0
- **Foundation:** extends `synapcores-apps/packages/app-framework` (auth + tenant + RBAC + SDK pre-wired)

### 3.3 Repo layout

```
synapcores-apps/
├── apps/
│   └── workflow-studio/
│       ├── src/
│       │   ├── app/                  # Next.js routes (browser-served HTML + server actions)
│       │   │   ├── (canvas)/          # canvas view
│       │   │   ├── (runs)/            # runs view
│       │   │   └── api/               # Node proxy REST endpoints
│       │   ├── canvas/                # React Flow setup + node renderers (CLIENT)
│       │   ├── nodes/                 # one file per node type — definition + inspector + compiler shard
│       │   ├── compiler/              # visual JSON → SQL (SERVER ONLY)
│       │   ├── runs/                  # execution viewer (CLIENT) + WS forwarder (SERVER)
│       │   ├── engine/                # SDK client + WS proxy (SERVER ONLY)
│       │   ├── store/                 # Zustand slices (CLIENT)
│       │   └── lib/
│       │       ├── auth/              # session cookie + CSRF
│       │       └── secrets/           # encrypted local secrets store
│       ├── bin/
│       │   └── workflow-studio        # CLI: start | compile | deploy | undeploy
│       ├── public/
│       ├── package.json
│       ├── Dockerfile
│       ├── SRD.md                     # this document
│       └── README.md
└── packages/
    └── workflow-types/                # Shared schema (zod + TS types) — also published as @synapcores/workflow-types npm package
```

---

## 4. Functional requirements

### 4.1 Canvas + authoring

| ID | Requirement |
|---|---|
| **FR-1** | React-Flow-based canvas with pan/zoom, snap-to-grid, minimap |
| **FR-2** | Node palette with collapsible categories: Triggers, Memory, Agents, Actions, Control flow, Connectors, I/O |
| **FR-3** | Node types required for v0.1.0: `RowEventTrigger`, `MemoryStore`, `MemoryRecall`, `AgentRun`, `SqlQuery`, `HttpRequest`, `If`, `Switch`, `Loop`, `Approval` (HBR, ports SOAR pattern), `SetVariable`, `Return` |
| **FR-4** | Edges carry typed data (TEXT / INT / VECTOR / JSON / ROWSET) — connection rejected on mismatch |
| **FR-5** | Drawer-style node inspector for property editing (model name, prompt, table, column mapping, etc.) |
| **FR-6** | Undo/redo (50 levels minimum), keyboard shortcuts (⌘Z, ⌘⇧Z, ⌘D, ⌘S, Del) |
| **FR-7** | Validation panel — surfaces broken edges, missing required props, unresolved variables before deploy |
| **FR-8** | Workflow-level metadata: name, description, owner, tags, target engine version |
| **FR-9** | Save to local IndexedDB on every change (autosave drafts, never lose work) |
| **FR-10** | Save to engine via Node proxy `POST /api/workflows` — versioned |
| **FR-11** | Import / export workflow as JSON file (one file per workflow) |
| **FR-12** | Copy/paste of subgraphs across workflows |
| **FR-13** | Template gallery — bootstrap from "15-Min-Agent", "Phishing Triage", "Ticket Resolver", "Fraud Risk Score" |
| **FR-14** | Search-in-canvas (⌘F) to find nodes by label/type |
| **FR-15** | Read-only mode for non-editor viewers (audit / compliance) |

### 4.2 Compiler (server-side, in Node proxy)

| ID | Requirement |
|---|---|
| **FR-16** | Deterministic visual → SQL compilation. Same workflow JSON → byte-identical SQL output. |
| **FR-17** | Generates a single `CREATE OR REPLACE PROCEDURE wf_<id>_v<version>(...)` plus zero-or-more `CREATE TRIGGER` statements that invoke it |
| **FR-18** | Round-trip preserves node coordinates, comments, variable names |
| **FR-19** | Compile output viewable inline before deploy (read-only SQL pane, syntax-highlighted) |
| **FR-20** | Hand-edited SQL detection — studio warns "engine SQL diverges from canvas" and offers reload/overwrite |
| **FR-21** | Target-engine version check — compiler refuses to emit `MEMORY_RECALL` against v1.8.4 engine, etc. |
| **FR-22** | Dry-run compile via CLI: `workflow-studio compile workflow.json --out workflow.sql` |

### 4.3 Deploy + lifecycle

| ID | Requirement |
|---|---|
| **FR-23** | One-click Deploy via Node proxy — compiles → runs `DROP TRIGGER IF EXISTS` + `CREATE` atomically |
| **FR-24** | One-click Undeploy — removes triggers + procedures the studio created (tracked in `workflow_definitions.deployed_objects`) |
| **FR-25** | Deploy audit trail — who, when, which engine, which version → `IMMUTABLE TABLE workflow_deploys` |
| **FR-26** | Version pinning — Deploy attaches a workflow version; engine carries the version with every run for trace correlation |
| **FR-27** | Test mode — compiles to a temporary `wf_test_<uuid>` namespace, runs once, tears down — never touches production triggers |
| **FR-28** | Multi-engine targets (settings panel) — switch between dev/staging/prod engines without rebuild |

### 4.4 Execution observability

| ID | Requirement |
|---|---|
| **FR-29** | Runs tab — table of recent runs (workflow, started_at, status, duration), filterable by date/status |
| **FR-30** | Per-run timeline view — Gantt-style steps with latency bars; click a step → see inputs, outputs, errors |
| **FR-31** | Live tail mode — WebSocket subscription to ongoing runs, updates within 500ms of step completion |
| **FR-32** | Tool-call drill-down for `AGENT_RUN` steps — see prompt, tools called, model response |
| **FR-33** | Re-run / replay from any failed step (reuses cached prior outputs) |
| **FR-34** | Export run as JSON for support tickets |

### 4.5 Connectors + I/O

| ID | Requirement |
|---|---|
| **FR-35** | v0.1.0 ships these built-in nodes: `HttpRequest` (uses engine `execute_http_request`), `SqlQuery`, `MemoryStore`/`Recall`, `AgentRun`, `RecipeRun`. **Slack, Jira, Email deferred** to v0.2.0 (require external connector registry). |
| **FR-36** | Secrets / variables panel — encrypted-at-rest in Node proxy's `~/.workflow-studio/credentials` (mode 0600); injected into HTTP/SQL nodes at deploy time as engine-side `SET @var = ...` |
| **FR-37** | Sample-data fixtures per workflow for test-mode runs |
| **FR-38** | Output mapping — explicit "this node's output column X → next node's input field Y" |

### 4.6 Auth

| ID | Requirement |
|---|---|
| **FR-39** | Engine API key entered via the studio's settings UI, stored **server-side** in the Node proxy's encrypted secret store (`~/.workflow-studio/credentials` mode 0600, or env var `SYNAPCORES_API_KEY`). Browser never sees it. Browser-to-Node auth is a session cookie + CSRF token. |
| **FR-40** | Connection test on key entry — Node proxy round-trips `/health` + `SELECT version()` |
| **FR-41** | Per-engine API key — switching engines re-prompts |

---

## 5. Non-functional requirements

| ID | Requirement | Acceptance threshold |
|---|---|---|
| **NFR-1** | Canvas remains interactive (>30fps pan/zoom) with up to **100 nodes** | Lighthouse perf > 80 |
| **NFR-2** | Browser support: latest 2 versions of Chrome, Edge, Firefox, Safari | Manual smoke per release |
| **NFR-3** | First-load to first-canvas under **3 seconds** on cable broadband | Time-to-interactive metric |
| **NFR-4** | Author offline; only deploy + runs require engine connection | Works with engine URL set to `localhost:9999` (down) |
| **NFR-5** | Apache-2.0 license; no GPL transitive deps | License-checker CI step |
| **NFR-6** | i18n-ready (strings in JSON catalog), default `en` only in v0.1.0 | Code review |
| **NFR-7** | All engine API calls retry with exponential backoff (1s/2s/4s, 3 attempts) | Network-test suite |
| **NFR-8** | Distribution: npm package + docker image + standalone tarball — matches widget-v2 pattern | Each artifact verified in release CI |
| **NFR-9** | Engine API key never written to browser disk, browser logs, browser telemetry | Pen-test of build |
| **NFR-10** | Browser bundle size **< 2.5 MB gzipped** (excluding React Flow which is mandatory) | Bundle-analyzer in CI |
| **NFR-11** | Accessibility: WCAG 2.1 AA for forms/menus (canvas can be AA-exempt for v0.1.0) | axe-core CI |
| **NFR-12** | Telemetry: opt-in only, anonymized — does NOT include workflow content or engine URLs | Default off |

---

## 6. Data model (engine-side)

The studio writes its persistence to the target engine via the Node proxy. Tables are created on first connect if missing (`CREATE TABLE IF NOT EXISTS`).

```sql
CREATE TABLE workflow_definitions (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  version      INT  NOT NULL DEFAULT 1,
  definition   TEXT NOT NULL,              -- canvas JSON
  compiled_sql TEXT,                       -- last compiled output
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | deployed | archived
  owner        TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workflow_versions (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  version      INT  NOT NULL,
  definition   TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by   TEXT
);

CREATE IMMUTABLE TABLE workflow_deploys (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  version      INT  NOT NULL,
  engine_url   TEXT NOT NULL,
  deployed_by  TEXT,
  deployed_at  TIMESTAMP,
  objects_json TEXT                        -- {triggers: [...], procedures: [...]} for clean undeploy
);

CREATE TABLE workflow_runs (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL,
  version      INT  NOT NULL,
  trigger_kind TEXT,                       -- which trigger fired
  trigger_data TEXT,                       -- the NEW/OLD row that fired it
  status       TEXT NOT NULL,              -- running | success | error | cancelled
  started_at   TIMESTAMP,
  ended_at     TIMESTAMP,
  error        TEXT
);

CREATE TABLE workflow_step_runs (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  node_type    TEXT NOT NULL,
  status       TEXT NOT NULL,
  input_json   TEXT,
  output_json  TEXT,
  started_at   TIMESTAMP,
  ended_at     TIMESTAMP,
  error        TEXT
);

-- Approval port from SOAR (apps/soar/src/lib/schema.sql:189)
CREATE TABLE workflow_approval_queue (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  state        TEXT NOT NULL,              -- awaiting | approved | rejected | timed_out
  requested_at TIMESTAMP,
  decided_at   TIMESTAMP,
  decided_by   TEXT,
  reason       TEXT
);
```

`workflow_deploys` uses `IMMUTABLE TABLE` deliberately — the deploy audit chain is the governance story.

---

## 7. Compilation strategy

Each workflow compiles to:
1. **One stored procedure** per workflow version: `wf_<short_hash>_v<version>`
2. **Zero or more triggers** that invoke that procedure
3. **One INSERT into `workflow_deploys`** to record what landed

| Node type | SQL emitted |
|---|---|
| `RowEventTrigger` | `CREATE TRIGGER ... AFTER INSERT/UPDATE/DELETE ON <table> FOR EACH ROW EXECUTE PROCEDURE wf_<id>_v<v>(NEW, OLD);` |
| `MemoryStore` | `SELECT MEMORY_STORE(<namespace>, <content>, <metadata>) INTO @memory_id;` |
| `MemoryRecall` | `SELECT * FROM MEMORY_RECALL(<namespace>, <query>, <top_k>) INTO TABLE @results;` |
| `AgentRun` | `SELECT AGENT_RUN(<prompt>, <model>, <tools>) INTO @result;` |
| `SqlQuery` | inline SQL with parameter substitution |
| `HttpRequest` | uses engine's `execute_http_request` (already in `trigger_executor.rs:837`) — emits CALL form |
| `If` | `IF <expr> THEN ... ELSE ... END IF;` |
| `Switch` | `CASE <expr> WHEN ... THEN ... END CASE;` |
| `Loop` | `WHILE <expr> LOOP ... END LOOP;` |
| `Approval` | `INSERT INTO workflow_approval_queue (..., state='awaiting'); -- proc returns; second trigger on approval_queue fires resume.` Pattern ported from `apps/soar/src/lib/actions/dispatcher.ts:94`. |
| `SetVariable` | `SET @<name> = <expr>;` |
| `Return` | `RETURN <value>;` |

---

## 8. Open architectural questions — resolved before sprint kickoff

| # | Question | Resolution |
|---|---|---|
| Q1 | Workflow persistence: in engine or in studio's own SQLite? | **In engine** — unifies observability, leverages `IMMUTABLE TABLE` for audit. Node proxy is stateless except for secrets. |
| Q2 | Secrets storage: in engine or in studio's Node proxy? | **v0.1.0: Node proxy local (`~/.workflow-studio/credentials` mode 0600).** Engine-side secret store deferred to v0.2.0. |
| Q3 | Approval node mechanism: async wait or external poll? | **Async via second trigger on `workflow_approval_queue`** — proven in SOAR. The first proc returns when state=awaiting; the second trigger resumes when state changes. |
| Q4 | HTTP node — does engine have HTTP SQL functions? | **YES** — `execute_http_request` already shipped in `trigger_executor.rs:837` and `procedure_executor.rs:811`. Confirmed during pre-SRD audit. |
| Q5 | Run all triggers for the same workflow into ONE procedure, or split? | **One procedure per workflow version.** Triggers are routing-only. Easier to undeploy atomically. |
| Q6 | Multi-version concurrency — what happens to in-flight runs when a new version deploys? | v0.1.0: in-flight runs complete on the old procedure (because the procedure name embeds version). Newly-fired triggers route to the new procedure. **No live migration.** |
| Q7 | Auth: API key in URL or header? | **Authorization: Bearer** per the v1.8.5 engine spec. Held server-side only. |

---

## 9. Success criteria

| ID | Criterion | Test |
|---|---|---|
| **SC-1** | Build the 15-Min-Agent demo entirely in the canvas, deploy, see it run | Live walkthrough video, 1 take |
| **SC-2** | Re-create one of SOAR's existing investigation workflows (phishing triage) in the canvas | Generated SQL diffs against the hand-written SOAR equivalent — semantically equivalent |
| **SC-3** | Save → export JSON → import on a different machine → identical canvas | Byte-level JSON identity check |
| **SC-4** | All generated SQL passes `recipe-cert` against v1.8.5-ce and v1.9.0-ce when available | CI matrix |
| **SC-5** | Run a workflow that fires 100 times in 60s; execution viewer shows all 100 within 2s of completion | Synthetic load test |
| **SC-6** | Browser bundle < 2.5 MB gzipped | bundle-analyzer CI gate |
| **SC-7** | Lighthouse perf > 80, accessibility > 90 | CI on prod build |
| **SC-8** | Marketing assets ready: 15-min YouTube walkthrough, 3-min teaser, blog post, GH README | Manual review |

---

## 10. Reusable building blocks (compressed schedule depends on this)

| Asset | Location | What we reuse |
|---|---|---|
| **synapcores-apps app-framework** | `synapcores-apps/packages/app-framework` | Next.js scaffolding, auth, tenant, RBAC, SDK pre-wired — 3 apps already extend it |
| **Widget v2 Node proxy** | `/home/devops/IP/GPT/synapcores-agent/widget` | WS proxy + credential holder + reconnect logic + CLI shape |
| **SOAR approval queue pattern** | `apps/soar/src/lib/actions/dispatcher.ts:94` + `schema.sql:189` | Async approval node implementation pattern |
| **Engine `execute_http_request`** | `crates/aidb-query/src/trigger_executor.rs:837` + `procedure_executor.rs:811` | HTTP node compiles to existing SQL function — no engine work |
| **AGENT_RUN + MEMORY_*** | shipped v1.7.0 + v1.8.5 | All in-database agent primitives the compiler emits |
| **IMMUTABLE TABLE** | shipped v1.5 | Deploy audit chain |
| **@synapcores/sdk@0.5.0** | npm + GH SynapCores/nodejs-sdk | The whole engine I/O surface for the Node proxy |
| **React Flow / @xyflow/react v12** | npm | Canvas — no in-house canvas code |

---

## 11. Compressed sprint schedule (compressed Phases 0–3 into Week 1)

Total: **9 working days**, single frontend dev.

| Day | Phase | Output |
|---|---|---|
| **1** | **0 — Spike (compressed to 1 day)** | (a) Next.js 15 scaffold via app-framework, (b) React Flow renders 100-node canvas at 60fps confirmed, (c) Node proxy lifted from widget v2 boots and proxies one `/v1/query/execute` round-trip end-to-end |
| **2** | **1a — Canvas + node palette** | Canvas + node palette + 5 of 12 node types renderable (RowEventTrigger, MemoryStore, MemoryRecall, AgentRun, SqlQuery), drawer-style inspector working, IndexedDB autosave |
| **3** | **1b — Remaining nodes + validation + JSON I/O** | Other 7 node types (HttpRequest, If, Switch, Loop, Approval, SetVariable, Return), validation panel, JSON import/export, undo/redo, search |
| **4** | **2a — Compiler v1** | Visual JSON → SQL for all 12 node types deterministically, inline SQL preview pane, target-engine version check, CLI `workflow-studio compile` |
| **5** | **2b — Deploy / undeploy / audit** | Node proxy `POST /api/workflows/deploy` + `DELETE` round-trip, `IMMUTABLE TABLE workflow_deploys` write, multi-engine settings panel |
| **6** | **3a — Execution viewer (server side)** | Runs tab REST endpoints, WS proxy forwards `workflow_step_runs` inserts as live frames, per-run timeline data model |
| **7** | **3b — Execution viewer (UI) + test mode** | Gantt timeline UI, tool-call drill-down, replay-from-step, test mode with temp namespace tear-down |
| **8** | **4 — Templates + connectors polish** | 4 starter templates (15-Min-Agent, Phishing Triage, Ticket Resolver, Fraud Risk Score), Approval node end-to-end via SOAR queue pattern |
| **9** | **5 — Distribution + docs** | npm package + docker image + standalone tarball CI, README + 15-min YouTube walkthrough script, recipe-cert passing, **`0.1.0-alpha` tag** |

**Why 9 days and not 8+ weeks:** Phases 0–3 collapse to ~5 days because we are NOT writing the framework, NOT writing the Node proxy, NOT writing canvas code from scratch, and NOT inventing the approval pattern. Each of those is lifted from an existing shipped asset.

---

## 12. Release plan

| Tag | Contents | Audience |
|---|---|---|
| `0.1.0-alpha` | End of Day 9 — feature-complete, ready for internal demo | Internal SE team + design partners on-call |
| `0.1.0-beta` | +1 week of design-partner feedback applied | Public design partners (3–5) |
| `0.1.0` | +1 week after beta — public launch | Public launch — blog post, YouTube walkthrough, GH README |

---

**Document complete. Sprint approved for execution.**
