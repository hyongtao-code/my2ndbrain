import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { GraphNode, GraphEdge } from "../types";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode: (id: string) => void;
  onHoverNode: (n: { id: string; title: string; x: number; y: number } | null) => void;
  selectedId: string | null;
  hoveredId: string | null;    // id of node being hovered (for neighbour halo)
  searchMatchIds: Set<string> | null;  // ids matching the current search query; null = no filter
  autoSpin: boolean;          // when false, the sphere stops auto-rotating
  resumeSpinAt?: number;      // bumping this counter forces autoSpin to resume
};

const RADIUS = 5;

// Build a great-circle arc from `a` to `b` on a sphere of given radius,
// bulging the curve outward by `lift` units so it sits clearly *on* the
// sphere surface (or slightly above it) instead of cutting through the volume.
function greatCircleArc(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  segments = 48,
  lift = 0.25,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const start = a.clone().normalize();
  const end = b.clone().normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
  // skip degenerate edges
  if (angle < 1e-4 || !isFinite(angle)) {
    out.push(a.clone());
    out.push(b.clone());
    return out;
  }
  // shortest great-circle: slerp
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const sinA = Math.sin(angle);
    const w0 = Math.sin((1 - t) * angle) / sinA;
    const w1 = Math.sin(t * angle) / sinA;
    const p = new THREE.Vector3()
      .addScaledVector(start, w0)
      .addScaledVector(end, w1);
    // outward lift so the arc hovers a bit above the sphere surface
    p.multiplyScalar(radius + lift);
    out.push(p);
  }
  return out;
}

