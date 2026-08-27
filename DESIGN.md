# My2ndBrain — Design System & Art Direction

> **Status**: Phase 1 (Art Direction & Design System).
> **Rule**: this document is the SINGLE visual spec. All future UI work
> (component refactor, page redesign, motion polish) MUST refer back to
> this file. Do not introduce new colours / spacings / motion timings
> outside of it.
> **Last verified against**: HEAD `da150e7` on `dev` (no code changes
> yet — only this document).

---

## 0. How to read this document

- §1 — what is wrong with the current UI (concrete bug list).
- §2 — three visual directions, with the recommendation.
- §3 — Design System tokens (colour, type, space, surface, shadow, motion, interaction).
- §4 — Knowledge Sphere Design (geometry, material, lighting, atmosphere, nodes, edges).
- §5 — Technical Plan (what to refactor vs. keep in the current stack).
- §6 — Implementation guardrails (anti-patterns you MUST NOT introduce).

---

## 1. Current UI Analysis

### 1.1 Where My2ndBrain stands today

- **Frontend stack**: React 19 + Three.js 0.185 + `@react-three/fiber` 9 + `@react-three/drei` 10 + Vite 8 + TypeScript 5. All 3D lives in `frontend/src/components/KnowledgeSphere.tsx` (408 lines). 2D shell is `App.tsx` + `styles.css` (~1860 lines).
- **Visual identity already present**: dark palette (`--bg-0 #000000`), Apple SF stack, accent blue `#0a84ff`, tech violet `#7c5cff`, hairline surfaces — these are good bones, but **they are assembled into a generic "AI dashboard"** rather than a *spatial celestial object*.

### 1.2 Concrete problems with the current UI

| # | Problem | Where | Why it fails the brief |
|---|---------|-------|------------------------|
| 1 | **Sphere has no light/dark structure**. It is a solid black inner sphere (`#0b0b0e`, opacity 0.92) with a faint wireframe shell on top. The lighting is **flat**: ambient 0.6 + three point lights at 1.1/0.8/0.5 intensity, all pointed AT the sphere from the camera side. There is **no terminator, no clear shadow, no depth gradient** — the planet reads as a flat dark disc with dots. | `KnowledgeSphere.tsx` L378–382, L304–340 | Violates "Highlight → Midtone → Terminator → Shadow" requirement. |
| 2 | **All nodes are roughly the same size** (0.12–0.55) and use `meshPhysicalMaterial` with `clearcoat: 0.6, clearcoatRoughness: 0.1` — every node looks like a wet plastic marble regardless of `importance` or `cluster`. | `KnowledgeSphere.tsx` L215, L266–276 | Violates "important = larger + brighter, weak = smaller + dimmer + further" requirement. |
| 3 | **Edge colour is purple `#7c5cff` / `#9d7bff`** — that's the exact "purple + blue AI gradient" the brief forbids. Highlight colour is `#ffd166` (Apple systemYellow) — fine, but it's the only warm accent and competes with the violet rather than supporting a single warm key light. | `KnowledgeSphere.tsx` L122–126, L143–145 | Banned anti-pattern. |
| 4 | **220 stars around the sphere are tiny white dots** (`sphereGeometry args=[0.02]`). They have no twinkle, no depth variation, no parallax — they read as a uniform white noise shell. | `KnowledgeSphere.tsx` L354–366 | Feels cheap; should be a sparse, parallaxed starfield with a few hero stars. |
| 5 | **`meshPhysicalMaterial` with `clearcoat` on every node** plus `metalness: 0.4` makes 4 nodes look like 4 glass beads. It says "stock 3D demo" not "knowledge atoms". | `KnowledgeSphere.tsx` L266–276 | Wrong material register. |
| 6 | **Background CSS gradient on `<body>`**: `radial-gradient(ellipse at 50% -20%, rgba(10, 132, 255, 0.15))` + violet at the bottom — **the exact purple+blue AI wash the brief bans**. | `styles.css` L69–71 | Must be replaced with a layered deep-near-black gradient with no purple. |
| 7 | **Top bar**: 52px translucent strip with hairline + `backdrop-filter: blur(20px)`. Looks like a SaaS dashboard header. Brand dot has `box-shadow: 0 0 8px var(--violet-soft)` — that glow is exactly the "everything glows" anti-pattern. | `styles.css` L99–124 | The brief says "UI panels should retreat to second plane; sidebar/card should not steal focus". |
| 8 | **Stats pill (Nodes / Edges / Clusters)** is bright white on dark, sitting right of the search box — it competes with the sphere for attention. | `App.tsx` L284–288, `styles.css` L284–302 | Reads as a SaaS dashboard widget. |
| 9 | **Auto-spin** runs at `dt * 0.06` (≈ 3.4°/s). That's roughly a full rotation every 105 s — pleasant, but combined with no parallax and no terminator the sphere looks like it's just *spinning a wireframe* rather than a body floating in space. | `KnowledgeSphere.tsx` L322–326 | Speed is fine; what the user *feels* is wrong because of #1, #4, #5. |
| 10 | **Hover behaviour** is correct (faded non-neighbours, halo ring) but the visual is busy — three overlapping translucent spheres + emissive boost + a glow ring all change at once. The brief says "natural, slow, precise, subtle". | `KnowledgeSphere.tsx` L231–296 | Reduce to ONE feedback channel per state. |
| 11 | **FAB cluster** uses 3 round buttons with hover-glow (`border-color: var(--accent)` + `box-shadow`). The "look at the chat panel" emoji `🧠` is in the topbar. | `App.tsx` L312–323, styles.css FAB block | Emoji + glow → "AI demo" look. |
| 12 | **Brand** says "MY SECOND BRAIN · My Second Brain · 第二大脑" — two languages stacked. Good, but the dot's glow is the giveaway that this is AI-themed styling. | `styles.css` L120–124 | Glow is a flag. Drop it. |

