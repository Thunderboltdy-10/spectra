# Spectra Master Plan v2 — Workstream-First Architecture

## Context

Spectra is an AI-powered learning platform for EU schools. After completing Phases 1-5 of the original plan in [Previous Plan](PREV.md) (infrastructure, chat UX, routing, agents, artifacts) and partially implementing Phase 6 (search/Tavily), the product thesis is shifting fundamentally.

**The old thesis**: Artifacts Workspace as the differentiator — a version-tracked, multi-view artifact system replacing images/flashcards/bookmarks.

**The new thesis**: **Workstream-first workspace** — Spectra becomes a genuine AI-native school productivity + management platform. `/workspace` is the new primary surface. Workstreams are the main primitive. Artifacts become the durable object/provenance/versioning layer underneath, not the visible product surface.

**What this changes**: Chat stays but shares the stage. The product moves from "school ChatGPT replacement" to structured AI workspace where students organize their entire academic life.

---

## What Survives, What Transforms, What Dies compared to PREV.md

| Layer | Action | Detail |
|-------|--------|--------|
| Phases 1-4 (infra, chat, routing, agents) | **KEEP** | Backbone is solid |
| Phase 5 backend (artifact schema, versioning, CRUD) | **KEEP** | Powers the workspace layer underneath |
| Phase 5 frontend (`/artifacts` route, views) | **REMOVE/TRANSFORM** | Route removed. Canvas/graph views inform workspace design |
| Phase 6 (Tavily search, sources) | **COMPLETE** | Partially done, finish as-is |
| Phase 7 (tldraw, diagrams) | **MIGRATE** | tldraw assumptions are replaced by a React Flow workspace graph foundation |
| Phase 8 (Mem0 migration) | **REPLACE** | Enhanced custom memory with provenance, no Mem0 |
| Phase 9 (UI polish, dropdowns) | **ADAPT** | Still relevant, applied to workspace context |
| Phase 10 (analytics hub) | **KEEP** | Analytics stays as separate route |
| Routing engine (phase-router, scoring) | **KEEP + EXTEND** | Gains workstream routing layer |
| Agent system (wizard, auto-routing) | **KEEP + EXTEND** | Agents attach to workstreams |
| ManageBac (`src/lib/managebac.ts`) | **RESTART** | Wrong architecture, rebuild with school admin token |
| Sidebar nav | **ADAPT** | "Artifacts" → "Workspace", context-aware sidebar |
| `/flashcards`, `/images`, `/bookmarks` | **REMOVE** | Absorbed into workspace/artifacts |
| `/achievements` | **TRANSFORM** | Merge into analytics |

---

## 1. Core Entities

### Workstream
The primary organizational unit. Contains threads, notes, artifacts, files, source packs, deadlines, planner state, memory cues, linked agents, and AI activity.

**Types:**
- **Subject** — linked to a school subject (Biology HL, Math AA). Auto-suggested from ManageBac timetable. Gets subject-specific default agent. Focus: study materials, notes, flashcards.
- **Project** — deadline-centric (Extended Essay, CAS Project). Milestone tracking, progress focus. Focus: drafts, research, deadlines.
- **General** — fully flexible, user-defined. No default agent or structure.

**States:** `active` | `completed` | `archived`

### Thread
A conversation scoped to a workstream (or standalone for one-offs). Maps to existing `chats` table with a new optional `workstreamId`.

### Artifact
A durable, versioned object. Types unchanged: study_plan, timetable, note, flashcard_deck, document, code_project, diagram, image, bookmark, collection. Exists underneath workstreams as the persistence/provenance layer. Auto-saved when AI generates something worth keeping.

### Note
A Tiptap-powered document. Can be workstream-scoped, subject-scoped, or standalone. Three editor modes: agentic, notion-like, simple.

### Planner Item
A deadline, task, milestone, or reminder within a workstream. Sourced from ManageBac, AI suggestions, or manual creation.

### Source Pack
Existing resource collection scoped to a workstream or agent. No schema change needed — link via `workstreamId` on existing `packs` table.

### Memory Cue
A provenance-aware memory entry. Stores source (thread/workstream/artifact/integration), confidence, freshness, and scope. Scoped to personal (cross-workstream) or workstream level.

### Agent Attachment
An agent linked to a workstream for domain-specific assistance. Uses existing `agents` table — workstream stores `linkedAgentId`.

### One-off Task
A conversation not tied to any workstream. Lives in the chat sidebar only. Can be "promoted" to a workstream thread if it becomes substantive. Clean separation: workspace = structured work, chat = everything else.

---

## 2. Product Surfaces

### Route Map

| Route | Purpose | Status |
|-------|---------|--------|
| `/workspace` | Main workspace — React Flow spatial graph with workstream nodes around the hub | **NEW** |
| `/workspace?focus={id}&view={structured\|columns\|graph}` | Route-backed focused workstream state anchored to the map | **NEW** |
| `/notes` | Dedicated notes area outside workstreams, with return path back into workspace focus | **NEW** |
| `/chat` | Standalone chat for one-offs and quick questions | **ADAPT** |
| `/chat?from=workspace&ws={id}` | Full chat with back-arrow to workspace | **NEW** |
| `/agents` | Agent browser and creation | KEEP |
| `/models` | Model explorer | KEEP |
| `/analytics` | Learning analytics (absorbs achievements) | ADAPT |
| `/admin` | Admin console (gains ManageBac integration config) | ADAPT |
| `/super-admin` | Platform management | KEEP |

