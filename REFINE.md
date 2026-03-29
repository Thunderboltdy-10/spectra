# Spectra Workspace: Complete Overhaul Plan

## Context

Spectra's workspace is an AI-native school canvas where workstreams, threads, documents, and artifacts coexist on an infinite zoomable surface. Phase 2 implementation (tasks 2A-2F) was completed by a previous conversation, but a deep audit reveals **20+ bugs, 10+ missing implementations, and multiple broken UX flows** across both backend and frontend. The remaining tasks (2G-2K) are incomplete, and the completed tasks have significant quality issues.

The user wants: a personal sanctuary that feels alive without moving, a continuous seamless canvas (not separate pages), Notion-quality document editing, AI integrated everywhere, and all data actually flowing (counts, messages, graph). The current state is far from this vision.

This plan is structured in two macro-phases: **A (Backend & Logic)** and **B (UI & Experience)**.

---

# PHASE A: Backend, Logic, Data Integrity

All backend fixes that unblock the UI. No visual changes here -- pure correctness.

---

## A1: Schema & Count Tracking

### Add threadCount to workstreams
- **`convex/schema.ts`**: Add `threadCount: v.optional(v.number())` to workstreams table
- **`convex/chats.ts`**: Create `ensureWorkstreamThreadCount()` (model on `ensureWorkstreamArtifactCount` in `convex/artifacts.ts:80-94`). Call it after:
  - `createChat` (after line 383)
  - Any chat deletion/archive mutation
  - Any mutation that changes a chat's `workstreamId`
- **`src/hooks/use-workspace-data.ts`**: Already declares `threadCount?: number` on line 22 -- will now receive data

### Add messageCount to chat listings
- **`convex/chats.ts`**: In `listByWorkstreamSummary` query (line 277-310), add message count per chat. Use a `messageCount` field on the `chats` table (denormalized, incremented in `sendMessage`) rather than counting on read.
- **`convex/schema.ts`**: Add `messageCount: v.optional(v.number())` to chats table
- **`convex/messages.ts`**: After inserting a message, increment the parent chat's `messageCount`

### Fix artifact count race condition
- **`convex/artifacts.ts:80-94`**: Replace read-count-write with atomic counter: `ctx.db.patch(workstreamId, { artifactCount: (ws.artifactCount ?? 0) + delta })` where delta is +1 or -1 depending on operation. Remove the full `collect().length` pattern.
- Apply same atomic pattern to `ensureWorkstreamThreadCount`

---

## A2: Notes-to-Artifacts Full Migration

### Data model
- **`convex/artifacts.ts`**: Ensure `type: "document"` artifacts support all note fields (editorMode, contentPlaintext, sourceType). Most fields already exist per PLAN.md 1A.
- **`convex/notes.ts`**: Add a migration helper `migrateNoteToArtifact()` that:
  1. Creates artifact with `type: "document"`, copies all fields
  2. Creates initial `artifactVersions` entry
  3. Stores `legacyNoteId` on the artifact for backward compat
  4. Returns the new artifact ID

### Hook consolidation
- **`src/hooks/use-artifact-data.ts`**: Refactor to query artifacts table directly (currently proxies through `/api/notes`). Add:
  - `createDocument()` -- creates artifact with `type: "document"`
  - `updateDocument()` -- updates artifact, triggers version creation
  - `listDocuments(workstreamId?)` -- lists document-type artifacts
- **`src/hooks/use-notes-data.ts`**: Keep as thin wrapper around `useArtifactData` for backward compat. Deprecate.

### API consolidation
- **`src/app/api/notes/route.ts`**: Proxy to artifacts API with `type: "document"`. All creates go through artifacts.
- **`src/app/api/artifacts/route.ts`**: Handle all CRUD including document-type operations

### Fix legacy noteId in AI mutations
- **`src/components/editor/ai-bar.tsx:162`**: The line `const targetArtifactId = artifactId ?? noteId` fails when noteId is a legacy notes table ID. Fix: if `noteId` is provided and `artifactId` is not, call a migration endpoint first to get/create the artifact ID, THEN use it.
- **`convex/artifacts.ts`**: Add `getOrMigrateFromNote(noteId)` query that returns the artifact ID for a legacy note (migrating on-demand if needed)

---

## A3: AI Edit Lifecycle Fixes

