import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { GraphNode, GraphEdge } from "../types";

// ============================================================================
// My2ndBrain — Knowledge Sphere (DESIGN.md §4)
// Visual spec lives in DESIGN.md. Any change here must be reflected there.
//
// Geometry      : IcosahedronGeometry(R, 6) for the planet body, no pole pinch.
// Materials     : MeshStandardMaterial PBR for nodes + body, ShaderMaterial
//                 fresnel for the atmospheric rim, additive BackSide mesh
//                 for the back-haze silhouette.
// Lighting      : One strong cool-white directional (key) + a faint cool-grey
//                 directional (fill) + a single warm-amber directional (rim)
//                 + ambient. Shadow cast on a hidden floor disc.
// Motion        : 80 s/revolution auto-spin (slow, celestial). prefers-reduced-
//                 motion freezes spin and reduces hover durations.
// Performance   : edge geometry is one merged BufferGeometry for ALL edges,
//                 not per-edge. Star layer is two pre-built arrays. 612 stars
//                 total (600 faint + 12 hero). All twinkling in JS, not shader.
// ============================================================================

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode: (id: string) => void;
  onHoverNode: (n: { id: string; title: string; x: number; y: number } | null) => void;
  selectedId: string | null;
  hoveredId: string | null;
  searchMatchIds: Set<string> | null;
  autoSpin: boolean;
  resumeSpinAt?: number;
};

const RADIUS = 5;

// ---------- helpers ---------------------------------------------------------

/** Great-circle arc from a to b, bulging outward by lift. */
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
  if (angle < 1e-4 || !isFinite(angle)) {
    out.push(a.clone());
    out.push(b.clone());
    return out;
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const sinA = Math.sin(angle);
    const w0 = Math.sin((1 - t) * angle) / sinA;
    const w1 = Math.sin(t * angle) / sinA;
    const p = new THREE.Vector3()
      .addScaledVector(start, w0)
      .addScaledVector(end, w1);
    p.multiplyScalar(radius + lift);
    out.push(p);
  }
  return out;
}

/** Per-node properties derived from importance (DESIGN.md §4.5). */
function nodeRadius(importance: number | null | undefined): number {
  const v = Math.max(0, Math.min(1, importance ?? 0.5));
  return 0.08 + 0.24 * Math.pow(v, 0.7);
}
function nodeOpacity(importance: number | null | undefined): number {
  const v = Math.max(0, Math.min(1, importance ?? 0.5));
  return 0.45 + 0.55 * Math.pow(v, 0.7);
}
function nodeEmissive(importance: number | null | undefined): number {
  const v = Math.max(0, Math.min(1, importance ?? 0.5));
  return 0.18 * Math.pow(v, 1.5);
}
/** Outward "depth" — important nodes sit slightly forward. */
function surfaceLift(importance: number | null | undefined): number {
  const v = Math.max(0, Math.min(1, importance ?? 0.5));
  return v * 0.18 - 0.05;
}

// ---------- starfield --------------------------------------------------------

const HERO_STARS = 12;
const FAINT_STARS = 600;
// Pre-computed once at module load (deterministic). Both layers use
// Fibonacci-sphere distribution so the points are evenly spread with
// no clumping at the poles.
function fibPoint(i: number, total: number, radius: number): THREE.Vector3 {
  const phi = Math.acos(2 * ((i + 0.5) / total) - 1);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  );
}
const FAINT_POSITIONS: THREE.Vector3[] = Array.from({ length: FAINT_STARS },
  (_, i) => fibPoint(i, FAINT_STARS, 60));
const HERO_POSITIONS: THREE.Vector3[] = Array.from({ length: HERO_STARS },
  (_, i) => fibPoint(i + 17, HERO_STARS, 70));  // offset 17 to avoid alignment

// ---------- ambient + camera parallax --------------------------------------

