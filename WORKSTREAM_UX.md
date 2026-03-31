# Spectra Workspace: Vision, Approaches & Implementation Plan

> "The workspace should feel like it makes you productive. It combines everything together in one place. It doesn't have a steep learning curve — it's just intuitive and easy to learn. Yet SO POWERFUL: guided by AI."

---

## Part I: The Problem Today

The workspace has the right bones — a zoomable canvas, workstreams as spatial objects, a command bar, right panels, an editor with AI. But the experience betrays the vision at every turn:

### Navigation is hostile
- **Accidental commitment**: A tiny scroll flick triggers workstream entry. The zoom threshold (1.7x) is too close to the default view (0.9x), and the 400ms debounce isn't enough to prevent drive-by commits. Users enter workspaces by accident, then struggle to leave.
- **Exit is a maze**: Pressing "Workspace" to go back sometimes overshoots through the hub. The zoom restore (400ms, target 0.9) fights the user's own scroll momentum. Exiting one context and entering another happens unintentionally.
- **Cards are microscopic**: At max zoom-out (0.24x), workstream cards collapse to pill-sized objects. The auto-layout radius (750px for active) creates a tight cluster that looks like a button group, not a spatial world.
- **No centering**: Entering the workspace page or a workstream doesn't center the viewport on the content. You land zoomed-in on an arbitrary region, seeing partial cards off-screen.

### Content is untrustworthy
- **Wrong counts**: `threadCount` and `artifactCount` on cards show stale or zero values because the tracking functions use full-table scans that often fail silently.
- **Blue hover glitch**: A 2px gradient stripe appears at the top of cards on hover — looks like a selection bug, not a design element.
- **Overlapping internal nodes**: When entering a workstream, content nodes sometimes overlap because `buildStructuredNodes` doesn't account for varying content heights.

### Panels lack coherence
- **No fly animation**: The right panel slides in with a basic width expansion. There's no sense of the content "traveling" from the canvas to the panel. Opening a thread should feel like pulling it out of the workstream.
- **Artifacts missing AI**: The artifact/document panel has an AI bar at the top, but it should match the thread panel's bottom-mounted chat pattern. Version history works in the full page but not in the panel.
- **Panel switching breaks**: Going from a thread panel to an artifact panel can show "not found" errors because the content component doesn't reset state on ID change.

### Creation is friction
- **"New" only creates workstreams**: The primary creation button doesn't offer documents, threads, or artifacts.
- **Right-click is hidden knowledge**: The context menu exists but users don't discover it. When they do, items are created but positioned poorly.
- **No templates**: Every new artifact starts blank. Students face the blank page problem every time.

### The deeper issue
The workspace feels like a tech demo, not a home. It doesn't make anyone more productive — it adds steps. The AI integration is a sidebar, not the fabric. There's no reason to prefer this over opening ChatGPT in one tab and Google Docs in another.

---

## Part II: Research Foundations

### What the science says

**Spatial memory is real scaffolding.** fMRI research confirms that spatial layouts activate the hippocampal navigation system — the same hardware used for physical space. Students who organize academic work spatially develop "method of loci" recall: "Biology is top-right, Math is center-left." This spatial knowledge reduces cognitive load over time, but only if positions are **stable and user-controlled** (Nielsen Norman Group). Our auto-layout must be a starting suggestion, not a constant rearrangement.

**Context switching is devastating.** It takes 23 minutes to regain full focus after an interruption (UC Irvine). Employees using 10+ tools face 275 interruptions per day (Microsoft 2025). The antidote: unify work into fewer contexts with clear boundaries. Each workstream should be a sealed focus environment — entering one should suppress everything else.

**Ambient AI beats on-demand AI.** The most effective AI interfaces operate continuously in the background, surfacing relevant information without requiring explicit invocation. Google Workspace's approach: suggest meeting times, auto-prioritize, surface relevant documents — all without the user asking. The AI is a warm presence, not a cold tool.

**Generative UI is the frontier.** Google's A2UI protocol (December 2025) establishes the pattern: AI selects from a catalog of pre-designed widgets rather than generating raw HTML. The AI decides *what* to show, not *how* to render it. This keeps quality high while enabling infinite flexibility.

**Calm technology reduces stress.** The 2024-2025 trend toward warm, calm interfaces — earthy tones, subtle noise overlays, muted palettes — reflects research showing that softer interfaces reduce cortisol production during sustained use. Spectra's existing dark theme (`--bg-primary: #13111a`, warm `--text-secondary: #a09598`) already aligns. Motion should serve transitions only, never idle animation.

### What the best products do

| Product | Key Insight for Spectra |
|---------|------------------------|
| **Arc Browser Spaces** | Each context gets its own color theme and resource set. Visual shift signals cognitive mode change. |
| **Heptabase** | Spatial knowledge management — cards on an infinite canvas with connections. The canvas is a *thinking tool*. |
| **tldraw Make Real** | The canvas becomes a conversation with AI. Sketch → AI generates → iterate spatially. |
| **Linear** | Speed as a feature. Keyboard-first. Opinionated defaults reduce decision fatigue. |
| **Obsidian Canvas** | Bidirectional linking between spatial cards. The relationships ARE the value. |
| **Game HUDs** | Information layered by importance: always-visible vitals, on-demand inventory, contextual prompts. |
| **Radial menus (Mass Effect)** | Spatial muscle memory. Users remember "up-left = X" faster than scanning a list. |

---

## Part III: Three Approaches

Each approach addresses the same core problems but with different spatial metaphors and interaction models. All three share common fixes (Section IV) for the current bugs.

---

### Approach A: "The Observatory"
**Metaphor**: A telescope. You orbit your academic universe, then zoom into planets (workstreams) to see their surfaces. The hub is Mission Control — always visible, always grounding you.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│    ┌─────────────────────────────────────────┐      │
│    │                                         │      │
│    │         INFINITE CANVAS                 │      │
│    │                                         │      │
│    │    ┌──────┐        ┌──────┐             │      │
│    │    │Bio HL│════════│Chem  │             │      │
│    │    └──────┘        └──────┘             │      │
│    │         ╲              ╱                │      │
│    │          ╲            ╱                 │      │
│    │        ┌──────┐                        │      │
│    │        │Math  │                        │      │
│    │        └──────┘                        │      │
│    │                                         │      │
│    └─────────────────────────────────────────┘      │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  HUB DOCK: Timer │ Deadlines │ Quick Note │ ⌘K │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**How it works:**

