#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/aml bootstrap
 *
 * Phase 1: no-op (the AML domain schema lands in Phase 2). The
 * framework schema is still required — run `pnpm framework:bootstrap`
 * for that.
 *
 * Phase 2 will replace this with the AML schema loader (mirrors
 * apps/soar/bin/bootstrap.mjs).
 */

console.log(
  '[aml-bootstrap] Phase 1 ships only the framework shell; AML-domain schema arrives in Phase 2. No-op.',
);
process.exit(0);
