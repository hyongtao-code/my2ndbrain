import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";
import type { AssistantResponse, DraftOut } from "../types";
import { useI18n } from "../i18n";

type Mode = "ask" | "suggest" | "settings" | "draft";

type Props = { onJump: (id: string) => void; };

type ProviderInfo = {
    name: string;
    label: string;
    default_model: string;
    needs_api_key: boolean;
    api_key_label: string;
    kind: "local" | "openai-compat" | "gemini";
};

type LLMStatus = {
    provider: string;
    provider_label?: string;
    provider_kind?: string;
    base_url?: string;
    model: string;
    has_api_key: boolean;
    api_key_source: "runtime" | "env" | "none";
    providers?: ProviderInfo[];
};

type LLMTestResult = {
    ok: boolean;
    provider: string;
    provider_label: string;
    model: string;
    detail: string;
};

type Suggestion = {
    action: "link" | "merge" | "split" | "noop";
    rationale: string;
    nodes: string[];
    similarity?: number;
    provider?: string;
};

export default function AssistantPanel({ onJump }: Props) {
    const t = useTranslations();
    const { locale } = useI18n();
    const [mode, setMode] = useState<Mode>("draft");

    return (
        <div className="panel panel-assistant">
            <div className="panel-title">
                <span>🧠 {t("assistant.title")}</span>
            </div>

            <div className="assistant-tabs">
                <button
                    className={`tab ${mode === "ask" ? "active" : ""}`}
                    onClick={() => setMode("ask")}
                >
                    💬 {t("assistant.tabAsk")}
                </button>
                <button
                    className={`tab ${mode === "suggest" ? "active" : ""}`}
                    onClick={() => setMode("suggest")}
                >
                    💡 {t("assistant.tabSuggest")}
                </button>
                <button
                    className={`tab ${mode === "settings" ? "active" : ""}`}
                    onClick={() => setMode("settings")}
                >
                    ⚙️ {t("assistant.tabSettings")}
                </button>
                <button
                    className={`tab ${mode === "draft" ? "active" : ""}`}
                    onClick={() => setMode("draft")}
                >
                    📝 {t("assistant.tabDraft")}
                </button>
            </div>

            {mode === "ask" && <AskTab onJump={onJump} locale={locale} />}
            {mode === "suggest" && <SuggestTab onJump={onJump} />}
            {mode === "settings" && <SettingsTab />}
            {mode === "draft" && <DraftTab onJump={onJump} />}
        </div>
    );
}

// ============================================================
// Ask tab — plain local recall (no LLM call)
// ============================================================
function AskTab({ onJump, locale }: { onJump: (id: string) => void; locale: string }) {
    const t = useTranslations();
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(false);
    const [res, setRes] = useState<AssistantResponse | null>(null);
    const [skills, setSkills] = useState<any[]>([]);

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

    const render = (r: AssistantResponse): string => {
        // Localised chrome; backend answer stays in raw text (domain content).
        if (locale.startsWith("zh")) {
            const parts: string[] = [];
            parts.push(`主题：${r.topic || "(全部)"}  共 ${r.total} 条`);
            for (const [cat, items] of Object.entries(r.tree || {})) {
                parts.push(`\n【${cat}】(${items.length})`);
                for (const it of items) {
                    parts.push(`  • ${it.title}${it.summary ? " — " + it.summary.slice(0, 60) : ""}`);
                }
            }
            return parts.join("\n");
        } else {
            const parts: string[] = [];
            parts.push(`Topic: ${r.topic || "(all)"}  ·  ${r.total} nodes`);
            for (const [cat, items] of Object.entries(r.tree || {})) {
                parts.push(`\n[${cat}] (${items.length})`);
                for (const it of items) {
                    parts.push(`  • ${it.title}${it.summary ? " — " + it.summary.slice(0, 60) : ""}`);
                }
            }
            return parts.join("\n");
        }
    };

return (
        <div className="assistant-tab-body">
            <textarea
                className="textarea"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("assistant.askPlaceholder")}
                rows={2}
            />
            <div className="assistant-actions">
                <button className="btn-primary" onClick={ask} disabled={loading || !q.trim()}>
                    {t("assistant.ask")}
                </button>
            </div>
            {res && (
                <div className="answer">
                    <pre>{render(res)}</pre>
                </div>
            )}
        </div>
    );
}

