import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { NodeOut } from "../types";
import { useI18n } from "../i18n";

type Props = {
    node: NodeOut;
    onJump: (id: string) => void;
    onClose: () => void;
};

export default function NodeDetail({ node, onJump, onClose }: Props) {
    const t = useTranslations();
    const { locale } = useI18n();
    const [full, setFull] = useState<NodeOut | null>(null);
    useEffect(() => {
        setFull(null);
        fetch(`/api/nodes/${node.id}`)
            .then((r) => r.json())
            .then(setFull)
            .catch(() => setFull(node));
    }, [node.id]);

    const n = full || node;
    // Locale-aware date formatting.
    const date = n.created_at ? new Date(n.created_at).toLocaleString(locale) : "";

    return (
        <div className="panel panel-right detail">
            <div className="panel-title">
                <span>{t("detail.title")}</span>
                <button className="btn-icon" onClick={onClose}>{t("detail.close")}</button>
            </div>
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
                        <span key={k} className="tag" style={{ marginRight: 4, marginBottom: 4, display: "inline-block" }}>{k}</span>
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
        </div>
    );
}