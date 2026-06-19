import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { I18nProviderComponent } from '@/lib/i18n';

// Self-hosted via next/font so headless browsers (Playwright recordings,
// puppeteer screenshots) get the typeface without needing system fonts.
// Falls back through system-ui chain when offline.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SynapCores Workflow Studio',
  description: 'Visual agentic workflow builder for SynapCores',
  robots: { index: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className={`${inter.className} antialiased`}>
        <I18nProviderComponent locale="en">
          {children}
        </I18nProviderComponent>
      </body>
    </html>
  );
}
