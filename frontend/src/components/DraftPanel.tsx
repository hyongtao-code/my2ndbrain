// DraftPanel — left-side inbox for raw ideas the user hasn't promoted yet.
//
// This is the front-end of the KnowledgeDraft workflow:
//   - Re-display all drafts (newest first, pinned at top).
//   - Compose a new draft via the textarea at the top.
//   - Per-row actions: ✨ promote (single), 🗑 delete, 📌 pin/unpin.
//   - Bulk promote: select multiple, then "✨ 整理选中".
//   - Promoted drafts are greyed-out and show a green badge pointing at
//     the new node; clicking the badge jumps to that node on the sphere.
//
// The panel is rendered by App.tsx alongside NodeDetail (right side).
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";

import type { DraftOut } from "../types";

// Use DraftOut directly from types — no local alias.

type Props = {
    open: boolean;
    onClose: () => void;
    onJumpToNode: (id: string) => void;
    onGraphRefresh: () => void;
};

export default function DraftPanel({ open, onClose, onJumpToNode, onGraphRefresh }: Props) {
    const t = useTranslations();
    const [drafts, setDrafts] = useState<DraftOut[]>([]);
    const [includePromoted, setIncludePromoted] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [compose, setCompose] = useState("");
    const [composing, setComposing] = useState(false);
    const [promoting, setPromoting] = useState(false);
    const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const refresh = useCallback(async () => {
        try {
            const list = await api.listDrafts(includePromoted);
            setDrafts(list);
        } catch (e: any) {
            setBanner({ kind: "err", text: `Failed to load drafts: ${e?.message || e}` });
        }
    }, [includePromoted]);

    useEffect(() => {
        if (open) {
            refresh();
            setSelected(new Set());
        }
    }, [open, refresh]);

    const onCompose = async () => {
        const content = compose.trim();
        if (!content) return;
        setComposing(true);
        try {
            await api.createDraft(content);
            setCompose("");
            setBanner({ kind: "ok", text: t("drafts.saved") });
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        } finally {
            setComposing(false);
        }
    };

    const onPromote = async (ids: string[]) => {
        if (ids.length === 0) return;
        setPromoting(true);
        try {
            const res = await api.promoteDrafts(ids);
            const ok = res.promoted_count;
            const fail = res.failed_count;
            setBanner({
                kind: fail === 0 ? "ok" : "err",
                text: t("drafts.promoteResult", { ok, fail }),
            });
            setSelected(new Set());
            await refresh();
            onGraphRefresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: t("drafts.promoteFailed", { message: e?.message || String(e) }) });
        } finally {
            setPromoting(false);
        }
    };

    const onDelete = async (id: string) => {
        if (!confirm(t("drafts.deleteConfirm"))) return;
        try {
            await api.deleteDraft(id);
            setSelected((s) => { const ns = new Set(s); ns.delete(id); return ns; });
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        }
    };

    const onTogglePin = async (d: DraftOut) => {
        try {
            await api.updateDraft(d.id, { pinned: !d.pinned });
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        }
    };

    const toggleSelect = (id: string) => {
        setSelected((s) => {
            const ns = new Set(s);
            if (ns.has(id)) ns.delete(id); else ns.add(id);
            return ns;
        });
    };

    const unpromoted = drafts.filter((d) => !d.promoted_to_node_id);
    const promoted = drafts.filter((d) => d.promoted_to_node_id);
    const hasSelection = selected.size > 0;

    if (!open) return null;

    return (
        <div className="panel panel-left drafts">
            <div className="panel-title">
                <span>📝 {t("drafts.title")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    <label className="toggle-mini" title={t("drafts.includePromoted")}>
                        <input
                            type="checkbox"
                            checked={includePromoted}
                            onChange={(e) => setIncludePromoted(e.target.checked)}
                        />
                        <span>{t("drafts.includePromoted")}</span>
                    </label>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>
            </div>

            {banner && (
                <div className={`check ${banner.kind === "ok" ? "ok" : ""}`}
                     style={{ marginBottom: 10 }}>
                    {banner.text}
                </div>
            )}

            <div className="drafts-compose">
                <textarea
                    className="drafts-input"
                    placeholder={t("drafts.composerPlaceholder")}
                    value={compose}
                    onChange={(e) => setCompose(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            onCompose();
                        }
                    }}
                    rows={3}
                />
                <div className="drafts-compose-actions">
                    <span className="hint">{t("drafts.composerHint")}</span>
                    <button className="btn-primary" onClick={onCompose} disabled={composing || !compose.trim()}>
                        {composing ? t("drafts.saving") : t("drafts.save")}
                    </button>
                </div>
            </div>

            {hasSelection && (
                <div className="drafts-bulkbar">
                    <span>{t("drafts.selectedCount", { count: selected.size })}</span>
                    <button className="btn-primary" onClick={() => onPromote([...selected])} disabled={promoting}>
                        {promoting ? t("drafts.curating") : t("drafts.promoteSelected")}
                    </button>
                    <button className="btn-secondary" onClick={() => setSelected(new Set())}>
                        {t("drafts.clearSelection")}
                    </button>
                </div>
            )}

            <div className="drafts-list">
                {unpromoted.length === 0 && promoted.length === 0 && (
                    <div className="drafts-empty">
                        <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
                        <div>{t("drafts.empty")}</div>
                    </div>
                )}

                {unpromoted.map((d) => {
                    const isSelected = selected.has(d.id);
                    return (
                        <div key={d.id} className={`draft-card ${isSelected ? "selected" : ""} ${d.pinned ? "pinned" : ""}`}>
                            <div className="draft-card-row1">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelect(d.id)}
                                    title={t("drafts.selectRow")}
                                />
                                <span className="draft-source">{d.source}</span>
                                <span className="draft-date">
                                    {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                                </span>
                                <button className="btn-icon-mini" onClick={() => onTogglePin(d)} title={d.pinned ? t("drafts.unpin") : t("drafts.pin")}>
                                    {d.pinned ? "📌" : "📍"}
                                </button>
                            </div>
                            <div className="draft-content">{d.content}</div>
                            <div className="draft-actions">
                                <button className="btn-primary" onClick={() => onPromote([d.id])} disabled={promoting}>
                                    ✨ {t("drafts.promote")}
                                </button>
                                <button className="btn-icon" onClick={() => onDelete(d.id)} title={t("drafts.delete")}>
                                    🗑️
                                </button>
                            </div>
                        </div>
                    );
                })}

                {includePromoted && promoted.length > 0 && (
                    <>
                        <div className="drafts-section-divider">
                            {t("drafts.promotedSection")} ({promoted.length})
                        </div>
                        {promoted.map((d) => (
                            <div key={d.id} className="draft-card promoted">
                                <div className="draft-card-row1">
                                    <span className="draft-source">{d.source}</span>
                                    <span className="draft-date">
                                        {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                                    </span>
                                </div>
                                <div className="draft-content">{d.content}</div>
                                <div className="draft-actions">
                                    {d.promoted_to_node_id && (
                                        <button
                                            className="badge-link"
                                            onClick={() => onJumpToNode(d.promoted_to_node_id!)}
                                            title={t("drafts.jumpToNode")}
                                        >
                                            ✅ {t("drafts.promotedTo")} {d.promoted_to_node_id.slice(0, 8)}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}