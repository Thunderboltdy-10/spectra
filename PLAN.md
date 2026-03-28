# Spectra Workspace & Editor — Repair & Redesign Plan

## Context

Spectra's v3 vision describes an AI-native school workspace where the canvas is the world, the AI is an active agent with tools, and the experience unifies what would otherwise be separate apps. The current implementation has significant drift from this vision: the workspace uses overlays instead of true semantic zoom, notes and artifacts are parallel systems with duplicated logic, the editor has only 4 Tiptap packages with no working slash commands, the right push-panel shows stubs, the hub is an afterthought overlay, and ManageBac data is not properly distributed between hub-level and workstream-level concerns.

This plan restructures the repair into **Phase 1 (Backend, Logic, Data Model)** and **Phase 2 (UI, Canvas, Editor Surfaces, Testing)**. They are deeply linked but separated so each side gets proper weight.

**Key architectural decisions from the user:**
- Notes become artifacts: unify into one artifact-centric model (document artifacts get rich editing, other types use the same shell)
- AI edits are action-first: auto-apply with animation, user can discard/revert after
- AI interactions stored as real chat threads, not invisible one-off operations
- All three internal views (structured, columns, graph) are spatial and draggable
- Full canvas-native internal views via React Flow nodes, not overlays
- Hub behaves as a global workstream with Home/Hub distinction in toolbar
- One integrated editor experience (not three separate modes), AI lives on top
- useCompactChat treated as a mine for reusable logic, not preserved or deleted wholesale

---

# PHASE 1: Backend, Logic, Data Model, Orchestration

Everything in Phase 1 is about making the system architecturally correct before building the UI on top. No visual changes — pure data, logic, lifecycle, sync, and pipeline work.

---

## 1A: Artifact Unification — Notes Become Artifacts

### Problem

Notes (`convex/notes.ts`) and artifacts (`convex/artifacts.ts`) are parallel systems with different schemas, different CRUD, and different capabilities. Notes have no versioning, no lifecycle (active/archived), no tagging, no pinning. Artifacts have all of these plus a polymorphic type system. The artifact type system already includes a `"note"` type but it's unused. This creates duplicated logic, inconsistent behavior, and blocks the unified artifact interaction model.

### Data Model Changes

**File: `convex/schema.ts`**

Extend the artifacts table to absorb note-specific fields:

```
artifacts table additions:
  editorMode: v.optional(v.union(
    v.literal("standard"), v.literal("ai_enhanced"),
    v.literal("simple"), v.literal("notion"), v.literal("agentic"),  // backward compat
  )),
  contentPlaintext: v.optional(v.string()),
  sourceType: v.optional(v.union(
    v.literal("user_manual"), v.literal("ai_generated"), v.literal("managebac_sync"),
  )),
  managebacItemId: v.optional(v.string()),
  sourceDeleted: v.optional(v.boolean()),
  sourceUpdatedAt: v.optional(v.number()),
  syncConflictSummary: v.optional(v.string()),
  lastAiEditId: v.optional(v.string()),
  pendingDiffs: v.optional(v.any()),
```

Add search index on `contentPlaintext` for document-type artifact search.

**Keep** the existing notes table and `convex/notes.ts` temporarily — mark as deprecated. The migration happens in a Convex migration script that:
1. For each note, creates an artifact with `type: "document"` (not "note" — documents are the rich-editing artifact type)
2. Copies all fields, maps `editorMode` through `normalizeEditorMode()`
3. Creates an initial `artifactVersions` entry with `{op: "create"}` for each migrated note
4. Sets `sourceType` on the artifact from the note's source
5. Preserves `workstreamId` linking

After migration, `notes` table becomes read-only (backward compat for any lingering queries), then removed in a later cleanup.

### Artifact Type Taxonomy

Standardize the types (current: 10 types in `src/lib/artifact-types.ts`):

| Type | Rich editing? | Version tracking? | AI editable? | Shell behavior |
|------|--------------|-------------------|-------------|----------------|
| `document` | Yes (full Tiptap) | Yes | Yes | Full editor toolbar, slash commands, drag handles |
| `study_plan` | Partial (structured Tiptap) | Yes | Yes | Editor with subset of formatting |
| `flashcard_deck` | No (custom UI) | Yes | Yes (content generation) | Card editor, flip preview |
| `timetable` | No (custom UI) | Yes | No | Grid/schedule view |
| `code_project` | Yes (code editor) | Yes | Yes | Code editor with syntax highlighting |
| `diagram` | No (custom UI) | Yes | Yes (generation) | Visual editor or image |
| `image` | No | Yes | No | Image viewer with metadata |
| `bookmark` | No | No | No | URL + title + excerpt |
| `collection` | No (list management) | Yes | No | Ordered list of other artifacts |

**Key principle:** All types open in the same right-panel shell. Document-type artifacts get the full Tiptap experience. Other types get type-specific viewers/editors. Controls that don't apply to a type are visually unavailable (disabled/hidden), not split into separate UI.

### CRUD Consolidation

**File: `convex/artifacts.ts`**

Enhance to handle document-type operations:
- `update()` must create `artifactVersions` entry when content changes (already does this)
- Add `updateEditorMode()` mutation for document artifacts
- Add `searchByContent()` query using `contentPlaintext` for document artifacts
- Ensure `list()` supports filtering by type (already does)

**File: `src/hooks/use-notes-data.ts`**

Rename to `src/hooks/use-artifact-data.ts`. Refactor to query `artifacts` table with `type: "document"` filter. Keep the same return shape for backward compatibility during transition. Add methods:
- `createDocument()` — creates artifact with `type: "document"`, `editorMode: "standard"`
- `updateDocument()` — updates artifact, triggers version creation
- `listDocuments()` — lists artifacts with `type: "document"` for a workstream

**File: `src/app/api/notes/route.ts`**

