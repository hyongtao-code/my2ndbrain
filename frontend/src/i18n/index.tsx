/**
 * i18n bootstrap.
 *
 * - next-intl works fine outside Next.js (React API only): we wrap the app in
 *   <NextIntlClientProvider> and read strings via useTranslations().
 * - Two locales: zh-CN (default) and en.
 * - User choice persists in localStorage under 'msb.locale'.
 * - Falls back to zh-CN if stored value is missing or invalid.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import zhCN from "./zh-CN.json";
import en from "./en.json";

export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const messages: Record<Locale, Record<string, unknown>> = {
    "zh-CN": zhCN as unknown as Record<string, unknown>,
    en: en as unknown as Record<string, unknown>,
};

const STORAGE_KEY = "msb.locale";

function detectInitial(): Locale {
    if (typeof window === "undefined") return "zh-CN";
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && (LOCALES as readonly string[]).includes(stored)) {
            return stored as Locale;
        }
    } catch {
        /* localStorage may be unavailable in private mode */
    }
    const nav = window.navigator?.language?.toLowerCase() ?? "";
    if (nav.startsWith("en")) return "en";
    return "zh-CN";
}

interface I18nContextValue {
    locale: Locale;
    setLocale: (l: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) {
        throw new Error("useI18n must be used inside <I18nProvider>");
    }
    return ctx;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>("zh-CN");

    // Read persisted preference once on mount.
    useEffect(() => {
        setLocaleState(detectInitial());
    }, []);

    const setLocale = useCallback((l: Locale) => {
        setLocaleState(l);
        try {
            window.localStorage.setItem(STORAGE_KEY, l);
        } catch {
            /* ignore */
        }
        // Reflect in <html lang> so screen readers and CSS :lang() work.
        document.documentElement.lang = l;
    }, []);

    const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

    // Keep <html lang> in sync with current locale.
    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    return (
        <I18nContext.Provider value={value}>
            <NextIntlClientProvider
                locale={locale}
                messages={messages[locale]}
                timeZone="UTC"
            >
                {children}
            </NextIntlClientProvider>
        </I18nContext.Provider>
    );
}