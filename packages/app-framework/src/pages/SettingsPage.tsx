import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui';
import { Link2, User, Building2, KeyRound, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

/**
 * Settings hub — overview cards that link to the dedicated sections.
 * Apps render this at /settings/page.tsx via:
 *   import { SettingsPage } from '@synapcores/app-framework/pages';
 *   export default SettingsPage;
 */
export default function SettingsPage() {
  const cards = [
    {
      href: '/settings/profile',
      title: 'Profile',
      description: 'Your name, email, and password.',
      icon: <User className="h-5 w-5 text-primary" />,
    },
    {
      href: '/settings/workspace',
      title: 'Workspace',
      description: 'Name, URL slug, and tenant-level settings.',
      icon: <Building2 className="h-5 w-5 text-primary" />,
    },
    {
      href: '/settings/api-keys',
      title: 'API keys',
      description: 'Programmatic tokens for the SDK and CLI.',
      icon: <KeyRound className="h-5 w-5 text-primary" />,
    },
    {
      href: '/settings/mcp-tokens',
      title: 'MCP auditor tokens',
      description:
        'Scoped, time-bound tokens for external auditors / examiners.',
      icon: <ShieldAlert className="h-5 w-5 text-primary" />,
    },
    {
      href: '/team',
      title: 'Team & invitations',
      description: 'Invite analysts, change roles, see pending invites.',
      icon: <Link2 className="h-5 w-5 text-primary" />,
    },
  ];

  return (
    <div className="p-6 md:p-8">
      <AppPageHeader
        title="Settings"
        description="Manage your workspace, team, and access."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="block">
            <Card className="hover:border-primary/40 transition-colors h-full">
              <CardHeader className="flex-row items-start gap-3">
                {c.icon}
                <div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <CardDescription>{c.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-primary">
                Open →
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
