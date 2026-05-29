'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileLock2, Settings, Users } from 'lucide-react';
import { cn } from '../ui/cn';

export interface SidebarItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  /** Show even when there's no permission match. */
  always?: boolean;
}

export interface SidebarSection {
  /** Heading text or null for the first ungrouped section. */
  heading: string | null;
  items: SidebarItem[];
}

/**
 * The framework's standard sidebar. Every app passes its own item
 * structure — common items (Dashboard, Audit, Settings) live in the
 * framework defaults below; apps prepend their own.
 */
export function Sidebar({
  sections,
  brand,
}: {
  sections: SidebarSection[];
  brand: { label: string; href: string };
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-border bg-card">
      <div className="h-14 flex items-center px-5 border-b border-border">
        <Link
          href={brand.href}
          className="font-headline text-lg font-bold tracking-tight text-foreground"
        >
          {brand.label}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {sections.map((section, sIdx) => (
          <div key={section.heading ?? `s${sIdx}`}>
            {section.heading && (
              <h3 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.heading}
              </h3>
            )}
            <ul className="space-y-1">
              {section.items.map((it) => {
                const active =
                  pathname === it.href || pathname.startsWith(`${it.href}/`);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.badge !== undefined && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                          {it.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

/**
 * The framework's "general" sidebar items every app shows at the bottom.
 * Apps spread these in alongside their app-specific items.
 */
export const FRAMEWORK_SIDEBAR_SECTION: SidebarSection = {
  heading: 'Workspace',
  items: [
    {
      href: '/audit',
      label: 'Audit log',
      icon: <FileLock2 className="h-4 w-4" />,
    },
    {
      href: '/team',
      label: 'Team',
      icon: <Users className="h-4 w-4" />,
    },
    {
      href: '/settings',
      label: 'Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ],
};

// SidebarIcons re-exported from layout/icons.ts (a plain module) so
// they work in both server and client components.
