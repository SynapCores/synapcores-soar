import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SynapCores Aerospace RCA',
  description:
    'Engineering anomaly investigation memory. Vector + graph + immutable-audit + in-DB agents on one engine.',
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
