/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
// src/_components/translationProvider.tsx
import { createContext, Dispatch, ReactNode, SetStateAction, use, useEffect, useMemo, useState } from "react";

import { defaultLanguage } from "config";
import deJson from "src/_locales/de.json";
import enJson from "src/_locales/en.json";
import frJson from "src/_locales/fr.json";
import nlJson from "src/_locales/nl.json";

import { useSession } from "../_providers/SessionProvider";

type LanguageCode = 'nl' | 'en' | 'de' | 'fr';
type TranslationRecord = Record<string, string | Record<string, unknown>>;

const TranslationContext = createContext<{
  translations: TranslationRecord,
  setLanguage: Dispatch<SetStateAction<LanguageCode>>;
} | null>(null);

const getLanguage = (language: string): TranslationRecord => {
  switch (language) {
    case "nl": { return nlJson as TranslationRecord;
    }
    case "en": { return enJson as TranslationRecord;
    }
    case "de": { return deJson as TranslationRecord;
    }
    case "fr": { return frJson as TranslationRecord;
    }
    default: { return enJson as TranslationRecord;
    }
  }
};

export function TranslationProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [language, setLanguage] = useState<LanguageCode>((session?.language ?? defaultLanguage) as LanguageCode);
  const translations = useMemo(() => getLanguage(language), [language]);

  useEffect(() => {
    if (session?.language) {
      setLanguage(session.language as LanguageCode);
    }
  }, [session]);

  const contextValue = useMemo(() => ({
    translations, setLanguage
  }), [translations, setLanguage]);

  return (
    <TranslationContext value={contextValue}>
      {children}
    </TranslationContext>
  );
}

export function useTranslation() {
  const context = use(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return context.translations;
}

export function useUpdateLanguage() {
  const context = use(TranslationContext);
  if (!context) {
    throw new Error("setLanguage must be used within a TranslationProvider");
  }
  return context.setLanguage;
}

// helper function for dynamic translation
export function translate({ translationList, key, params }: {
  translationList: TranslationRecord,
  key: unknown,
  params?: { key: string, value: string | number | boolean }[]
}): string {
  if (typeof key !== "string" || key.length === 0) return "";
  
  const parts = key.split(".");
  let result: unknown = translationList;
  
  for (const part of parts) {
    if (result && typeof result === 'object' && part in result) {
      result = (result as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  
  if (typeof result !== "string") return key;
  if (!Array.isArray(params) || params.length === 0) return result;

  let finalResult = result;
  for (const param of params) {
    if (!param.key) continue;
    const regex = new RegExp(`{{${param.key}}}`, "g");
    finalResult = finalResult.replace(regex, String(param.value));
  }
  return finalResult;
}