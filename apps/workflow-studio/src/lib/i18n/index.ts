'use client';

// Minimal i18n implementation — NFR-6
// v0.1.0: English-only, catalog loaded from /locales/en/common.json
// Structure allows future locale switching without code changes.
// Usage: import { t } from '@/lib/i18n'; t('toolbar.save')

import { createContext, useContext, type ReactNode, useState, useEffect } from 'react';

type DeepRecord = {
  [key: string]: string | DeepRecord;
};

function resolvePath(catalog: DeepRecord, key: string): string {
  const parts = key.split('.');
  let current: string | DeepRecord = catalog;
  for (const part of parts) {
    if (typeof current !== 'object') return key;
    const val: string | DeepRecord | undefined = (current as DeepRecord)[part];
    if (val === undefined) return key;
    current = val;
  }
  return typeof current === 'string' ? current : key;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface I18nContextValue {
  t: (key: string, replacements?: Record<string, string>) => string;
  locale: string;
}

const I18nContext = createContext<I18nContextValue>({
  t: (key) => key,
  locale: 'en',
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function I18nProvider({ children, locale = 'en' }: { children: ReactNode; locale?: string }) {
  const [catalog, setCatalog] = useState<DeepRecord>({});

  useEffect(() => {
    fetch(`/locales/${locale}/common.json`)
      .then((r) => r.json())
      .then((data) => setCatalog(data as DeepRecord))
      .catch(() => {
        // Fall back to key passthrough on load error
      });
  }, [locale]);

  const t = (key: string, replacements?: Record<string, string>): string => {
    let result = resolvePath(catalog, key);
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
    }
    return result;
  };

  return { children, value: { t, locale } };
}

// Re-export using React createElement to avoid JSX in plain TS
import React from 'react';
export function I18nProviderComponent({ children, locale = 'en' }: { children: ReactNode; locale?: string }) {
  const [catalog, setCatalog] = useState<DeepRecord>({});

  useEffect(() => {
    fetch(`/locales/${locale}/common.json`)
      .then((r) => r.json())
      .then((data) => setCatalog(data as DeepRecord))
      .catch(() => {});
  }, [locale]);

  const t = (key: string, replacements?: Record<string, string>): string => {
    let result = resolvePath(catalog, key);
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
    }
    return result;
  };

  return React.createElement(I18nContext.Provider, { value: { t, locale } }, children);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useT() {
  return useContext(I18nContext).t;
}

export function useLocale() {
  return useContext(I18nContext).locale;
}

// ── Static t() for server components (always returns key) ─────────────────────

export function t(key: string): string {
  // Server-side: return key (i18n hydration happens client-side for v0.1.0)
  return key;
}