The screen is split into two persistent zones:
1. **Canvas zone** (top 85%): The infinite spatial canvas where workstreams live. Fully pannable, zoomable. Workstreams are large, visually rich cards with real content previews.
2. **Hub dock** (bottom 15%): A persistent, non-scrolling strip that contains your dashboard essentials — focus timer, upcoming deadlines, quick notes, and the AI command bar (⌘K). This strip NEVER moves. It's your cockpit.

**Entering a workstream:**
1. You **click** a workstream card (never scroll-to-enter)
2. The canvas smoothly zooms to center that workstream
3. The card "opens" — it expands to fill most of the canvas zone, revealing internal content (threads, documents, artifacts) as spatial nodes within it
4. Other workstreams fade to low opacity but remain visible at the edges (peripheral awareness)
5. The hub dock adapts: shows the workstream name, a "Back to orbit" button, and the AI bar now scoped to this workstream

**Why this works:**
- The hub dock provides permanent grounding — you always know where you are, what's due, how long you've been working
- Click-only entry eliminates accidental commits
- The canvas zone is purely for spatial exploration; the dock is for productivity tools
- Students develop spatial memory for their "academic solar system"

**Unique element — "Constellation Lines":**
When zoomed out, faint lines connect related workstreams (shared topics, cross-referenced artifacts). These are the "constellation" patterns of your academic universe. AI can suggest new connections: "Your Physics momentum unit connects to your Math calculus workstream — should I create a cross-reference?"

**AI integration:**
- The command bar in the dock is the primary AI surface. It's always accessible, always visible.
- Within a workstream, the AI bar sits at the bottom of the canvas zone (above the dock), scoped to that workstream's context.
- AI-generated artifacts (visualizations, summaries, quizzes) materialize as canvas nodes you can position, resize, and connect.

---

### Approach B: "The Living Desk"
**Metaphor**: A physical desk with drawers. The desk surface is your current focus. The drawers (visible at the edges) contain your other workstreams. Pull one open to switch contexts.

```
┌──────────────────────────────────────────────────────┐
│ ┌─ DRAWER ─┐                          ┌─ DRAWER ─┐  │
│ │ Bio HL   │                          │ History  │  │
│ │ 3 threads│    ACTIVE DESK SURFACE   │ 2 notes  │  │
│ │ 2 docs   │                          │ 1 thread │  │
│ │          │  ┌───────────────────┐   │          │  │
│ │  [open]  │  │   Current Work    │   │  [open]  │  │
│ │          │  │                   │   │          │  │
│ └──────────┘  │  Threads  │ Docs  │   └──────────┘  │
│               │  ┌─────┐  │ ┌───┐ │                  │
│               │  │Chat1│  │ │N1 │ │                  │
│ ┌─ DRAWER ─┐ │  │Chat2│  │ │N2 │ │  ┌─ DRAWER ─┐   │
│ │ Math HL  │ │  │Chat3│  │ │N3 │ │  │ Chemistry│   │
│ │ 5 threads│ │  └─────┘  │ └───┘ │  │ 4 threads│   │
│ │ 1 doc    │ │           │       │  │ 3 docs   │   │
│ │          │ └───────────────────┘  │          │   │
│ │  [open]  │                        │  [open]  │   │
│ └──────────┘                        └──────────┘   │
│                                                     │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│  │ ⌘K  Ask AI anything...          🎯 25:00     │  │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
└──────────────────────────────────────────────────────┘
```

**How it works:**

The screen is divided into:
1. **Active desk** (center, ~65% of screen): Shows the currently focused workstream's content as an organized spatial layout. Not a canvas you zoom into — it's already the content.
2. **Drawers** (edges, ~35% total): Other workstreams appear as compact cards docked to the left/right edges. They show summary info (counts, last activity, status color). Clicking a drawer "opens" it — the current desk slides away, the new one slides in. Dragging a drawer to the center opens it.
3. **Command strip** (bottom): AI bar + timer + quick actions.

**Navigation model:**
- There is NO zooming. You're always at "desk level."
- Switching workstreams is a horizontal slide animation (300ms, spring physics)
- The drawers are always visible — they ARE the overview
- Drag a thread from one drawer to the desk to cross-reference
- The canvas is still spatial within the desk — you can position documents, threads, and artifacts freely

**Why this works:**
- Zero learning curve: it maps to the physical metaphor of a desk with drawers
- No zoom confusion — you can't accidentally enter or exit anything
- Context is always visible at the periphery (spatial memory for "Bio is top-left, Math is bottom-left")
- The desk surface provides focus without isolation

**Unique element — "Desk Widgets":**
AI-generated widgets live on the desk surface alongside your documents and threads. Ask "How am I doing in Biology?" and a progress dashboard widget materializes on your desk. Ask "Create a study schedule for next week" and a timetable widget appears. These aren't chat messages — they're persistent, draggable, interactive canvas objects.

Widget catalog (AI selects from these):
- **Progress tracker**: Ring chart showing completion % with milestones
- **Flashcard stack**: Interactive flip cards, spaced repetition built in
- **Concept map**: Auto-generated from your documents, shows topic relationships
- **Timeline**: Upcoming deadlines with urgency coloring
- **Quick quiz**: AI-generated from recent notes, tests understanding
- **Comparison table**: Side-by-side analysis of concepts
- **Study playlist**: Ordered sequence of documents/activities for a session
- **Formula sheet**: Extracted key formulas/definitions from your notes

**AI integration:**
- The command strip is always present. It detects which desk is active and scopes AI context accordingly.
- When AI creates something, it appears as a widget ON the desk, not in a chat sidebar.
- Widgets are first-class artifacts — they have version history, can be shared, can be edited by AI.
- The AI can rearrange your desk: "Organize my Biology desk by deadline" → AI repositions items.

---

