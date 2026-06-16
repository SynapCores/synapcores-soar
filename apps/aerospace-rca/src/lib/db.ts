/**
 * Shim around the framework's SDK client for single-tenant demo mode.
 *
 * The framework's getAdminClient() reads SYNAPCORES_URL +
 * SYNAPCORES_ADMIN_API_KEY at process startup. For aerospace-rca we
 * point at the v1.8.1-ce engine directly; no per-tenant scoping.
 */

import 'server-only';

import { SynapCoresClient } from '@synapcores/app-framework/db';

let cached: SynapCoresClient | null = null;

export function db(): SynapCoresClient {
  if (cached) return cached;
  const apiKey = process.env.SYNAPCORES_ADMIN_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[aerospace-rca] SYNAPCORES_ADMIN_API_KEY is not set. See README.',
    );
  }
  cached = new SynapCoresClient({
    baseUrl: process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:8081',
    apiKey,
    timeoutMs: 60_000,
  });
  return cached;
}

/**
 * Today's anomaly — the BE-4 unit 027 bearing incident the demo plays
 * back. Tracked as a constant so the demo page, reset endpoint, and
 * detail page agree on which row is "today".
 */
export const TODAY_ANOMALY_ID = 'ANM-2026-BE4-027';

/** Single demo tenant — used by the immutable audit chain. */
export const DEMO_TENANT = 'demo-aero';
