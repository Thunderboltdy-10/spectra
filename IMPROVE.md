# Spectra Workspace: Complete Overhaul Plan (Wave 4)

## Context

Spectra's workspace has come a long way — the canvas, zoom-based commitment, right panels, command bar, and editor are all functional. But the experience doesn't yet match the vision: a **personal sanctuary where your brain, activities, and projects are spatially mapped**, AI is seamlessly integrated, and the whole thing feels alive without moving.

**What prompted this**: The workspace feels too abstract and hard to use. Zoom detection is over-sensitive, panels have switching bugs, the AI bar looks inconsistent, artifacts are hard to manage, Convex bandwidth is dangerously high (2.5GB/3 days across 7 functions), and the hub/workstream concept doesn't yet deliver on the "personal desk" promise.

**Intended outcome**: A workspace that feels like YOUR space — where zooming reveals content gradually and naturally, multiple workstreams can be visible simultaneously, panels switch cleanly, AI input is beautiful everywhere, and the Convex backend is 10x more efficient.

### Key Architectural Decision: Multi-Visible Zoom Model

The current model commits to ONE workstream and hides everything else. **The new model**: zooming in enough reveals ALL nearby workstreams' internals simultaneously. The workstream closest to viewport center gets "primary focus" (full opacity, targeted), while nearby ones get secondary focus (slightly dimmed but still showing their content). Panning shifts which one is primary — creating a seamless, continuous spatial world where you slide between desks.

This replaces the binary "committed/not" system with a gradient:
```
Zoom level:     Card only → Card + preview → Full internals visible
Focus state:    None → Secondary (dimmed content) → Primary (full content)
Transition:     Pan toward a workstream → it becomes primary → old one becomes secondary
```

---

# PHASE 1: Backend, Logic, Data Efficiency

Everything that must be correct before the UI can be polished. No visual changes — pure correctness, efficiency, and data integrity.

---

## A1: Convex Bandwidth Optimization [CRITICAL — Highest ROI]

**Problem**: 7 Convex functions collectively consume ~2.5GB/3 days. `checkUserBudget` alone is 1GB. `upsertModelCatalogForOrg` hits the 16MB read limit and fails.

### A1a: `checkUserBudget` (usage.ts:612-710) — 1GB/3 days

**Root cause**: `.collect()` on `usageEvents` (line 651-659) pulls ALL events for a user that month (potentially 1000s). `.collect()` on `modelCatalog` (line 660-663) pulls ALL models including `strengthEmbedding` (3KB+ per model).

**Changes to `convex/usage.ts`**:
- Line 651-659: Replace `.collect()` with `.take(3000)` — defensive limit
- Line 660-663: Create `getModelPricingMap(ctx, orgId)` that queries `modelCatalog` with `.take(300)` and projects ONLY pricing fields (`modelId`, `inputCostPerM`, `outputCostPerM`, `isFree`), excluding `strengthEmbedding` and other large fields
- Add `userMonthlyBudget` summary in `userSpending` table cached/updated incrementally by `recordUsage` mutations, so `checkUserBudget` only needs the summary row + org config (eliminates event scanning entirely)

### A1b: `listModels` (models.ts:285-305) — 500MB

**Changes to `convex/models.ts`**:
- Replace `.collect()` with `.take(200)` (line 293-296)
- Map out `strengthEmbedding` field before returning (line 298-303)
- **Schema**: Add `.index("by_org_featured", ["orgId", "isFeatured"])` to `modelCatalog`

### A1c: `upsertModelCatalogForOrg` (models.ts:915-978) — 270MB, 16MB limit

**Changes to `convex/models.ts`**:
- Chunk `args.models` into batches of 20
- Process first chunk in current mutation
- Schedule remaining via `ctx.scheduler.runAfter(0, internal.models.upsertModelCatalogChunk, { orgId, models: remaining })`

### A1d: `awardXp` (gamification.ts:1077-1147) — 180MB

**Changes to `convex/gamification.ts`**:
- Wrap `listUserAchievements()` and `ensureActivityCounters()` in `Promise.all()` for parallel execution
- Short-circuit `ensureUserStreakDoc` after first successful lookup

### A1e: `getChunksByIds` (rag.ts:26-58) — 150MB

**Changes to `convex/rag.ts`**:
- Replace sequential `for` loop with `await Promise.all(args.ids.map(id => ctx.db.get(id)))`