### Approach C: "The Portal Canvas" (Recommended)
**Metaphor**: A map with portals. The canvas IS the world. Workstreams are territories you explore. But the map has a permanent compass rose (the hub) that anchors you no matter how deep you go.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   OVERVIEW (zoomed out)              FOCUSED (clicked in)       │
│                                                                 │
│   ┌─────────────────┐              ┌─────────────────────────┐  │
│   │   ╭─────────╮   │              │                         │  │
│   │   │  BIO HL │   │              │  BIOLOGY HL             │  │
│   │   │ 4t · 2d │───│──┐          │                         │  │
│   │   ╰─────────╯   │  │          │  ┌─Thread─┐ ┌─Doc──┐   │  │
│   │                  │  │          │  │Enzymes │ │Lab   │   │  │
│   │   ╭─────────╮   │  │          │  │12 msgs │ │Report│   │  │
│   │   │  MATH   │───│──┤          │  └────────┘ └──────┘   │  │
│   │   │ 3t · 5d │   │  │          │                         │  │
│   │   ╰─────────╯   │  │          │  ┌─Thread─┐ ┌─Quiz─┐   │  │
│   │                  │  │          │  │Genetics│ │Mock  │   │  │
│   │   ╭─────────╮   │  │          │  │8 msgs  │ │Exam  │   │  │
│   │   │ CHEM SL │───│──┘          │  └────────┘ └──────┘   │  │
│   │   │ 2t · 1d │   │             │                         │  │
│   │   ╰─────────╯   │             │  ┌─Artifact────────┐   │  │
│   │                  │             │  │ AI: Enzyme viz   │   │  │
│   └─────────────────┘             │  │ [interactive]     │   │  │
│                                    │  └──────────────────┘   │  │
│                                    │                         │  │
│                                    └─────────────────────────┘  │
│                                                                 │
│  ┌──── HUB BAR (persistent, always bottom) ──────────────────┐  │
│  │                                                           │  │
│  │  [Bio HL ●] [Math ●] [Chem ●]  │  🎯 25:00  │  Due: 3  │  │
│  │                                 │             │          │  │
│  │         ┌──────────────────────────────────────┐         │  │
│  │         │ ⌘K  Ask anything...     [Bio HL ▾]  │         │  │
│  │         └──────────────────────────────────────┘         │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**The core innovation: Hub as persistent navigation + canvas as spatial exploration.**

The hub is NOT a workstream on the canvas. It's a persistent bar at the bottom of the screen — your control center, always accessible, always showing your vital signs. The canvas above it is purely for workstreams and their content.

**How the canvas works:**

The canvas occupies the top ~82% of the screen. It's an infinite, pannable, zoomable space where workstreams live as large, rich cards. But with critical differences from today:

1. **Scale everything 2.5x**: Cards that are currently 250-390px become 500-700px. Layout radius goes from 750px to 1875px. The canvas feels expansive, not cramped. At max zoom-out, cards are still readable, not pill-sized.

2. **Click-only entry**: Zooming and panning NEVER auto-commit to a workstream. The user scrolls freely, exploring the spatial layout. When they click a card, THEN the workstream opens with a smooth animation.

3. **Smooth entry animation** (450ms):
   - The clicked card expands to fill ~80% of the canvas zone
   - Other cards slide outward and fade to 10% opacity (still visible as landmarks)
   - Internal content (threads, documents, artifacts) flows in with staggered fade (30ms per item)
   - The hub bar updates: shows workstream name, back button, scoped AI context

4. **Panning between open workstreams**: When inside a workstream, panning far enough reveals the neighboring workstream. You can slide between them without closing/reopening. The transition is a cross-fade: old content fades, new content appears, hub bar updates. Like swiping between rooms.

5. **Smooth exit**: Click "Back" in the hub bar, or press Escape. Content fades out (200ms), card contracts back to its canvas position (350ms), other cards fade back in. You're back on the overview, centered where you started.

**How the Hub Bar works:**

The hub bar is a 120px-tall persistent strip at the bottom of the viewport. It contains:

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  ROW 1: Workstream pills + Focus timer + Deadline count              │
│  ─────────────────────────────────────────────────────                │
│  [● Bio HL] [● Math HL] [● Chem SL] [● History]  │ 🎯 25:00 │ 📅 3 │
│                                                                      │
│  ROW 2: AI Command Bar (centered, prominent)                         │
│  ─────────────────────────────────────────────                        │
│  ┌────────────────────────────────────────────────────┐              │
│  │  ⌘K  Ask anything, create anything...  [Auto ▾]   │              │
│  └────────────────────────────────────────────────────┘              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

- **Workstream pills**: Colored dots + names. Click to zoom-and-enter that workstream. The active one is highlighted. These are always visible — instant spatial navigation without zooming out first.
- **Focus timer**: Pomodoro counter. Shows current session time, session count. Click to configure (25/50/90 min sessions). Associates with active workstream.
- **Deadline counter**: Number of items due in the next 48 hours. Click to expand a deadline drawer.
- **AI Command Bar**: The primary AI interface. Always visible, always ready. Auto-detects workstream context. Dropdown lets you scope to a specific workstream or "General."

**Why this is the recommended approach:**

1. **Eliminates all scroll/zoom confusion**: The canvas is just a canvas. No auto-commitment. Click to enter, button to exit.
2. **Hub is always accessible**: No hunting for the hub card. No accidentally scrolling past it. It's right there, always.
3. **Spatial memory preserved**: Workstreams have persistent positions on the canvas. Students remember where things are.
4. **AI is fabric, not feature**: The command bar is always visible. Artifacts generated by AI appear as canvas objects. The AI scopes automatically to your current context.
5. **Zero learning curve**: Click a card → you're in. Click "Back" → you're out. The hub bar is self-explanatory.
6. **Scale creates breathing room**: 2.5x scaling means workstreams have real visual presence. You can read titles, see counts, understand status — all from the overview.

---

### Approach comparison

| Dimension | A: Observatory | B: Living Desk | C: Portal Canvas |
|-----------|---------------|----------------|------------------|
| **Spatial model** | Zoom into planets | Slide between desks | Click through portals |
| **Hub location** | Fixed dock (bottom) | Fixed strip (bottom) | Fixed bar (bottom) |
| **Navigation** | Click + zoom | Click + slide | Click + expand |
| **Multi-workstream** | Fade to periphery | Visible in drawers | Visible as landmarks |
| **Learning curve** | Medium (zoom metaphor) | Low (desk metaphor) | Low (click metaphor) |
| **AI surface** | Dock command bar | Strip command bar | Bar command bar |
| **Canvas freedom** | Full pan/zoom | No zoom, spatial desk | Full pan/zoom, no auto-commit |
| **Risk** | Zoom confusion persists | Feels less "spatial" | Must nail the scaling |
| **Implementation** | Moderate refactor | Major restructure | Moderate refactor |