// ============================================================
// Suggest tab — calls LLM (or heuristic fallback) for ONE suggestion
// ============================================================
function SuggestTab({ onJump }: { onJump: (id: string) => void }) {
    const t = useTranslations();
    const [loading, setLoading] = useState(false);
    const [sug, setSug] = useState<Suggestion | null>(null);
    const [applyMsg, setApplyMsg] = useState<string | null>(null);

    const ask = async () => {
        setLoading(true);
        setSug(null);
        setApplyMsg(null);
        try {
            const r = await fetch("http://127.0.0.1:8000/api/llm/suggest-improvements", { method: "POST" });
            const data = await r.json();
            setSug(data);
        } finally {
            setLoading(false);
        }
    };

    const apply = async () => {
        if (!sug || sug.action !== "link" || sug.nodes.length < 2) return;
        setLoading(true);
        setApplyMsg(null);
        try {
            const url = `http://127.0.0.1:8000/api/llm/link?source_id=${sug.nodes[0]}&target_id=${sug.nodes[1]}&relation=related`;
            const r = await fetch(url, { method: "POST" });
            const data = await r.json();
            if (data.detail) {
                setApplyMsg(`❌ ${data.detail}`);
            } else {
                setApplyMsg(`✅ Link created (id=${data.id.slice(0, 8)}, already_existed=${data.already_existed})`);
                // jump to the first node
                onJump(sug.nodes[0]);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="assistant-tab-body">
            <p className="assistant-hint">
                {t("assistant.suggestHint")}
            </p>
            <button className="btn-primary" onClick={ask} disabled={loading}>
                💡 {loading ? t("assistant.working") : t("assistant.suggestOne")}
            </button>
            {sug && (
                <div className="suggestion-card">
                    <div className="suggestion-action">
                        action: <b>{sug.action}</b>
                        {sug.provider && <span className="provider-tag">via {sug.provider}</span>}
                    </div>
                    <div className="suggestion-rationale">{sug.rationale}</div>
                    {sug.similarity !== undefined && (
                        <div className="suggestion-similarity">similarity: {sug.similarity.toFixed(3)}</div>
                    )}
                    {sug.nodes.length > 0 && (
                        <div className="suggestion-nodes">
                            {sug.nodes.map((id, i) => (
                                <button key={id} className="node-link" onClick={() => onJump(id)}>
                                    {id.slice(0, 8)}
                                </button>
                            ))}
                        </div>
                    )}
                    {sug.action === "link" && sug.nodes.length >= 2 && (
                        <button className="btn-primary" onClick={apply} disabled={loading}>
                            🔗 {loading ? t("assistant.working") : t("assistant.applyLink")}
                        </button>
                    )}
                    {applyMsg && <div className="apply-status">{applyMsg}</div>}
                </div>
            )}
        </div>
    );
}

// ============================================================
// Settings tab — set OpenAI key (in-memory only)
// ============================================================
function SettingsTab() {
    const t = useTranslations();
    const [status, setStatus] = useState<LLMStatus | null>(null);
    const [provider, setProvider] = useState("heuristic");
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState("");
    const [saved, setSaved] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<LLMTestResult | null>(null);
    const [testing, setTesting] = useState(false);
    const [showKey, setShowKey] = useState(false);

    const refresh = async () => {
        try {
            const r = await fetch("http://127.0.0.1:8000/api/llm/status");
            const d: LLMStatus = await r.json();
            setStatus(d);
            setProvider(d.provider);
            setModel(d.model || (d.providers || []).find(p => p.name === d.provider)?.default_model || "");
        } catch (e) {
            // backend not reachable
        }
    };

    useEffect(() => { refresh(); }, []);

    // When the user picks a different provider, auto-fill the model field
    // with that provider's default so they do not have to type it in.
    const onProviderChange = (newProvider: string) => {
        setProvider(newProvider);
        const meta = (status?.providers || []).find(p => p.name === newProvider);
        if (meta) setModel(meta.default_model);
        setTestResult(null);
    };

    const save = async () => {
        try {
            await fetch("http://127.0.0.1:8000/api/llm/config", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ provider, api_key: apiKey, model }),
            });
            setApiKey("");
            setSaved(t("assistant.saved"));
            await refresh();
            // auto-test on save so the user sees the light turn green
            await runTest();
            setTimeout(() => setSaved(null), 2500);
        } catch (e) {
            setSaved(t("assistant.failed", { message: (e as any).message }));
        }
    };

    const clear = async () => {
        try {
            await fetch("http://127.0.0.1:8000/api/llm/clear", { method: "POST" });
            await refresh();
            setSaved(t("assistant.cleared"));
            setTestResult(null);
            setTimeout(() => setSaved(null), 2500);
        } catch (e) {
            setSaved(t("assistant.failed", { message: (e as any).message }));
        }
    };

    const runTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const r = await fetch("http://127.0.0.1:8000/api/llm/test", { method: "POST" });
            const d: LLMTestResult = await r.json();
            setTestResult(d);
        } catch (e: any) {
            setTestResult({
                ok: false,
                provider,
                provider_label: provider,
                model,
                detail: e?.message || String(e),
            });
        } finally {
            setTesting(false);
        }
    };

    const meta = (status?.providers || []).find(p => p.name === provider);
    const needsKey = meta?.needs_api_key ?? false;
    const isConnected = testResult?.ok === true;
    const isFailed = testResult?.ok === false;

    return (
        <div className="assistant-tab-body">
            <p className="assistant-hint">{t("assistant.settingsHint")}</p>

            {/* Connection status light. Hover for vendor name + detail. */}
            <div
                className={`status-light ${isConnected ? "ok" : isFailed ? "bad" : "unknown"}`}
                title={testResult
                    ? `${testResult.provider_label}: ${testResult.detail}`
                    : t("assistant.lightNotTested")}
            >
                <span className="status-dot" />
                <span className="status-text">
                    {isConnected ? t("assistant.lightConnected", { name: testResult!.provider_label })
                        : isFailed ? t("assistant.lightFailed", { name: testResult!.provider_label })
                        : t("assistant.lightIdle")}
                </span>
                <button
                    className="status-test-btn"
                    onClick={runTest}
                    disabled={testing || !status}
                    title={t("assistant.testConnection")}
                >
                    {testing ? t("assistant.testing") : t("assistant.test")}
                </button>
            </div>

            <label>{t("assistant.provider")}</label>
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)}>
                {(status?.providers || []).map((p) => (
                    <option key={p.name} value={p.name}>{p.label}</option>
                ))}
            </select>

            <label>{t("assistant.model")}</label>
            <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={meta?.default_model || "gpt-4o-mini"}
            />

            {needsKey ? (
                <label>
                    {t("assistant.apiKey")}
                    <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-2)" }}>
                        ({meta?.api_key_label || "sk-..."})
                    </span>
                </label>
            ) : (
                <label>{t("assistant.apiKeyOpt")}</label>
            )}
            <div style={{ display: "flex", gap: 4 }}>
                <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={meta?.api_key_label || "sk-..."}
                    disabled={!needsKey}
                    style={{ flex: 1 }}
                />
                <button
                    className="btn-icon"
                    onClick={() => setShowKey(s => !s)}
                    title={showKey ? t("assistant.hideKey") : t("assistant.showKey")}
                    type="button"
                >
                    {showKey ? "🙈" : "👁"}
                </button>
            </div>

            <div className="assistant-actions">
                <button
                    className="btn-primary"
                    onClick={save}
                    disabled={needsKey && !apiKey}
                >
                    {t("assistant.save")}
                </button>
                <button className="btn-secondary" onClick={clear}>
                    {t("assistant.clear")}
                </button>
            </div>

            {testResult && (
                <div
                    className="test-detail"
                    style={{ color: isConnected ? "var(--good, #00d97e)" : "var(--danger)" }}
                >
                    {testResult.detail}
                </div>
            )}
            {saved && <div className="apply-status">{saved}</div>}
        </div>
    );
}

