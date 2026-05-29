/**
 * Runtime permission checks used by route handlers / server actions.
 */

import type { Session } from '../auth/types';
import type { Permission } from './types';

/**
 * Pure check — does the session hold this permission?
 */
export function hasPermission(
  session: Session | null,
  permission: Permission,
): boolean {
  if (!session) return false;
  return session.permissions.includes(permission);
}

/**
 * Throws if the session is missing the required permission. Use this
 * at the top of route handlers / server actions to gate access.
 */
export function requirePermission(
  session: Session | null,
  permission: Permission,
): asserts session is Session {
  if (!session) {
    throw new PermissionError('unauthenticated', 'You must be signed in.');
  }
  if (!session.permissions.includes(permission)) {
    throw new PermissionError(
      'forbidden',
      `Missing permission: ${permission}`,
    );
  }
}

export class PermissionError extends Error {
  readonly code: 'unauthenticated' | 'forbidden';
  constructor(code: 'unauthenticated' | 'forbidden', message: string) {
    super(message);
    this.name = 'PermissionError';
    this.code = code;
  }
}