**Recommendation: Approach C (Portal Canvas)** because it preserves the canvas metaphor the user loves while fixing every navigation pain point. It's the smallest departure from the current architecture while being the biggest improvement in usability.

---

## Part IV: Detailed User Flows (Approach C)

### Flow 1: First-time workspace entry

```
User navigates to /workspace
         │
         ▼
┌─ Page Load ──────────────────────────────────────────┐
│                                                       │
│  1. Fetch workstreams from Convex                     │
│  2. Compute layout (radial + force-directed)          │
│  3. Apply position overrides from localStorage        │
│  4. Calculate bounding box of ALL workstreams         │
│  5. Set viewport to fitView (center + contain all)    │
│  6. Hub bar initializes with workstream pills         │
│  7. Canvas renders with 400ms staggered card entry    │
│                                                       │
│  Visual: Cards fade in one by one (30ms stagger),     │
│  connections draw themselves (SVG path animation),    │
│  hub bar slides up from bottom (250ms)                │
│                                                       │
└───────────────────────────────────────────────────────┘
         │
         ▼
  User sees: All workstreams as large cards on canvas,
  hub bar at bottom with pills + timer + AI bar.
  Everything centered, everything readable.
```

**Key detail — fitView on load:**
```typescript
// After layout computation, center viewport to show all workstreams
const bounds = computeBoundingBox(workstreamPositions);
const padding = 120; // breathing room
instance.fitView({
  padding: padding / Math.min(viewportWidth, viewportHeight),
  duration: 0, // instant on first load
  nodes: workstreamNodes,
});
```

### Flow 2: Entering a workstream (click)

```
User clicks "Biology HL" card on canvas
         │
         ▼
┌─ Entry Animation (450ms total) ──────────────────────┐
│                                                       │
│  Phase 1: Zoom + center (0-300ms)                     │
│  ─────────────────────────────────                    │
│  - Canvas smoothly zooms to center on Bio card        │
│  - Zoom level: enough to fill ~80% of canvas zone     │
│  - Easing: cubic-bezier(0.22, 1, 0.36, 1)            │
│                                                       │
│  Phase 2: Card expansion (150-450ms, overlaps)        │
│  ─────────────────────────────────────────            │
│  - Bio card border dissolves (opacity 1→0, 200ms)     │
│  - Card background expands to fill canvas zone        │
│  - Other cards: slide outward + fade to 10% (300ms)   │
│  - Internal content nodes fade in staggered:          │
│    ┌──────────────────────────────────────┐           │
│    │ Threads group    (delay: 0ms)        │           │
│    │  ├─ Thread 1     (delay: 30ms)       │           │
│    │  ├─ Thread 2     (delay: 60ms)       │           │
│    │  └─ Thread 3     (delay: 90ms)       │           │
│    │ Documents group  (delay: 120ms)      │           │
│    │  ├─ Doc 1        (delay: 150ms)      │           │
│    │  └─ Doc 2        (delay: 180ms)      │           │
│    │ Artifacts group  (delay: 210ms)      │           │
│    │  └─ Quiz widget  (delay: 240ms)      │           │
│    └──────────────────────────────────────┘           │
│  - Each item: opacity 0→1, y: -6→0, scale 0.97→1    │
│                                                       │
│  Phase 3: Hub bar update (300-450ms)                  │
│  ───────────────────────────────────                  │
│  - Active pill highlights (color fills)               │
│  - Breadcrumb appears: "← Workspace / Biology HL"    │
│  - AI bar placeholder updates: "Ask about Biology..." │
│                                                       │
└───────────────────────────────────────────────────────┘
         │
         ▼
  User sees: Biology HL content laid out spatially.
  Threads as cards, documents as cards, artifacts as
  interactive widgets. All draggable, all clickable.
  Hub bar shows they're in Biology HL.
```

### Flow 3: Opening a thread (right panel)

```
User clicks "Enzymes Discussion" thread card
         │
         ▼
┌─ Panel Fly-In Animation (350ms total) ───────────────┐
│                                                       │
│  Phase 1: Thread card "launches" (0-150ms)            │
│  ─────────────────────────────────────────            │
│  - The clicked thread card pulses (scale 1→1.03→1)   │
│  - A ghost of the card lifts and drifts toward        │
│    the right edge of the screen (translateX +60px,    │
│    opacity 1→0.3, scale 1→0.8)                        │
│                                                       │
│  Phase 2: Panel materializes (100-350ms)              │
│  ──────────────────────────────────────              │
│  - Right panel slides in from right edge              │
│    (width 0→380px, easing: [0.22, 1, 0.36, 1])       │
│  - Canvas zone width adjusts (shrinks 380px)          │
│  - Panel content fades in (opacity 0→1, 100ms delay)  │
│  - Chat messages stagger in (30ms per message)        │
│                                                       │
│  Phase 3: AI bar transition (200-350ms)               │
│  ────────────────────────────────────                │
│  - Hub bar's AI command bar "flies" to the panel:     │
│    Hub bar AI bar fades out (translateY +20px, 150ms) │
│    Panel's bottom AI bar fades in (translateY -10px,  │
│    opacity 0→1, 200ms, 100ms delay)                   │
│  - Creates impression of the SAME input traveling     │
│  - Hub bar shows minimal state (timer + pills only)   │
│                                                       │
└───────────────────────────────────────────────────────┘
         │
         ▼
  User sees: Thread conversation in right panel.
  AI chat bar at the BOTTOM of the panel (same style
  as the hub bar's AI input). Canvas is narrower but
  still shows workstream content alongside.
```

### Flow 4: Opening a document (right panel)