### A1f: `getGlobalStats` (superAdmin.ts:260-279) — 110MB

**Changes to `convex/superAdmin.ts`**:
- Create `platformStats` singleton document updated by a cron job every 5 minutes
- Super admin reads cached document instead of scanning entire `orgs`, `users`, `messages` tables

### A1g: `listChats` (chats.ts:182-235) — 300MB

**Changes to `convex/chats.ts`**:
- When `workstreamId` provided, use `by_workstream` index instead of `by_owner_updated` + post-filter
- Add `.filter()` for `deletedAt` in Convex query before `.take()`

### A1h: Schema index additions (`convex/schema.ts`)

- `modelCatalog`: Add `.index("by_org_featured", ["orgId", "isFeatured"])`
- Verify existing indexes are adequate for optimized queries

**Verification**: Deploy, monitor Convex dashboard bandwidth for 24h. Target: < 500MB/3 days (down from 2.5GB).

---

## A2: Count Tracking Corrections

**Problem**: `ensureWorkstreamArtifactCount` (artifacts.ts:80-96) uses `.collect().filter().length` — full scan per write. `threadCount` exists in schema but no maintenance function exists.

### Changes

**`convex/artifacts.ts`** (line 80-96):
- Replace collect-filter-count-patch with atomic delta: `adjustWorkstreamArtifactCount(ctx, workstreamId, delta: 1 | -1)` → reads workstream, patches `artifactCount: (ws.artifactCount ?? 0) + delta`
- Update all ~10 call sites to pass correct delta

**`convex/chats.ts`**:
- Create `adjustWorkstreamThreadCount(ctx, workstreamId, delta: 1 | -1)` (same atomic pattern)
- Call +1 after `createChat`, -1 in `deleteChat`/`archiveChat`, both when `workstreamId` changes

**Verification**: Create workstream → add 3 threads + 2 artifacts → card shows "3 threads · 2 artifacts". Delete one → decrement.

---

## A3: Zoom Model Overhaul — Multi-Visible Internals

**Problem**: Current model is binary (committed/not). Too sensitive — idle state triggers focus. Exit sometimes re-commits. User wants: zoom reveals content GRADUALLY, multiple workstreams visible simultaneously, pan between them seamlessly.

### Architectural Change

Replace `committedWorkstreamId` (single ID) with a **visibility gradient model**:

```
State per workstream:
  - "card-only": default, shows card at current zoom band (overview/summary/detail)
  - "revealing": zoom deep enough + close enough → content starts loading & fading in
  - "active": viewport-center workstream, full content visible, primary focus

Global state:
  - primaryWorkstreamId: string | null  (closest to viewport center in internal band)
  - visibleWorkstreamIds: string[]      (all workstreams whose content is showing)
```

### Changes to `src/stores/workspace-store.ts`

- Rename `committedWorkstreamId` → `primaryWorkstreamId`
- Add `visibleWorkstreamIds: string[]` (workstreams in "revealing" or "active" state)
- Keep `exitWorkstream()` for the "go home" action (resets all to card-only)

### Changes to `src/lib/workspace/auto-layout.ts` (line 31-36)

**Scale layout distances by 1.5x** (more physical space between workstreams):
```
active: 500 → 750
quiet: 690 → 1035
completed: 900 → 1350
archived: 1080 → 1620
```
Increase force simulation repulsion threshold: 280 → 420

### Changes to `src/components/workspace/workspace-canvas.tsx`

**Raise zoom band thresholds** (line 97-101):
```
overview: zoom < 0.45   (was 0.58)
summary: zoom < 0.75    (was 0.9)
detail: zoom < 1.3      (was 1.48)
internal: zoom >= 1.3    (was 1.48)
```

**New: multi-visible logic** (replaces single-commit debounce at ~line 980-1024):
- On viewport change (debounced 400ms):
  1. If band is "internal":
     - Find ALL workstreams within 600 canvas units of viewport center
     - Set these as `visibleWorkstreamIds` (content loads for all of them)
     - The CLOSEST one becomes `primaryWorkstreamId`
     - Others get secondary focus (content visible at ~0.6 opacity)
  2. If band is "detail":
     - Pre-fetch content for nearest workstream (cache warmth)
     - No content shown yet
  3. If band is "overview" or "summary":
     - Clear all visibility → card-only for everyone