// ============================================================
// Draft tab — quick save-to-draft + list unpromoted drafts + promote
// ============================================================
function DraftTab({ onJump }: { onJump: (id: string) => void }) {
    const t = useTranslations();
    const [drafts, setDrafts] = useState<DraftOut[]>([]);
    const [showPromoted, setShowPromoted] = useState(false);
    const [content, setContent] = useState("");
    const [busy, setBusy] = useState(false);
    const [promoting, setPromoting] = useState<Set<string>>(new Set());
    const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const refresh = async () => {
        try {
            const list = await api.listDrafts(showPromoted);
            setDrafts(list);
        } catch (e: any) {
            setBanner({ kind: "err", text: `Load failed: ${e?.message || e}` });
        }
    };

    useEffect(() => { refresh(); }, [showPromoted]);

    const save = async () => {
        const text = content.trim();
        if (!text) return;
        setBusy(true);
        try {
            await api.createDraft(text);
            setContent("");
            setBanner({ kind: "ok", text: t("drafts.saved") });
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        } finally {
            setBusy(false);
        }
    };

    const promote = async (id: string) => {
        setPromoting((s) => { const ns = new Set(s); ns.add(id); return ns; });
        try {
            const res = await api.promoteDrafts([id]);
            setBanner({
                kind: res.failed_count === 0 ? "ok" : "err",
                text: t("drafts.promoteResult", { ok: res.promoted_count, fail: res.failed_count }),
            });
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        } finally {
            setPromoting((s) => { const ns = new Set(s); ns.delete(id); return ns; });
        }
    };

    const remove = async (id: string) => {
        if (!confirm(t("drafts.deleteConfirm"))) return;
        try {
            await api.deleteDraft(id);
            await refresh();
        } catch (e: any) {
            setBanner({ kind: "err", text: `${e?.message || e}` });
        }
    };

    const unpromoted = drafts.filter((d) => !d.promoted_to_node_id);
    const promoted = drafts.filter((d) => d.promoted_to_node_id);

    return (
        <div className="assistant-tab-body">
            <textarea
                className="textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("drafts.composerPlaceholder")}
                rows={2}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        save();
                    }
                }}
            />
            <div className="assistant-actions">
                <button className="btn-primary" onClick={save} disabled={busy || !content.trim()}>
                    {busy ? t("drafts.saving") : t("drafts.save")}
                </button>
                <label className="toggle-mini">
                    <input
                        type="checkbox"
                        checked={showPromoted}
                        onChange={(e) => setShowPromoted(e.target.checked)}
                    />
                    <span>{t("drafts.includePromoted")}</span>
                </label>
            </div>

            {banner && (
                <div className={`check ${banner.kind === "ok" ? "ok" : ""}`}>
                    {banner.text}
                </div>
            )}

            <div className="draft-list">
                {unpromoted.length === 0 && promoted.length === 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-2)", textAlign: "center", padding: 12 }}>
                        {t("drafts.empty")}
                    </div>
                )}

                {unpromoted.map((d) => (
                    <div key={d.id} className="draft-row">
                        <div className="draft-row-content">
                            <div className="draft-row-text">{d.content}</div>
                            <div className="draft-row-meta">
                                <span>{d.source}</span>
                                {d.created_at && (
                                    <span>{new Date(d.created_at).toLocaleString()}</span>
                                )}
                            </div>
                        </div>
                        <div className="draft-row-actions">
                            <button
                                className="btn-mini"
                                onClick={() => promote(d.id)}
                                disabled={promoting.has(d.id)}
                                title={t("drafts.promote")}
                            >
                                ✨
                            </button>
                            <button
                                className="btn-mini"
                                onClick={() => remove(d.id)}
                                title={t("drafts.delete")}
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}

                {showPromoted && promoted.length > 0 && (
                    <>
                        <div className="drafts-section-divider">
                            {t("drafts.promotedSection")} ({promoted.length})
                        </div>
                        {promoted.map((d) => (
                            <div key={d.id} className="draft-row promoted">
                                <div className="draft-row-content">
                                    <div className="draft-row-text">{d.content}</div>
                                    <div className="draft-row-meta">
                                        {d.promoted_to_node_id && (
                                            <button
                                                className="badge-link"
                                                onClick={() => onJump(d.promoted_to_node_id!)}
                                                title={t("drafts.jumpToNode")}
                                            >
                                                ✅ {d.promoted_to_node_id.slice(0, 8)}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