```
User clicks "Lab Report" document card
         │
         ▼
┌─ Panel Fly-In (same animation as thread) ────────────┐
│                                                       │
│  Same ghost-card + panel-slide animation as Flow 3    │
│  Panel width: 520px (wider for documents)             │
│                                                       │
│  Document panel layout:                               │
│  ┌──────────────────────────────────────┐             │
│  │  Lab Report on Enzyme Kinetics       │ ← title     │
│  │  Created Mar 15 · Modified 2h ago    │ ← metadata  │
│  │  ──────────────────────────────────  │             │
│  │                                      │             │
│  │  [Full Tiptap editor content]        │             │
│  │  - Rich text with formatting         │             │
│  │  - Slash commands work               │             │
│  │  - Drag handles on hover             │             │
│  │  - Version history via ⋯ menu        │             │
│  │                                      │             │
│  │  ──────────────────────────────────  │             │
│  │  ┌──────────────────────────────┐    │             │
│  │  │ AI: Edit this document...    │    │ ← AI bar    │
│  │  └──────────────────────────────┘    │             │
│  └──────────────────────────────────────┘             │
│                                                       │
│  AI bar at BOTTOM (not top). Same style as thread     │
│  panel. Same style as hub bar. One unified input.     │
│                                                       │
│  AI can: rewrite sections, add content, format,       │
│  generate from scratch. Changes appear as diffs       │
│  with accept/revert controls inline in the editor.    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 5: Exiting a workstream

```
User clicks "← Workspace" in hub bar, or presses Escape
         │
         ▼
┌─ Exit Animation (500ms total) ───────────────────────┐
│                                                       │
│  Phase 1: Close panel if open (0-200ms)               │
│  ──────────────────────────────────────              │
│  - Right panel slides out (reverse of entry)          │
│  - Canvas zone expands back to full width             │
│                                                       │
│  Phase 2: Content fade-out (100-300ms)                │
│  ──────────────────────────────────                  │
│  - Internal content nodes fade out                    │
│    (opacity 1→0, y: 0→4, scale 1→0.98, 200ms)        │
│  - Staggered reverse (last items first, 20ms gap)     │
│                                                       │
│  Phase 3: Card reformation (200-500ms)                │
│  ──────────────────────────────────                  │
│  - Workstream border re-forms (opacity 0→1, 200ms)    │
│  - Card contracts to its canvas size                  │
│  - Other workstream cards fade back in (10%→100%)     │
│  - Viewport zooms out to fitView all workstreams      │
│    (duration: 400ms, easing: ease-out)                │
│                                                       │
│  Phase 4: Hub bar reset (300-500ms)                   │
│  ──────────────────────────────                      │
│  - Breadcrumb fades, pill highlight resets             │
│  - AI bar placeholder: "Ask anything, create..."      │
│  - Full hub bar visible again                         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 6: AI creates an artifact

```
User types in AI bar: "Create a visualization of
enzyme reaction rates vs temperature"
         │
         ▼
┌─ AI Generation Flow ─────────────────────────────────┐
│                                                       │
│  1. AI bar shows streaming indicator                  │
│     "Creating visualization..."                       │
│                                                       │
│  2. AI generates artifact:                            │
│     - Type: "diagram" or "code_project"               │
│     - Content: Interactive chart (React component     │
│       or SVG or embedded code)                        │
│     - Title: "Enzyme Kinetics: Rate vs Temperature"   │
│                                                       │
│  3. Artifact materializes on canvas (400ms):          │
│     - Appears near the AI bar (bottom-center)         │
│     - Floats upward to an empty spot on the canvas    │
│       (translateY: +40→0, opacity: 0→1, scale 0.9→1) │
│     - Subtle glow pulse on arrival (workstream color) │
│     - Card shows: title + type icon + live preview    │
│                                                       │
│  4. AI bar shows confirmation:                        │
│     "Created 'Enzyme Kinetics' visualization"         │
│     [Open] [Undo]                                     │
│                                                       │
│  5. Artifact is now a persistent canvas node:         │
│     - Draggable to any position                       │
│     - Clickable to open in right panel                │
│     - Editable via AI ("make it show Michaelis-       │
│       Menten curve too")                              │
│     - Has version history                             │
│     - Counted in workstream artifactCount             │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 7: Panning between workstreams (while focused)

```
User is inside Biology HL, pans left toward Math HL
         │
         ▼
┌─ Cross-Workstream Pan ───────────────────────────────┐
│                                                       │
│  Detection:                                           │
│  - Track viewport center position continuously        │
│  - When center moves > 60% toward another workstream  │
│    → prepare transition                               │
│                                                       │
│  Animation (200ms cross-fade):                        │
│  ──────────────────────────                          │
│  - Biology content: opacity 1→0.15 (200ms)            │
│  - Math content: opacity 0→1 (200ms)                  │
│    (content was pre-fetched in detail band)            │
│  - Hub bar: active pill shifts from Bio to Math       │
│  - AI bar context: "Biology" → "Math"                 │
│  - No zoom change, no viewport jump                   │
│  - Just a smooth opacity crossfade                    │
│                                                       │
│  User experience:                                     │
│  It feels like sliding between rooms in a house.      │
│  You moved — the room changed — you kept walking.     │
│  No doors, no loading screens, no zoom dances.        │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 8: Creating content from the hub bar

