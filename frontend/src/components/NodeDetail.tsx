import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { NodeOut } from "../types";
import { useI18n } from "../i18n";
import { api } from "../lib/api";

type Props = {
    node: NodeOut;
    onJump: (id: string) => void;
    onClose: () => void;
    /** called after a successful edit or delete so App can refresh the graph */
    onMutated: () => void;
};

type EditState = {
    title: string;
    content: string;
    category: string;
    importance: number;
    busy: boolean;
    err: string | null;
};

const EMPTY_EDIT: EditState = {
    title: "", content: "", category: "", importance: 1.0, busy: false, err: null,
};

export default function NodeDetail({ node, onJump, onClose, onMutated }: Props) {
    const t = useTranslations();
    const { locale } = useI18n();
    const [full, setFull] = useState<NodeOut | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<EditState>(EMPTY_EDIT);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    useEffect(() => {
        setFull(null);
        setEditing(false);
        setConfirmDelete(false);
        setBanner(null);
        fetch(`/api/nodes/${node.id}`)
            .then((r) => r.json())
            .then(setFull)
            .catch(() => setFull(node));
    }, [node.id]);

    const n = full || node;
    const date = n.created_at ? new Date(n.created_at).toLocaleString(locale) : "";

    const startEdit = () => {
        setDraft({
            title: n.title,
            content: n.content,
            category: n.category || "",
            importance: n.importance ?? 1.0,
            busy: false,
            err: null,
        });
        setEditing(true);
        setBanner(null);
    };

    const saveEdit = async () => {
        if (!draft.title.trim() || !draft.content.trim()) {
            setDraft((d) => ({ ...d, err: "Title and content are required" }));
            return;
        }
        setDraft((d) => ({ ...d, busy: true, err: null }));
        try {
            const updated = await api.updateNode(node.id, {
                title: draft.title.trim(),
                content: draft.content.trim(),
                category: draft.category.trim() || undefined,
                importance: draft.importance,
            });
            setFull(updated);
            setEditing(false);
            setBanner({ kind: "ok", text: t("detail.updateSuccess") });
            onMutated();
        } catch (e: any) {
            const msg = e?.message || String(e);
            setDraft((d) => ({ ...d, busy: false, err: msg }));
        }
    };

    const doDelete = async () => {
        setDeleting(true);
        try {
            await api.deleteNode(node.id);
            setBanner({ kind: "ok", text: t("detail.deleteSuccess") });
            onMutated();
            onClose();
        } catch (e: any) {
            const msg = e?.message || String(e);
            setDeleting(false);
            setConfirmDelete(false);
            setBanner({ kind: "err", text: t("detail.deleteFailed", { message: msg }) });
        }
    };

    return (
        <div className="panel panel-right detail">
            <div className="panel-title">
                <span>{editing ? t("detail.editTitle") : t("detail.title")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    {!editing && !confirmDelete && (
                        <>
                            <button className="btn-icon" onClick={startEdit} title={t("detail.edit")}>
                                {t("detail.edit")}
                            </button>
                            <button className="btn-icon" onClick={() => setConfirmDelete(true)} title={t("detail.delete")}>
                                {t("detail.delete")}
                            </button>
                        </>
                    )}
                    <button className="btn-icon" onClick={onClose}>{t("detail.close")}</button>
                </div>
            </div>

            {banner && (
                <div className={`check ${banner.kind === "ok" ? "ok" : ""}`}
                     style={{ marginBottom: 10 }}>
                    {banner.text}
                </div>
            )}

            {!editing && (
                <>
                    <h2>{n.title}</h2>
                    <div className="meta">
                        <span className="tag">{n.category}</span>
                        {n.importance > 1.5 && (
                            <span className="tag gray">{t("detail.importance")} {n.importance.toFixed(1)}</span>
                        )}
                        {date && <span className="tag gray">{date}</span>}
                    </div>
                    {n.summary && (
                        <div className="summary">📌 {n.summary}</div>
                    )}
                    <div className="content">{n.content}</div>
                    {n.keywords && n.keywords.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                            {n.keywords.map((k) => (
                                <span key={k} className="tag"
                                      style={{ marginRight: 4, marginBottom: 4, display: "inline-block" }}>{k}</span>
                            ))}
                        </div>
                    )}
                    {n.neighbors && n.neighbors.length > 0 && (
                        <div className="neighbors">
                            <div style={{ fontSize: 11, color: "var(--text-1)", letterSpacing: "0.12em", textTransform: "uppercase", margin: "12px 0 6px 0" }}>
                                {t("detail.relatedTitle")} ({n.neighbors.length})
                            </div>
                            {n.neighbors.slice(0, 12).map((nb) => (
                                <div key={nb.id} className="row" onClick={() => onJump(nb.id)}>
                                    <span>{nb.title || nb.id.slice(0, 8)}</span>
                                    <span className="sim">{(nb.score * 100).toFixed(0)}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {editing && (
                <div className="add-form">
                    <label>Title *</label>
                    <input value={draft.title}
                           onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                           autoFocus />
                    <label>Content *</label>
                    <textarea value={draft.content}
                              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                              style={{ minHeight: 160 }} />
                    <label>Category</label>
                    <input value={draft.category}
                           onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                           placeholder="(blank = auto-classify next time)" />
                    <label>Importance (0–10)</label>
                    <input type="number" min={0} max={10} step={0.5}
                           value={draft.importance}
                           onChange={(e) => setDraft((d) => ({ ...d, importance: parseFloat(e.target.value || "1") }))} />
                    {draft.err && (
                        <div style={{ color: "var(--danger)", fontSize: 12 }}>{draft.err}</div>
                    )}
                    <div className="actions">
                        <button className="btn-secondary" onClick={() => setEditing(false)} disabled={draft.busy}>
                            {t("detail.close").replace("✕", "✕")}
                        </button>
                        <button className="btn-primary" onClick={saveEdit} disabled={draft.busy}>
                            {draft.busy ? t("detail.saving") : t("detail.save")}
                        </button>
                    </div>
                </div>
            )}

            {confirmDelete && (
                <div className="modal-overlay" onClick={() => !deleting && setConfirmDelete(false)}>
                    <div className="panel modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{t("detail.deleteConfirmTitle")}</h3>
                        <p style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.6, margin: "0 0 16px 0" }}>
                            {t("detail.deleteConfirmBody", { title: n.title })}
                        </p>
                        <div className="actions">
                            <button className="btn-secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                                {t("detail.close").replace("✕", "Cancel")}
                            </button>
                            <button className="btn-primary"
                                    style={{ background: "var(--danger)" }}
                                    onClick={doDelete} disabled={deleting}>
                                {deleting ? t("detail.deleting") : t("detail.delete")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}