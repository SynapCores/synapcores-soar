import 'server-only';
import { SynapCoresClient } from '@synapcores/app-framework/db';

export interface EngineConfig {
  url: string;
  apiKey: string;
}

/**
 * Get the admin client using env vars.
 * This is the "framework engine" for auth tables.
 */
export function getAdminEngineClient(): SynapCoresClient {
  const url = process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080';
  const key = process.env.SYNAPCORES_API_KEY ?? '';
  return new SynapCoresClient({ baseUrl: url, apiKey: key });
}

/**
 * Get a client for a named target engine.
 * Used for workflow deploy/run operations.
 */
export function getTargetEngineClient(config: EngineConfig): SynapCoresClient {
  return new SynapCoresClient({ baseUrl: config.url, apiKey: config.apiKey });
}

export { SynapCoresClient };
