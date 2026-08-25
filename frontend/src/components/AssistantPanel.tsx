import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../lib/api";
import type { AssistantResponse, DraftOut } from "../types";
import { useI18n } from "../i18n";

type Mode = "ask" | "suggest" | "settings" | "draft";

type Props = {
    onJump: (id: string) => void;
    drafts: import("../types").DraftOut[];
    refreshDrafts: () => void;
};

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

export default function AssistantPanel({ onJump, drafts, refreshDrafts }: Props) {
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
            {mode === "suggest" && <SuggestTab onJump={onJump} drafts={drafts} refreshDrafts={refreshDrafts} />}
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
    const [res, setRes] = useState<{
        provider: string;
        answer: string;
        related_nodes: Array<{ id: string; title: string; category: string; summary: string; similarity: number }>;
        used_nodes: string[];
    } | null>(null);
    const [skills, setSkills] = useState<any[]>([]);

    const ask = async () => {
        if (!q.trim()) return;
        setLoading(true);
        setRes(null);
        try {
            // Use the LLM-backed retrieval-augmented Q&A. This endpoint
            // embeds the question, pulls the top-k nearest nodes, and asks
            // the active LLM to write a natural-language answer grounded in
            // those nodes. Falls back to a structured listing if the LLM is
            // not configured.
            const r = await api.askLLM(q.trim(), 8);
            setRes(r);
        } finally {
            setLoading(false);
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
                    {loading ? t("assistant.working") : t("assistant.ask")}
                </button>
            </div>
            {res && (
                <div className="answer">
                    <div className="answer-meta">
                        {t("assistant.providerLabel")}: {res.provider}
                        {" · "}
                        {res.related_nodes.length} {t("assistant.relatedNodes")}
                    </div>
                    <div className="answer-text" style={{ whiteSpace: "pre-wrap" }}>
                        {res.answer}
                    </div>
                    {res.related_nodes.length > 0 && (
                        <div className="related-list">
                            <div className="related-list-title">{t("assistant.relatedSources")}</div>
                            {res.related_nodes.map((n) => (
                                <button
                                    key={n.id}
                                    className="related-list-item"
                                    onClick={() => onJump(n.id)}
                                >
                                    <span className="related-title">{n.title}</span>
                                    {n.category && <span className="related-cat">{n.category}</span>}
                                    <span className="related-sim">{Math.round(n.similarity * 100)}%</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================================
// Suggest tab — three LLM-powered curation actions:
//   (1) clean-draft: take one of the user's drafts and produce a
//       polished KnowledgeNode (title/content/category/keywords)
//   (2) find-merges: sample 10 random/popular/oldest, ask LLM which
//       pair is a duplicate
//   (3) find-edges:  sample 10 from the most-popular node and ask
//       LLM which pairs should be linked
// Each action has a confirm step before any write (POST /api/nodes
// for ingest, POST /api/llm/link for edge).
// ============================================================
type CleanDraftResult = {
    provider: string;
    title: string;
    content: string;
    category: string;
    keywords: string[];
    rationale: string;
};

type FindMergesResult = {
    provider: string;
    action: "merge" | "noop";
    rationale: string;
    nodes: string[];
    similarity?: number;
};

type FindEdgesResult = {
    provider: string;
    category: string | null;
    suggestions: Array<{
        source: string;
        target: string;
        relation: string;
        rationale: string;
        similarity?: number;
    }>;
    rationale?: string;
};

function SuggestTab({ onJump, drafts, refreshDrafts }: {
    onJump: (id: string) => void;
    drafts: import("../types").DraftOut[];
    refreshDrafts: () => void;
}) {
    const t = useTranslations();
    const [busy, setBusy] = useState<null | "clean" | "merge" | "edge">(null);
    const [cleanResult, setCleanResult] = useState<CleanDraftResult | null>(null);
    const [cleanDraftId, setCleanDraftId] = useState<string | null>(null);
    const [mergeResult, setMergeResult] = useState<FindMergesResult | null>(null);
    const [edgeResult, setEdgeResult] = useState<FindEdgesResult | null>(null);
    const [applyMsg, setApplyMsg] = useState<string | null>(null);

    // Pick the latest non-promoted draft by default.
    const pickDraftId = (): string | null => {
        const candidates = drafts.filter((d) => !d.promoted_to_node_id);
        return candidates.length ? candidates[0].id : null;
    };

    const doClean = async () => {
        const did = pickDraftId();
        if (!did) {
            setApplyMsg("❌ 没有可用的草稿 (草稿箱是空的)");
            return;
        }
        setBusy("clean");
        setApplyMsg(null);
        setCleanResult(null);
        setCleanDraftId(did);
        try {
            const r = await api.cleanDraft(did);
            setCleanResult(r);
        } catch (e: any) {
            setApplyMsg(`❌ ${e?.message || String(e)}`);
        } finally {
            setBusy(null);
        }
    };

    const acceptClean = async () => {
        if (!cleanResult || !cleanDraftId) return;
        setBusy("clean");
        setApplyMsg(null);
        try {
            const res = await api.ingest({
                title: cleanResult.title,
                content: cleanResult.content,
                category: cleanResult.category || undefined,
                keywords: cleanResult.keywords,
                importance: 5.0,
                source: "llm-clean",
                auto_link: true,
            });
            // Mark draft as promoted
            await api.promoteDrafts([cleanDraftId]);
            refreshDrafts();
            if (res?.node?.id) {
                onJump(res.node.id);
                setApplyMsg(`✅ 已生成节点：${cleanResult.title}`);
            } else {
                setApplyMsg("✅ 已生成节点");
            }
            setCleanResult(null);
            setCleanDraftId(null);
        } catch (e: any) {
            setApplyMsg(`❌ ${e?.message || String(e)}`);
        } finally {
            setBusy(null);
        }
    };

    const doMerge = async () => {
        setBusy("merge");
        setApplyMsg(null);
        setMergeResult(null);
        try {
            const r = await api.findMerges(10, "random");
            setMergeResult(r);
        } catch (e: any) {
            setApplyMsg(`❌ ${e?.message || String(e)}`);
        } finally {
            setBusy(null);
        }
    };

    const doEdge = async () => {
        setBusy("edge");
        setApplyMsg(null);
        setEdgeResult(null);
        try {
            const r = await api.findEdges(10, "random");
            setEdgeResult(r);
        } catch (e: any) {
            setApplyMsg(`❌ ${e?.message || String(e)}`);
        } finally {
            setBusy(null);
        }
    };

    const applyEdge = async (src: string, tgt: string, relation: string) => {
        setApplyMsg(null);
        try {
            const url = `/api/llm/link?source_id=${src}&target_id=${tgt}&relation=${encodeURIComponent(relation)}`;
            const r = await fetch(url, { method: "POST" });
            const data = await r.json();
            if (data.detail) {
                setApplyMsg(`❌ ${data.detail}`);
            } else {
                setApplyMsg(`✅ Edge created (id=${data.id.slice(0, 8)}, existed=${data.already_existed})`);
            }
        } catch (e: any) {
            setApplyMsg(`❌ ${e?.message || String(e)}`);
        }
    };

    return (
        <div className="assistant-tab-body">
            <p className="assistant-hint">{t("assistant.suggestHint")}</p>
            <div className="assistant-actions" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button className="btn-primary" onClick={doClean} disabled={busy !== null}>
                    🧹 {busy === "clean" ? t("assistant.working") : t("assistant.suggestCleanDraft")}
                </button>
                <button className="btn-primary" onClick={doMerge} disabled={busy !== null}>
                    🔀 {busy === "merge" ? t("assistant.working") : t("assistant.suggestMerge")}
                </button>
                <button className="btn-primary" onClick={doEdge} disabled={busy !== null}>
                    🔗 {busy === "edge" ? t("assistant.working") : t("assistant.suggestEdge")}
                </button>
            </div>

            {/* 1. Clean-draft result */}
            {cleanResult && (
                <div className="suggestion-card">
                    <div className="suggestion-action">
                        🧹 cleaned-draft <span className="provider-tag">via {cleanResult.provider}</span>
                    </div>
                    <div className="suggestion-rationale">{cleanResult.rationale}</div>
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 12, color: "var(--text-2)" }}>title</div>
                        <input
                            className="textarea"
                            value={cleanResult.title}
                            onChange={(e) => setCleanResult({ ...cleanResult, title: e.target.value })}
                            style={{ height: 32, padding: 6 }}
                        />
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 12, color: "var(--text-2)" }}>content</div>
                        <textarea
                            className="textarea"
                            value={cleanResult.content}
                            onChange={(e) => setCleanResult({ ...cleanResult, content: e.target.value })}
                            rows={6}
                        />
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                        <input
                            className="textarea"
                            value={cleanResult.category}
                            onChange={(e) => setCleanResult({ ...cleanResult, category: e.target.value })}
                            placeholder="category"
                            style={{ height: 32, padding: 6, flex: 1 }}
                        />
                        <input
                            className="textarea"
                            value={(cleanResult.keywords || []).join(", ")}
                            onChange={(e) =>
                                setCleanResult({
                                    ...cleanResult,
                                    keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                                })
                            }
                            placeholder="keywords (comma-separated)"
                            style={{ height: 32, padding: 6, flex: 2 }}
                        />
                    </div>
                    <button className="btn-primary" onClick={acceptClean} disabled={busy !== null} style={{ marginTop: 8 }}>
                        ✅ {t("assistant.acceptAndIngest")}
                    </button>
                </div>
            )}

            {/* 2. Find-merges result */}
            {mergeResult && (
                <div className="suggestion-card">
                    <div className="suggestion-action">
                        🔀 merge <b>{mergeResult.action}</b>{" "}
                        <span className="provider-tag">via {mergeResult.provider}</span>
                    </div>
                    <div className="suggestion-rationale">{mergeResult.rationale}</div>
                    {mergeResult.similarity !== undefined && (
                        <div className="suggestion-similarity">similarity: {mergeResult.similarity.toFixed(3)}</div>
                    )}
                    {mergeResult.nodes.length > 0 && (
                        <div className="suggestion-nodes">
                            {mergeResult.nodes.map((id) => (
                                <button key={id} className="node-link" onClick={() => onJump(id)}>
                                    {id.slice(0, 8)}
                                </button>
                            ))}
                        </div>
                    )}
                    {mergeResult.action === "noop" && (
                        <button className="btn-primary" onClick={doMerge} disabled={busy !== null}>
                            🔄 {t("assistant.tryAgain")}
                        </button>
                    )}
                </div>
            )}

            {/* 3. Find-edges result */}
            {edgeResult && (
                <div className="suggestion-card">
                    <div className="suggestion-action">
                        🔗 edges <span className="provider-tag">via {edgeResult.provider}</span>
                        {edgeResult.category && <span className="provider-tag">category: {edgeResult.category}</span>}
                    </div>
                    {edgeResult.rationale && <div className="suggestion-rationale">{edgeResult.rationale}</div>}
                    {edgeResult.suggestions.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6 }}>
                            没有推荐的新边（节点太少或相似度不够）
                        </div>
                    ) : (
                        edgeResult.suggestions.map((s, i) => (
                            <div key={i} style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                                <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                                    {s.relation}: {s.source.slice(0, 8)} → {s.target.slice(0, 8)}
                                </div>
                                <div style={{ fontSize: 12 }}>{s.rationale}</div>
                                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                    <button className="node-link" onClick={() => onJump(s.source)}>view A</button>
                                    <button className="node-link" onClick={() => onJump(s.target)}>view B</button>
                                    <button className="btn-primary" onClick={() => applyEdge(s.source, s.target, s.relation)}>
                                        🔗 {t("assistant.applyEdge")}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                    {edgeResult.suggestions.length === 0 && (
                        <button className="btn-primary" onClick={doEdge} disabled={busy !== null}>
                            🔄 {t("assistant.tryAgain")}
                        </button>
                    )}
                </div>
            )}

            {applyMsg && <div className="apply-status">{applyMsg}</div>}
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
        // Always send the current form values, even if apiKey is empty.
        // This way the user gets feedback about the values they just
        // typed in, not whatever is in the backend runtime override.
        const body = {
            provider,
            api_key: apiKey,
            model,
        };
        try {
            const r = await fetch("http://127.0.0.1:8000/api/llm/test", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
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
