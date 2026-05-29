/**
 * Re-exports the Auth.js route handlers + helpers so apps can wire
 * /app/api/auth/[...nextauth]/route.ts in one line:
 *
 *   export { GET, POST } from '@synapcores/app-framework/routes/auth';
 *
 * Apps that need extra providers call `createAuth(...)` directly from
 * the framework's auth/server module instead.
 */

import 'server-only';
import { createAuth } from '../auth/server';

export const { handlers, auth, signIn, signOut } = createAuth();
export const { GET, POST } = handlers;
