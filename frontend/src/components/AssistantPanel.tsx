import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";
import type { AssistantResponse, NodeOut } from "../types";
import { useI18n } from "../i18n";

type Props = { onJump: (id: string) => void; };

export default function AssistantPanel({ onJump }: Props) {
    const t = useTranslations();
    const { locale } = useI18n();
    const [q, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AssistantResponse | null>(null);
    const [skills, setSkills] = useState<any[]>([]);

    // Localised static strings (UI chrome) — `res.answer` from the backend
    // is heuristic-generated and intentionally stays in Chinese regardless
    // of UI locale (it's domain text, not chrome).
    const chrome = {
        zh: {
            topic: (t: string | undefined, total: number) => `主题：${t || "(全部)"}  共 ${total} 条`,
            category: (c: string, n: number) => `\n【${c}】(${n})`,
            bullet: (title: string, summary: string) => `  • ${title}${summary ? " — " + summary.slice(0, 60) : ""}`,
            skill: (name: string, trigger: string, body: string) =>
                `✅ 已生成 Skill：${name}\n触发关键词：${trigger}\n\n${body}`,
        },
        en: {
            topic: (t: string | undefined, total: number) => `Topic: ${t || "(all)"}  ·  ${total} nodes`,
            category: (c: string, n: number) => `\n[${c}] (${n})`,
            bullet: (title: string, summary: string) => `  • ${title}${summary ? " — " + summary.slice(0, 60) : ""}`,
            skill: (name: string, trigger: string, body: string) =>
                `✅ Skill generated: ${name}\nTriggers: ${trigger}\n\n${body}`,
        },
    }[locale === "en" ? "en" : "zh"];

    useEffect(() => {
        api.skills().then(setSkills).catch(() => {});
    }, []);

    const ask = async () => {
        if (!q.trim()) return;
        setLoading(true);
        try {
            const r = await api.assistantAsk(q.trim());
            setRes(r);
        } finally {
            setLoading(false);
        }
    };

    const organise = async () => {
        setLoading(true);
        try {
            const r = await api.organise(q.trim() || undefined);
            const lines: string[] = [];
            lines.push(chrome.topic(r.topic, r.total));
            for (const [cat, items] of Object.entries(r.tree) as [string, Array<{title:string;summary:string;importance:number}>][]) {
                lines.push(chrome.category(cat, items.length));
                for (const it of items.slice(0, 6)) {
                    lines.push(chrome.bullet(it.title, it.summary || ""));
                }
            }
            setRes({
                answer: lines.join("\n"),
                related_nodes: [],
            });
        } finally {
            setLoading(false);
        }
    };

    const generateSkill = async () => {
        setLoading(true);
        try {
            const r = await api.genSkill();
            setRes({
                answer: chrome.skill(r.skill.name, r.skill.trigger, r.skill.body),
                related_nodes: [],
            });
            setSkills(await api.skills());
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="panel panel-bottom assistant">
            <div className="panel-title">
                <span>{t("assistant.title")}</span>
                <span style={{ fontSize: 11, color: "var(--text-2)" }}>
                    {skills.length} {t("assistant.skills")}
                </span>
            </div>
            <div className="ask">
                <input
                    value={q}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && ask()}
                    placeholder={t("assistant.placeholder")}
                />
                <button className="btn-primary" onClick={ask} disabled={loading}>{t("assistant.ask")}</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={organise} disabled={loading}>
                    {t("assistant.organise")}
                </button>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={generateSkill} disabled={loading}>
                    {t("assistant.genSkill")}
                </button>
            </div>
            {res && (
                <>
                    <div className="answer">{loading ? t("assistant.thinking") : res.answer}</div>
                    {res.related_nodes && res.related_nodes.length > 0 && (
                        <div className="related">
                            {res.related_nodes.slice(0, 6).map((n) => (
                                <div key={n.id} className="row" onClick={() => onJump(n.id)}>
                                    <span>→ {n.title}</span>
                                    <span style={{ color: "var(--accent-2)" }}>{(n.similarity * 100).toFixed(0)}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}