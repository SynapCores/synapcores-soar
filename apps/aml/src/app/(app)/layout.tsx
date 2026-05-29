import {
  DashboardLayout,
  FRAMEWORK_SIDEBAR_SECTION,
  SidebarIcons,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { signOut } from '@/lib/auth';

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const amlSidebar = {
    heading: 'AML',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <SidebarIcons.Home className="h-4 w-4" /> },
      { href: '/transactions', label: 'Transactions', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/cases', label: 'Cases', icon: <SidebarIcons.ShieldAlert className="h-4 w-4" /> },
      { href: '/sars', label: 'SARs', icon: <SidebarIcons.FileLock2 className="h-4 w-4" /> },
      { href: '/actions', label: 'Actions', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/approvals', label: 'Approvals', icon: <SidebarIcons.ShieldAlert className="h-4 w-4" /> },
    ],
  };

  async function doSignOut(): Promise<void> {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <DashboardLayout
      brand={{ label: 'SynapCores AML', href: '/dashboard' }}
      sidebar={[amlSidebar, FRAMEWORK_SIDEBAR_SECTION]}
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