**Removed routes:** `/artifacts`, `/flashcards`, `/images`, `/bookmarks`, `/achievements`

### Default Landing (user-configurable)
- **Default behavior**: Smart routing — if user has active workstreams → `/workspace`. If new user or no workstreams → `/chat` with onboarding nudge.
- **Setting**: Users can override in preferences to always land on workspace or chat.
- **Storage**: `userPreferences.defaultLanding` field.

---

## 3. Workspace UX — React Flow Workspace Graph

### 3.1 Technology
**React Flow** as the workspace surface. Custom node components represent workstreams and the personal hub. Edges handle hub-to-workstream links and soft peer relationships. The map is a locked-down product surface: pan, zoom, drag, select/focus primitives, no whiteboard tools. Persistence stays in Convex for positions and in user preferences/local client state for viewport restoration.

### 3.2 The Global Workspace View
An infinite but calm spatial graph containing:
- **Workstream nodes** — custom React Flow nodes representing each workstream
- **Personal hub node** — central custom node connected to all workstreams
- **Connection lines** — styled edges from hub to each workstream, plus optional derived peer links between related workstreams
- **Completed workstreams** — faded to 30% opacity, slightly smaller, toggleable via toolbar

The workspace is calm and minimal at the default zoom. No floating-card chaos. Strong default layout (hub center, workstreams radiating outward) with user customization freedom (drag-and-drop repositioning).
The workspaces should also be able to be ordered and structured within the canvas, ordered as visual 'folder' blocks of space. Everything interactible and draggable, but should also happen and get structured automatically

### 3.3 Controlled Representation Bands

The defining UX innovation. Like Google Maps, the workspace reveals progressive detail as you zoom in. This is not raw whiteboard zoom and not naïve text scaling. It is a **controlled representation system** where each node moves through discrete reveal bands while preserving visual continuity.

**Implementation:** React Flow viewport zoom is translated into representation bands (`overview`, `summary`, `detail`). Within each band, motion and opacity can interpolate smoothly, but the system changes what is shown, not just how large the same text becomes.

```
titleSize = lerp(10, 18, clamp01((zoom - 0.2) / 0.4))
descOpacity = clamp01((zoom - 0.5) / 0.2)
artifactListTranslateY = lerp(20, 0, clamp01((zoom - 0.55) / 0.15))
```

**Zoom Level Breakpoints:**

| Viewport zoom | Level | What renders |
|----------|-------|-------------|
| low zoom | `overview` | Emoji, title, type signal, status. High legibility, low density. |
| mid zoom | `summary` | Title, description snippet, counts, activity state, stronger card identity. |
| high zoom | `detail` | Main-stage preview, quick actions, note/thread/planner signals, clear enter affordance. |

**Morph transitions:** Elements can animate opacity, transform, blur, and local scale between bands, but representation changes are intentional. The card boundary can gradually soften as the user commits deeper, preparing the transition into focus mode.

**Completed workstreams:**
```
opacity = status === "completed" ? 0.3 : 1
scale = status === "completed" ? 0.85 : 1
```
Toolbar toggle: "Show completed" on/off. When off, completed shapes hidden.

### 3.4 Personal Hub Node

A special central React Flow node connected to all workstreams. Always visible at any zoom level with custom visuals and no generic selection card behavior.

**At low zoom:** Circle with user's avatar. Profile avatar sourced from ManageBac when available (see §10.1). If a student's Clerk email matches their school ManageBac account, their ManageBac profile photo replaces the Clerk avatar automatically — both in the hub node and on all workstream cards that show user context.
**At higher zoom, expands to reveal:**
- Quick notes inbox (recent unattached notes)
- Cross-workstream planner (upcoming deadlines from all workstreams)
- Personal memory summary (highest-confidence entries)
- Recent items across all workstreams

**Connection lines** from hub to each workstream:
- Opacity proportional to workstream recency (active = bright, stale = faint)
- Dashed for completed workstreams
- Color matches workstream color
- Hidden at zoom < 0.25 for clean overview

### 3.5 Workspace Toolbar (fixed, minimal)

A small fixed toolbar at the top of the workspace page. Only essential actions:
- **Search** — global search across workstreams, threads, notes, artifacts
- **+ New Workstream** — opens creation dialog
- **Toggle completed** — show/hide completed workstreams
- **View hub** — center camera on personal hub node

Not cluttered. No mode selectors, no model pickers, no settings. Just workspace-level essentials.

### 3.6 Drag and Drop

React Flow handles node dragging natively. On drag end, persist new `canvasX`/`canvasY` to Convex. Workstream nodes stay user-draggable. The hub is a stable anchor and does not behave like a floating whiteboard object.

### 3.7 Workspace State Persistence

Viewport/camera state is persisted and restored. Focus state is route-backed. Panel state, selected view, and maximize/return flows must remain recoverable with browser back behavior.

---

## 4. Inside a Workstream

### 4.1 Entering a Workstream

At deeper zoom, or immediately on click, the workstream transitions into a **route-backed focused state**. This is not a modal and not a separate app. It is visually anchored to the same spatial system while the URL reflects the focused workstream and active internal view.

### 4.2 View Toggle

Three explicit views are available through a top-bar switcher inside focused workstream state:

**A. Structured View (default)**
Fixed layout grammar with:
- Top identity/header zone
- Main stage for the most important active item
- Stable surrounding modules for Threads, Notes, Artifacts, Planner, and Agents when relevant
- Right-side chat panel toggle