Proxy to artifacts API with `type: "document"`. Eventually deprecate.

### AI Interaction Threads for Artifacts

Every AI interaction with an artifact must be stored as a real chat thread:

**File: `convex/schema.ts`**

Add to chats table:
```
artifactId: v.optional(v.id("artifacts")),  // Links thread to artifact
threadType: v.optional(v.union(
  v.literal("conversation"),    // Normal workstream/global chat
  v.literal("artifact_edit"),   // AI editing an artifact
)),
```

**File: `convex/chats.ts`**

Add `listByArtifact()` query: returns all chat threads linked to an artifact, ordered by recency. This ensures:
- Follow-ups stay in the same thread (not new chats per interaction)
- Full conversation history is preserved and browseable
- The artifact's thread history is accessible from the version history panel

**Lifecycle:** When an artifact AI thread exists and the user asks a follow-up, the system continues the existing thread. Only create a new thread if the user explicitly starts a new conversation or if the artifact has no existing threads.

### Provenance Tracking

Every artifact stores its origin:
- `sourceType: "user_manual"` — user created directly
- `sourceType: "ai_generated"` — AI created (via tool call or chat)
- `sourceType: "managebac_sync"` — synced from ManageBac

When AI creates an artifact (via tool call from Phase 1C of PLAN.md), the `linkedChatId` and `sourceMessageId` fields trace back to the conversation that spawned it.

**Verification:**
- [ ] Existing notes successfully migrate to artifacts with `type: "document"`
- [ ] Each migrated note has an initial `artifactVersions` entry
- [ ] `useArtifactData` hook returns documents with same shape as old `useNotesData`
- [ ] `/api/notes` routes proxy correctly to artifacts
- [ ] Creating a document artifact creates version entry
- [ ] Updating a document artifact creates version entry with diff
- [ ] `next build` passes

---

## 1B: AI Edit Lifecycle — Action-First with Revert

### Problem

Current AI edits require manual approval before changes appear. The user wants action-first: AI changes auto-apply with animation, user can discard after.

### Design

**State machine for AI artifact edits:**

```
IDLE → AI_EDITING → APPLIED (auto) → CONFIRMED (after timeout) or DISCARDED
                                    ↓
                              REVERT_AVAILABLE (30s window)
                                    ↓
                              CONFIRMED (permanent)
```

1. User sends instruction to AI bar or artifact AI surface
2. AI generates edit operations (via `/api/editor/ai-edit`)
3. Operations auto-apply to the editor with animation (see Phase 2)
4. A "discard" affordance appears for 30 seconds
5. If discarded: content reverts to pre-edit state, version entry marked as discarded
6. If 30s passes or user edits further: changes are confirmed
7. Version entry is always created regardless of discard/confirm

### Version Entry Structure

**File: `convex/artifacts.ts`**

On AI edit, create version entry:
```typescript
{
  artifactId,
  diff: {
    op: "ai_edit",
    previous: previousContent,      // Full snapshot for revert
    operations: aiOps,               // The individual operations
    instruction: userInstruction,    // What the user asked
  },
  snapshot: /* every 10th version */,
  authorType: "agent",
  sourceChatId: artifactThreadId,    // Links to the AI thread
  sourceMessageId: messageId,
  description: aiSummary,
  status: "applied",                 // → "confirmed" or "discarded"
  createdAt: Date.now(),
}
```

Add `status` field to `artifactVersions` schema: `v.optional(v.union(v.literal("applied"), v.literal("confirmed"), v.literal("discarded")))`.

### Revert and Re-add

When discarding:
1. Restore previous content from `diff.previous`
2. Mark version as `status: "discarded"`
3. Show "Re-apply" option that re-applies the operations and flips status back to "applied"

When edits build on each other (user makes changes after AI edit):
- The 30s discard window closes immediately
- Version auto-confirms
- Reverting now requires version history (restoreVersion), not the quick discard

### Concurrency Safety

If the user edits the document while AI is generating:
- AI's operation offsets may be stale
- Solution: compare document state at AI-start vs document state at AI-return. If they differ, attempt to rebase operations (adjust offsets). If rebase fails, show "Document changed during editing — apply anyway?" (breaking action-first, but only for conflict cases).

**Verification:**
- [ ] AI edit auto-applies without user clicking "Accept"
- [ ] Discard affordance appears for 30s after AI edit
- [ ] Discarding reverts content to pre-edit state
- [ ] "Re-apply" after discard re-applies the operations
- [ ] Version entry created for every AI edit (applied, confirmed, or discarded)
- [ ] User editing after AI edit auto-confirms the AI edit
- [ ] Version history shows all edits with status indicators

---

## 1C: Thread and Chat Architecture

### Thread Types

Extend chats to distinguish purpose:
- `"conversation"` — Standard workstream or global chat
- `"artifact_edit"` — AI editing an artifact (linked via `artifactId`)

### Thread Overflow Logic

Workstreams can accumulate many threads. The workspace should NOT render all equally.

**File: `convex/chats.ts`**

Add `listByWorkstreamSummary()` query:
```typescript
// Returns: { recent: Chat[], overflowCount: number }
// recent: last 5-8 threads sorted by updatedAt
// overflowCount: total threads minus recent count
```

This is used by the workspace internal views to show the latest threads plus a "+N more" indicator. The full list is accessible on expand/hover.

For graph view: same logic — only render nodes for recent threads plus a cluster node representing overflow ("12 older threads"). The cluster node is clickable to reveal hidden items.

### AI Interaction Storage

All artifact AI interactions must persist as real threads:

1. When user first asks AI about an artifact, create a chat with `threadType: "artifact_edit"` and `artifactId`
2. Subsequent interactions continue this thread (lookup by `artifactId`)
3. The thread is visible in the workstream's thread list (with an artifact icon distinguishing it from regular chats)
4. The thread is also accessible from the artifact's version history