### Break confirm retry loop
- **`src/components/editor/ai-bar.tsx:83-95`**: The countdown timer calls `confirmPendingEdit()` every second. If it fails, `remainingMs` is set to 0, which causes the next timeout to fire immediately (Math.min(1000, 0) = 0). Fix:
  - Add `retryCount` state, max 3 retries
  - On failure: increment retryCount, if >= 3 set status to "confirm_failed" and stop timer
  - Show "Confirmation failed -- changes are saved locally" message
  - Add "Retry" button for manual retry

### Fix discard not reverting
- **`src/components/artifacts/artifact-ai-surface.tsx:100-104`**: `handleDiscard()` has a TODO. Implement:
  - Call `discardAiEdit` mutation with `versionId`
  - Mutation restores `diff.previous` content to the artifact
  - Mark version as `status: "discarded"`
  - Revert editor content via `editor.commands.setContent(previousContent)`

### Fix discard timer cleanup
- **`src/components/artifacts/artifact-ai-surface.tsx:79-90`**: Timer uses `setInterval` without cleanup on unmount. Wrap in `useEffect` with proper cleanup function. Clear interval on component unmount or when timer reaches 0.

### Fix version confirm overwrite risk
- **`convex/artifacts.ts:562-591`**: Before confirming, compare artifact's current content hash with the version's expected content. If they differ (user edited after AI apply), auto-confirm without content change (the version is already a historical record).

---

## A4: Data Fetching for Internal Views

### Add planner items API
- **`src/app/api/planner/route.ts`** (NEW): Create REST endpoint that queries `plannerItems` table by `workstreamId`. Support `?workstreamId={id}` and `?hub=1` (no workstreamId = hub-level).

### Wire data fetching in canvas
- **`src/components/workspace/workspace-canvas.tsx:560-618`**:
  - Line 563: Change `const [internalPlannerItems] = useState(...)` to `const [internalPlannerItems, setInternalPlannerItems] = useState(...)`
  - Line 564: Same for `internalArtifacts` → add setter
  - In the useEffect (line 579-617): Add parallel fetches for `/api/planner?workstreamId=` and `/api/artifacts?workstreamId=&type=document`. Parse responses and call setters.

### Wire hub data aggregation
- Hub-level content = items with `workstreamId: null`:
  - Quick Notes: `/api/artifacts?type=document` (no workstreamId)
  - Upcoming Deadlines: `/api/planner?hub=1&days=14`
  - Recent Activity: `/api/chats?limit=10` (no workstreamId)
- Pass this data to `buildHubNodes()` in workspace-canvas.tsx when hub is committed

---

## A5: Position Persistence Wiring

### Create Convex mutation
- **`convex/workstreams.ts`**: Add `batchUpdatePositions` mutation accepting `[{workstreamId, x, y}]` array, patches each workstream's `canvasX`/`canvasY`

### Wire in page
- **`src/app/workspace/page.tsx`**: In WorkspaceContent, call `registerSyncCallback()` with a function that POSTs to `/api/workstreams` with `action: "batchUpdatePositions"`
- **`src/app/api/workstreams/route.ts`**: Handle `action: "batchUpdatePositions"` in POST handler

---

## A6: Cleanup & Artifact Deletion Cascades

- When artifact deleted: update linked chats (clear `artifactId`), clear planner item references
- When chat deleted: decrement workstream `threadCount`
- `convex/artifacts.ts:restoreVersion` (line 735): Add `ensureWorkstreamArtifactCount()` call
- Remove dead code: `convex/notes.ts` `artifactId` filter (line 233) is always empty

---

# PHASE B: UI, Canvas, Editor, Experience

Everything the user sees and interacts with. This phase depends on Phase A for correct data.

---

## B1: Slash Command & Editor Bug Fixes

### Fix unmount race condition
- **`src/components/editor/slash-command-renderer.tsx:67,77`**: Wrap `root?.unmount()` in `queueMicrotask()`:
  ```ts
  onExit() {
    popup?.remove(); popup = null;
    const r = root; root = null; componentRef = null;
    queueMicrotask(() => r?.unmount());
  }
  ```
  Same pattern in `onKeyDown` Escape handler (line 64-70).

### Add Tab completion
- **`src/components/editor/slash-command-list.tsx:77-93`**: Add `case "Tab"` that calls `selectItem(selectedIndex)` and returns true.

