import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SynapCores Workflow Studio',
  description: 'Visual agentic workflow builder for SynapCores',
  robots: { index: false }, // private app — homepage carries the marketing surface
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
