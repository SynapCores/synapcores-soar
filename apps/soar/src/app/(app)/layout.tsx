/**
 * Authenticated app shell. Everything under (app)/* requires a session.
 *
 * The (app) route group lets us wrap a subset of routes in the
 * framework's DashboardLayout without affecting /login, /register, etc.
 */

import { DashboardLayout, SidebarIcons } from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { signOut } from '@/lib/auth';

/**
 * The SOAR-specific sidebar items. Framework adds Audit / Team /
 * Settings underneath via FRAMEWORK_SIDEBAR_SECTION.
 */
import { FRAMEWORK_SIDEBAR_SECTION } from '@synapcores/app-framework';

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const soarSidebar = {
    heading: 'SOAR',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <SidebarIcons.Home className="h-4 w-4" /> },
      { href: '/alerts', label: 'Alerts', icon: <SidebarIcons.ShieldAlert className="h-4 w-4" /> },
      { href: '/incidents', label: 'Incidents', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/playbooks', label: 'Playbooks', icon: <SidebarIcons.Users className="h-4 w-4" /> },
    ],
  };

  async function doSignOut(): Promise<void> {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <DashboardLayout
      brand={{ label: 'SynapCores SOAR', href: '/dashboard' }}
      sidebar={[soarSidebar, FRAMEWORK_SIDEBAR_SECTION]}
      session={{
        user: { name: session.user.name, email: session.user.email },
        tenant: session.tenant ? { name: session.tenant.name } : null,
      }}
      signOutAction={doSignOut}
    >
      {children}
    </DashboardLayout>
  );
}
