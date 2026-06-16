# Cinematic playback — storyboard

Total runtime: ~70 seconds. Every act fires real queries against
SynapCores AIDB on `http://127.0.0.1:8081`. No mocks.

The pre-conditions for a clean recording:
1. Engine up; `EMBED()` and `AGENT_RUN()` both reachable.
2. `pnpm seed-demo -- --bulk --hold-today` already executed (so the
   45-anomaly corpus + native graph + initial evidence rows are loaded,
   minus the BE-4 unit 027 anomaly which Act 1 ingests live).
3. Browser at `http://localhost:3005/demo`, viewport 1440x900,
   sidebar visible.

---

## Act 1 · 06:14:23 UTC — anomaly detected on BE-4 hot-fire stand 4 (~12s)

**On-screen.** A live feed card slides in for the incoming anomaly.
The card shows: severity=major, subsystem=turbopump, "LOX-side bearing
race micro-pitting", reporter K. Suresh, stand Hot-fire Stand 4. A
status line transitions through *embedding...* → *embedded + indexed*.
A secondary line: *"SharePoint baseline: ~3 prior reports surface in
2–3 days."*

**Queries fired.**

- `POST /api/v1/demo/ingest-today` → server-side ingest via
  `INSERT INTO anomalies ... VALUES (..., EMBED(description))`.
- `INSERT INTO evidence_chain (id, ts, actor, action, target_id, details)
   VALUES ($1, NOW(), 'system:ingest', 'anomaly.ingested', $2, $3)`.

**Caption.** *"Every anomaly becomes a vector the instant it lands."*

**Dollar callout.** Time-to-first-relevant-prior on SharePoint = days.
Time-to-first-relevant-prior here = the duration of an embedding =
~50ms wall-clock.

---

## Act 2 · semantic recall across 28 months of test history (~14s)

**On-screen.** A panel of top-5 similar past anomalies, ranked by
COSINE_SIMILARITY against the just-ingested embedding. Score bars,
program badges. The BE-3 unit 031 row glows red — "different program,
SharePoint search would never have linked".

**Queries fired.**

```sql
SELECT a.id, a.title, a.program,
       COSINE_SIMILARITY(a.embedding,
         (SELECT embedding FROM anomalies WHERE id = $1)) AS similarity
  FROM anomalies a
 WHERE a.id <> $1
 ORDER BY similarity DESC LIMIT 6
```

via `GET /api/v1/anomalies/ANM-2026-BE4-027/similar?k=6`.

**Caption.** *"4 prior matches. One on BE-3 — heritage engine — that a
SharePoint search would never have linked."*

**Dollar callout (one-pager U1).** 200 engineers × 6 hrs/wk
anomaly-history search → 0.5 hrs at $385/hr loaded aerospace eng rate =
**~$4.8M/yr labor reclaim**.

---

## Act 3 · graph reveals the supplier-batch fingerprint (~16s)

**On-screen.** Force-directed graph (`react-force-graph-2d`). Nodes:
today's anomaly (red), prior matched anomalies, the LOX-side turbopump
bearing race part, the Acme Bearings supplier (gold), the affected
programs (purple) — BE-4, BE-3, NG. Edges OCCURRED_ON, SUPPLIED_BY,
USED_IN. A side-panel renders the supplier summary:
*"Supplier: Acme Precision Bearings · Same bearing race ships into BE-4,
BE-3, NG."*

**Queries fired** via `GET /api/v1/anomalies/ANM-2026-BE4-027/graph`,
which issues these MATCHes against `/v1/query/execute`:

```cypher
MATCH (a:Anomaly)-[:OCCURRED_ON]->(p:Part)-[:SUPPLIED_BY]->(s:Supplier)
  WHERE a.id = "ANM-2026-BE4-027" RETURN p, s

MATCH (sib:Anomaly)-[:OCCURRED_ON]->(p:Part)
  WHERE p.id = "p-bearing-lox" RETURN sib

MATCH (sp:Part)-[:SUPPLIED_BY]->(s:Supplier)
  WHERE s.id = "acme-bearings" RETURN sp

MATCH (ca:CorrectiveAction)-[:RESOLVED_BY]->(a:Anomaly)-[:OCCURRED_ON]->(p:Part)
  WHERE p.id = "p-bearing-lox" RETURN ca
```

**Caption.** *"The supplier was already on a re-cert. We just did not
propagate it to two other programs."*

---

## Act 4 · agent finds the bureaucracy fault line (~16s)

**On-screen.** The Safety Officer agent panel. Status: *Agent thinking…
(deterministic query first, prose narration when LLM lands)* for ~1s,
then the deterministic finding lands:

> 3 open RFAs touch this anomaly's subsystem family (turbopump) and are
> > 60 days old. At least one is owned by an employee no longer at the
> company.