**B. Column View**
Grouped column layout for notes, tasks, artifacts, and conversation clusters. Inspired by productivity boards, but still native to Spectra's calm workspace language.

**C. Graph View**
Secondary internal relationship view showing connections between notes, artifacts, planner items, chats, and agents.

### 4.3 Chat Panel

On the outer map, quick chat can infer the likely workstream and open focus with chat already active. Inside focus, chat is a real right-side panel using the same routing/rendering surfaces as full chat, but with reduced chrome.

---

## 5. Chat Side Panel in Workspace

### 5.1 Architecture

A right-side drawer panel within the focused workspace state. It does not navigate away from `/workspace` until the user explicitly maximizes into full chat.

**When closed:** Outer-map quick chat remains available for fast entry. Inside focus, panel triggers remain in the header and in module actions.

**When open:** Panel takes ~380px on the right. Canvas resizes. Panel contains:

1. **Header:** Workstream name, close button, "Open full chat" button
2. **Messages area:** Reuses `ChatMessages` component with `compact` prop (reduced padding, no route-trace trigger)
3. **Composer:** Reuses `ChatComposer` with simplified defaults:
   - Auto mode/model/search/thinking (no selectors in panel)
   - Uses workstream's default mode and linked agent automatically
   - Slash commands still available
4. **No routing clutter:** No route-trace, orchestration, or settings drawers inside the workspace chat panel

**Functionality preserved:** Visualizations, code previews, flashcard renders, quiz renders, source citations — all still work. The panel is a simplified *view*, not a reduced *capability*.

### 5.2 Open Full Chat Navigation

"Open full chat" button navigates to:
```
/chat?chatId={id}&from=workspace&ws={workstreamId}
```

The `/chat` page detects `from=workspace` and renders a back-arrow button in the header that returns to `/workspace?focus={workstreamId}`. This back-arrow only appears when the `from` param is present — not in normal chat use.

### 5.3 State Management

Chat state must be workstream-aware. New chats created from focused workstream state persist `workstreamId`, so the panel and full chat route are looking at the same real thread scope.

---

## 6. Prompt Routing & Assignment

### 6.1 The Five-Level Assignment System

Every user prompt gets classified into one of five assignment levels:

| Level | Name | When | Pipeline behavior |
|-------|------|------|-------------------|
| L0 | `quick_reply` | <30 chars, simple follow-up, no attachments | Fastest model, no retrieval, no memory, no search |
| L1 | `standard` | Normal complexity, no enhanced triggers | Standard model, optional personal memory read |
| L2 | `enhanced` | Complex mode, attachments, explicit search | Strong model, RAG, memory read/write, optional search |
| L3 | `orchestrated` | Multi-agent, deep research, complex artifacts | Multi-step pipeline, task graph, specialist streaming |
| L4 | `workstream_deep` | Workstream context + cross-artifact reasoning | L3 + workstream memory injection, cross-artifact retrieval, planner awareness |

### 6.2 Workstream Detection Signals

When a prompt arrives, the system determines which workstream (if any) it belongs to:

1. **Explicit context:** User is chatting within a workstream panel → belongs to that workstream
2. **Topic similarity:** Embed the prompt, compare against workstream titles/descriptions/recent artifacts (cosine > 0.7 → auto-assign, 0.4-0.7 → suggest)
3. **Keyword matching:** Workstream tags/subject codes match prompt keywords
4. **Agent matching:** If an active agent matches and is linked to a workstream
5. **Recency bias:** If user was recently active in a workstream and prompt is ambiguous, prefer that workstream

### 6.3 Thread Continuation vs. Fork

Within a workstream, the system decides whether to continue the current thread or start a new one:

**Continue current thread when:**
- Same topic (cosine similarity > 0.5 with recent messages)
- Context window < 75% occupied
- < 15 turns since last compaction
- User explicitly replies in the same thread

**Fork into new thread when:**
- Topic drift detected (cosine < 0.3 with last 3 messages)
- User says "new question" / "different topic"
- Context window > 75% occupied
- Time gap > 12 hours since last message in thread

**Create new workstream when:**
- AI detects a substantial new subject/project not matching any existing workstream
- Suggestion toast: "This looks like a new project. Create workstream?" with [Create] [Not now] [Never]
- ManageBac sync detects new subjects → auto-suggest subject workstreams

### 6.4 Override & Correction

After every routing decision, a lightweight toast shows the assignment:
- "Added to Biology HL" with [Move] action
- "Kept as one-off chat" with [Add to workstream] action
- Users can re-home any thread at any time via thread context menu

### 6.5 Integration with Existing Pipeline

**Files to modify:**
- `src/lib/auto-settings.ts` — extend `classifyRequest` with `workstreamContext` parameter, add L4 detection
- `src/lib/orchestrator/route-plan.ts` — add `workstreamContext` and `assignmentLevel` to `BuildRoutePlanParams`
- `src/lib/orchestrator/pipeline.ts` — L4 adds workstream memory retrieval, deadline context injection, cross-artifact summaries in system prompt
- `src/lib/routing/phase-router.ts` — new phases for `ws_memory` and `ws_artifacts` retrieval

### 6.6 Token Budget by Level