- **Pan-transition**: When panning while in internal band, if a different workstream becomes closest, smoothly transition primary focus (200ms cross-fade). No zoom-out/zoom-in cycle.

**Hysteresis for exit**: Only clear visibility when zoom drops to "summary" or lower (not "detail"). This means slight zoom-out while deep doesn't kick you out.

**Neighbor opacity** (line 105-108):
- Non-visible workstreams: opacity fades with zoom (start at 1.0, full fade at 1.4)
- Visible-but-not-primary workstreams: opacity 0.6 (content dimmed but present)
- Primary workstream: opacity 1.0

**Content rendering**: Build internal nodes for ALL visible workstreams (not just primary). Position them relative to each workstream's canvas position.

**Commit-on-click** (explicit entry): Clicking a workstream card still zooms in more deeply and makes it primary, but now surrounding workstreams also become visible rather than hidden.

**Zoom-in depth**: When entering via click/card press, zoom target raised (1.5 → 1.7) to create a more immersive "inside the workspace" feel that reveals content gradually.

**Verification**: Zoom in near two adjacent workstreams → both show content. Closest one is full opacity, other is dimmed. Pan toward the dimmed one → it becomes primary, first one dims. Zoom out to summary → all return to card-only.

---

## A4: Real-Time Workstream Drag + Internal Drag Fix

**Problem**: Workstream card drag only shows position on release. Internal content drag causes white flash.

### Changes to `src/components/workspace/workspace-canvas.tsx`

**Real-time workstream drag** (~line 1194):
- Remove the `if (node.id.startsWith("ws-")) return;` early-return in `handleNodeDrag`
- Add 50ms throttle for `localOverrides` updates during drag
- React Flow handles visual position natively — fix ensures edges/connections update too

**Internal drag flash fix** (~line 1196-1203):
- Use `useRef` for internal node overrides during drag, only commit to state on `dragStop`
- Prevents full `nodes` useMemo recompute during each drag frame

**Verification**: Drag workstream → edges follow. Drag internal nodes → no white flash.

---

## A5: Content Pre-Fetch at Detail Band

**Problem**: Internal content loads only after commitment, causing visible delay.

### Changes to `src/components/workspace/workspace-canvas.tsx`

- Watch `semanticBand` and viewport position
- When "detail" band AND within 600 canvas units of a workstream: pre-fetch content into `contentCacheRef`
- Pre-fetch ALL nearby workstreams (since multiple can become visible in new model)
- 300ms debounce to avoid excessive fetches during scrolling

**Verification**: Zoom to detail near workstream, wait 500ms, then zoom to internal → content appears instantly.

---

## A6: Slash Command Fuzzy/Alias Matching

**Problem**: `/h2` doesn't match "Heading 2" (slash-command-extension.ts:145-153 uses only substring matching).

### Changes to `src/components/editor/slash-command-extension.ts`

**Add `aliases` field** to `SlashCommandItem` (line 13): `aliases?: string[]`

**Add aliases** to all commands:
- heading1: `["h1", "heading 1", "title"]`, heading2: `["h2", "heading 2", "subtitle"]`, heading3: `["h3", "heading 3"]`
- bullet: `["ul", "unordered", "bullets"]`, numbered: `["ol", "ordered", "numbers"]`, todo: `["checkbox", "task", "checklist"]`
- quote: `["blockquote", "bq"]`, code: `["codeblock", "cb", "pre"]`, divider: `["hr", "line", "separator"]`
- table: `["grid"]`, image: `["img", "picture"]`

**Replace `getFilteredCommands`** (line 145-153):
- Check aliases with `.includes()`
- Add ordered-character fuzzy match (all query chars appear in order in target)
- Priority: exact alias > substring > fuzzy

**Verification**: `/h2` → "Heading 2". `/cb` → "Code Block". `/tasks` → "Task List".

---

## A7: Auth/Invitation Flow Hardening

**Problem**: Email check collects ALL members. Error messages are generic.

### Changes to `convex/schoolAdmin.ts`

- Replace `.collect()` + in-memory email filter (~line 308-314) with `.filter(q => q.eq(q.field("email"), email.toLowerCase()))` in query
- Improve error messages:
  - `"Invitation is not pending"` → `"This invitation has already been used or cancelled."`
  - `"Invitation has expired"` → `"This invitation has expired. Please ask your administrator to send a new one."`
  - `"Email mismatch"` → `"This invitation was sent to ${invitation.email}. Please sign in with that email address to accept it."`
