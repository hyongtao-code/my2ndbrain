import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";
import type { IngestResponse } from "../types";
import MarkdownEditor from "./MarkdownEditor";

type Props = {
    onClose: () => void;
    onCreated: (r: IngestResponse) => void;
    fullscreen?: boolean;
    onFullscreenChange?: (v: boolean) => void;
};

// Inline SVG icon (DESIGN.md §6: no emoji as icon in chrome).
function IconClose({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={3.5} y1={3.5} x2={12.5} y2={12.5} />
      <line x1={12.5} y1={3.5} x2={3.5} y2={12.5} />
    </svg>
  );
}

// Inline SVG icon (DESIGN.md §6: no emoji as icon in chrome).
function IconDraft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.5 2.5 L10.5 2.5 L13 5 L13 13.5 L3.5 13.5 Z" />
      <polyline points="10,2.5 10,5.5 13,5.5" />
      <line x1={5.5} y1={7.5} x2={11} y2={7.5} />
      <line x1={5.5} y1={10} x2={11} y2={10} />
    </svg>
  );
}

export default function AddNodeModal({ onClose, onCreated, fullscreen = false, onFullscreenChange }: Props) {
    const t = useTranslations();
    
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [category, setCategory] = useState("");
    const [importance, setImportance] = useState(1.0);
    const [submitting, setSubmitting] = useState(false);
    const [preview, setPreview] = useState<IngestResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!title.trim() || !content.trim()) {
            setError(t("addModal.error.required"));
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            const res = await api.ingest({
                title: title.trim(),
                content: content.trim(),
                category: category.trim() || undefined,
                importance,
            });
            setPreview(res);
            onCreated(res);
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={"column-right modal-sheet add-modal" + (fullscreen ? " is-fullscreen" : "")} role="dialog" aria-modal="true">
            <div className="panel-title">
                <span>{preview ? t("addModal.titleDone") : t("addModal.title")}</span>
                <div style={{ display: "flex", gap: 4 }}>
                    <button
                        className="panel-full-toggle"
                        title={fullscreen ? t("panel.restore") : t("panel.fullscreen")}
                        onClick={(e) => {
                            e.stopPropagation();
                            onFullscreenChange?.(!fullscreen);
                        }}
                    >
                        {fullscreen ? "⤡" : "⤢"}
                    </button>
                    <button className="btn-icon" onClick={onClose}><IconClose /></button>
                </div>
            </div>

            {!preview && (
                <div className="add-form">
                    <label>{t("addModal.fields.title")}</label>
                    <input value={title}
                           onChange={(e) => setTitle(e.target.value)}
                           placeholder={t("addModal.titlePlaceholder")}
                           autoFocus />

                    <label>{t("addModal.fields.content")}</label>
                    <MarkdownEditor
                        value={content}
                        onChange={setContent}
                        placeholder={t("addModal.contentPlaceholder")}
                        minHeight={300}
                    />

                    <div className="add-form-row2">
                        <div>
                            <label>{t("addModal.fields.category")}</label>
                            <input value={category}
                                   onChange={(e) => setCategory(e.target.value)}
                                   placeholder={t("addModal.categoryPlaceholder")} />
                        </div>
                        <div>
                            <label>{t("addModal.fields.importance")}</label>
                            <input type="number" min={0} max={10} step={0.5}
                                   value={importance}
                                   onChange={(e) => setImportance(parseFloat(e.target.value || "1"))} />
                        </div>
                    </div>

                    {error && (
                        <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>
                    )}

                    <div className="actions">
                        <button className="btn-secondary" onClick={onClose}>{t("addModal.cancel")}</button>
                        <button className="btn-primary" onClick={submit} disabled={submitting}>
                            {submitting ? t("addModal.submitting") : t("addModal.submit")}
                        </button>
                    </div>
                </div>
            )}

            {preview && (
                <div className="add-preview">
                    <div className={`check ${preview.title_check.ok ? "ok" : ""}`}>
                        <div className="verdict-icon"><IconDraft size={14} /> <b>{t("addModal.titleCheck.verdict")}</b> · {t("addModal.titleCheck.confidence")} {(preview.title_check.confidence * 100).toFixed(0)}%</div>
                        <div>{preview.title_check.reason}</div>
                        {!preview.title_check.ok && (
                            <div>{t("addModal.titleCheck.suggested")}: <b>{preview.title_check.suggestion}</b></div>
                        )}
                    </div>
                    {preview.suggested_links.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 11, color: "var(--text-1)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                                {t("addModal.autoLinks")} ({preview.suggested_links.length})
                            </div>
                            {preview.suggested_links.map((l) => (
                                <div key={l.target_id}
                                     style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 6px" }}>
                                    <span>→ {l.target_title}</span>
                                    <span style={{ color: "var(--accent-2)" }}>
                                        {l.similarity != null ? `${(l.similarity * 100).toFixed(0)}%` : ""}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-1)" }}>
                        {t("addModal.cluster")}: <span className="tag">{preview.cluster_suggestion.name}</span>
                        <span style={{ marginLeft: 8 }}>{t("addModal.nodesCount")}: {preview.cluster_suggestion.size}</span>
                    </div>
                    <div className="actions">
                        <button className="btn-primary" onClick={onClose}>{t("addModal.finish")}</button>
                    </div>
                </div>
            )}
        </div>
    );
}