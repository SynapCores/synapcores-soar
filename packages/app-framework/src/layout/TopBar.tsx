'use client';

import * as React from 'react';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './dropdown';
import { Button } from '../ui/button';

/**
 * The framework's top bar. Renders the current tenant name + a user
 * menu (profile, settings, sign-out). Apps may inject extra slots —
 * notifications, search, etc. — via the `right` prop.
 */
export function TopBar({
  tenantName,
  userName,
  userEmail,
  signOutAction,
  right,
}: {
  tenantName: string | null;
  userName: string;
  userEmail: string;
  /** Server action that signs the user out. */
  signOutAction: () => Promise<void>;
  right?: React.ReactNode;
}) {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-3">
        {tenantName && (
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Workspace:</span>
            <span className="font-semibold text-foreground">{tenantName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {right}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 px-2 hover:bg-accent"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">{userName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {userEmail}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile" className="w-full">
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="w-full">
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem asChild>
                <button
                  type="submit"
                  className="w-full flex items-center gap-2 text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
