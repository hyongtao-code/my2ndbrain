import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "./lib/api";
import type { GraphPayload, IngestResponse, NodeOut } from "./types";
import KnowledgeSphere from "./components/KnowledgeSphere";
import NodeDetail from "./components/NodeDetail";
import AddNodeModal from "./components/AddNodeModal";
import ImportModal from "./components/ImportModal";
import ExportModal from "./components/ExportModal";
import AssistantPanel from "./components/AssistantPanel";
import LanguageToggle from "./components/LanguageToggle";
import { I18nProvider } from "./i18n";

function AppInner() {
    const t = useTranslations();
    const [graph, setGraph] = useState<GraphPayload | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selected, setSelected] = useState<NodeOut | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [hover, setHover] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
    const [autoSpin, setAutoSpin] = useState(true);
    const [filterCategory, setFilterCategory] = useState<string>("");
    const [drafts, setDrafts] = useState<import("./types").DraftOut[]>([]);
    // AI Assistant panel can be a small floating tab in the bottom-left
    // OR expanded to occupy the left 50vw of the screen. We lift this
    // state up here so the FAB cluster can react (e.g. when the
    // assistant panel is expanded over the canvas, the FAB still
    // works because the panel sits on top of the sphere with its
    // own z-index).
    // Layout mode for the left AI Assistant column.
    // "default" = 280px (1/4); "minimized" = 52px rail; "half" = 50vw (1/2)
    const [assistantMode, setAssistantMode] = useState<"default" | "minimized" | "half">("default");
    // Layout mode for the right modal sheet (AddNode / NodeDetail).
    // Derived from which modal is open + that modal's fullscreen flag —
    // not stored, computed each render so it always matches reality.
    //   closed      → "minimized" (column 0)
    //   open        → "default"  (column 320px)
    //   fullscreen  → "half"     (column 50vw)
    // Per-modal size state. Each modal is independent (open with
    // "default" = 1/4 or "half" = 1/2). The 4 booleans collapsed
    // into 4 strings so the modal header can render two separate
    // buttons (1/4 / 1/2) and highlight the active one.
    const [addMode, setAddMode] = useState<"default" | "half">("default");
    const [importMode, setImportMode] = useState<"default" | "half">("default");
    const [exportMode, setExportMode] = useState<"default" | "half">("default");
    const [detailMode, setDetailMode] = useState<"default" | "half">("default");
    // Derived from which modal is open + that modal's mode flag.
    const anyModalOpen = !!(selected || showAdd || showImport || showExport);
    const anyModalFullscreen = !!((selected && detailMode === "half") || addMode === "half" || importMode === "half" || exportMode === "half");
    const computedModalMode: "default" | "half" | "minimized" =
        !anyModalOpen ? "minimized" :
        anyModalFullscreen ? "half" : "default";
    // Assistant uses a direct setAssistantMode so the user can pick any
    // of the three sizes from the segmented control in the panel header.
    const refreshDrafts = useCallback(async () => {
        try {
            const list = await api.listDrafts(false);
            setDrafts(list);
        } catch {
            setDrafts([]);
        }
    }, []);
    useEffect(() => { refreshDrafts(); }, [refreshDrafts]);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchActiveIdx, setSearchActiveIdx] = useState(0);
    const stageRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        const g = await api.graph(filterCategory || undefined);
        setGraph(g);
    }, [filterCategory]);

    useEffect(() => { refresh(); }, [refresh]);

    // If the active filter no longer matches any node in the graph
    // (e.g. last node in that category was deleted), drop the filter
    // so the user is never stranded on an empty view without a way out.
    useEffect(() => {
        if (
            filterCategory &&
            graph &&
            !graph.nodes.some((n) => (n.category || "未分类") === filterCategory)
        ) {
            setFilterCategory("");
        }
    }, [graph, filterCategory]);

    // Compute ids of nodes that match the current search query. Case
    // insensitive substring against title / content / keywords. Empty
    // query => null set (= no filtering, normal hover behaviour).
    const searchMatchIds = useMemo<Set<string> | null>(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || !graph) return null;
        const out = new Set<string>();
        for (const n of graph.nodes) {
            const title = (n.title || "").toLowerCase();
            const cat = (n.category || "").toLowerCase();
            const kw = (n.keywords || []).join(" ").toLowerCase();
            if (title.includes(q) || cat.includes(q) || kw.includes(q)) {
                out.add(n.id);
            }
        }
        return out;
    }, [searchQuery, graph]);

    // Top-N matches for the search dropdown. Same data as the
    // highlight set, but ranked by a simple score so the user sees
    // the best matches first instead of arbitrary graph order.
    // Score: title-hit=3, category-hit=2, keyword-hit=1. Title prefix
    // matches get a +1 bonus to mimic "starts with" feel.
    const searchMatches = useMemo<Array<{ id: string; title: string; category: string; score: number }>>(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || !graph) return [];
        const scored: Array<{ id: string; title: string; category: string; score: number; _t: number; _c: number; _k: number }> = [];
        for (const n of graph.nodes) {
            const title = (n.title || "");
            const cat = (n.category || "");
            const kw = (n.keywords || []).join(" ");
            const lt = title.toLowerCase();
            const lc = cat.toLowerCase();
            const lk = kw.toLowerCase();
            const t = lt.includes(q) ? 3 : 0;
            const c = lc.includes(q) ? 2 : 0;
            const k = lk.includes(q) ? 1 : 0;
            const score = t + c + k + (t && lt.startsWith(q) ? 1 : 0);
            if (score > 0) scored.push({ id: n.id, title, category: cat, score, _t: t, _c: c, _k: k });
        }
        scored.sort((a, b) =>
            b.score - a.score
            || (b._t - a._t)         // title-hit wins ties
            || a.title.length - b.title.length  // shorter title wins (more specific)
        );
        return scored.slice(0, 5).map(({ _t, _c, _k, ...rest }) => rest);
    }, [searchQuery, graph]);

    // Pause auto-spin while a node is open for inspection, resume on close.
    useEffect(() => {
        if (selected) {
            setAutoSpin(false);
        } else if (!showAdd) {
            const t = setTimeout(() => setAutoSpin(true), 600);
            return () => clearTimeout(t);
        }
    }, [selected, showAdd]);

    const selectNode = useCallback(async (id: string) => {
        setSelectedId(id);
        try {
            const n = await api.node(id);
            setSelected(n);
        } catch {}
    }, []);

    const closeDetail = useCallback(() => {
        setSelected(null);
        setSelectedId(null);
    }, []);

    // tooltip projection: convert bubble (x,y) in world space -> screen px
    useEffect(() => {
        if (!hover || !stageRef.current) {
            setTooltip(null);
            return;
        }
        const rect = stageRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const SCALE = (rect.height * 0.5) / 14;
        const sx = cx + hover.x * SCALE;
        const sy = cy - hover.y * SCALE;
        setTooltip({ x: sx, y: sy, text: hover.title });
    }, [hover]);

    const handleCreated = (r: IngestResponse) => {
        refresh();
        selectNode(r.node.id);
    };

    return (
        <div
            className="app"
            data-assistant-mode={assistantMode}
            data-modal-mode={computedModalMode}
        >
            <div className="stage" ref={stageRef}>
                {graph && graph.nodes.length > 0 && (
                    <KnowledgeSphere
                        nodes={graph.nodes}
                        edges={graph.edges}
                        selectedId={selectedId}
                        hoveredId={hover?.id ?? null}
                        searchMatchIds={searchMatchIds}
                        onSelectNode={selectNode}
                        onHoverNode={setHover}
                        autoSpin={autoSpin}
                    />
                )}
                {(!graph || graph.nodes.length === 0) && (
                    <div className="empty">
                        <h1>{t("empty.title")}</h1>
                        <p>{t("empty.subtitle")}</p>
                    </div>
                )}
            </div>

            <div className="topbar">
                <div className="brand">
                    <div className="brand-dot" />
                    <span className="brand-title">{t("brand.title")}</span>
                    <span className="brand-sep">·</span>
                    <span className="brand-sub">{t("brand.subtitle")}</span>
                    <LanguageToggle />
                </div>
                <div className="search-wrap">
                    <div className="search-input">
                        <span className="search-icon"><IconSearch /></span>
                        <input
                            type="search"
                            className="search-field"
                            placeholder={t("search.placeholder")}
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setSearchOpen(true);
                                setSearchActiveIdx(0);
                            }}
                            onFocus={() => searchQuery && setSearchOpen(true)}
                            onKeyDown={(e) => {
                                if (!searchOpen || searchMatches.length === 0) return;
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setSearchActiveIdx((i) => Math.min(i + 1, searchMatches.length - 1));
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setSearchActiveIdx((i) => Math.max(i - 1, 0));
                                } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const m = searchMatches[searchActiveIdx];
                                    if (m) {
                                        selectNode(m.id);
                                        setSearchQuery("");
                                        setSearchOpen(false);
                                    }
                                } else if (e.key === "Escape") {
                                    setSearchOpen(false);
                                }
                            }}
                            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                        />
                        {searchQuery && (
                            <button
                                className="search-clear"
                                title="Clear"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
                            ><IconClose /></button>
                        )}
                    </div>
                    {searchOpen && searchMatches.length > 0 && (
                        <div className="search-dropdown" role="listbox">
                            {searchMatches.map((m, i) => (
                                <button
                                    key={m.id}
                                    className={"search-row" + (i === searchActiveIdx ? " is-active" : "")}
                                    role="option"
                                    aria-selected={i === searchActiveIdx}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setSearchActiveIdx(i)}
                                    onClick={() => {
                                        selectNode(m.id);
                                        setSearchQuery("");
                                        setSearchOpen(false);
                                    }}
                                >
                                    <span className="search-row-title">{m.title}</span>
                                    {m.category && <span className="search-row-cat">{m.category}</span>}
                                    <span className="search-row-score">{m.score}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {searchOpen && searchQuery.trim() && searchMatches.length === 0 && (
                        <div className="search-dropdown">
                            <div className="search-empty">{t("search.empty")}</div>
                        </div>
                    )}
                </div>
                <div className="category-filter">
                    <label className="category-filter-label" htmlFor="category-filter-select">
                        {t("filter.label")}
                    </label>
                    <select
                        id="category-filter-select"
                        className="category-filter-select"
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                    >
                        <option value="">{t("filter.allCategories")}</option>
                        {(graph?.stats.categories || []).map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>
                <div className="stats">
                    <div className="stat">{t("stats.nodes")} <b>{graph?.stats.node_count ?? 0}</b></div>
                    <div className="stat">{t("stats.edges")} <b>{graph?.stats.edge_count ?? 0}</b></div>
                    <div className="stat">{t("stats.clusters")} <b>{graph?.stats.cluster_count ?? 0}</b></div>
                </div>
                <div className="action-bar">
                    <button
                        className="fab"
                        title={t("fab.import")}
                        onClick={() => setShowImport(true)}
                    ><IconArrowUp /></button>
                    <button
                        className="fab"
                        title={t("fab.export")}
                        onClick={() => setShowExport(true)}
                    ><IconArrowDown /></button>
                    <button
                        className="fab fab-primary"
                        onClick={() => setShowAdd(true)}
                        title={t("fab.add")}
                    ><IconPlus /></button>
                </div>
            </div>

            {tooltip && (
                <div className="tooltip-3d" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>
            )}

            {selected && (
                <NodeDetail
                    node={selected}
                    onJump={(id) => selectNode(id)}
                    onClose={closeDetail}
                    onMutated={refresh}
                    modalMode={detailMode}
                    onSetMode={setDetailMode}
                />
            )}

            <AssistantPanel onJump={(id) => selectNode(id)} drafts={drafts} refreshDrafts={refreshDrafts} assistantMode={assistantMode} onSetMode={setAssistantMode} />



            {showAdd && (
                <AddNodeModal onClose={() => setShowAdd(false)} onCreated={handleCreated} modalMode={addMode} onSetMode={setAddMode} />
            )}
            {showImport && (
                <ImportModal onClose={() => setShowImport(false)} onCreated={handleCreated} modalMode={importMode} onSetMode={setImportMode} />
            )}
            {showExport && (
                <ExportModal onClose={() => setShowExport(false)} modalMode={exportMode} onSetMode={setExportMode} />
            )}
        </div>
    );
}

// ============================================================================
// Inline SVG icons (DESIGN.md §6: no emoji as icon in chrome).
// All icons are stroke 1 px, sized 14-16 px, currentColor.
// ============================================================================
function IconSearch({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <circle cx={7} cy={7} r={4.5} />
      <line x1={10.4} y1={10.4} x2={13.5} y2={13.5} />
    </svg>
  );
}
function IconClose({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={3.5} y1={3.5} x2={12.5} y2={12.5} />
      <line x1={12.5} y1={3.5} x2={3.5} y2={12.5} />
    </svg>
  );
}
function IconLang({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={2.5} y1={5}   x2={13.5} y2={5} />
      <line x1={2.5} y1={11}  x2={13.5} y2={11} />
    </svg>
  );
}
function IconBrain({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <path d="M5 4.5 C3.5 4.5 3 6 3 7.2 C3 8.2 3.5 9 4.2 9.3
               C4.1 9.5 4.2 10.2 4 10.7 C4 12 5.3 12.6 6.4 12.3
               L6.4 13 L8 12.5 L9.6 13 L9.6 12.3
               C10.7 12.6 12 12 12 10.7 C11.8 10.2 11.9 9.5 12.8 9.3
               C12.5 9 13 8.2 13 7.2 C13 6 12.5 4.5 11 4.5
               C10.5 3.5 9.5 3.5 9 4.2 C8.5 3.5 7.5 3.5 7 4.2
               C6.5 3.5 5.5 3.5 5 4.5 Z" />
      <line x1={8} y1={5.5} x2={8} y2={12} />
    </svg>
  );
}
function IconArrowUp({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={13} x2={8} y2={3} />
      <polyline points="3.5,7.5 8,3 12.5,7.5" />
    </svg>
  );
}
function IconArrowDown({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={3} x2={8} y2={13} />
      <polyline points="3.5,8.5 8,13 12.5,8.5" />
    </svg>
  );
}
function IconPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.4} strokeLinecap="round"
         aria-hidden="true" style={{ display: "block" }}>
      <line x1={8} y1={3} x2={8} y2={13} />
      <line x1={3} y1={8} x2={13} y2={8} />
    </svg>
  );
}

export function App() {
    return (
        <I18nProvider>
            <AppInner />
        </I18nProvider>
    );
}