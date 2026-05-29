/**
 * Client-safe auth exports.
 *
 * Server-only pieces (NextAuth, password verify, DB lookups) live in
 * ./server.ts. Importing this barrel from React components is safe.
 */

export type {
  Session,
  TenantInfo,
  UserInfo,
  SignInResult,
  SignInWithPasswordInput,
  SignInWithMagicLinkInput,
} from './types';