A bullet list with RFA IDs and the *"412 days open · owner
j.warren@blueorigin.com has left the company (HR registry)"* line in
destructive-red. A small badge bottom: **"OIG IG-26-004 — nearly half
of PDR RFAs remain open >1 year"**.

**Queries fired** (server-side via `POST /api/v1/anomalies/ANM-2026-BE4-027/agent`
body `{persona: 'safety_officer'}`):

```sql
-- Find similar past anomalies (vector)
SELECT ... COSINE_SIMILARITY(...) FROM anomalies ...

-- Cross-reference RFAs that touch related subsystems
SELECT id, program, owner, status, days_open, title, subsystem
  FROM rfas
 WHERE status IN ('open','in-review')
   AND subsystem IN (...)
 ORDER BY days_open DESC

-- Departed-owner check
SELECT email, name FROM departed_employees

-- Persist the finding to agent_runs + evidence_chain
```

In the background, `AGENT_RUN('technical_advisor', ...)` runs to add
italic prose narration. If it lands within the act window, the prose
shows under the deterministic summary. If not, the deterministic
finding is still complete and load-bearing.

**Caption.** *"An agent in the database found in seconds what
bureaucracy failed to surface in 13 months."*

**Dollar callout (one-pager U2).** 30 PMs × 4 hrs/wk RFA status chasing
→ 0.5 hrs at $245/hr = **~$650k/yr**.

---

## Act 5 · tamper-evident evidence spine (~12s)

**On-screen.** The evidence chain panel — every action since Act 1
shows up as a chained log row with `hash` and `prev_hash` (both
sha-256 of the row payload). A button: "Export FAA Evidence Package"
that downloads the JSON.

**Queries fired** via `GET /api/v1/audit?target=ANM-2026-BE4-027`:

```sql
SELECT id, ts, actor, action, target_id, details
  FROM evidence_chain
 WHERE target_id = $1
 ORDER BY ts ASC
 LIMIT 500
```

The engine refuses `UPDATE evidence_chain SET ...`. That's the
load-bearing claim — the table is immutable at the storage layer.

**Caption.** *"One database. Vectors caught the pattern. Graph
revealed the supplier. Agent surfaced the bureaucracy. Immutable audit
makes it FAA-defensible."*

**Closing CTA.** *"SynapCores AIDB · One engine, one binary,
on-prem-friendly · 90-day pilot."*

---

---

# U6 · DCU live telemetry — the complement of U1

U1 above is "memory recall after an engineer flagged something." U6
is the **real-time** layer at the DCU (Data Concentration Unit)
level — 3000 sensors × 100 Hz = 300K samples/sec — that *generates*
the events U1 then investigates. Total runtime: ~90 seconds.
Demo URL: `http://localhost:3005/dcu`.

Pre-conditions for a clean recording:
1. Engine up; `EMBED()` reachable.
2. `pnpm seed-demo` has loaded the 3000-sensor registry plus the U1
   corpus.
3. `pnpm --filter @synapcores/telemetry-bridge dev` running on :4005.
4. Aerospace-rca dev server on :3005.
5. Browser at `http://localhost:3005/dcu`, viewport 1440x900,
   sidebar visible.

## Act 0 · t=0 — kick off

**On-screen.** The page header reads "DCU — Live Telemetry · BE-4
hot-fire stand 4." Three rate-meter cards show 0. A row of 12
sparkline panels is empty. Click **Start Test**.

**Wired up.** The page spawns the Web Worker simulator and opens two
WebSockets to the bridge — `/ingest` (worker→bridge, 10Hz batches of
3K samples) and `/feed` (bridge→UI, 12 subscribed sensors live + all
alerts + 10Hz rate updates).

**Caption.** *"3000 sensors × 100 Hz. The bridge is real. The load is
simulated. AIDB sees the meaningful 0.3%."*

## Act 1 · t=0–10s — nominal

**On-screen.** Rate meter climbs to ~300K samples/sec. Sparklines
wiggle within nominal noise bands. Alert feed reads "No alerts yet.
Sensors are warming up; the detector needs ~2s of rolling-stats
warmup before z-score thresholds can fire."

**Caption.** *"Engine is humming. Every detector is in its 2-second
warmup window — rolling Welford stats are accumulating per sensor."*

## Act 2 · t≈12s — vibration spike, BE-4 unit 027 LOX turbopump

**On-screen.** Sparkline 1 (BE4-027-TP-VIB-X-014) goes vertical. The
alert feed gets a new entry with detector=`debounced-z`, score≈12σ
(saturated by the planted 7g spike). Big red "Open Investigation →"
button. The promoted anomaly id starts with `ANM-LIVE-BE4-027-...`.