### 1.3 What's already good (keep these)

- Dark colour palette base (black / near-black surfaces).
- SF Pro system font stack — already in `styles.css`.
- Hairline borders + low-opacity panel surfaces (the brief approves these).
- Functional IA: topbar → search → category filter → stats → canvas → side panel → FAB.
- Auto-pause-on-select, then resume after close (good UX).
- One-shot node select via click OR right-click (covers both desktop conventions).
- Status bar: "Nodes / Edges / Clusters" is useful information density — but the *visual treatment* is what to fix.

---

## 2. Three Visual Directions

I considered three readings of the brief. They differ in how **celestial** the sphere feels and how **invisible** the chrome feels.

### Direction A — "Cold observatory"

- **Idea**: deep-space telescope UI. Sphere reads like a planet seen through a low-light eyepiece. UI chrome is genuinely *invisible* — no borders, no pills, no shadows; just monospaced readout text overlaid on the canvas at 8 % opacity.
- **Pros**: maximum "spatial computing" feel; minimalism dial = 10/10; treats the sphere as the only real surface.
- **Cons**: information density collapses. New users can't find search / FAB / assistant. Stats become illegible. Hard to localise in zh-CN. The brief explicitly says UI panels should retreat to "second plane" — not vanish.

### Direction B — "Editorial celestial" ✅ recommended

- **Idea**: the sphere is a planet; the UI is a *museum label* — quiet, serif-free, monospaced or tabular-numerals, hairline rules, no glow, no shadow. Think a Sotheby's catalogue facing a glass case containing a celestial object. Apple-level polish, but the chrome is so restrained it disappears in the user's peripheral vision.
- **Pros**: matches every constraint in the brief (Apple + spatial + minimal + no neon + no glassmorphism excess). Information is still findable. Works in zh-CN. Survives mobile (the chrome has very few elements).
- **Cons**: requires careful token discipline — one wrong opacity ramp and it tips into "SaaS dashboard" again.

### Direction C — "Editorial celestial + warm single key light"

- Same as Direction B, but with a deliberate warm rim/key accent — a single amber-orange highlight on the sphere's terminator and on a thin "now editing" status line. This adds the "alive" feel the brief asks for (the sphere should feel like it's growing).
- **Pros**: the most distinctive. Evokes Renaissance chiaroscuro applied to space.
- **Cons**: warm + cool palettes need very careful balancing; if the warm accent shows up in more than 3 places on screen it stops feeling subtle and starts feeling branded.

### 2.1 Recommendation

**Direction B** is the base. **Direction C's warm single-key-light idea is added on top** but **only on the sphere itself and one or two status micro-text lines** (never on chrome). This combination is what gives the sphere "alive, growing" without leaking warm colour into the dashboard chrome.

---

## 3. Design System

### 3.1 Colour