- Add `.take()` limits to `getMemberSeatSnapshotWithExclusions` (~line 31-56)
- Validate `invitation.orgId` matches accepting context
- Rate limit invitation creation (max 50/hour per admin)

**Verification**: Wrong email → clear error. Expired → clear error. Seat limit → enforced.

---

## A8: Version History Navigation Fix

**Problem**: Version history opens panel-within-panel. Restore triggers `window.location.reload()`.

### Changes

**`src/components/editor/tiptap-editor.tsx`**:
- Add `onVersionHistoryOpen` callback prop
- In compact/panel mode: clicking "Version History" calls callback instead of inline toggle
- Fix restore: Fetch updated content → `editor.commands.setContent(newContent)` instead of reload
- Add `onVersionRestore` callback for parent state updates

**`src/components/workspace/right-push-panel.tsx`** (ArtifactPanelContent):
- `onVersionHistoryOpen` → `router.push('/notes?id={artifactId}&versionHistory=true')`
- `onVersionRestore` → update local `artifact` state

**Verification**: Panel → "Version History" → full page. Restore → content updates, no reload.

---

# PHASE 2: UI, Canvas, Editor, Experience

Everything the user sees and interacts with. Builds on Phase 1's corrected data.

---

## B1: Quick Chat Bar Blur Fix

**Problem**: Clicking canvas while focused doesn't collapse bar. Handler at workspace-command-bar.tsx:84-97 only collapses if `!query`.

### Changes to `src/components/workspace/workspace-command-bar.tsx`

Line 88-92: Remove `if (!query)` guard. Always collapse focus on outside click. Preserve query text for when user returns.

**Verification**: Type text → click canvas → bar collapses. Click bar → text preserved.

---

## B2: Right Push Panel Toggle + Switch Fix

**Problem**: (1) Same button twice doesn't close. (2) Thread→artifact causes "artifact not found". (3) No smooth transition.

### Changes

**`src/app/workspace/page.tsx`** (~line 185-192):
- Toggle: if `panel.type === type && panel.id === id`, close panel

**`src/components/workspace/right-push-panel.tsx`**:
- `key={`${type}-${id}`}` on content to force clean remount
- `ArtifactPanelContent`: Reset state on `artifactId` change via `useEffect`
- `AnimatePresence mode="wait"` with cross-fade (opacity, 150ms)

**Verification**: Same button → closes. Thread→artifact → no error, smooth fade.

---

## B3: Resizable Right Panels

**Problem**: Hardcoded widths. No drag-to-resize.

### Changes to `src/components/workspace/right-push-panel.tsx`

- 6px invisible drag handle on left edge (`cursor: col-resize`)
- On mousedown → track mousemove → width between MIN=320, MAX=680
- Persist per type in localStorage: `workspace:panel-width:{type}`
- Read on open, fallback to `PANEL_WIDTHS[type]`

**Verification**: Drag → resizes. Close + reopen → persisted.

---

## B4: Workspace Entry/Exit + Multi-Visible Animation

**Problem**: Entry "doubts", flickers. Exit same. Now also need animations for multi-visible model.

### Changes to `src/components/workspace/workspace-canvas.tsx`

**Gradual reveal animation** (new concept):
- When workstream enters "revealing" state: content nodes fade in from opacity 0→0.6, scale 0.97→1, 300ms staggered (30ms per item)
- When workstream becomes "active" (primary): content opacity 0.6→1, 200ms
- When workstream goes from active to secondary: content opacity 1→0.6, 200ms
- When workstream exits visibility: content fades out 200ms, then unmount

**Card dissolution** (when content becomes visible):
- Card doesn't fully disappear — it transforms into a subtle header/title bar for the workstream zone
- Transition: card shrinks from full size to a compact title strip (workstream name + color accent), 350ms
- This strip stays visible as a spatial anchor so you know which zone you're in

**Confident zoom entry** (click on card):
- Zoom duration: 620ms → 450ms
- Target zoom: 1.5 → 1.7 (more immersive)
- No blur animation (causes GPU flash) — only opacity + scale

**Smooth exit** (Home button or decisive zoom-out):
- Content fades out 200ms → title strips expand back to full cards 300ms → zoom out to overview 350ms