**Caption.** *"The DCU's rolling z-score caught a 12σ excursion. The
bridge promoted it into the same anomalies table the past 45 BE-4
investigations live in. One click and we're in the U1 surface."*

## Act 3 · t≈31s — pressure drift, NG-2 pre-burner

**On-screen.** Sparkline 2 (NG-2-PB-PRES-002) starts ramping. The
step detector fires first (~31.1s, slope ≈ 250 kPa/s above the
150 kPa/s threshold); the z-score detector follows once the drift
has shifted the rolling mean far enough.

**Caption.** *"Slow drift, not a spike — z-score alone would
whitewash this because the drift moves its own baseline. The
step-detector catches it first."*

## Act 4 · t≈53s — single-sample temp excursion, BE-3 unit 031 *(detector debounces — NO alert)*

**On-screen.** Sparkline 3 (BE3-031-TP-TEMP-007) shows one sample at
+60K above nominal, then immediately returns to baseline. **No new
alert appears.** The presenter narrates: the detector requires 4
consecutive over-threshold samples (40ms) before firing for
temperature kind.

**Caption.** *"The detector is real, not theater. A single bad sample
on a thermocouple is almost always noise. Debounce-of-4 swallows it.
A real plant operator does not want to be paged at 03:00 for a
1-sample 6σ event."*

## Act 5 · t≈71s — second BE4-027 sensor fires; cluster pattern

**On-screen.** Sparkline 4 (BE4-027-CC-VIB-Y-022) spikes. New alert
appears with a red **"cluster: 2 sensors on BE4-027 this run"** label.
The promoted anomaly's description explicitly references the prior
BE4-027 alert.

**Caption.** *"This is the second sensor on unit BE4-027 to fire in 60
seconds — turbopump and combustion chamber. The bridge wrote that
cluster relationship into telemetry_alerts.notes. The bearing-batch
story compounds."*

## Act 6 · t≈75s — click "Open Investigation" → U1 takes over

**On-screen.** Presenter clicks the Open Investigation button on the
Act 2 alert. Browser navigates to `/anomalies/ANM-LIVE-BE4-027-XXXXXX`
— the existing U1 detail page. The "Similar past anomalies (vector
recall)" card populates with the top-5 cosine matches:

- ANM-2024-BE3-007 — BE-3 turbopump bearing race carbon residue
- ANM-2024-BE4-022 — Repeat LOX bearing race carbon deposit, BE-4 022
- ANM-2026-NG-010 — Methane-side turbopump bearing race vibration
- ANM-2026-BE4-027 — BE-4 unit 027 LOX bearing race carbon deposit
- ANM-2023-BE4-019 — LOX turbopump bearing race micro-pitting

**Caption.** *"And now memory takes over. The live detection from 60
seconds ago is one row in the same corpus as 28 months of history.
COSINE_SIMILARITY against the embedding the bridge wrote at promote
time. The Safety Officer agent is one click away."*

## Recording cues — U6

| t (s) | event                                                |
|------:|------------------------------------------------------|
|     0 | click "Start Test"                                   |
|     2 | rate meter passes 100K/sec                           |
|    10 | rate meter steady ~300K/sec                          |
|    12 | Act 2 alert — BE4-027-TP-VIB-X-014                   |
|    31 | Act 3 alert — NG-2-PB-PRES-002                       |
|    53 | Act 4 — temp single-sample event (NO alert fires)    |
|    71 | Act 5 alert — BE4-027-CC-VIB-Y-022, cluster label    |
|    75 | click Open Investigation → /anomalies/<id>           |
|    90 | end (idle; click Stop or let it run for a longer demo)|

## What's stubbed / honest

- The 4 anomaly events are **deterministically planted** in
  `simulator.worker.ts` at fixed timestamps. Real DCU traffic
  obviously isn't scripted. The detection is real (the bridge has no
  knowledge of which sensors will fire); only the signal is planted.
- The "samples/sec ingested" headline is computed from the worker's
  own emit rate, not from a stat the engine publishes. The engine's
  view is the "Persisted aggregates" + "Bridge batches/sec" stat
  cards. Both are accurate to what they label.
- Default aggregation period is 0.2Hz (5 seconds). Bump to 1Hz via
  `DCU_AGGREGATE_PERIOD_MS=1000` in `apps/telemetry-bridge/.env.local`
  if the engine box absorbs it; the demo plays fine at either rate.

---

## Recording cues

| t (s) | event                                       |
|------:|---------------------------------------------|
|     0 | click "Kick Off"                            |
|     0 | Act 1 card slides in; "incoming" pulse ring |
|    12 | Act 2 similarity bars render                |
|    26 | Act 3 graph reveals                         |
|    42 | Act 4 agent finding lands                   |
|    58 | Act 5 evidence panel + Export button        |
|    70 | end (idle; Kick Off becomes "Run Again")    |
