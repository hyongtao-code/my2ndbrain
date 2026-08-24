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

type Props = {
    onClose: () => void;
    onCreated: (...args: any[]) => void;
};

type PendingFile = {
    file: File;
    title: string;       // guessed from first heading / first line
    body: string;        // full file content
    status: "ready" | "uploading" | "ok" | "error";
    error?: string;
    newNodeId?: string;
};

function guessTitle(content: string, fallback: string): string {
    const text = content.replace(/^\uFEFF/, "").replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trimStart();
    const first = text.split("\n").find((l) => l.trim().length > 0) ?? "";
    const m = /^\s*#+\s+(.+?)\s*$/.exec(first);
    if (m) return m[1].trim();
    if (first.trim()) return first.trim();
    return fallback;
}

export default function ImportModal({ onClose, onCreated }: Props) {
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
            const title = guessTitle(text, f.name.replace(/\.(md|markdown)$/i, ""));
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
            const r = await fetch("http://127.0.0.1:8000/api/nodes/import-md", {
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
        <div className="modal-overlay" onClick={busy ? undefined : onClose}>
            <div className="panel modal import-export-modal" onClick={(e) => e.stopPropagation()}>
                <div className="panel-title">
                    <span>📥 {t("import.title")}</span>
                    <button className="btn-icon" onClick={onClose} disabled={busy}>✕</button>
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
                                     it.status === "error" ? "❌" : "📄"}
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
                            >✕</button>
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