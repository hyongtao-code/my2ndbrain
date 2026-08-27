/**
 * ModalSizeToggle — segmented control for the 4 modal headers
 * (AddNode / Import / Export / NodeDetail) and any other place that
 * needs the 1/4 � 1/2 size choice. Two SVG icons, the active one
 * is highlighted via the .active class.
 *
 * Props mirror the assistant header's <div className="assistant-size-toggle">,
 * but use the same CSS class so styling stays consistent.
 */
import { useTranslations } from "next-intl";

type SizeMode = "default" | "half";

export default function ModalSizeToggle({
    mode,
    onSetMode,
}: {
    mode: SizeMode;
    onSetMode: (m: SizeMode) => void;
}) {
    const t = useTranslations();
    return (
        <div className="assistant-size-toggle" role="group" aria-label={t("modal.sizeGroup")}>
            <button
                className={"assistant-size-btn" + (mode === "default" ? " active" : "")}
                onClick={(e) => { e.stopPropagation(); onSetMode("default"); }}
                title={t("modal.sizeQuarter")}
                aria-label={t("modal.sizeQuarter")}
                aria-pressed={mode === "default"}
            >
                {/* 1/4 icon: square outline + filled leftmost quarter */}
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none"
                     stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
                     strokeLinejoin="round" aria-hidden="true">
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
                    <rect x="2.5" y="3.5" width="2.75" height="9" fill="currentColor" stroke="none" />
                </svg>
            </button>
            <button
                className={"assistant-size-btn" + (mode === "half" ? " active" : "")}
                onClick={(e) => { e.stopPropagation(); onSetMode("half"); }}
                title={t("modal.sizeHalf")}
                aria-label={t("modal.sizeHalf")}
                aria-pressed={mode === "half"}
            >
                {/* 1/2 icon: square outline + filled left half */}
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none"
                     stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
                     strokeLinejoin="round" aria-hidden="true">
                    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
                    <rect x="2.5" y="3.5" width="5.5" height="9" fill="currentColor" stroke="none" />
                </svg>
            </button>
        </div>
    );
}
