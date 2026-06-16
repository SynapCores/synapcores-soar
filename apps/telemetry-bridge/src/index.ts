/**
 * telemetry-bridge entry point.
 *
 * Two WebSocket paths:
 *   - /ingest : the browser simulator (Web Worker on the /dcu page)
 *               pushes batched samples at 10Hz. JSON only — small
 *               messages; ws library is plenty fast for the demo.
 *   - /feed   : the /dcu page subscribes here for live samples on
 *               selected sensors + alert events + 10Hz rate updates.
 *
 * Two HTTP paths:
 *   - GET /health   : { status: "ok", sensors, subscribers, ... }
 *   - POST /reset   : drops detection state for a fresh demo run.
 *                     (telemetry_alerts + promoted anomalies stay —
 *                      the engine carries history across runs by design.)
 *
 * Env:
 *   - SYNAPCORES_URL          (default http://127.0.0.1:8081)
 *   - SYNAPCORES_ADMIN_API_KEY  REQUIRED
 *   - DCU_BRIDGE_PORT         (default 4005)
 *   - DCU_AGGREGATE_PERIOD_MS (default 5000 — see honest tradeoff below)
 *   - DCU_BATCH_ROWS          (default 500)
 *   - DCU_PERSIST_AGGREGATES  (default 1 — set 0 to skip aggregate writes)
 *
 * Why default AGGREGATE_PERIOD = 5000ms (= 0.2Hz):
 *   The spec offers 1Hz (3000 rows/s, ~270K rows over a 90s run) and
 *   a 0.2Hz fallback (54K rows total) — "better to demo at a
 *   sustainable rate than to wedge the engine mid-demo." We default
 *   conservative; flip DCU_AGGREGATE_PERIOD_MS=1000 if the engine
 *   absorbs it on the target box.
 */

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Bridge } from './bridge.js';
import type {
  IngestBatchMessage,
  SubscribeMessage,
} from './types.js';

const PORT = Number(process.env.DCU_BRIDGE_PORT ?? 4005);
const BASE = process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:8081';
const KEY = process.env.SYNAPCORES_ADMIN_API_KEY;
const AGG_MS = Number(process.env.DCU_AGGREGATE_PERIOD_MS ?? 5000);
const BATCH = Number(process.env.DCU_BATCH_ROWS ?? 500);
const PERSIST = process.env.DCU_PERSIST_AGGREGATES !== '0';

if (!KEY) {
  console.error('[telemetry-bridge] SYNAPCORES_ADMIN_API_KEY not set.');
  process.exit(2);
}

const bridge = new Bridge({
  aidbBaseUrl: BASE,
  aidbApiKey: KEY,
  aggregatePeriodMs: AGG_MS,
  batchRowsPerInsert: BATCH,
  persistAggregates: PERSIST,
});

async function main(): Promise<void> {
  const n = await bridge.loadRegistry();
  bridge.start();
  console.log(`[telemetry-bridge] loaded ${n} sensors from telemetry_sensors`);

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          aidb: BASE,
          aggregate_period_ms: AGG_MS,
          persist_aggregates: PERSIST,
          ...bridge.snapshot(),
        }),
      );
      return;
    }
    if (req.method === 'POST' && req.url === '/reset') {
      bridge.resetRun();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'reset' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ingest') {
      wss.handleUpgrade(req, socket, head, (ws) => handleIngest(ws));
    } else if (url.pathname === '/feed') {
      wss.handleUpgrade(req, socket, head, (ws) => handleFeed(ws));
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`[telemetry-bridge] ready · ws://localhost:${PORT}/{ingest,feed}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[telemetry-bridge] ${signal} — shutting down`);
    bridge.stop();
    wss.close();
    httpServer.close(() => process.exit(0));
    // Hard exit if close stalls
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function handleIngest(ws: WebSocket): void {
  console.log('[telemetry-bridge] /ingest client connected');
  let dropped = 0;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as IngestBatchMessage;
      if (msg.type === 'samples') {
        bridge.ingest(msg);
      }
    } catch (e) {
      dropped++;
      if (dropped < 5) {
        console.warn(`[telemetry-bridge] bad /ingest message: ${(e as Error).message}`);
      }
    }
  });
  ws.on('close', () => console.log('[telemetry-bridge] /ingest client disconnected'));
  ws.on('error', (e) => console.warn(`[telemetry-bridge] /ingest ws err: ${e.message}`));
}

function handleFeed(ws: WebSocket): void {
  console.log('[telemetry-bridge] /feed client connected');
  const subscriber = {
    subscribed: new Set<string>(),
    send: (msg: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
  };
  bridge.addSubscriber(subscriber);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as SubscribeMessage;
      if (msg.type === 'subscribe' && Array.isArray(msg.sensor_ids)) {
        subscriber.subscribed = new Set(msg.sensor_ids);
        console.log(
          `[telemetry-bridge] /feed subscribed to ${msg.sensor_ids.length} sensors`,
        );
      }
    } catch {
      /* ignore */
    }
  });
  ws.on('close', () => {
    bridge.removeSubscriber(subscriber);
    console.log('[telemetry-bridge] /feed client disconnected');
  });
  ws.on('error', (e) => console.warn(`[telemetry-bridge] /feed ws err: ${e.message}`));
}

main().catch((e) => {
  console.error('[telemetry-bridge] fatal:', e);
  process.exit(1);
});
