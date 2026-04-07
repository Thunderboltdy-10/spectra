# Spectra Workspace Recovery Plan — Full Audit & Staged Rebuild

---

## A. EXECUTIVE DIAGNOSIS

### What is fundamentally wrong

The Spectra workspace is structurally diverging from its intended design on multiple axes simultaneously. This is not a collection of bugs — it is a systemic failure where:

1. **The spatial model is wrong.** Workspace territories use radial auto-layout with 520–780px node widths at distances of 1875–4050 canvas units. The spec requires ~1500x1200px territories at positions like (0,0), (2000,0), (4000,0). Current zoom thresholds (0.3/0.7) combined with small node sizes mean zoomed-out workspaces are unreadable dots, not meaningful cards. The zoom range (0.08–2.5) is too wide, the thresholds are wrong, and the workspace territories are too small.

2. **Scroll does NOT zoom — it pans.** `panOnScroll=true, zoomOnScroll=false`. The user must pinch-to-zoom or use Ctrl+scroll. The spec says "Zoom in/out: scroll wheel or pinch." This alone makes the entire zoom-depth interaction model broken from the user's perspective.

3. **Semantic zoom tiers exist but are shallow.** Three bands (overview <0.3, summary 0.3–0.7, detail ≥0.7) only control opacity/scale of workstream cards. There are no progressive content reveals, no tint zones, no morphing representations, no grouped spatial regions. Zooming in just makes the same small cards bigger.

4. **Hub items / edge utilities have broken drag constraints.** Timer and workspace dock only constrain Y-axis drag — items can disappear off-screen horizontally. Timer bottom constraint is 0 (should be ~400). No snap-to-edge system. No bounds validation on restore. No unified margin system.

5. **Artifact loading has a critical double-read bug.** `response.json()` is called twice on the same Response object in `right-push-panel.tsx:480-486` — once for error checking, once for data. The body is consumed on first read. This makes note/artifact creation crash with `[object Object]`.

6. **Thread creation likely races.** `createChat` mutation has no deduplication. Two rapid `sendMessage()` calls with no existing chatId both create separate chats. Only `getOrCreateArtifactThread` has dedup logic.

7. **The right panel has regressed.** WorkspaceCommandBar was removed from the panel, in-panel composer was added, but the transition continuity (quick chat → panel) is absent. No resize awareness in some paths.

8. **Background tint zones do not exist.** The spec requires soft gradient-edged tint zones per content group (6-8% opacity, radial gradient edges). None are implemented. Only lifecycle opacity (active/quiet/completed/archived) exists.

9. **Top navigation breadcrumb still renders.** The EdgeUtilityOverlay renders a top-center breadcrumb with workspace name and back button when inside a workspace. The user wants this removed entirely.

### Why previous passes failed

Previous passes (tracked in FIXES.md and MASTER_FIXES.md) operated as local symptom patches rather than systemic corrections. Each "fix" addressed a surface bug without questioning whether the underlying model was correct. Examples:

- "Fixed handleInit" — patched URL-param entry but did not address that the spatial model itself is too small and scroll doesn't zoom
- "Fixed committed workspace node hidden" — hid a card but didn't address that the entire entry/exit model lacks progressive depth
- "Removed WorkspaceCommandBar from panel" — removed a component but didn't build the intended quick-chat-to-panel transition
- "Fixed drag handle displacement" — corrected positioning math but the scroll offset logic may still fail in certain container configurations
- Many MASTER_FIXES.md items remain `[ ]` unchecked, contradicting the `[x]` marks in FIXES.md

### What kind of recovery is needed

This is a **partial rebuild of the workspace surface layer** and a **significant correction of the interaction model**, not a bug-fix pass. Specifically:

- The spatial model (territory sizes, zoom thresholds, scroll behavior) needs rebuilding
- The hub item system needs proper edge constraints built from scratch
- The semantic zoom tier system needs to actually drive progressive rendering
- Tint zones need to be implemented (they don't exist)
- The artifact loading bug needs a one-line fix but the surrounding flow needs audit
- Thread creation deduplication needs backend work
- The right panel needs continuity design, not just component presence

---

## B. REALITY AUDIT

### Broken

| System | Status | Detail |
|--------|--------|--------|
| Scroll → zoom | **BROKEN** | `zoomOnScroll=false, panOnScroll=true` — scroll pans, does not zoom. Contradicts spec §1.8 |
| Artifact loading | **BROKEN** | `response.json()` double-read at `right-push-panel.tsx:480-486` crashes on note creation |
| Hub item drag bounds | **BROKEN** | No X-axis constraints; Y-axis asymmetric (timer bottom=0). Items escape off-screen |
| Background tint zones | **MISSING** | Not implemented at all. Only lifecycle opacity exists |
| Workspace title/icon on canvas | **REMOVED** | Previous passes deleted draggable workspace title. Only `workstreamTitle` node exists but scaled poorly |
| Thread deduplication | **BROKEN** | `createChat` has no dedup; rapid sends create duplicates |
| Quick-chat-to-panel transition | **MISSING** | No visual continuity animation between quick chat bar and panel opening |

### Partially implemented but fundamentally wrong

| System | Status | Detail |
|--------|--------|--------|
| Semantic zoom tiers | **WRONG MODEL** | 3 bands exist but only control opacity/scale of identical card representations. No progressive content reveal, no morphing, no different renderers per tier |
| Workspace territories | **TOO SMALL** | 520-780px nodes at 1875-4050 unit distances. Spec requires 1500x1200px. Everything is unreadably small when zoomed out |
| Hub item system | **WRONG CONSTRAINTS** | Framer Motion `drag` with pixel constraints instead of proper edge-rail system. No snap-to-edge, no contour boundary, no consistent margins |
| Workspace selector dock | **WRONG HOVER** | Hover changes width from 64→224px but restructures layout awkwardly. No home/all-workspaces button at top. Active state highlighting confused |
| Create radial menu | **CONFLICT** | Positioned bottom-center, conflicts spatially with quick chat which is bottom-right. Options too close at 68px radius. Missing "Create with AI" option |
| Right panel | **REGRESSED** | Close/expand buttons exist but UX is degraded. No resize handle in some contexts. Text cutoff. Reply composer is minimal |
| Context menus | **PARTIALLY WIRED** | Backend actions are wired but user reports they don't work reliably. May be event propagation issues |

### Cosmetically "fixed" but likely still wrong

| System | Claimed Fix | Reality |
|--------|-------------|---------|
| handleInit entry | FIXES.md ✓ | URL-param entry works but the destination workspace is still too small and lacks depth progression |
| Committed node hidden | FIXES.md ✓ | Node is hidden but the whole committed-entry transition is abrupt, not progressive |
| Drag handle position | FIXES.md ✓ | Math corrected but `scrollOffset = wrapper.scrollTop ?? 0` — if scroll container is a parent div, not `.tiptap-root`, offset is still 0 |
| Quick chat animation | FIXES.md ✓ | `layout` prop removed from motion div, but the actual quick-chat-to-panel continuity is not implemented |
| Right panel width | FIXES.md ✓ | `w-full` applied, but panel still not properly resizable in all contexts |
| Policy correction stripping | FIXES.md ✓ | Pipeline strips patterns, but the policy prompt still has legacy mode-first language that may trigger corrections |

### Regressed from earlier state

- Workspace title and icon were draggable — now deleted or rendered as a small scaled node
- Right panel used to have a command bar footer — now removed without replacement continuity
- The `layout` prop removal from motion divs may have broken hover animation fluidity for the workspace dock
- Auto-zoom-on-deep-scroll was removed (the "zoom > 0.9 find closest workstream" logic) — this was actually part of the intended progressive entry but was judged "buggy" and deleted instead of fixed

---

## C. SPEC vs CLAIMED FIXES vs CURRENT REALITY MATRIX

### Spatial Model

| Aspect | Spec Says | Fix Tracker Claims | Reality |
|--------|-----------|-------------------|---------|
| Territory size | ~1500x1200px per workspace | Not addressed | 520-780px node width |
| Territory spacing | (0,0), (2000,0), (4000,0) | Not addressed | Radial layout, 1875–4050 unit distances |
| Zoom at far out | ~0.15 shows readable landscape | Not addressed | 0.08 min zoom, everything becomes dots |
| Zoom at mid | ~0.5 fills screen with one workspace | Not addressed | 0.3-0.7 is "summary" band |
| Zoom at deep | ~1.0 shows rendered content | Not addressed | ≥0.7 is "detail" but node is only 720px |
| Scroll = zoom | "scroll wheel or pinch" | Not addressed | `zoomOnScroll=false` — scroll pans only |

### Hub Items / Edge Utilities

| Aspect | Spec Says | Fix Tracker Claims | Reality |
|--------|-----------|-------------------|---------|
| Edge binding | "draggable but only along edges" | Hub bar overhaul ✓ | Drag is Y-only with pixel constraints, not rail-based |
| Default padding | "from page border, not customizable" | Not addressed | Inconsistent: 40px some, 0px+32pad others |
| Quick chat position | "bottom center" — **confirmed: unified bar at center** | Position reset ✓ | Actually bottom-RIGHT. Center is the radial menu. **Must merge into unified bar** |
| Timer position | "bottom right" — **confirmed** | Not addressed | Currently bottom-LEFT. **Must move to right** |
| + button position | "bottom left" (or integrated into unified bar) | Not addressed | Currently bottom-CENTER. **Must integrate into unified bar or move to left** |
| Workspace selector | "left edge, macOS dock behavior" | Not addressed | Left edge, but hover restructures badly |
| Never disappear | Hub items never leave viewport | Not addressed | X-axis unconstrained, items can vanish |

### Zoom / Depth Tiers

| Aspect | Spec Says | Fix Tracker Claims | Reality |
|--------|-----------|-------------------|---------|
| Glance tier | "title + first 2 lines + type icon + status dot" | Glance renderers exist | Cards show title/emoji but not actual content previews |
| Touch tier | "actual content rendered, focus ring, typing" | Touch tier for detail band | Only Note and Code have touch editors; others are glance-only |
| Deep Edit | "panel opens, canvas dims, item highlighted" | Panel exists | Canvas does not dim; item not highlighted when panel opens |
| Progressive detail | "no hard boundary, content progressively gains detail" | Not addressed | Hard zoom band transitions at 0.3 and 0.7 |
| Tint zones | "6-8% opacity, soft gradient edge, radial gradient" | Not addressed | **Not implemented at all** |

### Thread Creation / Quick Chat

| Aspect | Spec Says | Fix Tracker Claims | Reality |
|--------|-----------|-------------------|---------|
| Thread creation | One thread per interaction | Quick chat fix ✓ | `createChat` has no dedup; race creates doubles |
| Panel auto-open | Thread opens in right panel | Not addressed | User reports having to manually click threads |
| Workspace intent | "create a workspace" creates workspace | detectWorkspaceIntent ✓ | Works for regex patterns but not natural language |
| Context badge | "subtle workspace badge" on quick chat | Not addressed | Quick chat shows workspace context when focused but no persistent badge |

### Artifact Loading

| Aspect | Spec Says | Fix Tracker Claims | Reality |
|--------|-----------|-------------------|---------|
| Error handling | Artifacts load reliably | errData String() coercion ✓ | **STILL BROKEN** — response.json() double-read consumes body |
| Note creation | Creates and opens in panel | Not explicitly tracked | Crashes with [object Object] due to the double-read |

---

## D. ROOT-CAUSE-ORIENTED BREAKDOWN

### 1. Architectural mismatch: Canvas is still a shortcut graph, not a working surface

The spec's core thesis — "the workspace is NOT a shortcut layer, it IS the working surface" — has not been architecturally realized. The canvas still renders small ReactFlow nodes (520-780px) positioned radially around a hub, with most interaction requiring a panel open. This is structurally the same as pre-redesign, just with more node types.

**Root cause:** Territory sizing and zoom calibration were never recalibrated from the original compressed layout. The auto-layout system (`auto-layout.ts`) still uses the old radial positioning model with small node widths.

### 2. Interaction model inversion: Scroll pans instead of zooming

`panOnScroll=true, zoomOnScroll=false` means the primary interaction (scroll wheel) does the wrong thing. Users expect scroll = zoom depth, but get pan. This makes the entire semantic zoom model invisible because users cannot easily traverse zoom levels.

**Root cause:** ReactFlow default configuration was set for a generic canvas, not for the spec's depth-driven interaction model.

### 3. Hub items lack a proper edge-rail constraint system

Framer Motion `drag="y"` with pixel-offset constraints is fundamentally wrong for edge-bound items. The spec describes items that "live on the edges" and "move smoothly along edges." The current system lets items float freely in one axis and has no X constraints, no edge detection, no snap behavior.

**Root cause:** Hub items were implemented as absolutely-positioned divs with Framer Motion drag, which is a general-purpose drag library, not an edge-rail system. A proper implementation needs a custom constraint system that maps mouse position to edge position (e.g., track which edge the item is on, constrain to that edge's axis, allow edge switching with clear thresholds).

### 4. Shallow patching over deeper incorrect structure

Many fixes addressed symptoms without questioning the model:
- "Fixed handleInit" → patched entry but didn't fix that entry has no progressive depth
- "Fixed drag handle displacement" → corrected offset math but the container reference might be wrong
- "Removed WorkspaceCommandBar from panel" → removed a component but didn't build the replacement
- "Fixed right panel width" → added `w-full` but didn't address the structural UX regression

### 5. Event ordering / state race conditions

Thread duplication is a classic race condition: two concurrent `getOrCreateChat()` calls both see no existing chat, both create. The fix needs backend-level idempotency (e.g., unique constraint on workstreamId+userId+recent-timestamp, or optimistic locking).

### 6. Response body consumption bug

`response.json()` consumes the ReadableStream. Calling it twice on the same Response is a fundamental API misuse. The fix is trivial (read once, branch on status), but it reveals that the error-handling pattern in `loadArtifact` was written without understanding of the Fetch API body consumption model.

---

## E. SYSTEM-BY-SYSTEM BREAKDOWN

### E1. Workspace Canvas / Spatial Model

**Current state:** Radial auto-layout with node widths 520-780px. Positions at 1875-4050 canvas units from hub center. Min zoom 0.08, max 2.5. Default viewport zoom 0.35.

**Required state:** Territory sizes ~1500x1200px. Positions at (0,0), (2000,0), (4000,0) etc. with significant spacing. Zoom 0.15 = readable landscape, 0.5 = one workspace fills screen, 1.0 = deep content view.

**Gap:** Territories are ~3x too small. Layout model is radial (not grid/linear). Zoom thresholds need complete recalibration. Min zoom likely needs raising (0.08 is too extreme).

**Action:** Rebuild `auto-layout.ts` positioning to use larger territories with grid-like spacing. Recalibrate node widths to 1500px minimum at detail tier. Adjust zoom bands to match spec thresholds. Raise minZoom to ~0.12-0.15.

### E2. Semantic Zoom / Render Tiers

**Current state:** Three zoom bands (overview<0.3, summary 0.3-0.7, detail≥0.7) control card opacity/scale only. `buildWorkspaceNodes` creates column-based lanes (Threads, Documents, Planner, artifact types) but only at detail level. Glance tier is the same card at lower opacity.

**Required state:** Progressive content revelation:
- Far zoom: readable cards with title + 2 lines + type icon + status dot
- Mid zoom: actual content rendered by type (Touch tier)
- Deep zoom: rich inline editing (Note/Code), interactive elements, detailed previews
- Tint zones appear as soft colored regions around content groups
- No hard transitions between tiers — progressive gain/loss of detail

**Gap:** No progressive rendering. Same card at all zoom levels (just scaled). No tint zones. Column layout only appears when committed to a workspace, not as progressive reveal. Touch tier editors (Note/Code) only activate on click in detail band.

**Action:** Implement zoom-driven renderer switching in `internal-content-nodes.tsx`. Create GlanceRenderer, TouchRenderer, DeepRenderer per content type. Drive visibility by current zoom level. Implement soft tint zones using CSS radial gradients at 6-8% opacity. Ensure progressive transition between tiers (no hard jumps).

### E3. Workspace Selector / All-Workspaces Navigation

**Current state:** Left-edge vertical dock. Collapsed=64px (4 emoji stack), hover=224px (workspace list). Active workspace has cyan highlight. "New Workspace" and "Schedule" buttons at bottom.

**Required state:** macOS-dock-like behavior. Hover expands smoothly showing name + emoji per workspace. Top position = home/all-workspaces view. Active workspace highlighted. No layout restructuring on hover.

**Gap:** Hover causes awkward restructuring (width animation from 64→224px changes layout). No home/all-workspaces button at top. Active highlighting logic is confused. "Schedule" button is non-functional. Layout flips on hover.

**Action:** Redesign dock expansion to grow smoothly without layout restructuring. Add home button at top. Fix active state to only highlight current workspace or show neutral state when in all-workspaces view. Remove non-functional "Schedule" button. Implement macOS dock magnification-style hover.

### E4. Hub Items / Edge Utilities

**Current state:** 5 positioned elements with inconsistent margins:
- Timer: bottom-10 left-10, Y-drag only, constraints top:-400 bottom:0
- Dock: left-0 pl-8, Y-drag only, constraints top:-200 bottom:200
- Quick chat: bottom-10 right-10, NOT draggable
- Radial menu: bottom-10 center, NOT draggable
- Top breadcrumb: top-6 center, NOT draggable

**Required state (confirmed by user):**
- Workspace selector: left edge
- **Unified command/create bar: bottom CENTER** — one capsule bar that handles BOTH quick chat input AND creation (radial + menu attaches to its left end or integrates within it)
- Timer/Focus: **bottom RIGHT** (confirmed — currently wrongly at bottom-left)
- All draggable along edges, consistent margins, never off-screen

**Gap:** Positions are inverted (quick chat at right, timer at left — both wrong). Quick chat and + menu are separate elements but should be a unified bar at center. Drag constraints are broken (no X bounds). No edge-rail system. No snap-to-edge. No consistent margin system.

**Action:** Complete redesign of the positioning and constraint system:
1. **Merge quick chat + create button into a unified bottom-center command bar** — capsule input with send button + radial/fan creation menu integrated at its left end
2. Move timer from bottom-left to **bottom-right**
3. Implement edge-rail constraint model (items track along edges with min/max bounds)
4. Add snap-to-edge with valid-region boundary
5. Implement consistent edge margin (40px from all edges)
6. Add bounds checking on position restore from localStorage
7. Remove top breadcrumb entirely (user request)

### E5. Creation Affordances (+ Menu / Right-Click / Workspace Creation)

**Current state:** Radial menu at bottom-center with 5 options (Note, Code, Visual, Task, Workspace). 68px radius, semicircle 30-150°. Context menus exist for empty canvas, items, groups — wired to backend.

**Required state:** Creation integrated into the unified bottom-center command bar. "Create with AI" option focuses the text input. Easy workspace creation. Context menus reliable. Default hub widgets (timetable/quick notes) deferred — only hub primitive shells from Waves 1-2 are in scope (workspace selector, unified command bar, timer, collapse toggle).

**Gap:** Creation is separate from chat — should be unified. Missing "Create with AI" option. Workspace creation works but is awkward (buried in radial). Context menus reportedly unreliable. Hub widget shells need to exist but full timetable/notes widgets are deferred.

**Action:** Integrate radial creation menu into the unified bottom-center bar. Add "Create with AI" option that focuses the input. Make workspace creation more prominent. Debug context menu reliability. Hub primitive shells only (no full timetable/notes widgets this pass).

### E6. Quick Chat (now part of unified command bar)

**Current state:** Bottom-right positioned input panel. Shows workspace context when focused. Sends message → `detectWorkspaceIntent` checks for workspace creation → if inside workspace, opens panel with `chat:new` and sets `openChatQuery`.

**Required state:** Part of the **unified bottom-center command bar** — a single capsule that handles both chat input and item creation. Context-aware per zoom level. Scope badge showing workspace name. "Create with AI" routing from the radial menu focuses this input.

**Gap:** Currently a separate element at bottom-right. Should be merged with creation controls into one unified bar at bottom-center. Intent detection is regex-only. No persistent scope badge.

**Action:** Merge into unified command bar at bottom-center. Add persistent scope badge. The radial creation menu's "Create with AI" option focuses the unified bar's input. Expand intent handling where feasible (full classifier is Wave 3, but basic improvements can be made now).

### E7. Thread Creation / Opening

**Current state:** `createChat` mutation creates unconditionally. No dedup. Quick chat flow: message → panel opens with `chat:new` → auto-sends. 

**Duplicate thread bug:** Two rapid calls to `getOrCreateChat()` before either resolves → both create new chats. The `openChatQuery` auto-send in the panel may also fire twice if the panel re-mounts.

**Action:**
1. Add deduplication to `createChat` (check for existing chat with same workstreamId+userId within last 5s)
2. Add optimistic locking or mutex in `use-chat-panel.ts` around chat creation
3. Ensure `openChatQuery` is consumed exactly once (clear it immediately after reading)
4. Verify panel auto-send effect doesn't fire on re-mount

### E8. Right Push Panel / Big Chat Transition

**Current state:** Panel has close button (X), expand button (ArrowUpRight). Resize via left drag handle (320-680px). In-panel composer with text input + send button. ReactMarkdown rendering. ThinkingBlock display.

**Gap:** No quick-chat-to-panel visual continuity (the quick bar should "fly into" the panel). Panel bugs in normal use (user reports). Text cutoff. Expand routes to different pages (/chat, /artifacts, /planner). No canvas dimming when panel opens.

**Action:**
1. Fix the response.json() double-read bug (immediate critical fix)
2. Implement canvas dimming when panel is open (subtle opacity reduction)
3. Design and implement quick-chat → panel transition animation
4. Audit text cutoff issues (likely overflow/whitespace CSS)
5. Ensure panel resize works consistently across all panel types

### E9. Artifacts / Artifact Editor / Artifact Loading

**Current state:** Artifact loading crashes due to double response.json() read. Editor drag handle has corrected math but may still have scroll offset issues. Artifacts save (persistence improved). Drag position within workspace does NOT persist (only workstream-level positions persist, not individual content item positions).

**Gap:**
- Loading crash (critical)
- Drag handle still potentially offset if scroll container isn't `.tiptap-root`
- Content item position persistence not implemented (only workstream node positions saved)
- No zoom-depth artifact morphing (artifacts look the same at all zoom levels)

**Action:**
1. Fix double response.json() read (one-line fix)
2. Verify drag handle positioning in real scroll contexts
3. Implement content item position persistence (widget positions relative to workspace)
4. Design zoom-tier artifact renderers (different representations at different depths)

### E10. Context Menus / Right-Click / Creation Flows

**Current state:** Context menus implemented with capture-phase pointerdown handler. Three target types (empty canvas, item, group). Backend actions wired (duplicate, move, archive, pin).

**Gap:** User reports context menus don't work reliably. The `data-context-menu` attribute check in the capture handler may not prevent closing on internal clicks in all cases. Event propagation may interfere with ReactFlow's own handlers.

**Action:** Debug context menu event flow. Check that `data-context-menu` is on all context menu DOM elements. Verify that capture-phase handler doesn't race with ReactFlow's event handling. Test on different target types.

### E11. Persistence of Layout/Configuration

**Current state:** Workstream positions persist (localStorage + 45s Convex sync). Widget positions persist relative to workspace. Hub item positions persist to store. Viewport persists to localStorage.

**Gap:** Individual content item positions within a workspace do NOT persist across sessions. Only the lane/column layout is computed. If a user drags items within a workspace, those positions are lost. The spec describes a spatial workspace where items are arranged and rearranged — this requires persistent item-level positioning.

**Layout model (confirmed by user):** Layout depends on the active view mode (`byType | byTopic | timeline`). New items should be placed in a reasonable auto-position (not stacked at origin), but the user can then drag items freely and those positions must persist. View mode changes may re-layout items, but user-overridden positions within a view mode should be remembered.

**Bandwidth constraint:** User explicitly notes Convex bandwidth must not be excessive. Item positions should batch-sync (similar to the existing 45s debounce for workstream positions) rather than syncing on every drag pixel.

**Action:** Add item-level position fields to workspaceItems (canvasX, canvasY). Auto-position new items in a sensible default position within their group/tint zone. Save user drag positions on drag-stop to localStorage immediately, batch to Convex on 45s debounce (same pattern as workstream positions). Respect Convex bandwidth limits.

### E12. Backend / Projection / Sync

**Current state:** Projection is event-driven via `workspace-content-mutated`. LRU cache (7 items). Batched workspace content fetch. Immediate projection on artifact creation (claimed).

**Gap:** Thread creation deduplication missing. Artifact loading API has body consumption bug. Item-level positions not stored. Projection may not be truly immediate for all creation paths (user reports having to manually click threads after creation).

**Action:** Fix createChat deduplication. Fix artifact loading API consumer. Add item position fields. Verify projection immediacy across all creation paths (artifact, thread, planner).

### E13. Regressions from Prior Passes

| Regression | Cause | Impact |
|-----------|-------|--------|
| Workspace title/icon removed | Prior pass deleted draggable title | Users can't see/drag workspace identity |
| Auto-zoom entry removed | "zoom > 0.9 find closest" judged buggy, deleted | Progressive zoom-into-workspace no longer works |
| Right panel command bar removed | Claimed fix, not replaced with transition | Panel feels disconnected from quick chat |
| `layout` prop removed from motion divs | Fix for animation issues | May break hover transition fluidity |
| Top breadcrumb still renders | Not addressed | Unwanted top navigation showing |

---

## F. PRIORITY AND DEPENDENCY MAP

### Tier 1: FOUNDATIONAL (must fix first, everything else depends on these)

1. **Fix scroll = zoom** — Without this, the entire depth interaction model is invisible
2. **Fix spatial model** — Territory sizes, zoom thresholds, layout spacing
3. **Fix artifact loading crash** — response.json() double-read makes system unusable
4. **Fix thread deduplication** — Creates confusion and data pollution

### Tier 2: STRUCTURAL (depends on Tier 1, enables correct UX)

5. **Implement semantic zoom tiers** — Progressive rendering at different depths
6. **Rebuild hub item edge-rail system** — Proper edge constraints, positions, margins
7. **Remove top breadcrumb** — Quick win, user request
8. **Fix workspace selector dock** — Hover behavior, home button, active state

### Tier 3: INTERACTION (depends on Tier 2)

9. **Implement tint zones** — Background regions for content groups
10. **Fix creation affordances** — + menu position, workspace creation, "Create with AI"
11. **Quick-chat-to-panel transition** — Visual continuity animation
12. **Fix right panel UX** — Canvas dimming, text cutoff, resize consistency
13. **Content item position persistence** — Save drag positions within workspace

### Tier 4: POLISH (depends on Tier 3)

14. **Workspace title/icon restoration** — Bring back draggable identity
15. **Timer state sync** — Deduplicate state management, fix pause-on-sidebar
16. **Context menu reliability** — Event propagation debugging
17. **Drag handle verification** — Scroll offset in real editor contexts
18. **Quick chat position/scope** — Move to center, add scope badge

### DO NOT POLISH BEFORE FIXING:
- Do not tune animations before scroll=zoom works
- Do not add ghost items before spatial model is correct
- Do not polish tint zone colors before tint zones exist
- Do not refine context menus before the canvas interaction model works
- Do not work on classifier/skills before the workspace surface is stable

---

## G. CONCRETE STAGED EXECUTION PLAN

### STAGE 0: Critical Crash Fixes (1-2 hours)

These are blocking usability and should be fixed immediately before any structural work.

**0.1 Fix artifact loading double-read bug**
- File: `src/components/workspace/right-push-panel.tsx:480-486`
- Fix: Read response.json() once, branch on response.ok
```typescript
const rawData = await response.json().catch(() => ({}));
if (!response.ok) {
  const errMsg = typeof rawData.error === "string" ? rawData.error : String(rawData.error || "Failed to load artifact");
  throw new Error(errMsg);
}
const data = rawData as { artifact: Record<string, unknown> };
```

**0.2 Fix thread creation deduplication**
- File: `convex/chats.ts` — `createChat` mutation
- Add: Check for existing chat with same `workstreamId` + `userId` created within last 10 seconds
- Also: Add mutex/flag in `use-chat-panel.ts` `getOrCreateChat()` to prevent concurrent creation
- Also: Ensure `openChatQuery` is cleared immediately after consumption in `right-push-panel.tsx`

**0.3 Remove top breadcrumb**
- File: `src/components/workspace/edge-utility-overlay.tsx`
- Remove: The `AnimatePresence` block that renders the top-center breadcrumb with back button (currently conditionally shown when `primaryWorkstreamId && !panelOpen`)

**Validation:**
- Notes/artifacts can be created and opened without crash
- Quick chat creates exactly one thread per message
- No breadcrumb bar at top of workspace

---

### STAGE 1: Spatial Model Rebuild (core foundation)

This is the most impactful change. Everything else is cosmetic noise if the spatial model is wrong.

**1.1 Fix scroll = zoom**
- File: `src/components/workspace/workspace-canvas.tsx`
- Change: `panOnScroll={false}`, `zoomOnScroll={true}`
- Keep: `panOnDrag={true}` (click-drag pans), `zoomOnPinch={true}`
- This matches the spec: "Zoom in/out: scroll wheel or pinch. Pan: click and drag on empty canvas."

**1.2 Rebuild territory sizing**
- File: `src/lib/workspace/auto-layout.ts`
- Change: Increase workspace territory sizes to ~1500x1200px canvas coordinates
- Change: Position workspaces on a grid-like layout with ~2000px spacing between centers
- Change: Adjust radial distances if keeping radial layout, or switch to grid positioning
- Keep: Status-based distance (active closer, archived farther) but with larger base distances

**1.3 Recalibrate zoom thresholds**
- File: `src/components/workspace/workspace-canvas.tsx` + `src/stores/workspace-store.ts`
- Change zoom bands to match new territory sizes:
  - Landscape/overview: zoom < 0.20 (see all workspaces as readable cards)
  - Summary/single-workspace: 0.20 – 0.55 (one workspace fills most of screen)
  - Detail/deep: zoom ≥ 0.55 (content-level detail, inline editing)
- Change: `minZoom: 0.12` (instead of 0.08), `maxZoom: 2.0` (instead of 2.5)
- Change: `defaultViewport: { zoom: 0.18 }` to start at landscape view

**1.4 Increase node widths**
- File: `src/components/workspace/workspace-canvas.tsx` (node width constants)
- Change: Overview band width from 520 → 800px minimum
- Change: Summary band width from 620 → 1200px
- Change: Detail band width from 720 → 1500px
- These should scale smoothly, not jump

**1.5 Fix auto-exit threshold**
- Currently exits at zoom < 0.25. With new thresholds, adjust to zoom < 0.15 or similar
- Ensure exit animation is smooth (fitView to landscape)

**Validation:**
- Scroll wheel zooms in and out
- At far zoom (~0.15), all workspaces are visible as readable cards with titles
- At mid zoom (~0.4), one workspace fills most of the screen
- At deep zoom (~0.8), content items are large and detailed
- Click-drag pans the canvas
- No "Maximum update depth exceeded" errors
- Workspace entry and exit still work correctly

---

### STAGE 2: Semantic Zoom Tiers & Progressive Rendering

With the spatial model correct, now make zoom level drive what users see.

**2.1 Implement zoom-driven workspace card morphing**
- At landscape zoom: Show workspace as a large card with title, emoji, item count, last-activity, status dot
- At summary zoom: Show workspace interior — grouped content areas visible, tint zones appear, titles of items visible
- At detail zoom: Show full content — inline editing available, Touch tier active
- These transitions should be progressive (opacity/scale/content transitions), not hard switches

**2.2 Implement tint zones**
- File: New CSS + modification to internal-content-nodes.tsx
- Each content group (Artifacts, Threads, Planner, etc.) gets a background region:
  - 6-8% opacity of a neutral color
  - Soft radial gradient edge (use `radial-gradient` or large `box-shadow` with high spread)
  - Different subtle tint per group (warm for artifacts, cool for threads)
  - Section header (12px, 45% opacity) above zone
- Groups should feel like "areas of knowledge" that fade into the canvas

**2.3 Progressive content reveal**
- At landscape zoom: Items not individually rendered, just the workspace card
- At summary zoom: Item titles visible within tint zones, type icons, status dots
- At detail zoom: Full content renderers active, Touch tier editors available
- Transition should use opacity and scale interpolation, not hard switches

**2.4 Restore progressive zoom-into-workspace**
- The removed "zoom > 0.9 find closest workstream" logic was actually part of the intended behavior
- Reimplement: When user zooms deep enough over a workspace, auto-commit to it (smooth transition)
- Use debounce to prevent accidental triggers
- Add threshold: must be centered over workspace, not just near it

**Validation:**
- Zooming out shows workspace cards that are readable and meaningful
- Zooming in progressively reveals more detail
- Tint zones visible as soft colored regions around content groups
- No hard visual jumps between zoom levels
- Auto-entry on deep zoom works without accidental triggers

---

### STAGE 3: Hub Item System Rebuild

**3.1 Implement edge-rail constraint system**
- Replace Framer Motion `drag="y"` with custom edge-rail logic:
  - Each hub item has an `edge: "top" | "bottom" | "left" | "right"` property
  - Drag is constrained to the assigned edge's axis
  - Edge switching requires deliberate gesture (e.g., drag past corner threshold)
  - All items respect consistent margin from viewport edge (40px)
  - Position clamped to viewport bounds on every drag move
  - Invalid positions snap back on release
- Bounds validation on localStorage restore (if stored position is off-screen, reset to default)

**3.2 Fix default positions to match confirmed layout**
| Item | Confirmed Position | Current Position | Fix |
|------|-------------------|-----------------|-----|
| Workspace selector | Left edge | Left edge ✓ | Keep |
| **Unified command bar** | **Bottom center** | Quick chat at right, + menu at center (separate) | **Merge into one unified bar at center** |
| Timer/Focus | **Bottom right** | Bottom left | **Move to right** |
| Hub toggle | Bottom left | Not implemented | Add |

**3.3 Fix workspace selector dock**
- Don't restructure layout on hover — use smooth width expansion
- Add home/all-workspaces button at top of dock
- Fix active state: highlight actual workspace, or show neutral when in all-workspaces view
- Remove non-functional "Schedule" button
- Implement macOS dock style: icons grow slightly on hover, tooltip shows name

**3.4 Fix timer/focus widget**
- Consolidate state management: single source of truth (workspace store), no separate localStorage
- Fix pause logic: only pause when timer-specific events occur, not sidebar collapse
- Remove redundant quick chat button from timer
- Fix Y-axis constraint: symmetric range (e.g., top:-200, bottom:200)
- Add clean UI for session count, break toggle

**3.5 Remove top breadcrumb**
- Already done in Stage 0.3

**Validation:**
- All hub items are visible and never disappear off-screen
- Dragging along edges feels smooth and correctly constrained
- Items snap back if released in invalid position
- **Unified command/create bar at bottom-center** (one capsule for chat + creation)
- **Timer at bottom-right** (moved from current bottom-left)
- Workspace selector expands smoothly on hover without layout jump
- Home button at top of dock navigates to all-workspaces view
- Timer doesn't pause on sidebar collapse
- Timer has no redundant quick chat button
- All hub items maintain consistent 40px edge margin

---

### STAGE 4: Right Panel & Quick Chat Continuity

**4.1 Implement canvas dimming when panel opens**
- When right panel slides in, canvas opacity reduces to ~0.85
- Targeted item (if any) remains at full opacity with subtle highlight
- Uses CSS transition for smooth dim/restore

**4.2 Implement quick-chat-to-panel transition**
- When quick chat sends a message and panel opens:
  1. Quick chat input bar animates downward/out (scale + opacity)
  2. Right panel slides in from right
  3. Panel's bottom composer animates upward/in
  4. Feels like the same interaction surface transforming
- When panel closes, reverse the animation

**4.3 Fix right panel text cutoff**
- Audit overflow CSS in panel content areas
- Ensure `overflow-y: auto` is set on message containers
- Verify word-wrap/overflow-wrap on message text
- Test with long unbroken strings and code blocks

**4.4 Ensure panel resize works consistently**
- Verify drag handle visible and functional for all panel types (chat, note, artifact, planner)
- Ensure width persists correctly per panel type

**Validation:**
- Canvas dims when panel opens, returns to normal when panel closes
- Quick chat visually transitions into panel composer
- No text cutoff in any panel content
- Panel resizable via left drag handle for all types
- Panel close button and expand button work reliably

---

### STAGE 5: Creation, Context Menus, Persistence

**5.1 Integrate creation into unified command bar**
- The radial create menu becomes part of the unified bottom-center bar (built in Stage 3)
- Increase radius from 68px to 85-100px (more spacing between options)
- "Create with AI" option focuses the unified bar's text input
- Workspace creation option should be prominent and easy to discover

**5.2 Fix context menu reliability**
- Debug event propagation between context menu, ReactFlow, and hub items
- Ensure `data-context-menu` attribute is on all menu elements including nested buttons
- Test right-click on: empty canvas, workstream card, content item, group zone
- Verify all backend actions actually execute (not just render)

**5.3 Implement content item position persistence**
- Add `canvasX`, `canvasY` fields to workspaceItems schema (or use a separate table)
- Save positions on drag-stop (debounced)
- Include in batch position sync
- Restore positions on workspace re-entry

**5.4 Restore workspace title/icon**
- Bring back draggable workspace title + emoji as a prominent element when inside a workspace
- Position it as a header/anchor for the workspace content area
- Make it draggable within the workspace
- Show workspace color accent

**5.5 Fix workspace creation UX**
- Make workspace creation more prominent (larger radial menu item, or dedicated button)
- Ensure "Create workspace" option is visible in context menu on empty canvas
- Quick chat "create a workspace" should work reliably

**Validation:**
- + menu is at bottom-left with properly spaced options
- Right-click works reliably on all targets
- Content items remember their positions across sessions
- Workspace title and icon visible when inside a workspace
- Workspace creation is easy and discoverable from multiple entry points

---

### STAGE 6: Editor & Artifact Fixes

**6.1 Verify drag handle positioning**
- Test drag handle in:
  - Standalone editor page
  - Right panel editor
  - Inline workspace editor (if implemented)
- Verify `wrapper.scrollTop` is correct for each context
- Fix if `.tiptap-root` is not the scroll container in some contexts

**6.2 Artifact zoom-depth morphing (design)**
- Design how artifacts should look at different zoom levels:
  - Landscape: just a type icon + title pill
  - Summary: title + first 2-3 lines preview
  - Detail: full content with inline editing
- This connects to Stage 2 work but specifically for artifact content

**Validation:**
- Drag handle aligns correctly to the line being hovered
- Handle sits just beside the first character position
- Handle works in all editor contexts without displacement

---

## H. VALIDATION CRITERIA

### Stage 0 Validation
- [ ] Create a note from workspace → opens in panel without [object Object] error
- [ ] Send 3 rapid messages from quick chat → only 1 thread created each time
- [ ] No breadcrumb/back button visible at top of workspace

### Stage 1 Validation
- [ ] Scroll wheel zooms in/out (NOT pans)
- [ ] Click-drag pans the canvas
- [ ] At zoom ~0.15: all workspaces visible as readable cards (not dots)
- [ ] At zoom ~0.4: one workspace fills most of the viewport
- [ ] At zoom ~0.8: content items are large enough to read/interact with
- [ ] No "Maximum update depth exceeded" errors during zoom
- [ ] Workspace entry (click/zoom) and exit (Escape/zoom-out) work correctly

### Stage 2 Validation
- [ ] Tint zones visible as soft colored background regions around content groups
- [ ] Zooming in progressively reveals more content detail (not just bigger same card)
- [ ] At landscape zoom: workspace cards show title + emoji + item count
- [ ] At deep zoom: content items show full rendered content
- [ ] No hard visual jumps between zoom tiers
- [ ] Zooming deep enough into a workspace auto-enters it

### Stage 3 Validation
- [ ] No hub item can be dragged off-screen in any direction
- [ ] Items snap back if released in invalid position
- [ ] Unified command/create bar at bottom-center; timer at bottom-right
- [ ] Workspace dock hover expands smoothly without layout jump
- [ ] Home button in dock shows all-workspaces view
- [ ] Timer doesn't pause on sidebar collapse
- [ ] Timer has no redundant quick chat button
- [ ] Consistent 40px margin from all edges

### Stage 4 Validation
- [ ] Canvas dims visually when right panel is open
- [ ] Quick chat bar animates into panel composer on panel open
- [ ] No text cutoff in panel messages or artifact content
- [ ] Panel resize works for all panel types
- [ ] Close and expand buttons work reliably

### Stage 5 Validation
- [ ] + menu at bottom-left with options spaced > 30px apart
- [ ] Right-click on empty canvas shows creation menu with working actions
- [ ] Right-click on item shows item actions that execute correctly
- [ ] Content items keep their dragged positions after page reload
- [ ] Workspace title/icon visible and draggable when inside a workspace
- [ ] Workspace can be created from: radial menu, context menu, and quick chat

### Stage 6 Validation
- [ ] Drag handle aligns to hovered line in standalone editor
- [ ] Drag handle aligns to hovered line in right panel editor
- [ ] Handle sits just to the left of where text begins

---

## I. OPEN QUESTIONS / CLARIFICATIONS

*Questions 1, 3, 4, 6 were answered by the user during planning:*
- **Bottom bar:** Confirmed as unified bar at center (quick chat + creation merged)
- **Timer:** Confirmed bottom-right
- **Hub widgets:** Deferred — only hub primitive shells from Waves 1-2 in scope
- **Inner layout:** View-mode-driven (`byType | byTopic | timeline`). Items auto-positioned initially, user drags persist. Convex bandwidth must be kept reasonable.

### Remaining open questions:

1. **Workspace selector detail:** Image 1 shows a left-side vertical element with "Planner" tab visible on the right edge. Is the "Planner" on the right edge a separate panel tab (like a collapsible planner widget), or is it part of the workspace selector? This affects whether the right edge needs a persistent planner tab.

2. **Canvas background preference:** The current implementation has dots/grid/blank mode toggle as hub controls. Do you want to keep this toggle, or settle on one default? The spec doesn't mention background pattern options specifically.

3. **"Dots completed" and "links" toggles on timer:** You mentioned these feel wrong. Should they be removed entirely, or moved to a settings area?

4. **Thread panel auto-open:** When quick chat sends a message, the panel should auto-open. Currently there IS logic for this (`openPanel('chat', 'new')` + `setOpenChatQuery`). Is the issue specifically that TWO threads are created (race condition) and the confusion prevents either from opening properly? Or is it a separate auto-open bug even when only one thread is created?

---

## FILES REQUIRING MODIFICATION (by stage)

### Stage 0
- `src/components/workspace/right-push-panel.tsx` (line 480-486)
- `convex/chats.ts` (createChat mutation)
- `src/components/workspace/edge-utility-overlay.tsx` (remove breadcrumb)

### Stage 1
- `src/components/workspace/workspace-canvas.tsx` (scroll config, zoom thresholds, node widths)
- `src/lib/workspace/auto-layout.ts` (territory sizing, spacing)
- `src/stores/workspace-store.ts` (zoom band values)

### Stage 2
- `src/components/workspace/views/internal-content-nodes.tsx` (zoom-driven renderers)
- `src/components/workspace/workspace-canvas.tsx` (tint zones, progressive rendering)
- `src/app/globals.css` (tint zone CSS)

### Stage 3
- `src/components/workspace/edge-utility-overlay.tsx` (complete rebuild of positioning/constraints)
- `src/stores/workspace-store.ts` (hub item state)

### Stage 4
- `src/components/workspace/right-push-panel.tsx` (panel UX)
- `src/app/workspace/page.tsx` (canvas dimming, transition)
- `src/components/workspace/edge-utility-overlay.tsx` (quick chat transition)

### Stage 5
- `src/components/workspace/edge-utility-overlay.tsx` (menu position, workspace title)
- `src/components/workspace/workspace-canvas.tsx` (context menus, item persistence)
- `convex/schema.ts` or `convex/workspaceItems.ts` (position fields)

### Stage 6
- `src/components/editor/extensions/drag-handle.ts` (positioning verification)
