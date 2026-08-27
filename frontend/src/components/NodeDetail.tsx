import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { NodeOut } from "../types";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import MarkdownEditor from "./MarkdownEditor";
import ModalSizeToggle from "./ModalSizeToggle";
import { IconEdit, IconLink, IconTrash } from "./icons";

type Props = {
    node: NodeOut;
    onJump: (id: string) => void;
    onClose: () => void;
    /** called after a successful edit or delete so App can refresh the graph */
    onMutated: () => void;
    /** Modal layout mode: "default" = 1/4 (320px), "half" = 1/2 (50vw). */
    modalMode: "default" | "half";
    /** Set the modal's layout mode. */
    onSetMode: (m: "default" | "half") => void;
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

export default function NodeDetail({ node, onJump, onClose, onMutated, modalMode = "default", onSetMode }: Props) {
    const t = useTranslations();
    const { locale } = useI18n();
    const [full, setFull] = useState<NodeOut | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<EditState>(EMPTY_EDIT);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const [showLinkPicker, setShowLinkPicker] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [knownCategories, setKnownCategories] = useState<string[]>([]);

    useEffect(() => {
        setFull(null);
        setEditing(false);
        setConfirmDelete(false);
        setShowLinkPicker(false);
        setBanner(null);
        fetch(`/api/nodes/${node.id}`)
            .then((r) => r.json())
            .then(setFull)
            .catch(() => setFull(node));
        // Pull the existing-category list once per node so the
        // <datalist> can autocomplete. Cached in component state.
        api.listNodes()
            .then((rows) => {
                // Defensive: some rows might be missing category (e.g.
                // old data created before the field existed). Filter
                // out empty / whitespace-only values explicitly.
                const cats = new Set<string>();
                for (const r of (rows as Array<{ category?: string }>)) {
                    const c = (r.category || "").trim();
                    if (c) cats.add(c);
                }
                setKnownCategories(Array.from(cats).sort((a, b) => a.localeCompare(b, "zh-Hans")));
            })
            .catch(() => { /* non-fatal; the user can still type freely */ });
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
        <div className={"column-right detail" + (modalMode === "half" ? " is-fullscreen" : "")}>
            <div className="panel-title">
                <span>{editing ? t("detail.editTitle") : t("detail.title")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    <ModalSizeToggle mode={modalMode} onSetMode={onSetMode} />
                    {!editing && !confirmDelete && (
                        <>
                            <button className="btn-icon" onClick={startEdit} title={t("detail.edit")}>
                                {t("detail.edit")}
                            </button>
                            <button className="btn-icon" onClick={() => setShowLinkPicker(true)} title={t("detail.addLink")}>
                                <IconLink />
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
                    <label>Content * (Markdown supported)</label>
                    <MarkdownEditor
                        value={draft.content}
                        onChange={(v) => setDraft((d) => ({ ...d, content: v }))}
                        placeholder="Markdown supported: **bold**, *italic*, `code`, [link](url), lists..."
                        minHeight={260}
                    />
                    <label>Category</label>
                    <CategoryCombobox
                        value={draft.category}
                        onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
                        options={knownCategories}
                    />
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

            {showLinkPicker && (
                <LinkPicker
                    sourceId={n.id}
                    sourceTitle={n.title}
                    onClose={() => setShowLinkPicker(false)}
                    onAdded={(id) => { setShowLinkPicker(false); onMutated(); onJump(id); }}
                />
            )}
        </div>
    );
}
function LinkPicker({
    sourceId,
    sourceTitle,
    onClose,
    onAdded,
}: {
    sourceId: string;
    sourceTitle: string;
    onClose: () => void;
    onAdded: (newTargetId: string) => void;
}) {
    const t = useTranslations();
    const [q, setQ] = useState("");
    const [options, setOptions] = useState<Array<{ id: string; title: string; category: string }>>([]);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        // Use the api.graph to get all nodes (simple + good enough for small graphs)
        api.graph(undefined).then((g) => {
            setOptions(g.nodes
                .filter((x) => x.id !== sourceId)
                .map((x) => ({ id: x.id, title: x.title, category: x.category })));
        }).catch((e) => setErr(String(e)));
    }, [sourceId]);

    const matches = q.trim()
        ? options.filter((o) =>
            o.title.toLowerCase().includes(q.toLowerCase()) ||
            o.category.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 20)
        : options.slice(0, 20);

    const link = async (targetId: string) => {
        setBusy(true);
        setErr(null);
        try {
            const url = `/api/llm/link?source_id=${sourceId}&target_id=${targetId}&relation=related`;
            const r = await fetch(url, { method: "POST" });
            const data = await r.json();
            if (data.detail) {
                setErr(data.detail);
            } else {
                onAdded(targetId);
            }
        } catch (e: any) {
            setErr(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="panel modal" onClick={(e) => e.stopPropagation()}>
                <h3>{t("detail.addLink")}</h3>
                <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 10px 0" }}>
                    {t("detail.addLinkHint", { title: sourceTitle })}
                </p>
                <input
                    className="link-picker-search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("detail.searchNode")}
                    autoFocus
                />
                {err && <div style={{ color: "var(--danger)", fontSize: 12, margin: "6px 0" }}>{err}</div>}
                <div className="link-picker-results">
                    {matches.length === 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-2)", padding: 8 }}>
                            {t("detail.noMatches")}
                        </div>
                    )}
                    {matches.map((o) => (
                        <button
                            key={o.id}
                            className="link-picker-row"
                            onClick={() => link(o.id)}
                            disabled={busy}
                        >
                            <span className="link-picker-title">{o.title}</span>
                            <span className="link-picker-cat">{o.category}</span>
                        </button>
                    ))}
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                    <button className="btn-secondary" onClick={onClose}>{t("detail.close").replace("✕", "Cancel")}</button>
                </div>
            </div>
        </div>
    );
}


// -------------------------------------------------------------
// CategoryCombobox — a small dark-theme-styled input with a built-in
// dropdown of existing categories. The user can also type any
// custom value (it's a real <input>, not a <select>).
// -------------------------------------------------------------
type ComboboxProps = {
    value: string;
    onChange: (v: string) => void;
    options: string[];
    placeholder?: string;
};

function CategoryCombobox({ value, onChange, options, placeholder = "(empty = auto-classify next time)" }: ComboboxProps) {
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState<number>(-1);
    // When the input is empty, show every known category. When
    // the input has a value, still show every category — the user
    // can pick an existing one to replace what they typed, or
    // ignore the dropdown and keep typing a brand-new value. The
    // dropdown is not a search-as-you-type, it's a list of
    // suggestions. We only hide the exact-match row when the value
    // IS a known category, so the dropdown doesn't show a "you
    // picked this already" duplicate.
    const filtered = useMemo(() => {
        const v = (value || "").trim();
        if (!v) return options;
        return options.filter((o) => o !== v);
    }, [options, value]);
    const ref = useRef<HTMLDivElement>(null);
    // Close on outside click.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);
    return (
        <div className="cat-combo" ref={ref}>
            <div className="cat-combo-row">
                <input
                    type="text"
                    className="cat-combo-input"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setOpen(true);
                        setHover(-1);
                    }}
                    onFocus={() => options.length > 0 && setOpen(true)}
                    onKeyDown={(e) => {
                        if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
                            setOpen(true);
                            return;
                        }
                        if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setOpen(true);
                            setHover((h) => Math.min(h + 1, filtered.length - 1));
                        } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setHover((h) => Math.max(h - 1, 0));
                        } else if (e.key === "Enter" && open && hover >= 0) {
                            e.preventDefault();
                            onChange(filtered[hover]);
                            setOpen(false);
                        } else if (e.key === "Escape") {
                            setOpen(false);
                        }
                    }}
                />
                <button
                    type="button"
                    className={"cat-combo-toggle" + (open ? " is-open" : "")}
                    aria-label="Toggle category suggestions"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOpen((o) => !o)}
                >▾</button>
            </div>
            {open && filtered.length > 0 && (
                <div className="cat-combo-menu" role="listbox">
                    {filtered.map((opt, i) => (
                        <button
                            key={opt}
                            type="button"
                            role="option"
                            aria-selected={i === hover}
                            className={"cat-combo-item" + (i === hover ? " is-active" : "")}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setHover(i)}
                            onClick={() => { onChange(opt); setOpen(false); }}
                        >{opt}</button>
                    ))}
                </div>
            )}
        </div>
    );
}
