import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en, type TranslationKey } from './en';
import { zh } from './zh';

export type Language = 'en' | 'zh';

export const STORAGE_KEY = 'afct-sfx-lab:language';

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const MESSAGES: Record<Language, Record<TranslationKey, string>> = { en, zh };

const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh';
}

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) {
      return stored;
    }
  } catch {
    // storage may be unavailable (private mode / SSR)
  }
  return DEFAULT_LANGUAGE;
}

export function applyDocumentLanguage(language: Language) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage());

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage may be unavailable (private mode / SSR)
    }
    applyDocumentLanguage(next);
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(MESSAGES[language][key] ?? MESSAGES.en[key], vars),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error('useI18n must be used inside LanguageProvider');
  }
  return value;
}

export type { TranslationKey };