```
User right-clicks on canvas (inside a workstream)
         │
         ▼
┌─ Context Menu ───────────────────────────────────────┐
│                                                       │
│  ┌──────────────────────────┐                         │
│  │ + New Thread             │ ← Opens right panel     │
│  │ + New Document           │    with fresh content   │
│  │ + New Artifact      ▸   │ ← Submenu: type picker  │
│  │ ─────────────────────── │                          │
│  │ 🤖 Ask AI to create...  │ ← Opens AI bar focused  │
│  │ ─────────────────────── │                          │
│  │ ⚙ View: Structured  ▸  │ ← View mode switcher    │
│  └──────────────────────────┘                         │
│                                                       │
│  "New Artifact" submenu:                              │
│  ┌──────────────────────────┐                         │
│  │ 📄 Document              │                         │
│  │ 📋 Study Plan            │                         │
│  │ 🃏 Flashcard Deck        │                         │
│  │ 💻 Code Project          │                         │
│  │ 📊 Diagram               │                         │
│  │ 📅 Timetable             │                         │
│  └──────────────────────────┘                         │
│                                                       │
│  Each opens with a template picker:                   │
│  "Document" templates:                                │
│  [Blank] [Lab Report] [Essay] [Study Guide] [Notes]   │
│                                                       │
│  Template = AI-generated starting content.             │
│  "Lab Report" → AI prefills: Title, Introduction,     │
│  Method, Results, Discussion, Conclusion sections.    │
│  All editable. All versionable.                       │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 9: Hub bar interactions

```
┌─ Hub Bar Detail ─────────────────────────────────────┐
│                                                       │
│  WORKSTREAM PILLS (left section):                     │
│  ─────────────────────────────                       │
│  [● Bio HL] [● Math HL] [● Chem SL] [+]              │
│                                                       │
│  Each pill: colored dot + truncated name              │
│  Active: filled background, bold text                 │
│  Hover: shows tooltip with full name + counts         │
│  Click: zooms canvas to that workstream + enters      │
│  [+]: Opens "Create Workstream" dialog                │
│                                                       │
│  When no workstream is focused:                       │
│  All pills are equal (no highlight)                   │
│  Canvas shows overview                                │
│                                                       │
│  FOCUS TIMER (center-right):                          │
│  ──────────────────────                              │
│  🎯 25:00 [▶]                                         │
│  Click [▶]: Start timer (associates with active ws)   │
│  While running: 🎯 23:47 [⏸] — counts down           │
│  Complete: subtle pulse, session count increments      │
│  Click timer text: opens timer config popover          │
│    - Session length: 25 / 50 / 90 min                 │
│    - Break length: 5 / 10 / 15 min                    │
│    - Today: 3 sessions completed (1h 15m total)       │
│                                                       │
│  DEADLINE BADGE (right):                              │
│  ──────────────────                                  │
│  📅 3 due                                             │
│  Click: expands a drawer upward showing:              │
│  ┌──────────────────────────────────┐                 │
│  │ Physics Lab Report    │ Tomorrow │ 🔴              │
│  │ Math Problem Set 4    │ Wed      │ 🟡              │
│  │ Bio Essay Draft       │ Fri      │ 🟢              │
│  └──────────────────────────────────┘                 │
│  Click an item → opens right panel with that item     │
│                                                       │
│  AI COMMAND BAR (center, full width):                  │
│  ──────────────────────────────────                  │
│  ┌─────────────────────────────────────────────────┐  │
│  │ ⌘K  Ask anything, create anything...  [Auto ▾] │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Same as current workspace-command-bar but:           │
│  - Always visible (not hidden when panel open)        │
│  - When panel is open, AI bar moves INTO the panel    │
│    (fly-out/fly-in animation)                         │
│  - [Auto ▾] dropdown: select workstream or "General"  │
│  - Typing opens suggestion dropdown above             │
│  - Enter sends; response appears in right panel       │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Flow 10: Artifact panel — full page view

```
User clicks "Expand" icon on document in right panel
         │
         ▼
┌─ Notes/Artifacts Page (/notes?id=...) ───────────────┐
│                                                       │
│  ┌─ Sidebar ─┐  ┌─ Editor ────────────────────────┐  │
│  │            │  │                                 │  │
│  │ Artifacts  │  │  [Title from first H1]          │  │
│  │ ────────── │  │  Created Mar 15 · 2h ago · v3   │  │
│  │ 🔍 Search  │  │                                 │  │
│  │            │  │  [Full Tiptap Editor]            │  │
│  │ Biology HL │  │  - All formatting               │  │
│  │  └ Lab Rpt │  │  - Slash commands               │  │
│  │  └ Notes   │  │  - Drag handles                 │  │
│  │            │  │  - Block controls                │  │
│  │ Math HL    │  │                                 │  │
│  │  └ Formulas│  │                                 │  │
│  │  └ Prob Set│  │                                 │  │
│  │            │  │                                 │  │
│  │ Unscoped   │  │  ┌─────────────────────────┐    │  │
│  │  └ Quick N │  │  │ AI: Edit this doc...    │    │  │
│  │            │  │  └─────────────────────────┘    │  │
│  └────────────┘  └─────────────────────────────────┘  │
│                                                       │
│  AI bar at BOTTOM of editor area. Same unified style. │
│  Same capabilities as in workspace panel.             │
│  Version history in sidebar or via "v3" link.         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## Part V: The AI-Native Widget System

### Philosophy: AI Creates Your Workspace

The most ambitious part of this vision: **the workspace is not pre-built — it's AI-built.**

Default workstreams come with sensible starting layouts (threads, documents, artifacts in structured view). But over time, the AI generates personalized widgets based on your usage patterns, your questions, and your curriculum.

### How it works

**Widget catalog** (AI selects from these, never generates raw HTML):

| Widget Type | What it shows | When AI creates it |
|-------------|---------------|-------------------|
| `progress-ring` | Completion % with milestones | When student asks "how am I doing?" |
| `flashcard-stack` | Interactive flip cards | When studying vocabulary or concepts |
| `concept-map` | Node-edge graph of topics | When AI detects related concepts across docs |
| `timeline` | Upcoming deadlines, color-coded | When entering a workstream with due items |
| `quick-quiz` | 3-5 question check from recent notes | After a study session, AI suggests a quiz |
| `comparison-table` | Side-by-side concept analysis | When student asks to compare things |
| `study-playlist` | Ordered sequence of activities | When student says "what should I study?" |
| `formula-sheet` | Extracted key formulas/definitions | When working on STEM subjects |
| `resource-list` | Curated links + notes | When AI finds relevant external resources |
| `activity-feed` | Recent actions in workstream | Always present, auto-updated |
| `visualization` | Charts, graphs, diagrams | When student asks for visual representation |
| `code-sandbox` | Interactive code editor + output | When working on programming tasks |

**The creation flow:**

```
Student asks in AI bar: "How am I doing in Biology?"
         │
         ▼
AI processes → detects intent: "progress check"
         │
         ▼
AI selects widget: "progress-ring"
AI populates with real data:
  - completion: 67%
  - milestones: ["Cells ✓", "Genetics ✓", "Ecology ◻", "Evolution ◻"]
  - trend: "On track for May exam"
         │
         ▼
Widget materializes as a canvas artifact:
  - Saved as an artifact (type: "widget", subtype: "progress-ring")
  - Has version history
  - Is interactive (click milestones to see details)
  - Is AI-editable ("include my flashcard scores too")
  - Is positioned on the canvas, draggable