### Follow-up Continuity

**File: `src/hooks/use-compact-chat.ts` (or extracted logic)**

When initiating an artifact AI interaction:
1. Query for existing `artifact_edit` thread for this artifact
2. If exists: resume that thread (append new user message)
3. If not: create new thread with `threadType: "artifact_edit"`, `artifactId`, `workstreamId`

This prevents thread spam — one AI thread per artifact, with full history.

**Verification:**
- [ ] Artifact AI thread created on first interaction
- [ ] Follow-up interactions append to same thread
- [ ] Thread appears in workstream's thread list with artifact icon
- [ ] Thread overflow: only latest 5-8 shown in workspace, "+N more" visible
- [ ] Graph view shows cluster node for overflow threads

---

## 1D: Hub as Global Workstream

### Problem

The hub is currently a UI-only overlay with no data model backing. It needs to become a conceptual "global workstream" — a place where global objects live (unscoped notes, ManageBac timetable, cross-workstream planner, etc.).

### Data Model

The hub does NOT need its own workstream entry in the database. Instead, "hub-level" means `workstreamId === null`. Objects with no workstream are hub-level by definition:
- Artifacts with no `workstreamId` → hub-level (e.g., timetable)
- Planner items with no `workstreamId` → hub-level (cross-workstream deadlines)
- Chats with no `workstreamId` → general conversations (not workstream-scoped)

### Hub Queries

**File: `convex/artifacts.ts`**

Add `listHubArtifacts()` — returns artifacts where `workstreamId` is null, ordered by recency. Filtered by type if needed (e.g., show timetable, global documents).

**File: `convex/chats.ts`**

`listByWorkstream(null)` already works for hub-level chats (no workstreamId filter).

**File: `convex/plannerItems.ts`**

Add `listHubItems()` — returns planner items where `workstreamId` is null, plus an aggregated cross-workstream deadline view (all upcoming deadlines from all workstreams, limited to next 14 days).

### Home vs Hub

- **Home** = the zoomed-out overview with all workstreams + hub node visible on the canvas. This is the default state.
- **Hub** = zoomed/committed into the hub's own internal view, showing hub-level objects.

The toolbar should have two buttons:
- Home icon → reset canvas to overview (zoom out, center on all content)
- Hub icon → commit to hub (zoom into hub node, show hub internals)

**Verification:**
- [ ] Artifacts with `workstreamId: null` are queryable as hub-level
- [ ] Hub queries return timetable, unscoped documents, cross-workstream planner
- [ ] Home button resets to overview; Hub button commits to hub internal view
- [ ] Hub internal view shows global objects, not workstream-specific ones

---

## 1E: ManageBac Distribution

### Problem

ManageBac data currently syncs to workstreams but doesn't clearly distinguish hub-level vs workstream-level objects.

### Distribution Rules

| ManageBac Entity | Spectra Location | Rationale |
|-----------------|-----------------|-----------|
| Timetable (full schedule) | **Hub-level** artifact (`type: "timetable"`, `workstreamId: null`) | Global view of all classes |
| Per-class schedule | Workstream enrichment context (`managebacContext` on workstream) | Subject-specific |
| Assignments | Workstream planner items (linked by `managebacClassId` → `workstreamId`) | Subject-specific tasks |
| CAS activities | CAS workstream planner items | IB-specific, already has its own workstream |
| CAS reflections | CAS workstream document artifacts | Rich content worthy of artifact treatment |
| Announcements | Hub-level context (cached, time-limited) | School-wide, not subject-specific |
| Profile photo | User avatar (via Clerk metadata) | Global user property |

### Sync Changes

**File: `convex/managebacSync.ts`**

When syncing timetable:
- Create/update a hub-level artifact with `type: "timetable"`, `workstreamId: null`, `sourceType: "managebac_sync"`
- Content: structured timetable JSON (days, times, rooms, subjects)
- Per-class schedule still stored as `managebacContext` on each workstream

When syncing CAS reflections:
- Create as document artifacts (not notes) with `type: "document"`, in the CAS workstream
- Preserve `managebacItemId` provenance
- Set `sourceType: "managebac_sync"`

### Provenance Preservation

All ManageBac-sourced objects store:
- `sourceType: "managebac_sync"`
- `managebacItemId` (the original MB entity ID)
- `sourceUpdatedAt` (when MB last changed this entity)
- `sourceDeleted` (if MB removed the entity)

The AI uses these fields to determine when to mention ManageBac context: "Your Biology essay is due March 30 (from ManageBac)".

**Verification:**
- [ ] Timetable syncs as hub-level artifact, not workstream-level
- [ ] CAS reflections sync as document artifacts in CAS workstream
- [ ] All ManageBac objects preserve `sourceType`, `managebacItemId`
- [ ] Re-sync updates existing objects (matches by `managebacItemId`)
- [ ] Deleted MB objects get `sourceDeleted: true`, not hard-deleted

---

## 1F: Chat Logic Extraction from useCompactChat

### Problem

`useCompactChat` (7500+ lines) is tightly coupled to old workspace patterns. The useful logic needs to be extracted and reshaped for the new architecture.

### Extraction Strategy

Read `useCompactChat` line by line and extract into focused modules:

**New: `src/lib/chat/streaming.ts`** — SSE streaming logic
- `createChatStream(chatId, message, options)` → returns async iterator of typed events
- Event types: `phase`, `delta`, `thinking`, `tool_call`, `tool_result`, `done`, `error`
- AbortController management
- This is the core reusable streaming infrastructure

**New: `src/lib/chat/message-state.ts`** — Message accumulation
- `ChatMessageAccumulator` class: takes streaming events, builds message state
- Handles delta accumulation, thinking content, citation collection, phase tracking
- Pure logic, no React — usable from any hook or component

