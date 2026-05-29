import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SynapCores SOAR',
  description:
    'The open-core SOAR platform for the autonomous SOC. Tier-1 triage, IR playbook execution, immutable audit, MCP portal for auditors.',
  robots: { index: false }, // private app — homepage carries the marketing surface
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