**Pan-transition between workstreams**:
- When primary focus shifts: cross-fade (old primary dims to 0.6, new primary brightens to 1.0) over 200ms
- No zoom/viewport change — just opacity shift
- Subtle scale pulse on newly-primary workstream (1.0→1.01→1.0, 300ms) as "focus acquired" signal

**Workstream zone visual identity**:
- Each visible workstream gets a very subtle background gradient tint (derived from workstream color, ~3% opacity)
- Creates warm, distinct zones on the canvas
- "Currently working on" (last-accessed): subtle warm border glow using workstream color

**Verification**: Zoom in → content reveals gradually across multiple workstreams. Pan → focus shifts smoothly. Zoom out → everything returns to cards.

---

## B5: Unified AI Input with Fly-Out/Fly-In Animation

**Problem**: AI bar looks inconsistent. User wants same aesthetic everywhere with a sequential fly animation.

### Changes

**Create `src/components/shared/unified-ai-input.tsx`**:
- Same styling as workspace command bar: `rounded-2xl`, `bg-[var(--bg-elevated)]/95 backdrop-blur-xl`, warm border, same font/colors, `shadow-[0_8px_40px_-8px_rgba(0,0,0,0.35)]`
- Props: `onSubmit`, `placeholder`, `disabled`, `streaming`, `onStop`, `compact`, `icon`

**Fly-out/fly-in animation** (when right panel opens):
1. Command bar "flies out" downward (translateY 0→+40px, opacity 1→0, 200ms)
2. After 100ms delay: panel input "flies in" from above (translateY -20px→0, opacity 0→1, 250ms)
3. Creates impression of the same element traveling from canvas to panel
4. Reverse on panel close: panel input flies out upward, command bar flies in from below

**Replace inputs across codebase**:
- `src/components/editor/ai-bar.tsx`: Swap with `<UnifiedAiInput compact />`
- `src/components/workspace/right-push-panel.tsx` (ChatPanelContent): Swap composer
- `src/components/artifacts/artifact-ai-surface.tsx`: Swap input

**Verification**: Open panel → command bar flies out, panel input flies in. Close → reverse. All inputs share identical styling.

---

## B6: Artifact Organization Overhaul

**Problem**: Sidebar too narrow (300px), no filtering, selection highlight cut off, sometimes fails to open.

### Changes to `src/components/notes/notes-workspace.tsx`

- **Widen sidebar**: 300px → 360px
- **Filter bar** (below header): search input + type dropdown + workstream dropdown + sort (Recent/Name/Type)
- **Fix selection highlight**: Full-width bg `bg-[var(--accent-cyan)]/8` + left accent bar `border-l-3 border-[var(--accent-cyan)]`
- **Fix switching**: `key={noteId}` on TiptapEditor, explicit loading state between
- **Collapsible sections**: Group by workstream or type

**Verification**: Search → filters. Select artifacts → loads correctly, full-width highlight.

---

## B7: Document Metadata Header Redesign

**Problem**: Title constrained by dividers, dates generic, version history button awkward.

### Changes to `src/components/editor/tiptap-editor.tsx` (~line 414-436)

- Remove hard dividers
- 24px top padding for breathing room
- Single metadata line below content area: `"Created Mar 15 · Modified 2h ago · 3 versions"` in `text-[11px] text-[var(--text-tertiary)]`
- "3 versions" is clickable text, not a card
- Relative time for "Modified"
- Remove `"Document Artifact"` type label

**Verification**: Clean title, warm metadata line, no harsh dividers.

---

## B8: Block-Level Controls (+ and Drag)

**Problem**: Need Notion-style hover controls on left edge of every block.

### Changes to `src/components/editor/extensions/drag-handle.ts`

- Add "+" icon alongside drag grip (stacked)
- Position: 28px left of content, visible on block hover (150ms opacity transition)
- "+" click: Insert paragraph after block → move cursor → insert "/" to trigger slash commands

### CSS in `src/app/globals.css`
```css
.drag-handle-container { position: absolute; left: -32px; top: 2px; opacity: 0; transition: opacity 150ms; }
.ProseMirror > *:hover > .drag-handle-container { opacity: 1; }
```

**Verification**: Hover left → see "+" and grip. Click "+" → new line with slash dropdown.

---

## B9: Right-Click Canvas Context Menu

**Problem**: Limited options, not context-aware.

### Changes to `src/components/workspace/workspace-canvas.tsx` (~line 1351)

