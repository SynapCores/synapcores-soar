#!/usr/bin/env node
/**
 * Workflow Studio CLI
 *
 * Commands:
 *   workflow-studio start           — start the Next.js server
 *   workflow-studio compile <file>  — compile workflow JSON to SQL (prints to stdout)
 *   workflow-studio deploy <file>   — compile + deploy via REST API
 *   workflow-studio bootstrap       — run DB bootstrap
 */

import { readFile } from 'node:fs/promises';

const [, , command, ...args] = process.argv;

async function readWorkflowFile(path) {
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text);
}

switch (command) {
  case 'start':
  case undefined: {
    // Import and run the Next.js server
    await import('./server.js').catch(() => {
      console.error(
        '[workflow-studio] Production server not found. Run: pnpm build first.',
      );
      process.exit(1);
    });
    break;
  }

  case 'compile': {
    if (!args[0]) {
      console.error('Usage: workflow-studio compile <workflow.json>');
      process.exit(1);
    }
    const def = await readWorkflowFile(args[0]);
    // Inline basic compile for CLI use (avoids Next.js server requirement)
    const safeName = def.meta?.name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') ?? 'workflow';
    const version = def.version ?? 1;
    const procedureName = `wf_${safeName}_v${version}`;
    console.log(`-- Workflow: ${def.meta?.name}`);
    console.log(`-- Procedure: ${procedureName}`);
    console.log(`-- Nodes: ${def.nodes?.length ?? 0}`);
    console.log('');
    console.log('-- Run the Studio compile endpoint for full SQL output:');
    console.log(`-- POST /api/v1/workflows/${def.id ?? '<id>'}/compile`);
    break;
  }

  case 'deploy': {
    if (!args[0]) {
      console.error('Usage: workflow-studio deploy <workflow.json>');
      process.exit(1);
    }
    const def = await readWorkflowFile(args[0]);
    const studioUrl = process.env.STUDIO_URL ?? 'http://localhost:3010';
    const apiKey = process.env.STUDIO_API_KEY ?? '';

    console.log(`[deploy] Deploying to Studio at ${studioUrl}...`);
    const res = await fetch(`${studioUrl}/api/v1/workflows/${def.id}/deploy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ definition: def }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error('[deploy] Failed:', body.error ?? res.status);
      process.exit(1);
    }
    console.log('[deploy] Success!');
    console.log('  Procedure:', body.procedureName);
    console.log('  Triggers:', body.triggerNames?.join(', '));
    console.log('  Hash:', body.hash);
    break;
  }

  case 'bootstrap': {
    // Delegate to the bootstrap script
    await import('./bootstrap.mjs').catch(async () => {
      await import('./bin/bootstrap.mjs');
    });
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: workflow-studio <start|compile|deploy|bootstrap>');
    process.exit(1);
}