**New: `src/hooks/use-chat-panel.ts`** — Panel-optimized chat hook
- Replaces direct use of `useCompactChat` in panel contexts
- Uses extracted `createChatStream` and `ChatMessageAccumulator`
- Manages: messages, streaming state, phase indicators, send/cancel
- Supports both `threadType: "conversation"` and `threadType: "artifact_edit"`
- No coupling to old workspace layout assumptions

**Keep: `src/hooks/use-compact-chat.ts`** — Refactor to use extracted modules
- Becomes a thin wrapper around `createChatStream` + `ChatMessageAccumulator`
- Backward compat for any components still using it directly

**Keep: `src/hooks/use-chat-state.ts`** — Full chat page state
- Untouched for now — it serves the `/chat` page which works

**Verification:**
- [ ] `createChatStream` handles all SSE event types correctly
- [ ] `ChatMessageAccumulator` builds correct message state from events
- [ ] `useChatPanel` hook works in right push-panel context
- [ ] `useChatPanel` hook works for artifact AI threads
- [ ] Existing chat functionality (via `useCompactChat` or `useChatState`) not broken

---

## 1G: Build Stability

Before any Phase 2 work:

1. Fix `convex/workstreamMemory.ts:314` build error (manual object missing `_creationTime`)
2. Fix any TypeScript errors from schema changes (`npx tsc --noEmit`)
3. Run `next build` — must pass with zero errors
4. Address critical lint warnings (unused vars, `any` types in modified files)

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] `next build` passes
- [ ] No Convex deployment errors

---

# PHASE 2: UI, Canvas, Editor, Interaction Surfaces, Testing

Everything in Phase 2 builds the experience on top of Phase 1's corrected data model and logic. The canvas, editor, panels, command bar, and all interaction surfaces are implemented here.

---

## 2A: Editor — One Integrated Tiptap Experience

### Philosophy

One serious editor, not three modes pretending to be one. The Tiptap editor should be Notion/Affine-quality for document artifacts. AI lives on top through the artifact interaction surface (see 2F). Other artifact types open in the same panel shell but with type-appropriate controls.

### Extension Installation

```bash
npm install \
  @tiptap/extension-table @tiptap/extension-table-row \
  @tiptap/extension-table-cell @tiptap/extension-table-header \
  @tiptap/extension-task-list @tiptap/extension-task-item \
  @tiptap/extension-image @tiptap/extension-text-align \
  @tiptap/extension-color @tiptap/extension-text-style \
  @tiptap/extension-typography @tiptap/extension-character-count \
  @tiptap/extension-underline @tiptap/suggestion
```

Already available (starter-kit deps): `bubble-menu`, `floating-menu`, `highlight`, `link`.

All MIT licensed. Zero paid packages.

### Full Extension Configuration

**File: `src/components/editor/tiptap-editor.tsx`**

Replace the 2-extension array (lines 50-59) with:
- `StarterKit` (heading 1-3, codeBlock, bold, italic, strike, lists, blockquote, horizontal rule)
- `Placeholder`
- `Table` + `TableRow` + `TableCell` + `TableHeader` (resizable)
- `TaskList` + `TaskItem` (nested)
- `Image` (allowBase64, inline: false)
- `Highlight` (multicolor: false)
- `Underline`
- `Link` (openOnClick: false, autolink: true)
- `TextAlign` (heading, paragraph)
- `CharacterCount`
- `Typography` (smart quotes, em-dashes)
- `SlashCommand` (custom, see below)
- `Callout` (custom node, see below)
- `DragHandle` (custom ProseMirror plugin, see below)

SSR already handled (`immediatelyRender: false`).

### Slash Command System

**Rewrite: `src/components/editor/slash-command-extension.ts`**
**New: `src/components/editor/slash-command-list.tsx`**

Build using `@tiptap/suggestion`:

The extension detects "/" and spawns a dropdown. The dropdown:
- Renders a filtered list of commands
- Keyboard nav: arrow keys, Enter, Escape
- Each item: icon + label + description
- Positioned via tippy.js (Tiptap dep)
- Styled with Spectra CSS vars

Commands:
- Heading 1/2/3, Bullet List, Numbered List, Blockquote, Code Block, Divider (existing data)
- **Table** (3x3 insert)
- **Task List** (checkbox items)
- **Image** (URL prompt or upload)
- **Callout** (info/warning/tip variants)
- **Divider**

### Custom Callout Node

**New: `src/components/editor/extensions/callout-node.ts`**

Custom Tiptap Node: `group: "block"`, `content: "block+"`, `defining: true`.
- Attribute `type`: info | warning | tip
- Renders `<div data-callout class="callout callout-{type}">` with left border accent
- Commands: `setCallout`, `toggleCallout`
- CSS: cyan (info), amber (warning), mint (tip)

### Custom Drag Handles

**New: `src/components/editor/extensions/drag-handle.ts`**

ProseMirror plugin approach (no official MIT standalone package):
- On mousemove: find nearest top-level block node
- Position grip icon (GripVertical from lucide) 24px left of block
- Show on hover, 150ms opacity transition
- draggable: true → ProseMirror NodeSelection on dragstart
- On drop: move node via ProseMirror transaction

### Bubble Menu (Selection Formatting)

**File: `src/components/editor/tiptap-editor.tsx`**

Add `<BubbleMenu>` after `<EditorContent>`:
- Appears on text selection
- Buttons: Bold, Italic, Highlight, Code, Strikethrough, Link
- Styled: `bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-lg rounded-lg`

### Floating Menu (Empty Line)

Add `<FloatingMenu>`:
- Appears on empty paragraph
- Quick-insert: H1, List, Code, Table
- "Type / for more" hint

### Character/Word Counter

Bottom of editor:
```
{characters} characters · {words} words
```
Using `CharacterCount` extension storage. Text-[10px] text-[var(--text-tertiary)].

