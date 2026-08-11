import { useI18n, LOCALES, Locale } from "../i18n";

/**
 * Tiny language toggle: ZH ⇄ EN. Persists in localStorage via I18nProvider.
 */
export default function LanguageToggle() {
    const { locale, setLocale } = useI18n();
    const next: Locale = locale === "zh-CN" ? "en" : "zh-CN";
    const label = locale === "zh-CN" ? "EN" : "中文";
    return (
        <button
            className="lang-toggle"
            onClick={() => setLocale(next)}
            title={locale === "zh-CN" ? "Switch to English" : "切换到中文"}
            aria-label="switch language"
        >
            {label}
        </button>
    );
}