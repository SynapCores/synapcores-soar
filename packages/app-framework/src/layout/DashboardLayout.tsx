import * as React from 'react';
import { Sidebar, type SidebarSection } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * The framework's standard authenticated layout. Apps wrap their
 * (app)/layout.tsx in this:
 *
 *   <DashboardLayout
 *     brand={{ label: 'SynapCores SOAR', href: '/' }}
 *     sidebar={[soarSections, FRAMEWORK_SIDEBAR_SECTION]}
 *     session={session}
 *     signOutAction={signOut}
 *   >
 *     {children}
 *   </DashboardLayout>
 */
export function DashboardLayout({
  brand,
  sidebar,
  session,
  signOutAction,
  topBarRight,
  children,
}: {
  brand: { label: string; href: string };
  sidebar: SidebarSection[];
  session: {
    user: { name: string | null; email: string };
    tenant: { name: string } | null;
  };
  signOutAction: () => Promise<void>;
  topBarRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar sections={sidebar} brand={brand} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          tenantName={session.tenant?.name ?? null}
          userName={session.user.name ?? session.user.email}
          userEmail={session.user.email}
          signOutAction={signOutAction}
          right={topBarRight}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