| Level | System prompt | Memory | Artifacts | Search | Total target |
|-------|--------------|--------|-----------|--------|-------------|
| L0 | ~400 tokens | None | None | None | < 600 |
| L1 | ~800 tokens | Personal (max 3) | None | None | < 1200 |
| L2 | ~1500 tokens | Personal (max 5) | None | Optional | < 3000 |
| L3 | Full | Personal (max 5) | On demand | Yes | < 6000 |
| L4 | Full | Personal + WS (max 8 total) | WS summaries (max 3) | Yes | < 8000 |

---

## 7. Memory Architecture

### 7.1 Three-Layer Model

**Layer 1: Personal Memory** (cross-workstream, existing `userMemoryEntries` table)
- Identity: name, grade, school, IB subjects (never expires)
- Preferences: learning style, UI preferences, language (90 days)
- Academic patterns: strengths, weaknesses, common mistakes (180 days)
- Corrections: explicit user corrections (180 days)
- Max 80 entries, vector-indexed

**Layer 2: Workstream Memory** (new `workstreamMemory` table)
- Concepts learned in this workstream
- Progress markers (what's been covered, what's pending)
- Key decisions and findings
- Resource links (important artifacts/notes)
- Max 30 entries per workstream, vector-indexed

**Layer 3: Thread Context** (ephemeral, existing system)
- Current conversation messages
- Compaction summaries
- Not persisted beyond thread lifecycle

### 7.2 Provenance-Aware Entries

Every memory entry (both personal and workstream) stores:
- **`sourceType`**: `chat_extraction` | `artifact_link` | `user_explicit` | `managebac_sync` | `agent_inference`
- **`sourceChatId`**: which thread it was extracted from
- **`sourceMessageId`**: specific message that triggered extraction
- **`sourceArtifactId`**: if extracted from artifact content
- **`sourceWorkstreamId`**: which workstream context (personal entries only)
- **`confidence`**: 0.0-1.0, set at extraction time
- **`freshness`**: 0.0-1.0, decays daily (workstream: 0.98/day, personal: 0.99/day)
- **`scope`**: `global` | `workstream`

### 7.3 Injection Strategy

**Always inject** (into system prompt):
- Personal identity + preferences (Layer 1, max 3 entries, cosine > 0.6)

**Inject if relevant:**
- Workstream memory when in workstream context (Layer 2, max 3 entries, cosine > 0.7)
- Topic-specific personal memory when matched (Layer 1, max 2 entries, cosine > 0.7)

**Never auto-inject:**
- Artifact content (too large — agents read on demand)
- Low-confidence entries (< 0.5)
- Low-freshness entries (< 0.2)

**Surface but don't inject:**
- Entries that match the topic but don't meet injection threshold
- Shown as a collapsible "Related memory" indicator below the assistant message
- User can click to see details, pin to inject in future messages, or dismiss

### 7.4 Workstream Memory Extraction

Extends existing `maybeExtractMemory` in `src/lib/orchestrator/post-process.ts`:
1. After standard extraction, check if chat has `workstreamId`
2. If yes, run workstream-specific extraction prompt (looks for concepts, progress, deadlines, resource references)
3. Write to both `userMemoryEntries` (with `scope: "workstream"`) AND `workstreamMemory`
4. Deduplication: check existing workstream memory entries by canonical key + semantic similarity (> 0.8 = update, not duplicate)

### 7.5 Structured Memory via Workspace

