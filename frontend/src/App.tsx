import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconClose, IconPlus, IconSearch } from "./components/icons";
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
    const [assistantMode, setAssistantMode] = useState<"default" | "minimized" | "half">("default");
    // Per-modal layout mode. Each modal is independent (1/4 or 1/2),
    // and the modal header renders a toggle to switch between them.
    const [addMode, setAddMode] = useState<"default" | "half">("default");
    const [importMode, setImportMode] = useState<"default" | "half">("default");
    const [exportMode, setExportMode] = useState<"default" | "half">("default");
    const [detailMode, setDetailMode] = useState<"default" | "half">("default");
    const rightModalOpen = !!(selected || showImport || showExport);
    const rightModalInHalf =
        (!!selected && detailMode === "half") ||
        (showImport && importMode === "half") ||
        (showExport && exportMode === "half");
    const computedModalMode: "default" | "half" | "minimized" =
        !rightModalOpen ? "minimized" :
        rightModalInHalf ? "half" : "default";
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
    // so the user is never stranded on an empty view.
    useEffect(() => {
        if (
            filterCategory &&
            graph &&
            !graph.nodes.some((n) => (n.category || "未分类") === filterCategory)
        ) {
            setFilterCategory("");
        }
    }, [graph, filterCategory]);

    // ids of nodes that match the current search query (case-insensitive
    // substring over title / category / keywords). null = no filter.
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

    // Top-5 search matches ranked by score (title=3, category=2,
    // keyword=1, +1 for title-prefix hits).
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
        // Opening via the search dropdown always snaps the detail
        // panel to 1/2; the user can collapse back to 1/4 with the
        // panel's toggle. The assistant mode is left untouched.
        setDetailMode("half");
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
            data-add-open={showAdd}
            data-add-mode={addMode}
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
                                onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
                            ><IconClose /></button>
                        )}
                    </div>
                    {searchOpen && searchMatches.length > 0 && (
                        <div className="search-dropdown" role="listbox">
                            {searchMatches.map((m, i) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    className={"search-row" + (i === searchActiveIdx ? " is-active" : "")}
                                    role="option"
                                    aria-selected={i === searchActiveIdx}
                                    onMouseEnter={() => setSearchActiveIdx(i)}
                                    onClick={() => {
                                        // Click on a search row must select
                                        // the node AND close the dropdown.
                                        // onBlur already defers close by 150ms,
                                        // which is the right delay pattern.
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

// All inline SVG icons used by App.tsx live in ./icons.tsx so that
// each icon (Close / Search / Brain / Plus / etc.) has exactly one
// definition site.

export function App() {
    return (
        <I18nProvider>
            <AppInner />
        </I18nProvider>
    );
}