// Module-level mouse position so useFrame can read it without
// re-creating closures. Populated by the pointermove listener in
// CameraParallax.
const _mouse = { x: 0, y: 0 };
function CameraParallax() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      _mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      _mouse.y = ((ev.clientY - r.top) / r.height) * 2 - 1;
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [gl]);
  // Camera starts at (0, 1.6, 14); parallax drifts ±0.6 on x/y.
  const baseY = 1.6;
  useFrame(() => {
    const targetX = _mouse.x * 0.6;
    const targetY = baseY + _mouse.y * -0.6;
    camera.position.x += (targetX - camera.position.x) * 0.04;
    camera.position.y += (targetY - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// ---------- atomospheric rim shader ----------------------------------------

const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;
const ATMOSPHERE_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
uniform vec3 uRimColor;
uniform float uPower;
uniform float uIntensity;
void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), uPower);
  gl_FragColor = vec4(uRimColor, fresnel * uIntensity);
}
`;

// ============================================================================
// Component
// ============================================================================
export default function KnowledgeSphere(props: Props) {
  return (
    <Canvas
      camera={{ position: [0, 1.6, 14], fov: 50, near: 0.1, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      shadows
    >
      {/* Clear colour matches --bg-void (DESIGN.md §4.1). */}
      <color attach="background" args={["#050608"]} />

      {/* ─── Lighting (DESIGN.md §4.3) ─────────────────────────────────── */}
      {/* Main: cool white, top-front-left. Strong so terminator is visible. */}
      <directionalLight
        position={[-7, 6, 7]}
        intensity={1.1}
        color="#ECEEF5"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0005}
      />
      {/* Fill: opposite side, dim, cool grey — keeps shadow side non-black. */}
      <directionalLight position={[6, -2, -5]} intensity={0.18} color="#9DA0AC" />
      {/* Rim: warm key — the only warm light in the scene. */}
      <directionalLight position={[5, 1, -8]} intensity={0.45} color="#F3C892" />
      {/* Ambient: extremely weak, just enough to keep shadow side readable. */}
      <ambientLight intensity={0.10} color="#0B0C10" />

      <CameraParallax />

      {/* ─── Planet body (DESIGN.md §4.2) ─────────────────────────────── */}
      <SpherePlanet />

      {/* ─── Floor disc (receives shadow so planet appears to hover) ── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -5.1, 0]}
        receiveShadow
      >
        <circleGeometry args={[10, 64]} />
        <meshStandardMaterial color="#0B0C10" roughness={1} />
      </mesh>

      {/* ─── Starfield (DESIGN.md §4.7) ──────────────────────────────── */}
      {/* Background sky does NOT rotate with the planet. */}
      <Starfield autoSpin={props.autoSpin} />

      {/* ─── Slow celestial auto-rotation (DESIGN.md §4.8) ─────────── */}
      {/* Everything inside SphereGroup rotates as a single celestial
          body: the planet, the atmosphere, the edges, and the nodes. */}
      <SphereGroup autoSpin={props.autoSpin}>
        <SpherePlanet />
        <AtmosphereRim />
        <KnowledgeGraph
          nodes={props.nodes}
          edges={props.edges}
          selectedId={props.selectedId}
          hoveredId={props.hoveredId}
          searchMatchIds={props.searchMatchIds}
          onSelectNode={props.onSelectNode}
          onHoverNode={props.onHoverNode}
        />
      </SphereGroup>

      <OrbitControls
        enablePan={false}
        /* DESIGN.md §2.1 "central sphere first": the sphere is the
           centerpiece and its scale is intentional. Disable wheel
           zoom so the user doesn't accidentally zoom in. They can
           still rotate (left mouse drag) and the camera is
           auto-framed. */
        enableZoom={false}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.3}
        /* DESIGN.md §4.8: limit vertical rotation to roughly a
           hemisphere so the user can tilt up/down to see the
           planet from above/below but never flip past the poles
           (which would invert the texture + look weird). */
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.8}
      />
    </Canvas>
  );
}

// ============================================================================
// Sphere planet (the visible planet body)
// ============================================================================
function SpherePlanet() {
  return (
    <group>
      {/* Outer PBR planet shell. */}
      <mesh castShadow receiveShadow>
        <icosahedronGeometry args={[RADIUS, 6]} />
        <meshStandardMaterial
          color="#0E1015"
          roughness={0.72}
          metalness={0.05}
          flatShading={false}
        />
      </mesh>
      {/* Back-haze silhouette — additive BackSide slightly larger sphere. */}
      <mesh>
        <icosahedronGeometry args={[RADIUS * 1.025, 6]} />
        <meshBasicMaterial
          color="#161922"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// Atmospheric fresnel rim — the "almost imperceptible" outer halo
// ============================================================================
function AtmosphereRim() {
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      uniforms: {
        uRimColor: { value: new THREE.Color("#3C5066") },
        uPower: { value: 3.0 },
        uIntensity: { value: 0.35 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }, []);
  return (
    <mesh material={mat}>
      <icosahedronGeometry args={[RADIUS * 1.04, 6]} />
    </mesh>
  );
}

// ============================================================================
// Sphere group — slow celestial auto-rotation
// ============================================================================
function SphereGroup({
  autoSpin,
  children,
}: {
  autoSpin: boolean;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  // DESIGN.md §3.7: respect prefers-reduced-motion — freeze auto-spin
  // when the user has reduced motion enabled at the OS level.
  const reduced = useRef(false);
  const spinEnabled = useRef(autoSpin);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onChange = () => { reduced.current = mq.matches; };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    spinEnabled.current = autoSpin && !reduced.current;
  }, [autoSpin]);

  // 80 s / revolution ≈ 4.5°/s (DESIGN.md §4.8)
  const angularSpeed = (Math.PI * 2) / 80;
  useFrame((_, dt) => {
    if (!group.current) return;
    if (!spinEnabled.current) return;
    group.current.rotation.y += dt * angularSpeed;
  });
  return <group ref={group}>{children}</group>;
}

// ============================================================================
// Knowledge graph (edges + nodes)
// ============================================================================
function KnowledgeGraph({
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
  const lookup = useMemo(() => {
    const m = new Map<string, GraphNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Per-edge arc geometry, computed once per (nodes, edges) change.
  const arcData = useMemo(() => {
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
        return { id: e.id, arc, sim: Number(e.similarity_score || 0), isSel, isHover };
      })
      .filter(Boolean) as Array<{
        id: string;
        arc: THREE.Vector3[];
        sim: number;
        isSel: boolean;
        isHover: boolean;
      }>;
  }, [edges, lookup, selectedId, hoveredId]);

  // Single merged buffer geometry for the faint all-edges backdrop.
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

  // Pre-compute per-node positions, radii, opacities, emissive.
  const nodeData = useMemo(() => {
    return nodes.map((n) => {
      const v = new THREE.Vector3(n.x, n.y, n.z);
      const len = v.length() || 1;
      v.multiplyScalar((RADIUS + surfaceLift(n.importance)) / len);
      return {
        n,
        position: v,
        radius: nodeRadius(n.importance),
        opacity: nodeOpacity(n.importance),
        emissive: nodeEmissive(n.importance),
      };
    });
  }, [nodes]);

  // Direct neighbours of the hovered node.
  const neighborIds = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === hoveredId) s.add(e.target);
      if (e.target === hoveredId) s.add(e.source);
    }
    return s;
  }, [hoveredId, edges]);

  const { gl } = useThree();

  return (
    <group>
      {/* ─── Edges (DESIGN.md §4.6) ─────────────────────────────── */}
      {/* Single merged backdrop for ALL edges. Sparse, almost invisible. */}
      <lineSegments geometry={backdropGeom}>
        <lineBasicMaterial color="#5C606E" transparent opacity={0.12} />
      </lineSegments>

      {/* Per-edge highlight arcs (only for hovered/selected). */}
      {arcData.map((e) => {
        if (!(e.isSel || e.isHover)) return null;
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
        return (
          <lineSegments key={e.id} geometry={geom}>
            <lineBasicMaterial color="#ECEEF5" transparent opacity={0.75} />
          </lineSegments>
        );
      })}

      {/* ─── Nodes (DESIGN.md §4.5) ────────────────────────────── */}
      {nodeData.map(({ n, position, radius, opacity, emissive }, i) => {
        const isSel = n.id === selectedId;
        const isHover = n.id === hoveredId;
        const isNeighbor = neighborIds.has(n.id);
        const isSearchMatch = !!searchMatchIds && searchMatchIds.has(n.id);
        const isSearchActive = !!searchMatchIds && searchMatchIds.size > 0;
        const isSearchFaded = isSearchActive && !isSearchMatch && !isSel;
        const isHoverFaded = !!hoveredId && !isHover && !isNeighbor && !isSel;
        const isFaded = isSearchFaded || (isHoverFaded && !isSearchActive);

        // Scale envelope: hover → 1.20 (slow), search → 1.25, select → 1.45.
        // Done by mutating the group's scale each frame (lerp toward target).
        const targetScale =
          isSel ? 1.45 : isSearchMatch ? 1.25 : isHover || isNeighbor ? 1.20 : 1.0;
        const targetEmissive = isSel
          ? Math.min(0.9, emissive * 2.4)
          : isSearchMatch
            ? Math.min(0.85, emissive * 1.8)
            : isHover || isNeighbor
              ? Math.min(0.7, emissive * 1.4)
              : emissive;
        const finalOpacity = isFaded ? 0.18 : opacity;
        const nColor = new THREE.Color(n.cluster_color);

        return (
          <NodeBubble
            key={n.id}
            position={position}
            radius={radius}
            color={nColor}
            emissive={nColor}
            targetScale={targetScale}
            targetEmissive={targetEmissive}
            opacity={finalOpacity}
            onClick={(e) => {
              e.stopPropagation();
              onSelectNode(n.id);
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              e.nativeEvent.preventDefault();
              onSelectNode(n.id);
            }}
            onHover={(e) => {
              e.stopPropagation();
              onHoverNode({ id: n.id, title: n.title, x: n.x, y: n.y });
              gl.domElement.style.cursor = "pointer";
            }}
            onUnhover={() => {
              onHoverNode(null);
              gl.domElement.style.cursor = "";
            }}
          />
        );
      })}
    </group>
  );
}

function NodeBubble({
  position,
  radius,
  color,
  emissive,
  targetScale,
  targetEmissive,
  opacity,
  onClick,
  onContextMenu,
  onHover,
  onUnhover,
}: {
  position: THREE.Vector3;
  radius: number;
  color: THREE.Color;
  emissive: THREE.Color;
  targetScale: number;
  targetEmissive: number;
  opacity: number;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onContextMenu: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (e: ThreeEvent<PointerEvent>) => void;
  onUnhover: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // Lerp toward target scale and emissive intensity each frame.
  useFrame((_, dt) => {
    if (!group.current) return;
    const k = 1 - Math.exp(-dt * 6);  // critically-damped feel
    group.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      k,
    );
    if (matRef.current) {
      const cur = matRef.current.emissiveIntensity;
      matRef.current.emissiveIntensity = cur + (targetEmissive - cur) * k;
    }
  });
  return (
    <group
      ref={group}
      position={position}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerOver={onHover}
      onPointerOut={onUnhover}
    >
      {/* Single PBR sphere — highlight is in the material. */}
      <mesh>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={emissive}
          emissiveIntensity={targetEmissive}
          roughness={0.55}
          metalness={0.0}
          transparent
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// Starfield (DESIGN.md §4.7)
// ============================================================================
function Starfield({ autoSpin }: { autoSpin: boolean }) {
  // Hero stars twinkle via a JS-side scale on each frame. We mutate
  // the scale on a shared instanced group so the cost is one matrix
  // update per frame, not 12 individual meshes.
  const heroGroup = useRef<THREE.Group>(null);
  const t0 = useRef(performance.now() / 1000);
  useFrame(() => {
    if (!heroGroup.current) return;
    const t = performance.now() / 1000 - t0.current;
    // Subtle global pulse so the field "breathes".
    const s = 1 + 0.05 * Math.sin(t * 0.5);
    heroGroup.current.scale.setScalar(s);
  });

  return (
    <group>
      {/* Faint dust — small, low opacity. */}
      {FAINT_POSITIONS.map((p, i) => (
        <mesh key={`f-${i}`} position={p}>
          <sphereGeometry args={[0.35 + ((i * 13) % 7) * 0.06, 6, 6]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? "#ECEEF5" : "#9DA0AC"}
            transparent
            opacity={0.20 + ((i * 17) % 5) * 0.05}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* Hero stars — bigger, twinkle, breath with the sphere. */}
      <group ref={heroGroup}>
        {HERO_POSITIONS.map((p, i) => {
          const phase = (i * 1.37) % (Math.PI * 2);
          return (
            <HeroStar key={`h-${i}`} position={p} phase={phase} />
          );
        })}
      </group>
    </group>
  );
}

function HeroStar({ position, phase }: { position: THREE.Vector3; phase: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const t = performance.now() / 1000;
    const tw = 1 + 0.30 * Math.sin(t * 1.5 + phase);
    group.current.scale.setScalar(tw);
  });
  return (
    <group ref={group} position={position}>
      <mesh>
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshBasicMaterial color="#ECEEF5" transparent opacity={0.75} depthWrite={false} />
      </mesh>
      {/* faint corona — same color, slightly larger, much dimmer */}
      <mesh>
        <sphereGeometry args={[0.18, 6, 6]} />
        <meshBasicMaterial color="#ECEEF5" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}
