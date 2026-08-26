// ExportModal — pick nodes (multi-select) and download them as a
// .zip of .md files. The zip is generated server-side by
// /api/nodes/export-md-batch and we hand the URL to a <a download>
// to trigger the browser's "Save as" dialog. The user can pick
// their Downloads folder, by default it lands there.
//
// We never write to the user's filesystem ourselves; the browser
// takes care of the save dialog and the user picks the location.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";

type GraphNode = {
    id: string;
    title: string;
    category: string;
    keywords: string[];
};

type Props = {
    onClose: () => void;
};

export default function ExportModal({ onClose }: Props) {
    const t = useTranslations();
    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [search, setSearch] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await api.listNodes();
                if (cancelled) return;
                setNodes(list);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const filtered = nodes.filter((n) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return n.title.toLowerCase().includes(q) || n.category?.toLowerCase().includes(q);
    });

    const toggleOne = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const toggleAll = () =>
        setSelected((prev) => {
            if (filtered.every((n) => prev.has(n.id))) {
                // all selected — deselect all
                const next = new Set(prev);
                for (const n of filtered) next.delete(n.id);
                return next;
            }
            const next = new Set(prev);
            for (const n of filtered) next.add(n.id);
            return next;
        });

    const download = async () => {
        if (selected.size === 0) return;
        setDownloading(true);
        setError(null);
        try {
            const r = await fetch("/api/nodes/export-md-batch", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ node_ids: Array.from(selected) }),
            });
            if (!r.ok) {
                const txt = await r.text();
                throw new Error(`HTTP ${r.status}: ${txt}`);
            }
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "my2ndbrain-export.zip";
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Free the blob URL after a tick so the download can start.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={downloading ? undefined : onClose}>
            <div className="panel modal import-export-modal" onClick={(e) => e.stopPropagation()}>
                <div className="panel-title">
                    <span>📤 {t("export.title")}</span>
                    <button className="btn-icon" onClick={onClose} disabled={downloading}>✕</button>
                </div>

                <p className="assistant-hint">{t("export.hint")}</p>

                <div className="actions-row" style={{ marginBottom: 12, gap: 8 }}>
                    <input
                        className="search-field"
                        type="search"
                        placeholder={t("export.search")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                        className="btn-secondary"
                        onClick={toggleAll}
                        disabled={loading || filtered.length === 0}
                    >
                        {t("export.toggleAll")}
                    </button>
                </div>

                {loading && <div className="empty-hint">{t("export.loading")}</div>}
                {error && <div className="test-detail" style={{ color: "var(--danger)" }}>{error}</div>}

                <div className="export-list">
                    {filtered.map((n) => (
                        <label key={n.id} className="export-row">
                            <input
                                type="checkbox"
                                checked={selected.has(n.id)}
                                onChange={() => toggleOne(n.id)}
                            />
                            <div className="export-row-main">
                                <div className="export-row-title">{n.title}</div>
                                <div className="export-row-meta">
                                    {n.category && <span className="tag">{n.category}</span>}
                                </div>
                            </div>
                        </label>
                    ))}
                    {!loading && filtered.length === 0 && (
                        <div className="empty-hint">{t("export.noMatches")}</div>
                    )}
                </div>

                <div className="assistant-actions" style={{ marginTop: 12 }}>
                    <button className="btn-secondary" onClick={onClose} disabled={downloading}>
                        {t("export.cancel")}
                    </button>
                    <button
                        className="btn-primary"
                        onClick={download}
                        disabled={selected.size === 0 || downloading}
                    >
                        {downloading
                            ? t("export.downloading")
                            : t("export.download", { count: selected.size })}
                    </button>
                </div>
            </div>
        </div>
    );
}