function KnowledgeEdges({
  nodes,
  edges,
  selectedId,
  hoveredId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  hoveredId: string | null;
}) {
  // Pre-compute arc geometry per edge so we can render each as a tube.
  const arcData = useMemo(() => {
    const lookup = new Map<string, GraphNode>();
    nodes.forEach((n) => lookup.set(n.id, n));
    return edges
      .map((e) => {
        const a = lookup.get(e.source);
        const b = lookup.get(e.target);
        if (!a || !b) return null;
        const va = new THREE.Vector3(a.x, a.y, a.z);
        const vb = new THREE.Vector3(b.x, b.y, b.z);
        const arc = greatCircleArc(va, vb, RADIUS, 48, 0.25);
        const isSel = e.source === selectedId || e.target === selectedId;
        const isHover = !!hoveredId && (e.source === hoveredId || e.target === hoveredId);
        return {
          id: e.id,
          arc,
          sim: Number(e.similarity_score || 0),
          isSel,
          isHover,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        arc: THREE.Vector3[];
        sim: number;
        isSel: boolean;
        isHover: boolean;
      }>;
  }, [nodes, edges, selectedId, hoveredId]);

  // One merged buffer-geometry line for the faint "all-edges" backdrop.
  const backdropGeom = useMemo(() => {
    const positions = new Float32Array(arcData.length * 48 * 2 * 3);
    let off = 0;
    arcData.forEach((e) => {
      for (let i = 0; i < e.arc.length - 1; i++) {
        positions[off++] = e.arc[i].x;
        positions[off++] = e.arc[i].y;
        positions[off++] = e.arc[i].z;
        positions[off++] = e.arc[i + 1].x;
        positions[off++] = e.arc[i + 1].y;
        positions[off++] = e.arc[i + 1].z;
      }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [arcData]);

  return (
    <group>
      {/* faint backdrop for all edges */}
      <lineSegments geometry={backdropGeom}>
        <lineBasicMaterial
          color={new THREE.Color("#7c5cff")}
          transparent
          opacity={0.18}
        />
      </lineSegments>

      {/* per-edge highlighted arc — thicker, brighter when involved in selection */}
      {arcData.map((e) => {
        const positions = new Float32Array((e.arc.length - 1) * 2 * 3);
        for (let i = 0; i < e.arc.length - 1; i++) {
          positions[i * 6 + 0] = e.arc[i].x;
          positions[i * 6 + 1] = e.arc[i].y;
          positions[i * 6 + 2] = e.arc[i].z;
          positions[i * 6 + 3] = e.arc[i + 1].x;
          positions[i * 6 + 4] = e.arc[i + 1].y;
          positions[i * 6 + 5] = e.arc[i + 1].z;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const isFaded = !!hoveredId && !e.isSel && !e.isHover;
        const color = (e.isSel || e.isHover)
          ? new THREE.Color("#ffd166")
          : new THREE.Color("#9d7bff");
        const opacity = e.isSel ? 0.95
          : e.isHover ? 0.85
          : isFaded   ? 0.10
          : 0.55;
        return (
          <lineSegments key={e.id} geometry={geom}>
            <lineBasicMaterial
              color={color}
              transparent
              opacity={opacity}
            />
          </lineSegments>
        );
      })}
    </group>
  );
}

function KnowledgeNodes({
  nodes,
  edges,
  selectedId,
  hoveredId,
  searchMatchIds,
  onSelectNode,
  onHoverNode,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  hoveredId: string | null;
  searchMatchIds: Set<string> | null;
  onSelectNode: (id: string) => void;
  onHoverNode: Props["onHoverNode"];
}) {
  // Push each bubble slightly *outward* from the big sphere so it reads
  // as a 3D ball "stuck onto" the surface rather than a flat dot. We do
  // this by moving along the same direction vector (the original xyz from
  // /api/graph is already unit-length-ish on the big sphere).
  const RADIUS = 5;
  const SURFACE_LIFT = 0.05; // extra outward nudge so the bubble never
                             // looks half-sunk into the wireframe shell
  const positions = useMemo(
    () =>
      nodes.map((n) => {
        const v = new THREE.Vector3(n.x, n.y, n.z);
        const len = v.length() || 1;
        v.multiplyScalar((RADIUS + SURFACE_LIFT) / len);
        return v;
      }),
    [nodes],
  );
  const { gl } = useThree();

  // Build the set of node ids that are directly connected to the hovered
  // node (the "neighbourhood" we want to highlight together).
  const neighborIds = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === hoveredId) s.add(e.target);
      if (e.target === hoveredId) s.add(e.source);
    }
    return s;
  }, [hoveredId, edges]);

  return (
    <group>
      {nodes.map((n, i) => {
        const r = 0.12 + Math.min(0.55, (n.importance || 1) * 0.07);
        const isSel = n.id === selectedId;
        const isHover = n.id === hoveredId;
        const isNeighbor = neighborIds.has(n.id);
        // Search-filter highlighting takes precedence so a focused query
        // beats the hover "show neighbourhood" effect.
        const isSearchMatch = !!searchMatchIds && searchMatchIds.has(n.id);
        const isSearchActive = !!searchMatchIds && searchMatchIds.size > 0;
        const isSearchFaded = isSearchActive && !isSearchMatch && !isSel;
        // When something is hovered, fade everything else so the focus
        // group (hovered + neighbours) pops out.
        const isFaded = !!hoveredId && !isHover && !isNeighbor && !isSel;
        // Search fade takes priority over hover fade (search is a stronger
        // signal of user intent).
        const finalFaded = isSearchFaded || (isFaded && !isSearchActive);
        const color = new THREE.Color(n.cluster_color);
        const shellScale = isSel ? 1.55
            : isSearchMatch ? 1.30
            : isHover || isNeighbor ? 1.25
            : 1.0;
        const emissiveBoost = isSel ? 1.6
            : isSearchMatch ? 1.3
            : isHover || isNeighbor ? 1.2
            : 0.9;
        const baseOpacity = finalFaded ? 0.22 : 0.92;
        return (
          <group
            key={n.id}
            position={positions[i]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelectNode(n.id);
            }}
            onContextMenu={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              e.nativeEvent.preventDefault();
              onSelectNode(n.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHoverNode({ id: n.id, title: n.title, x: n.x, y: n.y });
              gl.domElement.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              onHoverNode(null);
              gl.domElement.style.cursor = "";
            }}
          >
            {/* glass shell: translucent outer sphere gives a soft halo */}
            <mesh>
              <sphereGeometry args={[r * shellScale, 24, 24]} />
              <meshPhysicalMaterial
                color={color}
                emissive={color}
                emissiveIntensity={emissiveBoost}
                roughness={0.15}
                metalness={0.4}
                clearcoat={0.6}
                clearcoatRoughness={0.1}
                transparent
                opacity={baseOpacity}
              />
            </mesh>
            {/* inner core: small bright sphere sells the "3D bubble" feel */}
            <mesh>
              <sphereGeometry args={[r * shellScale * 0.55, 16, 16]} />
              <meshBasicMaterial color={new THREE.Color("#ffffff")} />
            </mesh>
            {/* hover halo ring: a slightly larger transparent emissive sphere
                that only shows up when this node is hovered, selected, or
                a direct neighbour of the hovered node. */}
            {(isHover || isNeighbor || isSearchMatch) && (
              <mesh>
                <sphereGeometry args={[r * (shellScale + 0.45), 24, 24]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={isHover ? 0.32 : isSearchMatch ? 0.30 : 0.20}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function SphereScene({
  nodes,
  edges,
  selectedId,
  hoveredId,
  searchMatchIds,
  autoSpin,
  onSelectNode,
  onHoverNode,
}: Omit<Props, "resumeSpinAt">) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef(autoSpin);

  useEffect(() => {
    spin.current = autoSpin;
  }, [autoSpin]);

  // Auto-rotation
  useFrame((_, dt) => {
    if (!group.current) return;
    if (!spin.current) return;
    group.current.rotation.y += dt * 0.06;
  });

  return (
    <group ref={group}>
      {/* faint wireframe shell */}
      <mesh>
        <sphereGeometry args={[RADIUS, 48, 32]} />
        <meshBasicMaterial color="#1a1a1c" wireframe transparent opacity={0.10} />
      </mesh>
      {/* inner glow */}
      <mesh>
        <sphereGeometry args={[RADIUS * 0.97, 48, 32]} />
        <meshBasicMaterial color={new THREE.Color("#0b0b0e")} transparent opacity={0.92} />
      </mesh>

      <KnowledgeEdges nodes={nodes} edges={edges} selectedId={selectedId} hoveredId={hoveredId} />

      <KnowledgeNodes
        nodes={nodes}
        edges={edges}
        selectedId={selectedId}
        hoveredId={hoveredId}
        searchMatchIds={searchMatchIds}
        onSelectNode={onSelectNode}
        onHoverNode={onHoverNode}
      />

      {/* starfield */}
      {Array.from({ length: 220 }).map((_, i) => {
        const phi = Math.acos(2 * ((i + 0.5) / 220) - 1);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const x = RADIUS * Math.sin(phi) * Math.cos(theta);
        const y = RADIUS * Math.sin(phi) * Math.sin(theta);
        const z = RADIUS * Math.cos(phi);
        return (
          <mesh key={`s-${i}`} position={[x, y, z]}>
            <sphereGeometry args={[0.02, 6, 6]} />
            <meshBasicMaterial color={new THREE.Color("#ffffff")} transparent opacity={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function KnowledgeSphere(props: Props) {
  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 55 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[8, 8, 8]} intensity={1.1} color="#7c5cff" />
      <pointLight position={[-8, -6, -8]} intensity={0.8} color="#00d4ff" />
      <pointLight position={[0, 12, 0]} intensity={0.5} color="#ffffff" />

      <SphereScene
        nodes={props.nodes}
        edges={props.edges}
        selectedId={props.selectedId}
        hoveredId={props.hoveredId}
        searchMatchIds={props.searchMatchIds}
        autoSpin={props.autoSpin}
        onSelectNode={props.onSelectNode}
        onHoverNode={props.onHoverNode}
      />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={7}
        maxDistance={28}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        // autoRotate handled by SphereScene's own loop (it doesn't
        // conflict with OrbitControls; they each mutate the camera/scene
        // independently).
      />
    </Canvas>
  );
}