### Toolbar Update

**File: `src/components/editor/editor-toolbar.tsx`**

Add buttons for: Table, Task List, Image, Highlight, Underline.
Remove mode toggle from toolbar — mode is now determined by context:
- Standard editing = when no AI surface is active
- AI-Enhanced = when the artifact AI interaction surface is active
No separate toggle button needed. The AI bar appears contextually (see 2F).

### Editor CSS

**File: `src/app/globals.css`**

Add styles for tables, task lists, images, callouts, drag handles under `.tiptap-root .ProseMirror`.

**Verification:**
- [ ] Type "/" → dropdown with 12+ commands, filtering works
- [ ] `/table` → editable resizable table
- [ ] `/todo` → task list with checkboxes
- [ ] `/callout` → styled callout with accent border
- [ ] Select text → bubble menu appears
- [ ] Empty paragraph → floating menu
- [ ] Hover left of block → drag handle appears, drag reorders
- [ ] Character/word counter at bottom
- [ ] `next build` passes

---

## 2B: Artifact Interaction Surface — The AI Layer

### Two Contexts, One Language

AI interaction with artifacts behaves differently based on where the artifact lives:

**A. Full Artifact Page** (`/artifacts?id={artifactId}`)
- Artifact fills the main content area
- AI interaction opens in the **right push-panel** as a simplified conversational surface
- Shows: user messages, AI responses with diffs, explanations, clarifications
- No thinking boxes, no model badges, no routing phases — clean and artifact-focused
- The panel chat uses the artifact's thread (linked via `artifactId`)
- Same visual family as workspace right-panel chat, but simplified

**B. Inside Workspace** (artifact already in right panel)
- The artifact is already IN the right panel
- No second panel possible
- AI interaction appears as an **expanded response area above the input bar**
- The input bar lives at the bottom of the panel. When AI responds, the bar "grows upward" into a response zone
- Shows: AI response text, inline diffs, discard/confirm affordances
- When idle: just the input bar
- When AI is responding: input bar + expanding response area above it
- When response complete: response area shows result + discard timer, input bar ready for follow-up

### Implementation

**New: `src/components/artifacts/artifact-ai-surface.tsx`**

A single component that adapts to context:

```tsx
interface ArtifactAiSurfaceProps {
  artifactId: string;
  editor: Editor;          // Tiptap editor instance
  context: "full-page" | "workspace-panel";
  onApplyEdits: (ops) => void;
  onDiscard: () => void;
}
```

When `context === "full-page"`:
- Renders as right-panel content (passed to right push-panel)
- Full conversational layout: message list + composer at bottom
- Uses `useChatPanel` hook with `threadType: "artifact_edit"`

When `context === "workspace-panel"`:
- Renders inline within the artifact panel, above the input bar
- Compact: single response area + input bar
- Same `useChatPanel` hook, but UI is compressed into the panel

### Action-First Edit Flow (UI)

1. User types instruction in AI surface input
2. AI generates operations (streaming via `useChatPanel`)
3. Operations auto-apply to the editor with highlight animation:
   - Inserted text: brief green highlight that fades (400ms)
   - Replaced text: old content briefly shows as strikethrough, then transforms (300ms)
   - Deleted text: red flash then contract/remove (250ms)
4. Discard affordance appears: floating bar below toolbar "AI made {n} changes · [Discard] · auto-confirming in {countdown}s"
5. After 30s or next user edit: confirmed, discard bar disappears

### Thread Storage

All interactions flow through `useChatPanel` → `createChatStream` → `/api/chat` → stored as messages in the artifact's thread. The thread is linked via `artifactId` on the chat.

**Verification:**
- [ ] Full artifact page: AI interaction opens in right panel with clean conversational UI
- [ ] Workspace panel: AI response area expands above input bar, no nested panel
- [ ] AI edits auto-apply with animation
- [ ] Discard affordance appears for 30s
- [ ] Discarding reverts content
- [ ] Follow-up questions append to same thread
- [ ] Thread visible in workstream's thread list

---

## 2C: Workspace Foundation Cleanup

### Delete Dead Code

- **Delete:** `src/components/workspace/chat-side-panel.tsx` (old bottom-right bar, not imported)
- **Extract + delete:** `src/components/workspace/workstream-focus-panel.tsx`
  - Extract `HubFocusPanel` → `src/components/workspace/hub-internal-view.tsx` (see 2G)
  - Delete the 1962-line file

### Fix Border Shorthand

**File: `src/components/workspace/workspace-canvas.tsx:240-242`**

Replace:
```
border: `1px solid ${...}`,
borderStyle: lifecycle.dashed ? "dashed" : "solid",
borderColor: lifecycle.dashed ? "var(--border-default)" : undefined,
```
With individual properties:
```
borderWidth: 1,
borderStyle: lifecycle.dashed ? "dashed" : "solid",
borderColor: hovered ? color.value + "60" : "var(--border-default)",
```

### Fix Background Dots

**File: `src/components/workspace/workspace-canvas.tsx`**

If React Flow's `<Background variant="dots">` isn't rendering, implement via CSS:
```css
.react-flow {
  background-image: radial-gradient(circle, var(--text-tertiary) 0.8px, transparent 0.8px);
  background-size: 28px 28px;
}
```

Dots must persist at ALL zoom levels including inside committed workstreams. This is the visual continuity that makes it one world.

### Clean Legacy State

**File: `src/stores/workspace-store.ts`**

Remove `focusedWorkstreamId`, `focusCardBounds`, `focusWorkstream`, `focusWorkstreamWithChat`. Grep entire codebase for references.

### Notes UI Cleanup

**File: `src/components/notes/notes-workspace.tsx`**