### Fix keyboard/mouse selection desync
- **`src/components/editor/slash-command-list.tsx:129-131`**: The `globalIndex` counter in the render loop desyncs with `items.indexOf(item)`. Fix: use a flat items array with pre-computed indices, not per-section indexing.

### Import drag handle extension
- **`src/components/editor/tiptap-editor.tsx`**: Import `DragHandle` from `./extensions/drag-handle` and add to extensions array after `Callout`.
- **`src/components/editor/extensions/drag-handle.ts:84`**: Change CJS `require("@tiptap/pm/state")` to ES import.

### Fix blue focus outline
- **`src/app/globals.css`**: Add:
  ```css
  .tiptap-root .ProseMirror:focus,
  .tiptap-root .ProseMirror:focus-visible {
    outline: none;
    box-shadow: none;
  }
  ```

### Fix bullet list rendering
- **`src/app/globals.css`**: Add explicit list-style:
  ```css
  .tiptap-root .ProseMirror ul:not([data-type]) { list-style-type: disc; }
  .tiptap-root .ProseMirror ol { list-style-type: decimal; }
  .tiptap-root .ProseMirror ul:not([data-type]) li,
  .tiptap-root .ProseMirror ol li { display: list-item; }
  ```

### Fix placeholder persistence
- **`src/app/globals.css`**: The `is-editor-empty` class only applies to the root. For per-node placeholders, add:
  ```css
  .tiptap-root .ProseMirror > .is-empty:first-child::before {
    content: attr(data-placeholder);
    color: var(--text-tertiary);
    pointer-events: none;
    float: left; height: 0;
  }
  ```
- **`src/components/editor/tiptap-editor.tsx:91-94`**: Configure Placeholder with `showOnlyWhenEditable: true, showOnlyCurrent: true` to prevent placeholder on non-empty documents.

---

## B2: Editor Experience Overhaul (Notion-like)

