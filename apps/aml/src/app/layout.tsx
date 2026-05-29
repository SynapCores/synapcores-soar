import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SynapCores AML',
  description:
    'The open-core anti-money-laundering platform. Transaction monitoring, UBO traversal, autonomous SAR drafting, immutable audit, MCP portal for examiners.',
  robots: { index: false },
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
