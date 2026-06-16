import { DashboardLayout, SidebarIcons, FRAMEWORK_SIDEBAR_SECTION } from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';
import { signOut } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  const studioSidebar = {
    heading: 'Workflow Studio',
    items: [
      { href: '/canvas', label: 'Canvas', icon: <SidebarIcons.Home className="h-4 w-4" /> },
      { href: '/runs', label: 'Run History', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/approvals', label: 'Approvals', icon: <SidebarIcons.ShieldAlert className="h-4 w-4" /> },
      { href: '/settings', label: 'Engine Settings', icon: <SidebarIcons.Users className="h-4 w-4" /> },
    ],
  };

  async function doSignOut(): Promise<void> {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <DashboardLayout
      brand={{ label: 'Workflow Studio', href: '/canvas' }}
      sidebar={[studioSidebar, FRAMEWORK_SIDEBAR_SECTION]}
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
