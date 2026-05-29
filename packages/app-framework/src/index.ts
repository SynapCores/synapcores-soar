/**
 * @synapcores/app-framework — top-level barrel.
 *
 * Most consumers should use sub-path imports for tree-shake quality:
 *   import { DashboardLayout } from '@synapcores/app-framework/layout';
 *   import { Button } from '@synapcores/app-framework/ui';
 *   import { auth } from '@synapcores/app-framework/auth/server';
 *
 * The barrel below re-exports the safe-for-client surfaces only.
 */

// UI primitives (client-safe)
export {
  cn,
  Button,
  buttonVariants,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Label,
  DataTable,
  AppPageHeader,
} from './ui';
export type {
  ButtonProps,
  InputProps,
  DataTableColumn,
  DataTableProps,
} from './ui';

// Layout (client-safe — server-only auth helpers live separately)
export {
  DashboardLayout,
  Sidebar,
  FRAMEWORK_SIDEBAR_SECTION,
  SidebarIcons,
  TopBar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './layout';
export type { SidebarItem, SidebarSection } from './layout';

// Auth (types only — server bits at /auth/server)
export type {
  Session,
  TenantInfo,
  UserInfo,
  SignInResult,
  SignInWithPasswordInput,
  SignInWithMagicLinkInput,
} from './auth';

// RBAC (everything is safe for client use; just opaque strings)
export {
  FRAMEWORK_PERMISSIONS,
  DEFAULT_ROLE_GRANTS,
  hasPermission,
  requirePermission,
  PermissionError,
} from './rbac';
export type { Role, Permission, FrameworkPermission } from './rbac';

// DB types
export type { QueryResult, SynapCoresClientOptions } from './db';
export { SynapCoresError } from './db';

// Agent
export { AgentClient } from './agent';
export type { AgentRunOptions, AgentRunResult } from './agent';