This page will eventually become the artifact browser for document types. For now:
- Remove duplicate mode switcher (lines 158-174)
- Remove uppercase eyebrow labels ("Notes area", "Full editor")
- Simplify title bar to just the artifact title
- Fix note list item `rounded-[22px]` → `rounded-xl`

**Verification:**
- [ ] No console border shorthand warnings
- [ ] Background dots visible at all zoom levels
- [ ] No import of dead files
- [ ] No `focusedWorkstreamId` references
- [ ] Notes page: no uppercase labels, no duplicate toggles

---

## 2D: Semantic Zoom Canvas — Progressive Reveal

### Core Problem

The current canvas auto-commits to a workstream with a tiny scroll. Entering feels like opening a new page. It should feel like zooming into a map — progressive detail, same world.

### Zoom Sensitivity Fix

**File: `src/components/workspace/workspace-canvas.tsx`**

1. **Proximity gate:** Don't auto-commit unless nearest workstream center is within 500 canvas units of viewport center
2. **Stability debounce:** Only commit after zoom stable in "internal" band for 400ms
3. **Consider raising internal threshold** from 0.9 to ~0.95 (test what feels natural)
4. **Smooth representation morphing:** Content at each band should morph smoothly, not switch abruptly. Use CSS transitions on node content:
   - Description text: `max-height` transition as it appears/disappears between overview → summary
   - Thread previews: `opacity` + `max-height` transition as they appear in detail band
   - Fonts should NOT become disproportionate — use consistent sizing that simply reveals more content

### Dissolution Transition

At the detail → internal threshold:
- Workstream node border: `opacity 1 → 0` + `filter: blur(0 → 4px)` over 400ms
- Node content expands outward: `transform: scale(1 → 1.2)` combined with position shift
- Canvas-native internal nodes fade in simultaneously
- Other workstreams: opacity transitions proportionally (`opacity = lerp(1, 0, (zoom - 0.7) / 0.5)`)

### Single-Click Entry

Click a workstream → animated zoom-to-fit targeting the workstream node, passing through all bands naturally (~500ms). The zoom animation should traverse the bands visibly so the user sees the progressive reveal.

### Exit Methods

- **Zoom out:** Reverse of entry. Internal content contracts, node border re-forms.
- **Escape:** Animated zoom-out to last overview viewport position.
- **Breadcrumb:** "Workspace > Biology HL" at top when committed. Click "Workspace" → zoom out.
- **Browser back:** URL-backed state (`?ws={id}`) enables standard back nav.

**Verification:**
- [ ] Tiny scroll from default does NOT auto-commit
- [ ] Click workstream → smooth animated zoom through all bands
- [ ] Content morphs progressively (not abrupt switch)
- [ ] Border dissolves at commit threshold (opacity + blur)
- [ ] Other workstreams fade proportionally to zoom
- [ ] Escape zooms back out smoothly
- [ ] Breadcrumb appears only when committed
- [ ] Background dots visible throughout

---

## 2E: Canvas-Native Internal Views

### Architecture

When committed to a workstream, content renders as React Flow nodes — not as an overlay div. The current `<WorkstreamInternalView>` overlay (`absolute inset-0 z-20`) must be removed.

### Custom React Flow Node Types

**New: `src/components/workspace/views/internal-content-nodes.tsx`**

**GroupNode** (structured view):
- Transparent container for a category (Threads, Documents, Planner, Artifacts)
- Label + thin separator line + items as rows
- No card borders, no background fill — canvas dots bleed through
- Items: text + metadata + subtle hover highlight (`bg-[var(--bg-elevated)]/50`)
- "+" New action (understated text)
- Click item → right push-panel
- Draggable (user rearranges groups on canvas)
- Scale-adaptive: only render groups that have content

**ColumnNode** (column view):
- Vertical column with heading
- Items listed vertically
- Columns arranged horizontally
- Transparent background
- Column heading draggable to reorder columns
- Draggable within canvas

**GraphItemNode** (graph view):
- Small colored pill with title
- Sized by interaction count (messages, edits)
- Color by type: thread=cyan, document=mint, planner=coral, artifact=purple
- Draggable, clickable → push-panel
- Connected by edges:
  - Explicit references: solid lines (sourceType, linkedChatId)
  - Temporal proximity: dashed lines (created within 1 hour)

**GraphOverflowNode** (graph view):
- Cluster node: "12 older threads"
- Clickable to reveal hidden items
- Prevents rendering hundreds of nodes

### View Functions

**Modified: `src/components/workspace/views/workstream-internal-view.tsx`**

Transform from overlay component to functions that produce React Flow node arrays:

```typescript
export function buildStructuredNodes(data, basePosition): Node[] { ... }
export function buildColumnNodes(data, basePosition): Node[] { ... }
export function buildGraphNodes(data, basePosition): { nodes: Node[], edges: Edge[] } { ... }
```

### Integration into Canvas

**File: `src/components/workspace/workspace-canvas.tsx`**

In the `nodes` useMemo, when `committedWorkstreamId` is set:
1. Fetch workstream content via **Convex reactive queries** (not REST)
2. Call appropriate `buildXxxNodes()` based on `viewMode`
3. Spread into React Flow nodes array
4. Register custom node types in `nodeTypes` prop

Data fetching must use `useQuery(api.artifacts.listByWorkstream, ...)` etc. — real-time subscriptions, not polling.

### View Switching

View toggle in toolbar: Structured | Columns | Graph.
Switching animates: nodes cross-fade + position morph (~400ms).

### Thread/Artifact Overflow

For structured and column views:
- Show latest 5-8 items per category
- "+N more" link that expands the group to show all
- Expanded state collapses back on click or when switching views

For graph view:
- Show latest/most relevant items as nodes
- Overflow cluster node for each type ("12 older threads")
- Click cluster → expand to show all (may need canvas space)

### Remove Overlay

**File: `src/app/workspace/page.tsx`**

