/**
 * App-side auth helpers. We re-export the framework's `auth` + `signOut`
 * so app code can import from a single, app-local module — and so we
 * have a place to add SOAR-specific session enrichment later.
 */

import 'server-only';
export { auth, signIn, signOut } from '@synapcores/app-framework/routes/auth';