Background is a layered deep-near-black. **No purple. No blue glow. No glassmorphism saturation.**

```css
:root {
  /* —— Surface (Layered deep-space black) —— */
  --bg-void:       #050608;   /* canvas clear colour (one notch lighter than 000 so the vignette reads) */
  --bg-0:          #08090C;   /* page background; cool charcoal, NOT pure black */
  --bg-1:          #0E1015;   /* raised surface (panels, modal sheets) */
  --bg-2:          #161922;   /* hover / selected panel */
  --bg-3:          #1E2230;   /* input / chip surface */

  /* —— Hairline —— */
  --line:          rgba(232, 234, 246, 0.06);   /* rest state */
  --line-strong:   rgba(232, 234, 246, 0.10);   /* hovered / focused */
  --hairline:      rgba(232, 234, 246, 0.04);   /* divider between same-tone panels */

  /* —— Type —— */
  --text-0:        #ECEEF5;   /* primary, paper-on-ink (slightly cool) */
  --text-1:        #9DA0AC;   /* secondary */
  --text-2:        #5C606E;   /* tertiary / placeholder */
  --text-inverse:  #0B0C10;   /* text on light surfaces (we don't use those — kept for parity) */

  /* —— Accent (cool white primary; warm amber is reserved for the sphere) —— */
  --accent:        #E5E7EE;   /* primary accent = COOL WHITE, not blue */
  --accent-soft:   rgba(229, 231, 238, 0.65);
  --accent-faint:  rgba(229, 231, 238, 0.18);
  --accent-press:   #C9CCD6;

  /* —— Warm key light (sphere only) —— */
  --warm-key:      #F3C892;   /* the *single* warm colour in the system */
  --warm-key-soft: rgba(243, 200, 146, 0.30);

  /* —— Semantic (rare; only when state matters) —— */
  --warn:          #E0B341;
  --danger:        #C0524C;
  --ok:            #6B9A78;
}
```

Notes:
- **No `--violet`, no `--cyan`, no Apple systemBlue.** The previous `--accent #0a84ff` and `--violet #7c5cff` are **deleted**, not "softened".
- All `bg-*` surfaces are **slightly cool** (blue undertone ≤ 5 %) — this is what makes "warm key light on sphere" feel like a real sunset on a real planet. If the surface were neutral grey, a warm rim would feel yellow-and-stuck-on.
- `--warm-key` is the **only** warm colour in the entire system. It is allowed on:
  - the sphere's terminator highlight (sub-surface scattering + emissive at the hot spot),
  - the **single selected node's halo** when a node is being inspected,
  - the **draft-in-progress dot** in the FAB cluster.
  It is **never** used on buttons, tabs, headers, badges, or background gradients.

### 3.2 Typography

Keep the existing SF stack; widen it with one additional weight:

```css
--font-sans:  -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
               "Helvetica Neue", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono:  "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;

/* Use tabular-nums for any digit string — distances, counts, time */
.tabular { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
```

| Role | Size | Weight | Tracking | Notes |
|------|------|--------|----------|-------|
| Display (the "MY SECOND BRAIN" wordmark) | 13 px | 600 | +0.18em uppercase | SF Pro Display, uppercase, letterspacing +0.18em. Currently 0.08em — too tight. |
| Body | 14 px | 400 | 0 | SF Pro Text |
| Label | 11 px | 500 | +0.10em uppercase | `BRAND SUBTITLE`, `FILTER`, `STATUS` |
| Numeric | 12 px | 500 | 0 + tabular | Stats (Nodes/Edges/Clusters), counts |
| Mono (logs) | 12 px | 400 | 0 | `SF Mono` for log lines, debug |