Remove `<WorkstreamInternalView>` overlay rendering. All internal content is now canvas nodes.

**Verification:**
- [ ] Internal content renders as React Flow nodes (not overlay div)
- [ ] Canvas dots visible between groups
- [ ] Groups are draggable on canvas
- [ ] Structured view: group labels + separators + item rows
- [ ] Column view: horizontal columns, reorderable
- [ ] Graph view: draggable nodes, edges, overflow clusters
- [ ] Scale-adaptive: empty categories not rendered
- [ ] Items clickable → right push-panel opens
- [ ] View toggle switches with smooth transition
- [ ] Data updates in real-time (Convex reactive)

---

## 2F: Right Push-Panel — Universal Detail Surface

### Content Implementation

**File: `src/components/workspace/right-push-panel.tsx`**

Replace all stubs with real content:

**ChatPanelContent:**
- Use `useChatPanel` hook (extracted in Phase 1F)
- Full message rendering with all visualizations
- Routing phase indicators ABOVE messages (not fake typing dots)
- No horizontal separator above composer — gradient mask at scroll bottom
- Scoped to workstream

**ArtifactPanelContent (for documents):**
- Dynamic import of `TiptapEditor` (SSR-safe)
- Full editor with toolbar, slash commands, all extensions
- Centered document width within 520px panel (px-6 margins)
- AI interaction surface below: input bar at bottom, response area expands upward
- Uses `useChatPanel` with `threadType: "artifact_edit"` for AI interactions
- Discard bar for AI edits

**ArtifactPanelContent (for other types):**
- Same panel shell
- Type-specific viewer (flashcards: flip view, code: syntax highlight, etc.)
- AI interaction surface still available (same input bar pattern)
- Editing controls that don't apply are hidden/disabled

**RouteTracePanelContent:**
- Score breakdown per candidate
- Selection method indicator
- No right margin

### Panel Behavior

- Only one panel at a time — opening replaces current with cross-fade
- Canvas resizes: `flex: 1` for canvas, panel takes fixed width
- Widths: chat 380px, document 520px, artifact 480px, route-trace 400px
- Panel state in URL: `?ws={id}&panel=artifact&artifact={artifactId}`
- Escape closes panel, canvas re-expands
- Expand icon (↗) opens full-page view

### Command Bar Integration

When panel is open:
- Workspace command bar **disappears**
- For chat panels: the panel's own composer is the input surface
- For artifact panels: the artifact AI input bar is the interaction surface
- When panel closes: command bar reappears

**Verification:**
- [ ] Chat panel shows full messages with streaming, phases, visualizations
- [ ] Document panel shows full Tiptap editor with toolbar
- [ ] AI input in artifact panel works, response expands above bar
- [ ] Other artifact types show type-specific viewer
- [ ] Command bar hides when panel open, reappears when closed
- [ ] Panel content swaps with cross-fade
- [ ] Expand icon opens full page view

---

## 2G: Hub Internal View

### Home vs Hub

**File: `src/components/workspace/workspace-toolbar.tsx`**

Two buttons:
- **Home** (house icon): `onCenterHome` → reset canvas to overview zoom, center on all content
- **Hub** (compass/globe icon): `onCommitHub` → commit to hub, show hub internals

### Hub as Canvas-Native Content

When hub is committed (zoomed into deeply or Hub button pressed):
- Hub node dissolves (same dissolution transition as workstreams)
- Hub-level content appears as canvas-native nodes (same as workstream internals)
- Uses structured view layout by default

Hub content groups:
- **Quick Notes**: Unscoped document artifacts (`workstreamId: null`)
- **Upcoming Deadlines**: Cross-workstream planner aggregation (next 14 days)
- **Timetable**: ManageBac timetable artifact (if synced)
- **Recent Activity**: Last 10 actions across all workstreams
- **Quick Actions**: New workstream, new document, new chat

### Hub Implementation

**New: `src/components/workspace/hub-internal-view.tsx`**

Provides `buildHubNodes()` function that returns React Flow nodes for hub content. Same pattern as workstream internal views. Integrates into the canvas node injection logic.

**Verification:**
- [ ] Home button returns to overview
- [ ] Hub button commits to hub with dissolution transition
- [ ] Hub shows global objects: unscoped docs, deadlines, timetable, recent activity
- [ ] Hub content is canvas-native (not overlay)
- [ ] Hub is navigable back to overview via Escape or breadcrumb

---

## 2H: Command Bar Continuity

### One Component, Contextual Behavior

**File: `src/components/workspace/workspace-command-bar.tsx`**

The command bar is always the same component with contextual adaptation:

**Global (zoomed-out overview):**
- Minimal by default: search icon + "Ask anything..." placeholder
- On focus: expands height, shows send button, workstream dropdown above (default: "Auto")
- Sending with workstream: animated zoom into workstream, opens thread in push-panel
- Sending without: navigates to `/chat` or creates unscoped thread
- Press away or Escape: collapses to minimal
- `Cmd/Ctrl+K` to focus

**Inside committed workstream:**
- Same component, scoped to current workstream
- No real dropdown, but visually shows the workstream name in the same position as the selected dropdown state from global view (coherent design language)
- "Ask Biology HL..." placeholder
- Sending creates/continues thread in that workstream → opens in push-panel
- Press away: collapses to minimal

**When right panel is open:**
- Bar disappears entirely
- Interaction moves into the panel:
  - Chat panel → panel's own composer
  - Artifact panel → artifact AI input bar
- When panel closes: bar reappears

**Verification:**
- [ ] Global: minimal → expands → dropdown → send → zoom + panel
- [ ] Inside workstream: same appearance, scoped, no dropdown
- [ ] Panel open: bar disappears
- [ ] Panel close: bar reappears
- [ ] Cmd/Ctrl+K focuses in both contexts
- [ ] Visual coherence between global-with-selected-workstream and inside-workstream states