Context-aware menu:
- **Not in internal band**: "New Workstream", "New Document (Hub)", "Open Hub"
- **In internal band, primary workstream**: "New Thread", "New Document", "New Planner Item" (scoped)
- **In hub**: "New Document", "New Workstream"
- Add icons, section dividers

**Verification**: Right-click adapts to context.

---

## B10: Settings Panel Consistency

**Problem**: Different content on different pages.

### Changes to `src/components/global-settings-drawer.tsx`

- Remove `pathname !== "/"` conditional (~line 63-69)
- Always show: Theme + Account. Remove "Open chat controls" button.

**Verification**: Identical settings on all pages.

---

## B11: Artifact Creation Flow with Templates

**Problem**: Creating artifacts just makes blank documents. No type picker or templates.

### Changes

**Create artifact creation modal** (similar pattern to `WorkstreamCreateDialog`):
- Type picker grid: Document, Study Plan, Flashcard Deck, Code, Diagram, etc.
- Name input with auto-focus
- Template picker per type:
  - Document: Blank, Lab Report, Essay Outline, Study Guide, Meeting Notes
  - Study Plan: Blank, Exam Prep, Weekly Schedule
  - Flashcard Deck: Blank, Vocabulary, Concept Cards
  - Code: Blank, Python Script, Web Page
- Templates provide AI-generated starting content (stored as JSON presets)
- Create button → navigates to new artifact in current context

**Wire into**: notes-workspace "New" button, right-click canvas, right panel "New"

**Verification**: Click "New" → modal → select type → pick template → artifact created with template content.

---

## B12: Hub Entry Fix + Content + Timer Widget

**Problem**: Hub entry broken. Hub feels bland. User wants focus timer as canvas widget.

### Changes

**Fix hub entry** (`workspace-canvas.tsx`):
- Verify `__hub__` commitment works with new multi-visible model
- Hub uses same gradual reveal as workstreams (special case: hub IS a workstream zone)

**Hub content nodes** (`hub-internal-view.tsx`):
- Verify `buildHubNodes()` receives real data
- Content: Upcoming Deadlines, Recent Activity, Quick Notes, Quick Actions
- Wire data fetching for hub-level items (workstreamId=null)

**Focus Timer Widget** (NEW):
- Canvas-native node on the hub: Pomodoro timer with start/pause/reset
- Synced with existing timer popup (both read/write to same timer state in workspace store)
- Shows: current session time, session count, "Currently working on: [workstream name]"
- Integrates with the "currently working on" indicator
- Visual: warm accent border when active, subtle pulse on session complete
- Draggable like other hub nodes, position persisted

**Timer state**: Add `timerState: { active: boolean, sessionMinutes: number, elapsed: number, workstreamId?: string }` to workspace store. Both the canvas widget and any popup share this state.

**Verify counts**: threadCount + artifactCount display correctly on cards after A2.

**Verification**: Hub entry works. Timer starts/pauses. Timer widget + popup stay synced.

---

## B13: File Attachment UX

**Problem**: File attachment is slow and sometimes fails.

### Changes to chat message composer components

- Add progress indicator during upload
- Add error handling with retry button
- Show file size and estimated time
- Clear error messages on failure

**Verification**: Attach file → progress → success. Fail → error + retry.

---

## B14: Ambient Polish & Life

**Problem**: User wants the workspace to feel "alive without moving parts" — conveyed through effects, transitions, and micro-interactions, not continuous animation.

### Changes across multiple files

**Workstream zone warmth** (workspace-canvas.tsx):
- Subtle gradient tint per visible workstream zone (3% opacity of workstream color)
- "Currently working on" glow: last-accessed workstream gets a soft border glow
- Time-of-day greeting on hub: "Good morning" / "Good afternoon" with user name

**Micro-interactions**:
- Content items: subtle scale(1.01) on hover, 150ms ease
- Panel open/close: add slight spring physics (not just linear ease)
- Internal node entry: stagger fade-in (30ms per item) with subtle y-drift (-4px → 0)
- Workstream card hover: shadow deepens slightly, border warms