```

**The key insight**: Widgets are artifacts. They live in the artifact system. They have version history. They can be shared. They persist across sessions. They're not ephemeral chat responses — they're THINGS on your desk.

### Customization without overwhelm

The workspace starts with smart defaults:
1. New workstream → Auto-creates: activity feed widget + timeline widget
2. First study session → AI suggests: "Want me to create a concept map of what you've covered?"
3. Before exam → AI suggests: "I've prepared a quick quiz from your recent notes. Add it to your desk?"

Students never need to manually configure anything. The AI proposes, the student accepts or dismisses. Over time, the workspace becomes uniquely theirs — not because they spent hours customizing, but because the AI learned what they need.

**The reversal principle** (from PREV.md):
> "Everything is created automatically unless the user specifically says to revert back."

This means: AI adds the widget. Student sees it. If they don't want it, they dismiss it. This is faster and more natural than: student realizes they need something → searches for it → configures it → positions it. The AI does the work. The student keeps what's useful.

---

## Part VI: Visual Identity & Polish

### The "alive without moving" principle

The workspace should feel warm, responsive, and present — without any continuous animation at rest.

**What "alive" means:**
- Workstream cards have subtle depth (layered shadows that respond to hover)
- Hovering a card: shadow deepens, border warms, scale +1% — 150ms ease
- Content items: slight lift on hover (y: -1px, shadow increase) — 150ms
- Transitions are springy but quick (no bouncing, no overshoot beyond 2%)
- Colors are warm, not clinical. The existing Spectra palette is perfect.
- When AI is processing: a subtle breathing glow on the AI bar (not spinning, not pulsing hard — just a gentle luminance shift, 2s cycle, only while processing)

**What "alive" does NOT mean:**
- No spinning loaders (use progress bars or breathing indicators)
- No continuous particle effects
- No idle animations on any element
- No "breathing" cards at rest
- No parallax effects on scroll

### Transition timing (standardized across entire workspace)

| Transition | Duration | Easing | Notes |
|-----------|---------|--------|-------|
| Card hover (scale, shadow) | 150ms | ease | Instant feel |
| Card click → zoom | 450ms | [0.22, 1, 0.36, 1] | Smooth overshoot |
| Content item stagger | 30ms/item | ease-out | Max 10 items = 300ms |
| Panel slide in | 300ms | [0.22, 1, 0.36, 1] | Width + opacity |
| Panel slide out | 250ms | ease-in | Slightly faster out |
| Panel content swap | 200ms | cross-fade | When switching panel type |
| AI bar fly-out | 200ms | ease-in | Hub → panel |
| AI bar fly-in | 250ms | ease-out, 100ms delay | Panel → shows |
| Exit workstream | 500ms | ease-out | Content + zoom + reform |
| Cross-workstream pan | 200ms | ease | Just opacity swap |
| Widget materialize | 400ms | [0.22, 1, 0.36, 1] | Float up + fade in |
| Hub bar slide up | 250ms | ease-out | On page load |
| Deadline drawer | 200ms | ease-out | Expand upward |

---

## Part VII: Technical Changes Required

### Critical Fixes (apply regardless of approach)

#### Fix 1: Remove auto-commit on zoom
**File**: `src/components/workspace/workspace-canvas.tsx`
- Remove `updateVisibilityModel` call from `handleMove` and `handleMoveEnd`
- Zoom/pan should ONLY update the `zoomBand` state for representation changes (card size, detail level)
- Commitment happens ONLY via `handleOpenWorkstream` (click) or hub bar pill click
- Keep `getRepresentationBand` for visual changes (card size, info density) — just decouple it from commitment

#### Fix 2: Scale up layout 2.5x
**File**: `src/lib/workspace/auto-layout.ts`
- Active radius: 750 → 1875
- Quiet radius: 1035 → 2588
- Completed radius: 1350 → 3375
- Archived radius: 1620 → 4050
- Repulsion threshold: 420 → 1050

**File**: `src/components/workspace/workspace-canvas.tsx`
- Card widths: scale proportionally (250/320/390/460 → 500/580/660/740)
- Update all distance calculations that reference 600px proximity

#### Fix 3: fitView on load and exit
**File**: `src/components/workspace/workspace-canvas.tsx`
- On initial render: call `instance.fitView({ padding: 0.1, duration: 0 })` after nodes are computed
- On exit workstream: call `instance.fitView({ padding: 0.1, duration: 400 })` instead of restoring previous viewport
- This ensures ALL workstreams are always visible and centered after exit

#### Fix 4: Hub bar (persistent bottom strip)
**File**: `src/app/workspace/page.tsx` (NEW layout structure)
- Split the workspace page into two zones:
  ```
  <div className="flex flex-col h-screen">
    <div className="flex-1 relative"> {/* Canvas zone */}
      <WorkspaceCanvas ... />
      <RightPushPanel ... /> {/* Overlays canvas */}
    </div>
    <HubBar ... /> {/* Persistent bottom strip, ~120px */}
  </div>
  ```
- Remove the hub node from the canvas entirely
- HubBar is a new component with: workstream pills, timer, deadline badge, AI command bar

#### Fix 5: Click-only workstream entry
**File**: `src/components/workspace/workspace-canvas.tsx`
- Keep `handleOpenWorkstream` for card clicks
- Remove all scroll/zoom-based commitment logic
- The `zoomBand` still changes representation (card size/detail) but NEVER triggers commitment
- Add `onNodeClick` handler that detects workstream node clicks and calls `handleOpenWorkstream`

#### Fix 6: Fix workstream counts
**File**: `convex/artifacts.ts`
- Replace collect-filter-count-patch with atomic delta in `ensureWorkstreamArtifactCount`

**File**: `convex/chats.ts`
- Create `adjustWorkstreamThreadCount(ctx, workstreamId, delta: 1 | -1)`
- Call +1 after `createChat`, -1 in `deleteChat`/`archiveChat`

#### Fix 7: Fix blue hover stripe
**File**: `src/components/workspace/workspace-canvas.tsx`
- The 2px gradient stripe at card top (line ~419) — either make it the workstream's accent color at 30% opacity (warm, intentional) or remove it entirely
- If keeping: make it 3px, full opacity on hover, and add a matching bottom stripe for symmetry

#### Fix 8: Panel fly-in/fly-out animation
**File**: `src/components/workspace/right-push-panel.tsx`
- Add ghost-card animation: when opening, a translucent copy of the clicked card lifts and drifts toward the panel edge
- Panel content enters with staggered fade (same as internal nodes: 30ms per element)
- AI bar "flies" from hub bar to panel bottom (translate animation)

#### Fix 9: Unified AI bar position
**All panel content components** in `right-push-panel.tsx`:
- Move AI input to the BOTTOM of every panel type (thread, note, artifact)
- Use the same `UnifiedAiInput` component everywhere
- Style: `rounded-2xl bg-[var(--bg-elevated)]/95 backdrop-blur-xl` — matches hub bar

#### Fix 10: Panel state reset on switch
**File**: `src/components/workspace/right-push-panel.tsx`
- Add `key={`${type}-${id}`}` on content wrapper to force remount
- Add `useEffect` cleanup on `id` change to reset loading/error states
- `AnimatePresence mode="wait"` with cross-fade

#### Fix 11: Drag handle positioning
**File**: `src/components/editor/extensions/drag-handle.ts`
- Fix the "+" and grip icons to position at the left edge of the content block, not floating far away
- Use `left: -32px` relative to the ProseMirror content area, `top: 2px` from the block top
- Ensure the positioning accounts for the editor's padding/margin

#### Fix 12: Creation flow
**File**: `src/components/workspace/workspace-canvas.tsx` (context menu)
- "New Thread" → creates thread scoped to active workstream → opens in right panel
- "New Document" → creates document artifact → opens in right panel with template picker
- "New Artifact" → submenu with type picker → template picker → opens in right panel
- "Ask AI to create..." → focuses the AI command bar

**New component**: `src/components/artifacts/create-artifact-dialog.tsx` (already exists but unwired)
- Wire it to: context menu "New Artifact", hub bar [+], and notes-workspace "New" button
- Add template picker per type
- Templates provide AI-generated starting content

#### Fix 13: Internal node overlap
**File**: `src/components/workspace/views/internal-content-nodes.tsx`
- `buildStructuredNodes`: Add height estimation per group based on item count
- Increase inter-group gap: 24 → 48
- Add collision detection: if two groups would overlap, push the second one down

---

## Part VIII: Implementation Order

```
WAVE 1: Foundation (fix the pain)
═══════════════════════════════════
1. Remove auto-commit on zoom          [Fix 1]
2. Scale up layout 2.5x               [Fix 2]
3. Add fitView on load/exit           [Fix 3]
4. Click-only workstream entry         [Fix 5]
5. Fix workstream counts              [Fix 6]
   → After this wave: navigation is smooth, counts are correct,
     no accidental commits, everything centered and readable.

