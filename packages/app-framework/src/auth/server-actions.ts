/**
 * Single re-export surface for everything an app's server actions need.
 * Apps import from here so they don't have to remember which file each
 * helper lives in.
 */

import 'server-only';

export {
  createUser,
  findUserByEmail,
  setUserPassword,
  markEmailVerified,
  mintAuthToken,
  redeemAuthToken,
  UserAlreadyExistsError,
  ValidationError,
} from './users';
export type { CreateUserInput, TokenPurpose, MintedToken } from './users';

export {
  createTenant,
  addMembership,
  writeAuditEvent,
} from './tenants';
export type { CreateTenantInput } from './tenants';

export {
  sendMagicLink,
  sendPasswordReset,
  sendTenantInvite,
} from './mailer';

export {
  inviteUser,
  listPendingInvites,
  revokeInvitation,
  acceptInvitation,
  previewInvitation,
  userExistsForEmail,
} from './invitations';
export type { InviteUserInput, PendingInvite } from './invitations';
