// ImportModal — upload .md files in batch and import them as new
// knowledge nodes. Uses the browser file picker (input[type=file]) so
// the user picks .md files from their local system; we never touch
// the filesystem ourselves.
//
// Read-only with respect to existing nodes: this modal only POSTs to
// /api/nodes/import-md which only INSERTs new rows. The user can
// delete imported nodes later via NodeDetail if they don't like the
// result.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";
import ModalSizeToggle from "./ModalSizeToggle";

type Props = {
    onClose: () => void;
    onCreated: (...args: any[]) => void;
    /** Modal layout mode: "default" = 1/4, "half" = 1/2. */
    modalMode: "default" | "half";
    /** Set the modal's layout mode. */
    onSetMode: (m: "default" | "half") => void;
};

type PendingFile = {
    file: File;
    title: string;       // guessed from first heading / first line
    body: string;        // full file content
    status: "ready" | "uploading" | "ok" | "error";
    error?: string;
    newNodeId?: string;
};

function guessTitleFromFilename(filename: string): string {
    // Mirrors backend's _parse_md: title = filename without .md / .markdown
    return filename.replace(/\.(md|markdown)$/i, "").trim() || filename;
}

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
function IconDownload({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={2.5} x2={8} y2={10.5} />
      <polyline points="4,7 8,11 12,7" />
      <line x1={3} y1={13.5} x2={13} y2={13.5} />
    </svg>
  );
}

// Inline SVG icons (DESIGN.md §6: no emoji as icon in chrome).
function IconError({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <circle cx={8} cy={8} r={6} />
      <line x1={5.5} y1={5.5} x2={10.5} y2={10.5} />
      <line x1={10.5} y1={5.5} x2={5.5} y2={10.5} />
    </svg>
  );
}
function IconFile({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.5 2 L10.5 2 L13 4.5 L13 14 L3.5 14 Z" />
      <polyline points="10,2 10,5 13,5" />
    </svg>
  );
}

export default function ImportModal({ onClose, onCreated , modalMode = "default", onSetMode}: Props) {
    const t = useTranslations();
    const inputRef = useRef<HTMLInputElement>(null);
    const [items, setItems] = useState<PendingFile[]>([]);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ created: number; failed: number } | null>(null);

    const onPick = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const next: PendingFile[] = [];
        for (const f of Array.from(files)) {
            if (!/\.(md|markdown)$/i.test(f.name)) continue;
            const text = await f.text();
            const title = guessTitleFromFilename(f.name);
            next.push({ file: f, title, body: text, status: "ready" });
        }
        setItems((prev) => [...prev, ...next]);
    };

    const removeAt = (i: number) =>
        setItems((prev) => prev.filter((_, idx) => idx !== i));

    const importAll = async () => {
        if (items.length === 0) return;
        setBusy(true);
        // Backend takes multipart/form-data with all files at once.
        const form = new FormData();
        for (const it of items) form.append("files", it.file, it.file.name);
        try {
            const r = await fetch("/api/nodes/import-md", {
                method: "POST",
                body: form,
            });
            const data = await r.json();
            const byFilename = new Map<string, { ok: boolean; error?: string; node_id?: string; title?: string }>();
            for (const res of data.results || []) byFilename.set(res.filename, res);
            setItems((prev) =>
                prev.map((it) => {
                    const r = byFilename.get(it.file.name);
                    if (!r) return { ...it, status: "error", error: "no result returned" };
                    return r.ok
                        ? { ...it, status: "ok", newNodeId: r.node_id }
                        : { ...it, status: "error", error: r.error || "import failed" };
                })
            );
            setDone({ created: data.created_count, failed: data.failed_count });
            if (data.created_count > 0) onCreated();
        } catch (e: any) {
            setItems((prev) =>
                prev.map((it) => ({ ...it, status: "error", error: e?.message || String(e) }))
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-sheet-wrap" onClick={busy ? undefined : onClose}>
            <div className={"column-right modal-sheet import-export-modal" + (modalMode === "half" ? " is-fullscreen" : "")} onClick={(e) => e.stopPropagation()}>
                <div className="panel-title">
                    <span><IconDownload /> {t("import.title")}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                        <ModalSizeToggle mode={modalMode} onSetMode={onSetMode} />
                        <button className="btn-icon" onClick={onClose} disabled={busy}><IconClose /></button>
                    </div>
                </div>

                <p className="assistant-hint">{t("import.hint")}</p>

                <input
                    ref={inputRef}
                    type="file"
                    accept=".md,.markdown,text/markdown"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => onPick(e.target.files)}
                />

                <div className="actions-row" style={{ marginBottom: 12 }}>
                    <button
                        className="btn-secondary"
                        onClick={() => inputRef.current?.click()}
                        disabled={busy}
                    >
                        {t("import.pickFiles")}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--text-2)" }}>
                        {items.length > 0
                            ? t("import.selectedCount", { count: items.length })
                            : t("import.noFiles")}
                    </span>
                </div>

                <div className="import-list">
                    {items.length === 0 && (
                        <div className="empty-hint">{t("import.empty")}</div>
                    )}
                    {items.map((it, i) => (
                        <div key={i} className={`import-row status-${it.status}`}>
                            <div className="import-row-main">
                                <div className="import-row-title">
                                    {it.status === "ok" ? "✅" :
                                     it.status === "error" ? <IconError size={14} /> : <IconFile size={14} />}
                                    &nbsp;{it.title}
                                </div>
                                <div className="import-row-file">{it.file.name}</div>
                                {it.error && (
                                    <div className="import-row-err">{it.error}</div>
                                )}
                            </div>
                            <button
                                className="btn-icon-mini"
                                title={t("import.removeRow")}
                                onClick={() => removeAt(i)}
                                disabled={busy}
                            ><IconClose /></button>
                        </div>
                    ))}
                </div>

                {done && (
                    <div className="import-done">
                        {t("import.done", { created: done.created, failed: done.failed })}
                    </div>
                )}

                <div className="assistant-actions" style={{ marginTop: 12 }}>
                    <button className="btn-secondary" onClick={onClose} disabled={busy}>
                        {done ? t("import.close") : t("import.cancel")}
                    </button>
                    <button
                        className="btn-primary"
                        onClick={importAll}
                        disabled={items.length === 0 || busy || (done !== null)}
                    >
                        {busy ? t("import.importing") :
                         done ? t("import.done") :
                         t("import.importButton", { count: items.length })}
                    </button>
                </div>
            </div>
        </div>
    );
}