WAVE 2: Hub Bar (the new anchor)
═══════════════════════════════════
6. Build HubBar component             [Fix 4]
   - Workstream pills
   - Focus timer
   - Deadline badge
   - AI command bar (move from canvas overlay)
7. Remove hub node from canvas
8. Wire hub bar interactions (pill click → zoom + enter)
   → After this wave: the hub is always visible,
     AI bar is always accessible, workstream switching
     is one click.

WAVE 3: Panels (make content beautiful)
═══════════════════════════════════
9. Panel fly-in/fly-out animation     [Fix 8]
10. Unified AI bar position (bottom)   [Fix 9]
11. Panel state reset on switch        [Fix 10]
12. Fix drag handle positioning        [Fix 11]
13. Fix blue hover stripe              [Fix 7]
    → After this wave: panels feel connected to the canvas,
      AI is consistently at the bottom, no visual glitches.

WAVE 4: Creation (make building easy)
═══════════════════════════════════
14. Wire CreateArtifactDialog          [Fix 12]
15. Context menu overhaul              [Fix 12]
16. Template system per artifact type  [Fix 12]
17. Fix internal node overlap          [Fix 13]
    → After this wave: creating anything is fast,
      templates eliminate blank-page anxiety,
      internal views don't overlap.

WAVE 5: AI Widgets (the future)
═══════════════════════════════════
18. Widget artifact type + catalog
19. AI widget generation pipeline
20. Widget rendering on canvas
21. Widget interactions (edit, resize, connect)
    → After this wave: AI creates persistent,
      interactive, personal workspace elements.

WAVE 6: Polish (make it feel alive)
═══════════════════════════════════
22. Standardize all transition timings
23. Hover micro-interactions
24. Stagger animations on content entry
25. Hub bar breathing indicator during AI processing
26. Workstream zone tinting (3% opacity of color)
    → After this wave: everything feels warm,
      responsive, and crafted.
```

---

## Part IX: Success Criteria

The workspace is done when:

1. **A new student** opens the workspace and immediately understands: "These are my subjects. I click one to go in. The bar at the bottom is my home base."

2. **A returning student** opens the workspace and finds everything exactly where they left it. Their Biology notes are top-right. Their Math threads are center-left. The AI remembers their last conversation.

3. **A student in a study session** forgets they're using a tool. They're just... studying. The AI surfaces a quiz when they've been reading for 30 minutes. A deadline reminder appears in the hub bar 24 hours before due. A concept map connects their Physics notes to their Math notes without being asked.

4. **A teacher** sees their students' workspaces and understands at a glance: who's on track, who's struggling, who hasn't started. The spatial layout tells the story.

5. **No one** accidentally enters or exits a workstream. No one sees wrong counts. No one encounters a broken panel. No one faces a blank page without a template.

6. **The scroll wheel** just scrolls. The click enters. The Escape exits. The AI bar is always there. It just works.

---

## Part X: Open Questions

1. **Should workstream pills in the hub bar be reorderable?** Drag-to-reorder would let students prioritize. But it adds complexity.

2. **Should the hub bar collapse/minimize?** Some students might want maximum canvas space. A double-click on the hub bar could toggle between full and minimal (just the AI bar).

3. **Should widgets be shareable between workstreams?** A study schedule widget might span Biology + Chemistry. Cross-workstream widgets need careful data scoping.

4. **Should the canvas support freeform drawing?** tldraw-style sketching on the canvas could be powerful for visual learners. But it's a significant addition.

5. **Should there be a "presentation mode"?** Students presenting their work could enter a mode where the workspace becomes a sequential walkthrough of their workstream content.

6. **How deep should AI customization go?** Should students be able to say "make my workspace dark blue" or "add a plant to my desk" (decorative personalization)? Or strictly functional?

---

*This document is the source of truth for the Spectra workspace vision. Implementation follows Approach C (Portal Canvas) unless explicitly changed. All technical fixes in Part VII are required regardless of approach.*
