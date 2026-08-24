#!/usr/bin/env node
/**
 * Exchange the pinned admin username/password for a gateway JWT via
 * POST /v1/auth/login, and print ONLY the access_token to stdout so the
 * entrypoint can capture it:
 *
 *   export SYNAPCORES_ADMIN_API_KEY="$(node bin/aidb-login.mjs)"
 *
 * This exists so a first run is `docker compose up -d` and nothing else.
 * Previously the quickstart required booting the engine, grepping its logs
 * for the first-boot `aidb_…` key, pasting that into .env, and only then
 * starting the app.
 *
 * The engine mints the token (signed with AIDB_JWT_SECRET); nothing is signed
 * client-side and no token is baked into the image. Retries until the gateway
 * is up AND the first-boot admin user exists, since schema init can lag
 * container start. All diagnostics go to stderr so stdout stays clean.
 */

const BASE = (process.env.SYNAPCORES_URL ?? 'http://synapcores:8080').replace(/\/+$/, '');
const USER = process.env.AIDB_ADMIN_USER ?? 'admin';
const PASS = process.env.AIDB_ADMIN_PASSWORD;
const RETRIES = Number(process.env.AIDB_LOGIN_RETRIES ?? 90);
const DELAY_MS = Number(process.env.AIDB_LOGIN_RETRY_MS ?? 2000);

if (!PASS) {
  console.error('[aidb-login] AIDB_ADMIN_PASSWORD is not set — cannot log in.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    const res = await fetch(`${BASE}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (res.ok) {
      const body = await res.json();
      // The login route returns the token at the top level; other gateway
      // routes wrap payloads in {data,meta}, so accept either shape.
      const token = body?.access_token ?? body?.data?.access_token;
      if (typeof token === 'string' && token) {
        console.error(`[aidb-login] obtained token on attempt ${attempt}`);
        process.stdout.write(token);
        process.exit(0);
      }
      console.error('[aidb-login] login succeeded but response had no access_token');
    } else {
      console.error(`[aidb-login] attempt ${attempt}/${RETRIES} → HTTP ${res.status} (gateway warming up?)`);
    }
  } catch (e) {
    console.error(`[aidb-login] attempt ${attempt}/${RETRIES} → ${e.message}`);
  }
  await sleep(DELAY_MS);
}

console.error(`[aidb-login] gave up after ${RETRIES} attempts waiting for ${BASE}`);
process.exit(1);
