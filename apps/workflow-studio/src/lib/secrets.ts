import 'server-only';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface EngineCredential {
  id: string;
  label: string;
  url: string;
  apiKey: string;
  createdAt: string;
}

const CREDS_DIR = join(homedir(), '.workflow-studio');
const CREDS_FILE = join(CREDS_DIR, 'credentials.json');

async function readCredentials(): Promise<Record<string, EngineCredential>> {
  try {
    const text = await readFile(CREDS_FILE, 'utf-8');
    return JSON.parse(text) as Record<string, EngineCredential>;
  } catch {
    return {};
  }
}

async function writeCredentials(creds: Record<string, EngineCredential>): Promise<void> {
  await mkdir(CREDS_DIR, { recursive: true });
  await writeFile(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function listEngines(): Promise<EngineCredential[]> {
  const creds = await readCredentials();
  return Object.values(creds);
}

export async function getEngine(id: string): Promise<EngineCredential | null> {
  // Env var short-circuit for single-engine mode
  if (id === 'default' && process.env.SYNAPCORES_API_KEY) {
    return {
      id: 'default',
      label: 'Default (env)',
      url: process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080',
      apiKey: process.env.SYNAPCORES_API_KEY,
      createdAt: new Date(0).toISOString(),
    };
  }
  const creds = await readCredentials();
  return creds[id] ?? null;
}

export async function saveEngine(engine: EngineCredential): Promise<void> {
  const creds = await readCredentials();
  creds[engine.id] = engine;
  await writeCredentials(creds);
}

export async function deleteEngine(id: string): Promise<void> {
  const creds = await readCredentials();
  delete creds[id];
  await writeCredentials(creds);
}

export async function getDefaultEngine(): Promise<EngineCredential | null> {
  // Env-var first
  if (process.env.SYNAPCORES_API_KEY) {
    return getEngine('default');
  }
  const engines = await listEngines();
  return engines[0] ?? null;
}
