import {
  DashboardLayout,
  SidebarIcons,
} from '@synapcores/app-framework';

/**
 * Demo mode — no auth. The DashboardLayout takes a synthetic session
 * so the chrome (sidebar + topbar) renders identically to AML / SOAR
 * without standing up the framework's tenancy machinery for a 30-minute
 * outreach demo.
 */
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebar = {
    heading: 'Aerospace RCA',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <SidebarIcons.Home className="h-4 w-4" /> },
      { href: '/anomalies', label: 'Anomalies', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/rfas', label: 'RFAs', icon: <SidebarIcons.ShieldAlert className="h-4 w-4" /> },
      { href: '/audit', label: 'Evidence Chain', icon: <SidebarIcons.FileLock2 className="h-4 w-4" /> },
      { href: '/dcu', label: 'Live Telemetry', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
      { href: '/demo', label: 'Monitoring', icon: <SidebarIcons.Activity className="h-4 w-4" /> },
    ],
  };

  async function noOp(): Promise<void> {
    'use server';
  }

  return (
    <DashboardLayout
      brand={{ label: 'SynapCores Aerospace RCA', href: '/dashboard' }}
      sidebar={[sidebar]}
      session={{
        user: { name: 'Reliability Engineer', email: 'demo@blueorigin.com' },
        tenant: { name: 'Engines · Blue Origin (demo)' },
      }}
      signOutAction={noOp}
    >
      {children}
    </DashboardLayout>
  );
}