Artifacts, notes, and planner items serve as high-fidelity structured memory:
- Agents read these directly on demand (no injection)
- This prevents irrelevant memory leakage (asking about Brawl Stars won't inject WW2 context)
- The workspace itself is the highest-fidelity memory layer

### 7.6 Freshness Decay Cron

Daily cron job in `convex/crons.ts`:
- `workstreamMemory.freshness *= 0.98` per day
- `userMemoryEntries.freshness *= 0.99` per day
- Entries with freshness < 0.1 AND confidence < 0.5 → auto-archive (not delete)

---

## 8. Agentic Editor (Tiptap)

### 8.1 Technology

**Tiptap v2** (ProseMirror-based, React-native). Packages:
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`
- `@tiptap/pm` (ProseMirror utilities)
- Future: `@tiptap/extension-collaboration` for real-time

### 8.2 Three Editor Modes (toggle)

**Simple mode:**
- Clean textarea-like experience
- `StarterKit` only (paragraphs, bold, italic, headings, lists)
- No slash commands, no floating menus
- For quick notes, simple text

**Notion-like mode:**
- Block-based editing with slash commands
- `StarterKit` + `Placeholder` + custom `SlashCommand` extension + `DragHandle`
- Slash commands: `/heading`, `/bullet`, `/numbered`, `/code`, `/quote`, `/divider`, `/table`
- Floating toolbar on selection (bold, italic, link, code, highlight)
- Drag handles on blocks for reordering

**Agentic mode:**
- Everything from Notion-like PLUS AI command bar
- AI edits inline via diff-based operations
- Auto-accept toggle controls behavior

### 8.3 AI Bar

A bar at the top of the editor (agentic mode only):
```
[AI: "Fix grammar in paragraph 3..." ] [Submit] [Auto-accept: ON]
```

Accepts natural language instructions:
- "Fix the grammar"
- "Add a conclusion section"
- "Make the introduction more concise"
- "Convert to bullet points"
- "Expand on the second paragraph"

### 8.4 Diff-Based Editing

When AI instruction is submitted:
1. Serialize current Tiptap document JSON
2. Send instruction + document to `/api/editor/ai-edit`
3. AI returns structured edit operations: `{ type: "replace"|"insert"|"delete", from, to, content, reason }`
4. **Auto-accept ON:** Operations applied immediately as Tiptap transaction with undo point. User sees changes appear. "Undo" button reverts. Toggle to bring back if undone.
5. **Auto-accept OFF:** Operations rendered as inline diff decorations (green additions, red strikethrough deletions). Per-operation accept/reject buttons.

Diff visualization uses Tiptap `DecorationSet` to overlay markers without modifying actual content until accepted.

### 8.5 Artifact Integration

The agentic editor is the primary way to interact with artifacts:
- Opening an artifact (from workstream or chat) loads it in the editor (right panel or dedicated view)
- Code artifacts: Tiptap with code block extension + language detection
- AI-generated artifacts: auto-open in editor with agentic mode
- Every AI edit creates an `artifactVersion` with the diff
- Version history panel (existing pattern from `artifact-editor.tsx`) for restore

### 8.6 Auto-Save Behavior

When the system creates something worth keeping:
1. Auto-save as artifact, linked to active workstream
2. Lightweight toast: **"Saved"** with actions:
   - Undo (delete the artifact)
   - Move to [workstream] (reassign)
   - Keep as one-off (unlink from workstream)
3. Auto-detection triggers:
   - Flashcard generation → `flashcard_deck` artifact
   - Document generation → `document` artifact
   - Study plan creation → `study_plan` artifact
   - Substantial code (>20 lines) → `code_project` artifact
4. No explicit "save as artifact" button needed, though manual creation still available

---

## 9. Notes System

### 9.1 Note Categories

- **Workstream notes**: Scoped to a workstream, appear as note objects/previews inside focused workstream views
- **Subject notes**: Long-lived, tied to a subject area (but not a specific workstream)
- **Quick notes / inbox**: Created from hub node, later filed or discarded
- **Documents**: Durable long-form (essays, reports, lab writeups) — distinguished by length and structure

### 9.2 Notes in Workspace

- Notes appear as previews/cards inside focused workstream modules and views
- Clicking a note opens it in the right-side panel first
- The panel can maximize into `/notes` while preserving a return path back to `/workspace?focus={id}`
- `/notes` is also a dedicated standalone notes area outside workstreams
- Quick notes accessible from hub node
- AI can reference/quote notes in conversations when in workstream context
- Notes auto-link to workstream when created within workstream chat

### 9.3 Storage

Notes live in a new `notes` table (see Schema section). Content stored as Tiptap JSON. Plaintext version stored for search indexing. Notes optionally linked to `artifacts` table for version tracking (heavyweight notes that need provenance).

---

## 10. Integrations

### 10.1 ManageBac (Restart from Scratch)

**Authentication:** School admin token model.
1. School admin generates API token in ManageBac (Settings > Develop > API Manager)
2. Admin enters token in Spectra Admin > Integrations > ManageBac
3. Admin maps students: auto-match by email, or manual Clerk ↔ ManageBac student ID mapping
4. Token stored encrypted in `orgs` table (new field: `managebacConfig`)

**Data pulled (read-only, per student):**
- **Timetable** → auto-suggest subject workstreams ("You have Biology HL. Create workstream?")
- **CAS activities** → feed CAS project workstream planner
- **Announcements** → surface in hub node
- **Deadlines/assignments** → create planner items in matching workstreams

**Constraints:**
- Read-only only. No writes to ManageBac.
- Only signed-in user's own data (filtered by student ID mapping)
- No access to other students' data
- Sync frequency: daily pull + manual refresh button
- Graceful degradation if ManageBac API is down

**Files:**
- `src/lib/managebac.ts` → rewrite with school admin token pattern
- `src/app/api/managebac/route.ts` → rewrite
- `convex/schema.ts` → add `managebacConfig` to orgs table
- New: `src/app/admin/integrations/page.tsx` for admin configuration UI

### 10.2 Future Integrations (not implemented now, architecture-aware)
- Google Classroom
- Moodle
- Canvas LMS
- Calendar sync (Google/Outlook)

---

## 11. Search & Retrieval

### 11.1 Tavily Integration (complete Phase 6)
Existing partial implementation. Complete as designed:
- Search, Extract, Crawl, Research tools
- Selective use based on routing decision
- 30-minute cache TTL
- Cost minimization rules preserved

### 11.2 Workspace Search
New global search across workspace:
- Workstream titles/descriptions (Convex search index)
- Thread content (existing `messages.search_content`)
- Note content (new `notes.search_content`)
- Artifact titles/tags (existing `artifacts` search)
- Results grouped by type with relevance scoring
- Accessible from workspace toolbar and command palette (existing kbar)

### 11.3 Chat History Retrieval
- Index completed threads for keyword + semantic search
- When user asks about past work: search within workstream scope first
- Hybrid BM25 + vector search (existing from Phase 8.2 work)

---

## 12. Backend Data Model

### 12.1 New Tables

**`workstreams`**
```
ownerUserId, orgId, type ("subject"|"project"|"general"),
title, description?, emoji?, color?,
status ("active"|"completed"|"archived"),
canvasX?, canvasY?, canvasWidth?, canvasHeight?,
subjectCode?, managebacClassId?,
linkedAgentId?, linkedPackId?,
defaultMode?, defaultThinking?,
artifactCount?, lastActivityAt?, completedAt?,
createdAt, updatedAt
```
Indexes: `by_owner`, `by_owner_status`, `by_owner_updated`, `by_org`, `search_title`

**`workstreamMemory`**
```
workstreamId, ownerUserId, orgId,
key, text, embedding (vector 1536),
category ("concept"|"progress"|"preference"|"deadline"|"correction"|"resource_link"),
confidence, freshness,
sourceType ("chat_extraction"|"artifact_link"|"user_explicit"|"managebac_sync"|"agent_inference"),
sourceChatId?, sourceMessageId?, sourceArtifactId?,
status ("active"|"superseded"|"dismissed"),
supersededBy?,
createdAt, updatedAt
```
Indexes: `by_workstream`, `by_workstream_category`, `by_workstream_status`, `by_source_chat`, vector index on `embedding`

**`plannerItems`**
```
ownerUserId, orgId, workstreamId?,
title, description?,
type ("deadline"|"milestone"|"goal"|"reminder"),
priority ("low"|"medium"|"high"),
status ("pending"|"in_progress"|"completed"|"cancelled"),
dueAt?, completedAt?,
sourceType ("user_manual"|"ai_suggested"|"managebac_sync"),
sourceArtifactId?, sourceChatId?, managebacItemId?,
createdAt, updatedAt
```
Indexes: `by_owner`, `by_owner_status`, `by_workstream`, `by_due`

**`notes`**
```
ownerUserId, orgId, workstreamId?, artifactId?,
title, content (Tiptap JSON), contentPlaintext?,
editorMode ("agentic"|"notion"|"simple"),
lastAiEditId?, pendingDiffs?,
createdAt, updatedAt
```
Indexes: `by_owner_updated`, `by_workstream`, `by_artifact`, `search_content`

**`userPreferences`**
```
userId, orgId,
defaultLanding ("smart"|"workspace"|"chat"),
workspaceLayout? (persisted camera state),
editorDefaultMode? ("agentic"|"notion"|"simple"),
updatedAt
```
Index: `by_user`

### 12.2 Modified Tables

**`chats`**: Add `workstreamId: v.optional(v.id("workstreams"))` + index `by_workstream`

**`artifacts`**: Add `workstreamId: v.optional(v.id("workstreams"))` + index `by_workstream`

**`userMemoryEntries`**: Add optional fields:
- `sourceWorkstreamId`, `sourceArtifactId`, `sourceMessageId`
- `freshness` (0.0-1.0)
- `scope` ("global"|"workstream")

**`orgs`**: Add `managebacConfig` (encrypted token, student mapping, sync settings)

---

## 13. Frontend Architecture

### 13.1 New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `@xyflow/react` | Workspace graph surface | ~200KB |
| `zustand` | Ephemeral state management | ~1KB |
| `@tiptap/react` + extensions | Note/artifact editor | ~200KB |
| `framer-motion` | Smooth transitions and layout animations | ~150KB |

### 13.2 Zustand Stores

**`workspaceStore`**: Viewport state, selected workstream, view options (show archived, show connections, background mode), creation dialog state, transition bounds for focus entry

**`chatPanelStore`**: Panel open/closed, active workstream, active thread, draft message

**`editorStore`**: Active artifact/note, editor mode, diff state, AI bar state, version history

Convex stays for all persisted data and real-time sync. Zustand handles only ephemeral UI state.

### 13.3 New Component Structure

```
src/app/workspace/
  page.tsx                        — Route: /workspace

src/components/workspace/
  workspace-canvas.tsx            — React Flow mount + custom node/edge registration
  workspace-toolbar.tsx           — Fixed toolbar (search, +new, toggles)
  chat-side-panel.tsx             — Outer-map quick chat entry
  workstream-create-dialog.tsx    — Creation wizard (type, name, subject, agent)
  workstream-focus-panel.tsx      — Route-backed focused workspace state + detail panels

src/lib/workspace/
  zoom-helpers.ts                 — reveal-band helpers + color system

src/components/editor/
  tiptap-editor.tsx               — Root editor with mode switching
  ai-bar.tsx                      — AI instruction bar (agentic mode)
  slash-command-extension.ts      — Tiptap slash commands
  drag-handle-extension.ts        — Block drag handles
  diff-decoration.ts              — Diff overlay decorations
  editor-toolbar.tsx              — Mode toggle + formatting
  editor-version-panel.tsx        — Version history

src/lib/editor/
  ai-edit-engine.ts               — AI edit orchestration
  diff-engine.ts                  — Diff computation + application
  serialize.ts                    — Tiptap JSON ↔ plaintext

src/stores/
  workspace-store.ts              — Zustand workspace state
  chat-panel-store.ts             — Zustand chat panel state
  editor-store.ts                 — Zustand editor state

src/hooks/
  use-workspace-data.ts           — Convex queries for workspace
  use-workspace-chat.ts           — Chat state scoped to workstream
```

### 13.4 Sidebar Adaptation

The existing sidebar (`src/components/chat/chat-sidebar.tsx`) adapts based on route:
- On `/workspace`: Shows workstream list (active, with activity indicators), quick actions
- On `/chat`: Shows chat history as it does now (one-offs and workstream threads mixed, grouped by date)
- Primary nav items: **Workspace** (replaces Artifacts), **Chat**, **Agents**

---

## 14. Existing Code Disposition

| Component | Action | Reasoning |
|-----------|--------|-----------|
| `src/app/artifacts/page.tsx` | **REMOVE** | No longer a visible route |
| `src/components/artifacts/canvas-view.tsx` | **REMOVE** | Replaced by React Flow workspace |
| `src/components/artifacts/graph-view.tsx` | **ADAPT** | Pattern reused for workstream linked/graph view |
| `src/components/artifacts/timeline-view.tsx` | **ADAPT** | Pattern reused for workstream timeline view |
| `src/components/artifacts/sections-view.tsx` | **ADAPT** | Pattern informs workstream stacked view |
| `src/components/artifacts/artifact-editor.tsx` | **TRANSFORM** | Replaced by Tiptap agentic editor |
| `src/components/artifacts/artifact-card.tsx` | **KEEP** | Reused inside workstream views |
| `src/components/artifacts/create-artifact-dialog.tsx` | **KEEP** | Reused for manual artifact creation |
| `convex/artifacts.ts` | **KEEP** | Backend CRUD powers workspace layer |
| `src/lib/artifact-types.ts` | **KEEP** | Type definitions still valid |
| `src/app/page.tsx` (chat) | **ADAPT** | Gains workstream awareness, back-arrow |
| `src/hooks/use-chat-state.ts` | **ADAPT** | Add workstreamId param, workstream defaults |
| `src/lib/orchestrator/pipeline.ts` | **EXTEND** | Add L4, workstream memory, cross-artifact |
| `src/lib/routing/phase-router.ts` | **EXTEND** | New phases for WS memory/artifacts |
| `src/lib/orchestrator/retrieval.ts` | **KEEP** | Search/RAG unchanged |
| `convex/memory.ts` | **EXTEND** | Provenance fields, freshness decay |
| `src/lib/managebac.ts` | **REWRITE** | School admin token architecture |
| `src/components/chat/chat-sidebar.tsx` | **ADAPT** | Context-aware: workspace list vs chat list |
| `src/components/layout/app-shell.tsx` | **ADAPT** | Workspace route handling |
| Sidebar nav items | **ADAPT** | "Artifacts" → "Workspace" |
| `/flashcards`, `/images`, `/bookmarks` routes | **REMOVE** | Absorbed into workspace |
| `/achievements` route | **MERGE** | Into analytics |

---

## 15. Implementation Waves

### Wave 1: Data Foundation
*Everything depends on this.*

- [x] New Convex tables: `workstreams`, `workstreamMemory`, `plannerItems`, `notes`, `userPreferences`
- [x] Schema modifications: add `workstreamId` to `chats` and `artifacts`, provenance fields to `userMemoryEntries`, `managebacConfig` to `orgs`
- [x] New indexes
- [x] Convex backend: `convex/workstreams.ts` (full CRUD), `convex/plannerItems.ts`, `convex/notes.ts`, `convex/userPreferences.ts`
- [x] Install Zustand, create workspace/chatPanel/editor stores
- [x] API routes: `/api/workstreams`, `/api/planner`, `/api/notes`, `/api/preferences`

### Wave 2: Workspace Graph
*Depends on Wave 1.*

- [x] Install React Flow
- [x] `/workspace` route and page
- [x] `workspace-canvas.tsx` — React Flow mount with custom hub/workstream nodes
- [x] Reveal-band node states (`overview`, `summary`, `detail`) instead of literal whiteboard zoom
- [x] Connection arrows with recency-based opacity
- [x] Workspace toolbar (search, +new, toggle completed, background mode)
- [x] Viewport persistence (camera state, node positions)
- [x] Drag-and-drop reordering
- [x] Completed workstreams: faded + toggleable
- [x] Workstream creation dialog (type, name, subject, agent)

### Wave 3: Chat Integration
*Depends on Wave 1. Partially parallel with Wave 2.*

- [x] Quick chat entry on outer workspace map
- [x] Right-side chat panel inside focused workstream state
- [x] Workstream-aware chat creation and routing
- [x] Back-arrow navigation (`from=workspace` param)
- [x] Sidebar adaptation: workstream list on `/workspace`, chat list on `/chat`
- [x] Nav item update: "Artifacts" → "Workspace", dedicated `/notes` area added

### Wave 4: Prompt Routing Expansion
*Depends on Wave 1 and 3.*

- [x] 5-level assignment system (L0-L4) in `auto-settings.ts`
- [x] Workstream detection signals in `route-plan.ts`
- [x] Thread continuation vs fork logic
- [x] AI workstream suggestion from chat (toast UI)
- [x] Override & correction UI (toast with Move action)
- [x] L4 pipeline: workstream memory retrieval, deadline injection, cross-artifact summaries

### Wave 5: Memory Enhancement
*Depends on Wave 1, partially on Wave 4.*

- [x] Provenance fields on `userMemoryEntries`
- [x] `workstreamMemory` backend (CRUD, vector search)
- [x] Workstream memory extraction in `post-process.ts`
- [x] Layered injection logic in pipeline
- [x] "Surface but don't inject" UI (memory indicator below messages)
- [x] Freshness decay cron job
- [x] Contradiction detection (superseded entries)

### Wave 6: Agentic Editor
*Depends on Wave 1 (notes table). Independent of Waves 2-5 — can be parallelized.*
  
- [x] Install Tiptap packages (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, `@tiptap/pm`)
- [x] `tiptap-editor.tsx` with mode toggle (simple/notion/agentic)
- [x] Simple mode: StarterKit only (no toolbar)
- [x] Notion-like mode: formatting toolbar (bold, italic, headings, lists, blockquote, code)
- [x] Agentic mode: AI bar with natural language instructions
- [x] `/api/editor/ai-edit` route (claude-haiku, returns structured diff ops)
- [x] Auto-accept toggle (applies immediately vs. shows preview)
- [x] Diff accept/reject UI in AI bar
- [ ] Slash commands extension (notion mode): `/heading`, `/bullet`, `/code`, `/quote`
- [ ] Drag-handle extension for block reordering
- [ ] Artifact integration: load/save from `artifacts` table
- [ ] Auto-save artifact flow (detection, toast, workstream binding)
- [ ] Version history panel

**Also implemented in this wave (Wave 2-3 quality fixes):**
- [x] Reveal-band representation system instead of naïve constant scaling
- [x] Focus mode overlay: workstream node morphs into route-backed workspace state
- [x] Hub same interaction grammar as workstreams (custom node, no generic selection card)
- [x] WorkstreamFocusPanel with structured/columns/graph switcher + reusable detail panels
- [x] useCompactChat hook: real streaming chat in the panel (same /api/chat protocol)
- [x] QuickChatBar: intelligent workstream inference, manual picker when ambiguous
- [x] Workspace initial centering (hub at center on load)
- [x] Position persistence race condition fixed (props-only updates on re-sync)
- [x] Center-hub toolbar button wired
- [x] Back gesture: click workspace backdrop, Escape key, visible back button

### Wave 7: Inside Workstreams
*Depends on Waves 2, 3, 6.*

- [ ] Structured view inside focused workstream
- [ ] Column view inside focused workstream
- [ ] Graph view inside focused workstream
- [ ] Reusable panel-first detail flow for notes, artifacts, code, documents
- [ ] Planner view/module inside focused workstream
- [ ] Hub panel: quick notes, cross-WS planner, personal memory, recent items

### Wave 8: ManageBac + Integrations
*Depends on Wave 1, Wave 7.*

- [ ] Admin UI for ManageBac token configuration
- [ ] Student ↔ ManageBac ID mapping (email match + manual)
- [ ] Rewrite `managebac.ts` with school admin token
- [ ] Timetable pull → auto-suggest subject workstreams
- [ ] Deadlines/assignments → planner items
- [ ] CAS activities → CAS workstream feed
- [ ] Daily sync cron + manual refresh

### Wave 9: Polish & Complete
*Final pass.*

- [ ] Workspace search (global across all entities)
- [ ] Remove old routes (`/artifacts`, `/flashcards`, `/images`, `/bookmarks`)
- [ ] Redirect setup for old routes
- [ ] Complete Phase 6 search/Tavily work
- [ ] Achievements merge into analytics
- [ ] End-to-end testing of all flows
- [ ] Performance optimization (canvas with many workstreams, memory retrieval latency)

---

## 16. Verification Strategy

### Core Flows to Test

1. **Workspace lifecycle**: Create workstream → appears on map → zoom in → richer representation bands appear → click/focus → complete → fades → toggle visibility
2. **Representation bands**: Zoom out → overview labels only → zoom in → summary card → zoom further → detail card. Verify controlled reveal changes, not raw scaling.
3. **Chat panel**: Open focused workstream chat panel → chat → artifact auto-saved → verify in workstream. Close panel → open outer-map quick chat → inferred workstream focus opens with chat active.
4. **Full chat navigation**: Open full chat from panel → verify back-arrow → click back → return to workspace focused on correct workstream.
5. **Routing**: Send prompt in chat → verify correct workstream assignment → override with Move → verify thread moved. Send one-off → verify stays in chat sidebar only.
6. **Memory**: Chat in workstream → verify workstream memory extracted → switch workstream → verify isolation (no leakage). Check provenance on extracted entries.
7. **Agentic editor**: Open artifact → switch to agentic mode → submit AI instruction → verify diff renders → accept → verify version created → undo → verify revert.
8. **ManageBac**: Admin configures token → student sees timetable → subject workstreams suggested → deadlines appear in planner.
9. **One-off flow**: Random question in /chat → verify stays outside workspace → promote to workstream → verify thread appears in workstream.
10. **Hub node**: Open hub → verify quick notes, planner items, memory summary all populate correctly.

### Performance Targets
- Workspace graph load with 15 workstreams: < 1.5s
- Representation band transitions: 60fps
- Chat panel open/close: < 200ms
- Memory retrieval (personal + workstream): < 500ms
- Workstream memory extraction: < 2s (async, non-blocking)
- AI edit response in agentic editor: < 3s for simple edits

---

## 17. Critical Files Reference

| Purpose | Path |
|---------|------|
| Convex schema | `convex/schema.ts` |
| Chat pipeline | `src/lib/orchestrator/pipeline.ts` |
| Route planning | `src/lib/orchestrator/route-plan.ts` |
| Phase router | `src/lib/routing/phase-router.ts` |
| Auto settings | `src/lib/auto-settings.ts` |
| Memory backend | `convex/memory.ts` |
| Memory extraction | `src/lib/orchestrator/post-process.ts` |
| Chat state hook | `src/hooks/use-chat-state.ts` |
| Artifacts backend | `convex/artifacts.ts` |
| Artifact types | `src/lib/artifact-types.ts` |
| ManageBac (rewrite) | `src/lib/managebac.ts` |
| App shell | `src/components/layout/app-shell.tsx` |
| Sidebar | `src/components/chat/chat-sidebar.tsx` |
| Chat header | `src/components/chat/chat-header.tsx` |
| Existing graph view | `src/components/artifacts/graph-view.tsx` |
| Existing timeline view | `src/components/artifacts/timeline-view.tsx` |