---

## 2I: Position Persistence & Auto-Layout Integration

### Wire Convex Sync

**File: `src/app/workspace/page.tsx`**

Call `registerSyncCallback` on mount. Create `batchUpdatePositions` mutation in `convex/workstreams.ts`.

### Internal View Positions

Each workstream's internal view has its own positions per view mode. Internal canvas-native nodes are also draggable. Their positions:
- Canonical: computed by auto-layout (structured → flow layout, columns → horizontal, graph → force)
- Overrides: user drag → localStorage → batched Convex sync (same 2-layer pattern)
- Per-workstream, per-view-mode

**Verification:**
- [ ] Drag outer workstream node → position saved → persists on reload
- [ ] Drag internal group node → position saved per workstream + view mode
- [ ] Convex sync fires after 45s debounce or on page close

---

## 2J: Animation Language

All transitions follow consistent timing:

| Transition | Duration | Easing |
|-----------|---------|--------|
| Zoom representation morph | 300ms | ease-out |
| Border dissolution | 400ms | ease-out (opacity + blur) |
| Neighbor fade | Proportional to zoom | linear lerp |
| Internal node settling | 400ms | spring (stiffness 180, damping 24) |
| View switch | 400ms | cross-fade + position morph |
| Panel open | 300ms | ease-out slide from right |
| Panel close | 250ms | ease-in slide to right |
| Panel content swap | 200ms | cross-fade |
| AI edit highlight | 400ms | fade-out (green for insert, red for delete) |
| Discard bar appear | 200ms | slide down |
| Item hover | 150ms | ease, bg-elevated highlight |
| Command bar expand | 200ms | ease-out height + opacity |

**No scale transforms on hover** (breaks spatial metaphor). No continuous ambient motion. Effects serve transitions only.

---

## 2K: Testing & Performance

### Performance Targets

- Canvas load (15 workstreams): < 1.5s
- Zoom band transitions: 60fps (GPU-composited: transform + opacity only)
- Push-panel open/close: 60fps, < 300ms
- Internal view node render: < 400ms
- Graph view force sim: < 200ms (cap at 20 iterations, max 50 nodes)
- AI edit response: < 3s to first streaming token
- Command bar focus: < 100ms

### End-to-End Tests

- [ ] Full semantic zoom lifecycle: overview → summary → detail → internal → exit
- [ ] Create thread from command bar → appears in workstream → opens in panel
- [ ] AI edits artifact → auto-applies → discard → revert → re-apply
- [ ] ManageBac sync → timetable in hub, assignments in workstreams
- [ ] Version history shows all AI edits with instructions
- [ ] Thread overflow: 20+ threads → only latest shown, "+N more" works
- [ ] Graph view: nodes draggable, edges visible, overflow cluster works
- [ ] All three views switch smoothly with content preservation
- [ ] Panel chat: full message rendering, streaming, routing phases
- [ ] `next build` passes with zero errors

---

## Critical Files Reference

| Purpose | Path | Phase |
|---------|------|-------|
| Convex schema | `convex/schema.ts` | 1A,1B,1C,1D |
| Artifacts backend | `convex/artifacts.ts` | 1A,1B |
| Notes backend (deprecate) | `convex/notes.ts` | 1A |
| Chats backend | `convex/chats.ts` | 1C |
| ManageBac sync | `convex/managebacSync.ts` | 1E |
| Chat streaming (NEW) | `src/lib/chat/streaming.ts` | 1F |
| Message accumulator (NEW) | `src/lib/chat/message-state.ts` | 1F |
| Chat panel hook (NEW) | `src/hooks/use-chat-panel.ts` | 1F |
| Compact chat hook (refactor) | `src/hooks/use-compact-chat.ts` | 1F |
| Artifact data hook (NEW) | `src/hooks/use-artifact-data.ts` | 1A |
| Tiptap editor | `src/components/editor/tiptap-editor.tsx` | 2A |
| Editor toolbar | `src/components/editor/editor-toolbar.tsx` | 2A |
| Slash commands (REWRITE) | `src/components/editor/slash-command-extension.ts` | 2A |
| Slash command dropdown (NEW) | `src/components/editor/slash-command-list.tsx` | 2A |
| Callout node (NEW) | `src/components/editor/extensions/callout-node.ts` | 2A |
| Drag handle (NEW) | `src/components/editor/extensions/drag-handle.ts` | 2A |
| Artifact AI surface (NEW) | `src/components/artifacts/artifact-ai-surface.tsx` | 2B |
| Workspace canvas | `src/components/workspace/workspace-canvas.tsx` | 2C,2D,2E |
| Workspace store | `src/stores/workspace-store.ts` | 2C |
| Workspace page | `src/app/workspace/page.tsx` | 2C,2E,2F |
| Internal content nodes (NEW) | `src/components/workspace/views/internal-content-nodes.tsx` | 2E |
| Internal view (REFACTOR) | `src/components/workspace/views/workstream-internal-view.tsx` | 2E |
| Right push-panel | `src/components/workspace/right-push-panel.tsx` | 2F |
| Hub internal view (NEW) | `src/components/workspace/hub-internal-view.tsx` | 2G |
| Command bar | `src/components/workspace/workspace-command-bar.tsx` | 2H |
| Workspace toolbar | `src/components/workspace/workspace-toolbar.tsx` | 2G |
| Position persistence | `src/lib/workspace/position-persistence.ts` | 2I |
| Auto-layout | `src/lib/workspace/auto-layout.ts` | 2I |
| Notes workspace (cleanup) | `src/components/notes/notes-workspace.tsx` | 2C |
| Editor store | `src/stores/editor-store.ts` | 2A |
| AI edit API | `src/app/api/editor/ai-edit/route.ts` | 2B |
| Globals CSS | `src/app/globals.css` | 2A |
