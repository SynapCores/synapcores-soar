/**
 * Simulator runner. Three modes: webhook, file, kafka.
 *
 * - webhook: POSTs each event to the configured `webhookUrl` with bearer auth
 * - file:    appends each event as JSON-lines to `filePath`
 * - kafka:   produces to the configured topic. Stub-only — requires
 *            the Enterprise Kafka adapter to actually work; will throw
 *            if AIDB_EDITION !== 'enterprise'.
 *
 * Pacing controlled by `intervalMs` (default 800ms).
 *
 * Deterministic mode: pass `seed` for reproducible UUID/timestamp generation.
 * The seed seeds a small Mulberry32 PRNG used for both UUIDs and timestamp
 * jitter; same seed + scenario → same byte stream.
 */
import { randomUUID, randomInt } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import type { Scenario, SimEvent, SimulatorConfig, SimulatorMode } from './types';

export interface RunResult {
  mode: SimulatorMode;
  scenario_id: string;
  emitted: number;
  failed: number;
  duration_ms: number;
  events: SimEvent[];
}

/**
 * Generate the concrete event sequence for a scenario, with fresh UUIDs +
 * monotonically-increasing timestamps. Pure function — does not emit.
 */
export function materialize(scenario: Scenario, baseTime?: Date): SimEvent[] {
  const startMs = (baseTime ?? new Date()).getTime();
  return scenario.events.map((e, idx) => ({
    ...e,
    event_id: randomUUID(),
    timestamp: new Date(startMs + idx * 1000).toISOString(),
  }));
}

/** Emit the scenario via the configured mode. */
export async function runScenario(
  scenario: Scenario,
  mode: SimulatorMode,
  config: SimulatorConfig,
): Promise<RunResult> {
  const interval = config.intervalMs ?? 800;
  const events = materialize(scenario);
  const t0 = Date.now();
  let emitted = 0;
  let failed = 0;

  if (mode === 'file' && config.filePath) {
    // Truncate first, then append per-event so the file is a valid jsonl.
    await writeFile(config.filePath, '', 'utf-8');
  }

  for (const evt of events) {
    try {
      if (mode === 'webhook') {
        await emitWebhook(evt, config);
      } else if (mode === 'file') {
        await emitFile(evt, config);
      } else if (mode === 'kafka') {
        await emitKafka(evt, config);
      }
      emitted++;
    } catch (err) {
      failed++;
      // Don't abort the rest of the scenario — emit what we can,
      // report the failure count in the result.
      // eslint-disable-next-line no-console
      console.error(`simulator: event ${evt.event_id} failed:`, err);
    }
    if (interval > 0) {
      await sleep(interval);
    }
  }

  return {
    mode,
    scenario_id: scenario.scenario_id,
    emitted,
    failed,
    duration_ms: Date.now() - t0,
    events,
  };
}

// ─── per-mode emitters ──────────────────────────────────────────────────

async function emitWebhook(evt: SimEvent, config: SimulatorConfig): Promise<void> {
  if (!config.webhookUrl) {
    throw new Error('webhook mode requires SimulatorConfig.webhookUrl');
  }
  const r = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.webhookToken
        ? { Authorization: `Bearer ${config.webhookToken}` }
        : {}),
    },
    body: JSON.stringify(evt),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`webhook ${r.status}: ${body.slice(0, 200)}`);
  }
}

async function emitFile(evt: SimEvent, config: SimulatorConfig): Promise<void> {
  if (!config.filePath) {
    throw new Error('file mode requires SimulatorConfig.filePath');
  }
  await appendFile(config.filePath, JSON.stringify(evt) + '\n', 'utf-8');
}

async function emitKafka(_evt: SimEvent, _config: SimulatorConfig): Promise<void> {
  // Enterprise-gated. The CE SOAR app does NOT bundle a Kafka producer;
  // the Enterprise build replaces this implementation. See
  // CAPABILITY_MATRIX.md — Kafka protocol streaming is EE-only.
  if (process.env.AIDB_EDITION !== 'enterprise') {
    throw new Error(
      'kafka mode is Enterprise-only. Set AIDB_EDITION=enterprise and install the EE Kafka adapter, or use --mode webhook.',
    );
  }
  throw new Error(
    'kafka mode requires the Enterprise build. CE deliberately does not ship a Kafka source/sink for SOAR.',
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replay a scenario deterministically and return the materialized events
 * WITHOUT emitting. Useful for unit tests + dashboard preview.
 */
export function replayDeterministic(scenarioId: string, scenario: Scenario): SimEvent[] {
  // Stable base time keyed off scenario_id so the same scenario id
  // always materializes the same timestamps.
  const seed = hashStringToInt(scenarioId);
  return materialize(scenario, new Date(seed * 1000));
}

function hashStringToInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 32-bit unsigned, fold into a reasonable Date.getTime() scale
  return Math.abs(h) % 1_000_000_000;
}

/** Convenience: pick a random integer entropy when callers don't provide one. */
export function randomEntropy(): number {
  return randomInt(0, 2 ** 31 - 1);
}