**Min body size = 12 px** (no smaller text — don't violate accessibility on top of an OLED dark UI).

### 3.3 Spacing

Keep the 8 px grid; tighten the inner ladder:

```css
--space-0:  2px;
--space-1:  4px;
--space-2:  8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;
--space-9: 96px;   /* "vast whitespace" — top/bottom of sphere section */
```

### 3.4 Surface

Surfaces are **invisible** by default — they exist by their *position*, not their *fill*.

| Surface | Fill | Border | Shadow | Use |
|---------|------|--------|--------|-----|
| **Page** | `bg-0` solid | none | none | behind everything |
| **Canvas** | `bg-void` clear colour | none | none | inside `<Canvas>` |
| **Top bar** | `bg-0` solid | bottom `line-strong` (1 px) | none | the only chrome with a visible bottom edge |
| **Floating panel** (assistant, side panel) | `bg-1` solid | `line-strong` (1 px) | **none** | panel feels attached, not lifted |
| **Modal sheet** (Add / Import / Export / Detail) | `bg-1` solid | `line-strong` (1 px) | `0 1px 0 rgba(0,0,0,.6)` — a 1 px hard inner edge, **no glow** | reads as a physical surface |
| **Input** | `bg-3` solid | `line` (1 px), `line-strong` on focus | none | |
| **Chip / pill** | `bg-2` solid | `line` (1 px) | none | used for category filter, lang toggle |

**Forbidden surfaces**: cards with `box-shadow: 0 20px 40px -20px rgba(0,0,0,.6)`, anything with `backdrop-filter: blur` *plus* a saturated tint, anything with `linear-gradient(45deg, ...)` on a chrome element. These are the three places where the old styles.css crossed the line.

### 3.5 Shadow

Shadows are **rare** and **physical**, never glow.

- `var(--shadow-pop)`: `0 1px 0 rgba(0,0,0,.6) inset` — used on modal sheets to give them a physical edge. No outer shadow.
- That's it. No other shadow tokens.

### 3.6 Lighting (for the 3D sphere)

See §4. The 3D lighting model is defined there; the design tokens above are 2D-only.

### 3.7 Motion

All durations follow **ease-out cubic**, never `linear`, never `ease-in-out`. Most durations are **slow on purpose**.

```css
--dur-instant:  120ms;   /* hover color, button press */
--dur-quick:    240ms;   /* tooltip appear, tab switch */
--dur-base:     420ms;   /* panel slide-in, modal open */
--dur-deliberate: 800ms; /* sphere hover scale, halo ring bloom */
--dur-cinematic:   1400ms; /* first-load sphere bloom, parallax settle */
--dur-orbit:       32000ms; /* one full slow auto-rotation */

--ease-out-cubic:   cubic-bezier(0.22, 0.61, 0.36, 1);
--ease-out-quart:   cubic-bezier(0.165, 0.84, 0.44, 1);  /* for sphere / halo */
--ease-in-soft:     cubic-bezier(0.4, 0, 0.2, 1);       /* for "closing" states only */
```

Rules:
- Sphere hover → node scale: `--dur-deliberate` with `--ease-out-quart`. No bounce, no spring.
- Halo ring bloom: same as hover.
- Modal sheet: `--dur-base` with `--ease-out-cubic`.
- Auto-rotation: `--dur-orbit` (≈ 32 s per full revolution → ≈ 11°/s, slower than current 3.4°/s → no, 11°/s is **faster**; the brief asks for slow; we use **80 s / revolution → 4.5°/s**, half a rotation in 40 s — feels like a body, not a screen-saver).
- All motion respects `prefers-reduced-motion: reduce`. When reduced, sphere stops auto-rotating, parallax freezes, hover transitions drop to `--dur-quick` or instant.

### 3.8 Interaction

| Interaction | Feedback |
|-------------|----------|
| Hover node (3D) | node `shellScale` 1.0 → 1.20 over `--dur-deliberate`; node `emissiveIntensity` × 1.15; halo ring opacity 0 → 0.18. **Only one** channel changes scale — no extra emissive jump. |
| Hover node → neighbours | non-neighbour nodes fade to opacity 0.18 (was 0.22) over `--dur-deliberate`. Edges connecting hovered node brighten from 0.55 → 0.85 over the same window. The **sphere** itself does **not** pulse. |
| Click node | Pause auto-spin (already done). Selected node `shellScale` 1.0 → 1.45. Side panel slides in `--dur-base`. |
| Click empty space | Side panel closes; auto-spin resumes after 600 ms (already done). |
| Search match | matched nodes `shellScale` × 1.25, unmatched fade to 0.18. (Match current behaviour, no animation duration change.) |
| Hover button / chip | background → `--bg-2` over `--dur-instant`; text → `--text-0`. **No border glow. No box-shadow.** |
| Click primary action | scale 1.0 → 0.97 → 1.0, total 120 ms, no opacity flicker. |
| Modal open | opacity 0 → 1, translateY +8 px → 0, over `--dur-base`. **No backdrop blur with colour tint.** Just `rgba(5,6,8,0.72)` overlay. |

### 3.9 Iconography

- All icons are **inline SVG**, stroke 1 px, sized 14 / 16 / 20 px.
- No emoji in chrome. The `🧠 / 🔍 / ⬆ / ⬇ / ＋` characters become SVG icons.
- Search icon = a thin circle with a 45°-angled short line.
- Lang toggle = two short horizontal bars (≡).

### 3.10 Layout grid

- 12-column desktop, 24 px gutters, 96 px outer margin.
- 8-column tablet (768–1023 px), 16 px gutters.
- 4-column mobile (375–767 px), 16 px gutters, but the 3D canvas becomes a static hero image at this size (the sphere is desktop-only; mobile gets a portrait card list of nodes + a "view in browser" prompt to rotate the device).

---

## 4. Knowledge Sphere Design

### 4.1 Geometry

- **Outer shell**: an `IcosahedronGeometry(5, 6)` (subdivision 6 → ~7680 faces) is a good base for a sphere that can carry per-vertex displacement without ugly faceting. We keep the current 48 × 32 segments as the **physical outline** and add a low-poly internal mesh only if we want bump maps.
- **Why IcosahedronGeometry, not SphereGeometry**: SphereGeometry has ugly pole pinching at the top/bottom that you can never fully hide with bump maps. Icosahedron has even vertex distribution.
- **Radius**: 5 (keep current).
- **Background**: `gl-clear-color = #050608` (set via `<color attach="background">`).

### 4.2 Material — the planet body

We replace the current opaque black sphere + wireframe shell with **two physical surfaces**:

```ts
// Outer planet shell — full sphere, PBR
<mesh>
  <icosahedronGeometry args={[RADIUS, 6]} />
  <meshStandardMaterial
    color="#0E1015"
    roughness={0.72}
    metalness={0.05}
    flatShading={false}
  />
</mesh>

// Atmospheric back-haze — slightly larger sphere, additive blend
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
```

Why two:
- The outer shell is what catches lighting → terminator → shadow come from this mesh.
- The inner back-haze is **purely additive** at BackSide, no lighting. It gives the sphere a **visible silhouette against the deep background** even in the unlit half. This is what makes it feel like a *celestial object* and not a *chrome ball*.

We **delete** the current `meshBasicMaterial color="#1a1a1c" wireframe` (L333) and `meshBasicMaterial color="#0b0b0e"` (L337). Wireframe is a debug indicator, not a production look.

### 4.3 Lighting (the brief's main requirement)

```ts
// 1. Main directional light — top-front-left, cool white
<directionalLight
  position={[-7, 6, 7]}     /* left-above-front, distance irrelevant for directional */
  intensity={1.1}
  color="#ECEEF5"          /* cool white, matches --text-0 */
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

// 2. Fill — opposite side, very dim, slightly cooler (no warm tint)
<directionalLight
  position={[6, -2, -5]}
  intensity={0.18}
  color="#9DA0AC"          /* matches --text-1 — gives shadows detail */
/>

// 3. Rim light — back-light, single warm key (the only warm light in the scene)
<directionalLight
  position={[5, 1, -8]}    /* behind, slightly to the right */
  intensity={0.45}
  color="#F3C892"          /* --warm-key — the planet's rim catches the same sunset */
  target={sphereCenterRef}
/>

// 4. Ambient — extremely weak, just enough to keep shadow side non-black
<ambientLight intensity={0.10} color="#0B0C10" />
```

Why this combination:

- **Main + ambient** satisfy the rule "any PBR scene needs ambient + directional or it renders black".
- **Main intensity 1.1** is deliberately strong so the terminator is visible. The fill at 0.18 doesn't kill the contrast.
- **Rim light is warm, not the same hue as the main light** — that's the key trick from cinematic product photography. The sphere's hot side reads as cool moonlight, the back rim reads as a warm sunset coming from somewhere else. This single warm rim makes the planet feel *real*, not just lit.
- **Shadow map** is enabled because the brief says "shadow". A small but real drop shadow under the sphere (received by a hidden disc at y = -RADIUS * 1.05) makes the planet look like it's hovering above a floor. **Floor disc**: `<mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -5.1, 0]} receiveShadow><circleGeometry args={[10, 64]} /><meshStandardMaterial color="#0B0C10" roughness={1} /></mesh>`

### 4.4 Atmosphere

The brief says "almost imperceptible but elevates space". We add **two layers**:

1. **Back-haze sphere** (already shown in §4.2) — `BackSide` + additive + 1.025 × radius. This is the *silhouette glow* without the word "glow".
2. **Outer rim fresnel** — a fragment-shader pass on a third sphere (`RADIUS * 1.04`) that adds a *cool-white* halo where viewDir·normal approaches 0 (i.e. where the surface is parallel to the camera). This is the *atmosphere*. Implementation:

```glsl
// In a custom ShaderMaterial on the atmosphere mesh:
varying vec3 vNormal;
varying vec3 vViewDir;
uniform vec3 uRimColor;   // "#3C5066" — a desaturated cool blue
void main() {
  float fresnel = pow(1.0 - dot(normalize(vNormal), normalize(vViewDir)), 3.0);
  float alpha = fresnel * 0.35;   // very subtle
  gl_FragColor = vec4(uRimColor, alpha);
}
```

`THREE.AdditiveBlending`, `depthWrite: false`. This **only adds light at the silhouette** and is invisible everywhere else — exactly what the brief asked for.

### 4.5 Knowledge Nodes

**Sizes, brightness, depth are now derived from node properties**, not constants:

```ts
// Per-node radius: importance in [0, 1] → radius in [0.08, 0.32]
const r = 0.08 + 0.24 * Math.pow(n.importance ?? 0.5, 0.7);

// Per-node outward "depth": important nodes sit slightly forward
// (closer to camera), weak nodes sit slightly recessed
const SURFACE_LIFT = (n.importance ?? 0.5) * 0.18 - 0.05;
position={sphereSurfacePos(n).multiplyScalar(RADIUS + SURFACE_LIFT)}

// Per-node opacity: important nodes are 1.0, weak nodes are 0.45
const opacity = 0.45 + 0.55 * Math.pow(n.importance ?? 0.5, 0.7);

// Per-node emissive intensity: weak nodes stay matte, important nodes glow softly
const emissive = 0.18 * Math.pow(n.importance ?? 0.5, 1.5);

// Per-node material: drop clearcoat + metalness on every node;
// the colour stays neutral, the node surface is matte ceramic
<meshStandardMaterial
  color={nColor}            // hue comes from cluster_color
  emissive={nColor}
  emissiveIntensity={emissive}
  roughness={0.55}
  metalness={0.0}
  transparent
  opacity={opacity}
/>
```

Rules:
- **Selected node** is the **only** node that gets the warm `--warm-key` halo. Not the warm rim, not the warm emissive — just the halo, and only when selected.
- **Drop the inner bright core sphere** (the small white ball inside each node). With proper lighting on a PBR sphere, the highlight is in the material; layering a white sphere inside each node makes them look like marbles. The new look is **a single PBR sphere with a soft falloff**.
- **Hover behaviour**: only `shellScale` and `emissiveIntensity` change. The halo ring is **removed** (the new material + size difference is enough; the halo was busy).

### 4.6 Edges

Edges become **sparse, almost-invisible threads** rather than drawn lines.

```ts
// Edge backdrop: ALL edges, very faint, no per-edge object
<lineSegments geometry={backdropGeom}>
  <lineBasicMaterial color="#5C606E" transparent opacity={0.12} />
</lineSegments>

// Edge highlight (only for hovered / selected)
{e.isSel || e.isHover ? (
  <lineSegments geometry={geom}>
    <lineBasicMaterial color="#ECEEF5" transparent opacity={0.75} />
  </lineSegments>
) : null}
```

Why: today's edges are visible *all the time* (opacity 0.55), which means the sphere looks like a tangle of yarn even at rest. The new behaviour shows edges only when they carry meaning. The base colour drops from violet `#9d7bff` → cool grey `#5C606E` to remove the AI-purple signal.

### 4.7 Starfield

Replace the 220 evenly-distributed white spheres with **two layers**:

```ts
// Layer 1 — many faint points (parallaxed on z-axis by mouse, very small)
const many = 600;
for (let i = 0; i < many; i++) {
  const phi = Math.acos(2 * ((i + 0.5) / many) - 1);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  // ... same Fibonacci-sphere pattern, but use:
  //   - radius in [40, 80] (much further out)
  //   - size in [0.3, 0.8] (tiny)
  //   - opacity in [0.15, 0.45]
  //   - color in ["#ECEEF5", "#9DA0AC"] — only the cool palette
}

// Layer 2 — a handful of HERO stars (12 stars, slightly bigger, twinkle)
for (let i = 0; i < 12; i++) {
  // size in [1.2, 2.0], opacity 0.7, with a subtle sine-wave twinkle
  // (1 + 0.3 * sin(t * speed + phase))
  // placed on a different fibonacci distribution, larger radius (60-90)
}
```

The hero stars are what give the sphere a sense of *being in space*. Don't overdo it — 12 is enough.

### 4.8 Camera & Motion

```ts
camera: { position: [0, 1.6, 14], fov: 50, near: 0.1, far: 200 }

// Auto-rotation: 80 s per revolution (~4.5°/s)
group.current.rotation.y += dt * (Math.PI * 2 / 80);

// Subtle mouse parallax: when mouse is in the centre, camera looks at origin;
// when mouse is at the edge, camera drifts ±0.6 units on x and y
useFrame((_, dt) => {
  // mouse parallax target — smooth lerp toward target
  camera.position.x = lerp(camera.position.x, targetX, 0.05);
  camera.position.y = lerp(camera.position.y, targetY, 0.05);
  camera.lookAt(0, 0, 0);
});

// Reduce OrbitControls' rotateSpeed even further so a user has to
// *intentionally* drag — the planet should feel heavy.
rotateSpeed: 0.3   // was 0.6
minDistance: 9     // was 7
maxDistance: 22    // was 28
```

### 4.9 Bloom / Post-processing

**None.** This is the most important rule in this section. The brief explicitly bans "purple-blue glow", "满屏发光", "Dribbble炫技". A sphere lit by directional + rim + ambient + atmospheric fresnel is already glowy enough; adding a Bloom post-process will turn it back into the rejected AI look.

If we later need a single subtle effect, use `<EffectComposer>` with `Noise` (very low amount, 0.02) to break up solid black — that's it. No Bloom, no ChromaticAberration, no Vignette beyond what `<color attach="background">` already gives.

---

## 5. Technical Plan

### 5.1 Is the current stack good?

**Yes**, with two caveats.

- **React Three Fiber 9 + drei 10 + three 0.185** is current and well-supported.
- **Performance** on the current 4-node graph is fine; the existing `useMemo` discipline for edges and stars is good. We keep it.
- **Caveat 1**: `OrbitControls` uses `enableDamping` — that's fine but the new `rotateSpeed: 0.3` should be paired with `dampingFactor: 0.12` so the planet feels weightier when released.
- **Caveat 2**: `EffectComposer` is not currently in the bundle. We will NOT add it in Phase 1; we keep zero post-processing.

### 5.2 What changes in the codebase (Phase 2 plan, NOT for this commit)

Phase 2 — code refactor — should land in **a single atomic commit** with these surgical edits:

| File | Change | Risk |
|------|--------|------|
| `KnowledgeSphere.tsx` | Replace `meshBasicMaterial` wireframe + inner sphere with the two-mesh planet + back-haze + atmosphere in §4.2. Replace lighting block with §4.3. Replace node material with §4.5. Remove the halo ring. Replace starfield with §4.7. Replace `wireframe` shell with the shadow-receiving floor disc. | High — this is the visual center of the app. **Do this in a single commit with a side-by-side screen recording** (canvas screenshots before/after) so regressions are obvious. |
| `KnowledgeSphere.tsx` | Drop `clearcoat: 0.6, clearcoatRoughness: 0.1, metalness: 0.4` everywhere. Drop `MeshPhysicalMaterial` → `MeshStandardMaterial` for nodes. | Low. |
| `KnowledgeSphere.tsx` | Edge colours: backdrop `#5C606E` opacity 0.12, highlight `#ECEEF5` opacity 0.75. Drop violet. | Low. |
| `KnowledgeSphere.tsx` | Auto-rotation 80 s/rev; rotateSpeed 0.3; min/maxDistance 9/22. | Low. |
| `KnowledgeSphere.tsx` | `<color attach="background" args={["#050608"]} />` (was `"#000000"`). | Trivial. |
| `KnowledgeSphere.tsx` | Per-node radius/opacity/emissive derived from `n.importance`. | Low. |
| `App.tsx` | Replace `🧠` emoji with an inline SVG. Add `prefers-reduced-motion` listener that pauses auto-spin and reduces hover durations. | Low. |
| `styles.css` | Replace `:root` colour tokens with §3.1. Replace body gradient with `radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.03), transparent 70%), radial-gradient(ellipse at 50% 100%, rgba(20,30,45,0.50), transparent 60%), var(--bg-0)`. Drop `backdrop-filter: blur` from topbar (or keep it but at 4 px, not 20 px — and never with colour tint). Drop glow on brand dot. | Medium — touches many surfaces. |
| `styles.css` | Drop `box-shadow` from `.fab-cluster`, `.fab`. Use simple bg + border. | Low. |
| `styles.css` | Add CSS for the new `var(--space-*)` tokens (drop the old `xxs/xs/sm/md/lg/xl/xxl/section` names in favour of `space-0..9`). | Mechanical rename. |
| `package.json` | No new deps. Optionally add `@react-three/postprocessing` *only if* Phase 3 needs it. | — |

### 5.3 What we keep unchanged

- `App.tsx` IA, search dropdown, category filter, FAB cluster positions.
- `AssistantPanel.tsx`, `NodeDetail.tsx`, `AddNodeModal.tsx`, `ImportModal.tsx`, `ExportModal.tsx` — these get touched in **Phase 3** (polish), not in Phase 2.
- Backend, Docker packaging, scripts.

### 5.4 Validation criteria before merging Phase 2

- All 10 bash scripts pass `bash -n`.
- `tsc -b` produces 0 errors.
- `vite build` succeeds.
- Existing 4 user nodes still visible after refactor (screenshot diff).
- `my2ndbrain-prod` container healthy, `/api/health` 200.
- `prefers-reduced-motion: reduce` test: sphere stops auto-rotating.

---

## 6. Implementation Guardrails (anti-patterns you must NOT introduce)

These are the exact failures the brief calls out. If a future commit touches any of them, **revert**.

- ❌ **No purple, no violet, no Apple systemBlue**. The accent is **cool white** `#ECEEF5`. Re-introducing purple anywhere — even as a hover colour — is a regression.
- ❌ **No `box-shadow: 0 0 Npx ...` glows** on UI chrome. Glows are reserved for the sphere's atmospheric layer (and even there it's a fresnel, not a glow).
- ❌ **No `backdrop-filter: blur(NNpx)` with colour tint**. A pure blur is fine for the topbar's `saturate(180%) blur(20px)` (we drop the blur to 4 px); a tinted blur is the "purply glassmorphism" anti-pattern.
- ❌ **No emoji as icon** in chrome. SVG only.
- ❌ **No `linear-gradient(45deg, …)` on chrome** (the category-filter chevron uses a small gradient arrow — that stays as a *single* gradient on a *single* 5×5 px arrow, not on a button). No full-element gradients.
- ❌ **No `position: absolute; inset: 0` panels over the canvas with backdrop-blur**. The assistant panel is now a *side panel* that pushes the canvas, not an overlay.
- ❌ **No EffectComposer Bloom** until Phase 3 explicitly authorises it.
- ❌ **No more than one place uses `--warm-key`**. If a second place needs warm, use `--accent` (cool white) instead.
- ❌ **No bigger node font-size than 16 px**, no body smaller than 12 px.
- ❌ **No "spring" easing for the sphere**. `--ease-out-quart` only.

---

## 7. Out of scope (Phase 3 and beyond)

These are deliberately **not** in Phase 1:

- Polish for `AssistantPanel.tsx` (chat-style AskTab already exists; needs token refresh only).
- Polish for `NodeDetail.tsx`, `AddNodeModal.tsx`, `ImportModal.tsx`, `ExportModal.tsx`.
- Mobile portrait mode (the brief explicitly says desktop-first).
- Internationalisation refinements (current `i18n/` works; Phase 3 may add line-height per script).
- New soundscapes / audio (the brief says "no Loaderspinner vibe" — no audio either).
- Backend changes.

---

## 8. Sign-off

Phase 1 deliverable: **this document**. No code changes in this commit.

Phase 2 (code) is gated on:
1. User reads this document and confirms **Direction B + warm rim accent on sphere only** (§2.1).
2. User agrees with **§3 Design System tokens**.
3. User agrees with **§4 Knowledge Sphere lighting + material** (the two-sphere PBR + back-haze + atmospheric fresnel).
4. User agrees with **§5.2 surgical edits** list.

After sign-off, Phase 2 lands as one commit (or two: lighting first, then chrome) with the validation criteria from §5.4.
