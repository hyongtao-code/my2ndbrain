import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "./lib/api";
import type { GraphPayload, IngestResponse, NodeOut } from "./types";
import KnowledgeSphere from "./components/KnowledgeSphere";
import NodeDetail from "./components/NodeDetail";
import AddNodeModal from "./components/AddNodeModal";
import AssistantPanel from "./components/AssistantPanel";
import LanguageToggle from "./components/LanguageToggle";
import { I18nProvider } from "./i18n";

function AppInner() {
    const t = useTranslations();
    const [graph, setGraph] = useState<GraphPayload | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selected, setSelected] = useState<NodeOut | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [hover, setHover] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
    const [autoSpin, setAutoSpin] = useState(true);
    const stageRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        const g = await api.graph();
        setGraph(g);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

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
        <div className="app">
            <div className="stage" ref={stageRef}>
                {graph && graph.nodes.length > 0 && (
                    <KnowledgeSphere
                        nodes={graph.nodes}
                        edges={graph.edges}
                        selectedId={selectedId}
                        onSelectNode={selectNode}
                        onHoverNode={setHover}
                        autoSpin={autoSpin}
                    />
                )}
            </div>

            {(!graph || graph.nodes.length === 0) && (
                <div className="empty">
                    <h1>{t("empty.title")}</h1>
                    <p>{t("empty.subtitle")}</p>
                </div>
            )}

            <div className="topbar">
                <div className="brand">
                    <div className="brand-dot" />
                    <span className="brand-title">{t("brand.title")}</span>
                    <span className="brand-sep">·</span>
                    <span className="brand-sub">{t("brand.subtitle")}</span>
                    <LanguageToggle />
                </div>
                <div className="stats">
                    <div className="stat">{t("stats.nodes")} <b>{graph?.stats.node_count ?? 0}</b></div>
                    <div className="stat">{t("stats.edges")} <b>{graph?.stats.edge_count ?? 0}</b></div>
                    <div className="stat">{t("stats.clusters")} <b>{graph?.stats.cluster_count ?? 0}</b></div>
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
                />
            )}

            <AssistantPanel onJump={(id) => selectNode(id)} />

            <button className="fab" onClick={() => setShowAdd(true)} title={t("fab.add")}>＋</button>

            {showAdd && (
                <AddNodeModal onClose={() => setShowAdd(false)} onCreated={handleCreated} />
            )}
        </div>
    );
}

export function App() {
    return (
        <I18nProvider>
            <AppInner />
        </I18nProvider>
    );
}