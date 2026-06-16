import type { Metadata } from 'next';
import './globals.css';
import { I18nProviderComponent } from '@/lib/i18n';

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
      <body className="antialiased">
        {/* I18nProviderComponent loads /locales/en/common.json client-side.
            Server components and static text use the key-passthrough t() function.
            Future: pass locale from cookie/header for multi-language support. */}
        <I18nProviderComponent locale="en">
          {children}
        </I18nProviderComponent>
      </body>
    </html>
  );
}