**Transitions timing table** (standardize across codebase):
| Transition | Duration | Easing |
|-----------|---------|--------|
| Content reveal (per item) | 300ms | ease-out, 30ms stagger |
| Primary focus shift | 200ms | ease |
| Card → title strip | 350ms | [0.22, 1, 0.36, 1] |
| Zoom entry (click) | 450ms | [0.22, 1, 0.36, 1] |
| Zoom exit | 350ms | ease-out |
| Panel open | 300ms | ease-out + slight spring |
| Panel close | 250ms | ease-in |
| Command bar fly-out | 200ms | ease-in |
| Panel input fly-in | 250ms | ease-out, 100ms delay |
| Item hover | 150ms | ease |

**No ambient motion**: Zero continuous animations, no spinning, no pulse effects at rest. Motion serves transitions only.

**Verification**: Everything feels warm and responsive. No jank. No continuous motion at rest.

---

# Execution Order

```
PHASE 1                                    PHASE 2
========                                   ========

A1 Bandwidth ──────────────────┐
A2 Count Tracking ──────────────┤
A3 Multi-Visible Zoom Model ───┼──── B1 Command Bar Blur (quick win)
A4 Real-Time Drag ──────────────┤     B2 Panel Toggle/Switch (quick win)
A5 Content Pre-Fetch ───────────┘     B3 Resizable Panels
A6 Slash Fuzzy ────────────────────── B8 Block Controls
A7 Auth Hardening                     B4 Multi-Visible Animations ── depends on A3, A5
A8 Version History Nav ────────────── B7 Document Metadata
                                      B5 Unified AI Input + Fly Animation
                                      B6 Artifact Organization
                                      B9 Context Menu
                                      B10 Settings Consistency
                                      B11 Artifact Creation + Templates
                                      B12 Hub + Timer Widget ── depends on A2, A3
                                      B13 File Attachment UX
                                      B14 Ambient Polish ── depends on B4, B5
```

**Quick wins** (no deps): B1, B2, B10, A6, A7
**Critical path**: A1 → A2 → A3 → A5 → B4 → B14
**Highest UX impact**: A3 (zoom model) + B4 (animations) + B5 (AI input)
**Last**: B14 (polish pass touches everything)

---

# Critical Files

| File | Sections |
|------|----------|
| `convex/usage.ts` | A1a |
| `convex/models.ts` | A1b, A1c |
| `convex/gamification.ts` | A1d |
| `convex/rag.ts` | A1e |
| `convex/superAdmin.ts` | A1f |
| `convex/chats.ts` | A1g, A2 |
| `convex/artifacts.ts` | A2 |
| `convex/schema.ts` | A1h |
| `convex/schoolAdmin.ts` | A7 |
| `src/stores/workspace-store.ts` | A3 (multi-visible state) |
| `src/components/workspace/workspace-canvas.tsx` | A3, A4, A5, B4, B9, B12, B14 |
| `src/lib/workspace/auto-layout.ts` | A3 |
| `src/components/workspace/workspace-command-bar.tsx` | B1 |
| `src/components/workspace/right-push-panel.tsx` | B2, B3, B5 |
| `src/app/workspace/page.tsx` | B2 |
| `src/components/editor/slash-command-extension.ts` | A6 |
| `src/components/editor/tiptap-editor.tsx` | A8, B7, B8 |
| `src/components/editor/extensions/drag-handle.ts` | B8 |
| `src/components/notes/notes-workspace.tsx` | B6 |
| `src/components/shared/unified-ai-input.tsx` | B5 (NEW) |
| `src/components/global-settings-drawer.tsx` | B10 |
| `src/components/workspace/hub-internal-view.tsx` | B12 |
| `src/app/globals.css` | B8, B14 |

---

# Verification Plan

After all changes:
1. `npx tsc --noEmit` passes
2. `next build` passes with zero errors
3. Convex deployment succeeds
4. Convex bandwidth < 500MB/3 days (from 2.5GB)
5. Zoom in → content reveals gradually across multiple workstreams
6. Pan between workstreams → seamless focus shift
7. Panel toggle, switch, resize all work
8. `/h2` matches "Heading 2" in slash commands
9. AI input identical style everywhere, fly-out/fly-in animation on panel open/close
10. Artifact sidebar: search, filter, sort, full-width selection, templates on create
11. Hub entry works, shows real content, timer widget synced with popup
12. Version history navigates to full page (not panel-in-panel)
13. Settings identical on all pages
14. Invitation flow: wrong email → clear error, seat limit enforced
15. No continuous animation at rest — only transitions
16. Block controls (+/drag) visible on hover in editor