### Inline title (title IN the document)
- **`src/components/editor/tiptap-editor.tsx`**: Add `showDocumentMeta` prop. When true:
  - Render a non-editable metadata header above EditorContent: title (extracted from first H1), dates, version history button
  - The first H1 in the document IS the title. If content loads without H1, prepend one.
  - Below the H1: show "Created {date} | Modified {date}" in text-xs text-tertiary
  - "Version History" button opens a side panel (or uses EditorStore's `isVersionHistoryOpen`)
- **`src/components/notes/notes-workspace.tsx`**: Remove separate title header bar (line 148-152). Pass `showDocumentMeta` to TiptapEditor.
- **`src/components/workspace/right-push-panel.tsx`**: Remove separate title `<input>` in NotePanelContent (line 388-398). Use `showDocumentMeta` in compact form.

### Floating block menu (Notion-style + button per line)
- **`src/components/editor/tiptap-editor.tsx`**: Implement a `BlockMenu` component that:
  - Appears on the left of any block when hovered (24px left of content)
  - Shows "+" icon that opens slash command dropdown at that position
  - Shows drag grip icon (reuses drag handle visuals)
  - Uses ProseMirror `decorations` or a hover-tracking plugin
  - CSS already exists at `globals.css:1570` (`.floating-menu`)

### Bubble menu enhancement
- Current: custom `SelectionToolbar` positioned manually (tiptap-editor.tsx:324-349)
- Issue: positioning can go off-screen (no collision detection)
- Fix: Add viewport bounds checking. If toolbar would render above viewport, flip below selection.

### Character/word counter
- Already using `CharacterCount` extension. Add display at bottom of editor:
  ```
  {characters} characters | {words} words
  ```
  Styled `text-[10px] text-[var(--text-tertiary)]` at the bottom-right of the editor container.

### Rename Notes to Artifacts throughout UI
- **`src/components/notes/notes-workspace.tsx:87`**: "Notes" → "Artifacts"
- **`src/components/notes/notes-workspace.tsx:90`**: "documents" → "artifacts"
- **`src/components/workspace/right-push-panel.tsx:65`**: `note: "Document"` → `note: "Artifact"`
- **Navigation/sidebar**: Any link saying "Notes" → "Artifacts"
- Keep URL path `/notes` for compat but display label changes

---

## B3: Canvas Continuity & Zoom Experience

### Fix hub node disappearing on zoom-out
- **`workspace-canvas.tsx:761`**: `hidden: !!committedWorkstreamId` makes hub invisible when any workstream is committed. Change to:
  - Never hide the hub node (let opacity handle visibility)
  - When committed: animate hub opacity to 0 (not hidden=true, which removes from DOM)
  - On exit: animate hub opacity back to 1

### Raise auto-commit threshold
- **`workspace-canvas.tsx:96`**: Change internal band from `zoom >= 0.95` to `zoom >= 1.1`
- **`workspace-canvas.tsx:718`**: Raise debounce from 400ms to 600ms
- **`workspace-canvas.tsx:744`**: Tighten proximity gate from 500 to 350 canvas units

### Fix exit workstream (double-press)
- **`src/app/workspace/page.tsx:140-155`**: `handleCommitWorkstream(null)` updates URL but does NOT call `exitWorkstream()` from the store. Add `exitWorkstream()` call when `workstreamId` is null:
  ```ts
  if (workstreamId) {
    updateWorkspaceRoute({ ws: workstreamId, hub: undefined }, "push");
  } else {
    exitWorkstream(); // <-- ADD THIS
    updateWorkspaceRoute({ ws: undefined, panel: undefined, ... });
  }
  ```

### Improve dissolution transition
- **`workspace-canvas.tsx:240-246`**: Current: opacity 0, scale 1.15, blur 4px, 0.4s. Enhance:
  - Extend to 0.5s
  - Add subtle y-drift: `y: dissolving ? -6 : 0`
  - Border: animate borderColor to transparent over first 0.3s
  - Other workstreams: ensure smooth linear opacity fade (already computed as `neighborOpacity`)

### Fix background dots at all zoom levels
- **`workspace-canvas.tsx:480-490`**: React Flow `<Background>` should scale with zoom. If dots disappear at low zoom, pass zoom-adjusted gap:
  ```tsx
  function FlowBackground({ mode, zoom }) {
    const gap = mode === "dots" ? Math.max(20, 28 * Math.min(zoom / 0.5, 1)) : 56;
    // ... rest
  }
  ```
  Pass `zoom` from `useStore(s => s.transform[2])` or from the parent's viewport state.

### Single-click exit behavior
- **`workspace-canvas.tsx`**: When breadcrumb "Workspace" is clicked or Escape pressed while committed:
  1. Call `handleCommitWorkstream(null)` (which now calls exitWorkstream)
  2. Animate viewport to `previousViewport` over 500ms
  3. Internal nodes fade out during animation
  4. Workstream border re-forms (reverse dissolution)

---

## B4: Hub Internal View (Canvas-Native, Replace Overlay)

### Delete overlay approach
- **`src/app/workspace/page.tsx:282-290`**: Remove the `HubFocusPanel` overlay rendering entirely
- **`src/components/workspace/workstream-focus-panel.tsx`**: Delete file (1962 lines of legacy code)

### Wire hub data into canvas nodes
- **`workspace-canvas.tsx`**: When hub is committed (`committedWorkstreamId === "hub"` or a special hub commit flag):
  - Fetch hub-level data (A4 provides the queries)
  - Call `buildHubNodes(hubData, basePosition)` from `hub-internal-view.tsx`
  - Inject resulting nodes into React Flow

### Hub commitment flow
- Hub node click OR Hub toolbar button → set `committedWorkstreamId` to a sentinel value (e.g., `"__hub__"`)
- Same dissolution transition as workstreams
- Hub content appears as canvas-native nodes (Quick Notes, Deadlines, Activity, Quick Actions)

### Home vs Hub distinction
- **`src/components/workspace/workspace-toolbar.tsx`**: Two buttons:
  - Home (house icon): Calls `handleCommitWorkstream(null)` → resets to overview zoom
  - Hub (compass icon): Commits to hub → shows hub internals
  - Both always visible; active state indicates current location

---

## B5: Command Bar Enhancements

### Workstream dropdown with "Auto" default
- **`workspace-command-bar.tsx`**: When expanded in global view (not committed):
  - Show dropdown above input with options: "Auto (detect)" + list of active workstreams + "General chat"
  - "Auto" is default: uses keyword matching against workstream titles to auto-route
  - Selected workstream shows as a badge chip in the input area

### Auto-zoom on send
- **`workspace-command-bar.tsx`**: When user sends with a workstream selected:
  1. Call `onOpenWorkstreamChat(workstreamId, query)`
  2. This triggers: zoom into workstream → open chat panel with the message
- **`src/app/workspace/page.tsx:252-254`**: Enhance `onOpenWorkstreamChat` handler:
  ```ts
  onOpenWorkstreamChat={(workstreamId, query) => {
    handleCommitWorkstream(workstreamId);
    // Small delay for zoom animation, then open panel
    setTimeout(() => handleOpenPanel("chat", "new"), 500);
  }}
  ```

### Command bar hides when panel open (already implemented)
- **Verify**: `hidden={!!panel}` at page.tsx:249 correctly removes command bar when right panel is open.

---

## B6: Internal View Polish

### Remove outlines, improve spacing
- **`internal-content-nodes.tsx`**: GroupNode and ColumnNode need explicit transparent backgrounds and no borders. Add `style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}` to root containers.
- **`src/app/globals.css`**: Add styles for `.internal-group-node`, `.internal-column-node` since they're referenced but never defined.
- Increase inter-group gap: `GAP = 24` → `GAP = 36` in `buildStructuredNodes`

### Fix graph view rendering
- Graph view uses same data arrays as structured/column. Once A4 wires the fetch, graph will populate.
- Fix radial layout centering: ensure `basePosition` offsets are correct
- Fix temporal proximity edges: ensure timestamps are compared in same units (ms)

### Fix item click for planner items
- **`internal-content-nodes.tsx:135,218`**: Planner items have `panelType: undefined`. Add a `panelType: "planner"` and handle in right-push-panel (even if just showing the item details).

### Visual spacing
- Items within groups: increase from `space-y-px` to `space-y-1`
- Add subtle separators between groups (thin horizontal rule, opacity 0.1)
- Use `bg-[var(--bg-elevated)]/30` hover on items (not 50)

---

## B7: Right Push-Panel Completion

### Implement ArtifactPanelContent
- **`right-push-panel.tsx:422-454`**: Replace stub with real artifact viewer:
  - For `type: "document"`: render TiptapEditor with `compact` mode and `showDocumentMeta`
  - For other types: type-specific viewer (code → syntax highlight, flashcard → flip view, etc.)
  - AI input bar at bottom with send handler
  - Connect to `useChatPanel` with `threadType: "artifact_edit"` for AI interactions

### Fix message area mask
- **`right-push-panel.tsx:219`**: The `mask-image` gradient fades the bottom 10% of messages. Remove or reduce to 2% at the very bottom edge.

### Fix note title debounce
- **`right-push-panel.tsx:403-414`**: Add debounce to title input onChange (500ms) before calling updateDocument.

### Fix stream phase indicator positioning
- Move phase indicator from inside composer to above the last message in the messages area.

---

## B8: Animation Language & Polish

### Consistent timing table
All transitions should use these values (verify/fix across codebase):

| Transition | Duration | Easing |
|-----------|---------|--------|
| Zoom band content morph | 300ms | `[0.22, 1, 0.36, 1]` |
| Border dissolution | 500ms | ease-out (opacity + blur) |
| Neighbor fade | proportional to zoom | linear |
| Internal node stagger | 150ms per item | ease-out |
| Panel open/close | 300ms/250ms | ease-out slide |
| Panel content swap | 200ms | cross-fade |
| Command bar expand | 200ms | `[0.22, 1, 0.36, 1]` |
| Item hover | 150ms | ease |

### Workstream card width transition
- **`workspace-canvas.tsx:224`**: Width changes by band (220/280/320/360) happen without animation. Add `transition: 'width 300ms ease'` to outer container style.

### Internal node entry animation
- Items stagger in with `scale: 0.95 → 1` and `opacity: 0 → 1`, 30ms delay per item
- Group headings slide in from left (x: -8 → 0)

### No ambient motion
- No continuous animations, no spinning elements, no pulse effects in resting state
- Motion only serves transitions and user interactions

---

## B9: Notes/Artifacts Page Overhaul

### Page restructure
- **`src/components/notes/notes-workspace.tsx`**: Major overhaul:
  - Rename heading to "Artifacts"
  - Sidebar: list artifacts by type with icons (document, study plan, flashcard, etc.)
  - New artifact creation: show type picker (Document, Study Plan, Flashcard Deck, etc.)
  - For documents: open with full TiptapEditor + `showDocumentMeta`
  - For other types: open with type-specific editor
  - Remove separate title header bar
  - AI bar always visible at bottom of editor area

### Notion-like empty state
- When document is blank: show placeholder hints
  - "Type / for commands" hint centered in editor
  - Floating "+" on hover per line
  - No harsh borders or outlines

### AI integration
- AI command bar at bottom of artifacts page (same component as workspace command bar, adapted)
- Sends to artifact's AI thread
- Opens right panel for AI conversation in full-page context

---

## B10: Build Stability & Final Verification

### TypeScript
- Run `tsc --noEmit`, fix all errors from schema changes and new props

### React 19 compatibility
- Verify all `useEffect` cleanups properly cancel fetches
- Ensure no synchronous unmounts during renders (slash command fix in B1)
- Test StrictMode double-render doesn't cause issues

### Error boundaries
- Add React error boundary around:
  - WorkspaceCanvas (prevent full-page crash from React Flow errors)
  - TiptapEditor (prevent crash from extension errors)
  - RightPushPanel (prevent crash from panel content errors)

### Performance checks
- Canvas load with 15 workstreams: target < 1.5s
- Zoom transitions: verify 60fps (only transform + opacity, GPU-composited)
- Push-panel open: target < 300ms

### End-to-end flows to verify
1. Create workstream → add thread → see threadCount update on card
2. Zoom into workstream → see threads/documents/planner/artifacts in internal view
3. Click thread → right panel opens → chat works → messages show
4. Open document → title is inline H1 → slash commands work → Tab completes → drag handles work
5. AI edit document → auto-applies → discard works → confirm works (no retry loop)
6. Command bar → select workstream → send → auto-zoom → panel opens
7. Hub button → hub internal view (canvas-native) → see global items
8. Home button → exit to overview → hub visible → positions preserved
9. Graph view → nodes with edges → overflow clusters
10. `next build` passes with zero errors

---

## Execution Order

```
A1 (schema/counts) ──┐
A2 (notes→artifacts) ─┤
A3 (AI edit fixes)  ──┼── B1 (editor bugs) ──── B2 (editor overhaul) ── B9 (artifacts page)
A4 (data fetching)  ──┤                    ├── B3 (canvas zoom) ────── B4 (hub canvas-native)
A5 (position sync)  ──┘                    ├── B5 (command bar)
A6 (cleanup)                               ├── B6 (internal views)
                                           ├── B7 (right panel)
                                           └── B8 (animations) ─────── B10 (stability)
```

A1-A6 can be parallelized. B1 should come first in Phase B since it fixes crashes. B3 and B2 are the highest-impact UX improvements. B10 is always last.

## Critical Files

| File | Changes |
|------|---------|
| `convex/schema.ts` | threadCount, messageCount fields |
| `convex/chats.ts` | ensureWorkstreamThreadCount, messageCount tracking |
| `convex/artifacts.ts` | Atomic counts, getOrMigrateFromNote, confirmAiEdit fix |
| `convex/workstreams.ts` | batchUpdatePositions mutation |
| `src/components/editor/slash-command-renderer.tsx` | queueMicrotask unmount fix |
| `src/components/editor/slash-command-list.tsx` | Tab support, index fix |
| `src/components/editor/tiptap-editor.tsx` | Drag handle import, showDocumentMeta, floating menu |
| `src/components/editor/ai-bar.tsx` | Retry loop fix, legacy noteId resolution |
| `src/components/workspace/workspace-canvas.tsx` | Hub visibility, zoom thresholds, data fetching setters, dots |
| `src/components/workspace/right-push-panel.tsx` | Artifact panel implementation, mask fix |
| `src/components/workspace/workspace-command-bar.tsx` | Auto mode, zoom-on-send |
| `src/components/workspace/views/internal-content-nodes.tsx` | Styling, spacing, click handlers |
| `src/components/workspace/hub-internal-view.tsx` | Data wiring |
| `src/components/notes/notes-workspace.tsx` | Full overhaul → Artifacts page |
| `src/components/artifacts/artifact-ai-surface.tsx` | Discard implementation, timer cleanup |
| `src/app/workspace/page.tsx` | Exit fix, hub overlay removal, position sync |
| `src/app/globals.css` | Focus outline, bullets, floating menu, node styles |
| `src/stores/workspace-store.ts` | Hub commit state |
| `src/hooks/use-artifact-data.ts` | Direct artifact queries |
| `src/app/api/planner/route.ts` (NEW) | Planner items endpoint |
