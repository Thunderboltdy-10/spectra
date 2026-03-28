# Spectra Master Plan v3 — Intelligent Workspace Platform

## Context

Spectra is an AI-powered learning platform for EU schools (IB curriculum focus). After completing Waves 1-6 of the v2 plan (data foundation, workspace graph, chat integration, routing expansion, memory enhancement, partial agentic editor), the product has a functional workstream-based workspace but significant gaps remain in quality, coherence, and architectural ambition.

**The v2 thesis** moved Spectra from "school ChatGPT" to "workstream-first workspace." That shift was correct. But the execution left the workspace feeling like a prototype rather than a home — the quick chat is tucked away, the focus animations feel unnatural, thread counts don't update, the notes editor is inconsistent across modes, memory leaks across workstreams, and the AI has no agency over its own tools (memory read/write happens as pipeline side-effects, not as deliberate tool calls).

**The v3 thesis**: Spectra becomes a **genuine AI-native school productivity platform** where the workspace is the home, the AI is an active participant with tools (not just a responder), and the experience bridges the gap between separate apps (Notion, ChatGPT, flashcards, planning) into one coherent workspace. The AI should be able to recall memory, save insights, spawn threads, switch modes, and manage context — all as explicit, visible actions. The response doesn't need to happen in one pass; it can pause, delegate, and resume.

**What prompted v3**: Multiple UX and logic issues discovered during v2 execution, plus a fundamental rethinking of how the AI should operate (tool-based agency rather than pipeline side-effects). The workspace needs to feel like a true home, not an experiment.

**Relationship to earlier plans**: The previous, v2 plan (PREV.md) provided useful foundations — particularly the infrastructure, chat pipeline, routing engine, and agent system. However, PREV.md is now stale in product philosophy. Its artifact-centric worldview, its pricing/deployment assumptions, and its frontend architecture no longer match where Spectra is going. v2 was closer but still thought in terms of overlays, card dashboards, and pipeline-only AI. **This v3 plan is the sole source of truth.** Any inherited concepts (ManageBac, testing strategy, search completion) have been reframed to fit the v3 worldview rather than kept as legacy appendices.

---

## What Changed: v2 to v3

| Area | v2 Approach | v3 Approach | Why |
|------|------------|------------|-----|
| Memory access | Pipeline side-effect (post-process extraction) | Explicit AI tools + pipeline extraction | AI should decide when to read/write memory, not just the pipeline |
| Response flow | Single-pass streaming | Multi-pass: pause, tool-call, delegate, resume | Complex requests need context switches, thread forks, model changes |
| Quick chat | Bottom-right corner, 220px bar | Center-screen command bar (Spotlight-style) | Must feel important — it's the primary entry point for conversations |
| Entering a workstream | Card-morph spring animation into overlay panel | Semantic zoom — node dissolves, internal layout emerges on canvas | The canvas IS the world; you never leave it. Overlays/panels break the spatial metaphor |
| Editor modes | Simple / Notion / Agentic (3 separate modes) | Standard / AI-Enhanced (2 clear modes) | Three modes confuse users; toolbar should always be available |
| Model selection | Freshness as soft score (0.33 for >1yr) | Hard cutoff: >90 days penalized 0.15x, >180 days blocked | Old models are unacceptable for a school product |
| Memory scope | No filtering — workstream memory leaks globally | Scoped retrieval + cross-workstream via explicit tool only | Prevents context contamination while keeping memory accessible |
| Thread opening | Threads open in full chat view | Threads open in right push-panel; expand icon for full view | Push-panel keeps user on the canvas |
| Workspace default | Smart routing (workspace if workstreams exist) | Workspace always, with prominent center chat bar | Commit to the workspace-first vision |
| Internal views | Dashboard-style panels/overlays | Canvas-native zone blocks, columns, and mind-map nodes | Everything lives on the canvas — no separate UI layers |
| Position persistence | Immediate Convex writes | Local-first (localStorage) + batched Convex sync | Avoids bandwidth issues; saves on close |

---

## Architecture Principles

1. **The canvas is the world** — The user is always on the canvas. Zooming in transforms the representation (semantic zoom), it doesn't open a separate layer. Workstreams are spaces you enter, not panels you open.
2. **AI as agent, not just responder** — The AI has tools: memory recall/write, thread management, note creation, planner updates. It decides when to use them.
3. **Token efficiency** — Never bulk-inject everything. Memory, context, and skills are loaded on demand via tools. System prompts stay lean per assignment level.
4. **Push-panel for detail** — Individual items (threads, notes, artifacts) open in a right push-panel that resizes the canvas. Full-page views are one click away but never the default from workspace.
5. **Visible intelligence** — When the AI makes decisions (routing, memory, thread forking), the user can see why via collapsible inline blocks. Route trace shows score breakdowns.
6. **Model freshness** — No model older than 90 days gets normal weighting. Education demands current capabilities.
7. **Two-mode editor** — Standard (rich formatting) and AI-Enhanced (formatting + AI bar). No confusing third mode.
8. **Settle-then-react layout** — Auto-layout positions items intelligently. Items settle and stay still. When something changes, they animate to new positions (~400ms). No ambient motion.

---

## AI Object Lifecycle & Reversibility

The AI (via tools from Phase 1C) can create workstreams, notes, planner items, threads, and memory entries. These actions must be visible, reversible where possible, and safe when reversal is not straightforward.

### Creation Visibility

When the AI creates an object, it surfaces as a **collapsible action block** in the response (same as memory tool calls):

```
┌─ Assistant ──────────────────────────────────┐
│ ▸ Created note: "Chapter 5 Summary"          │
│   in Biology HL · [Open] [Undo]              │
│                                              │
│ I've started a summary of the key concepts   │
│ from Chapter 5. You can find it in your...   │
└──────────────────────────────────────────────┘
```

Each creation block shows: what was created, where it lives, and an **[Undo]** action (available for ~60 seconds after creation).

### Reversibility Rules

Not all reversals are equal. The plan distinguishes three categories:

**Simple reversal** (safe, always available within 60s):
- Note created → delete (no dependents yet)
- Planner item created → delete
- Memory entry saved → dismiss
- Thread created with 0 messages → delete

**Conditional reversal** (safe only if no dependents):
- Thread with messages → cannot simply delete. Offer "Archive" instead (hides from view but preserves data)
- Note with AI-generated versions → reverting to before creation means discarding those versions. Show confirmation: "This note has 3 AI edits. Undo will discard all of them."
- Workstream with content → cannot undo creation. Offer "Archive" which fades it from the canvas.

**No reversal** (destructive — require explicit confirmation):
- Deleting a workstream that contains threads, notes, artifacts, and memory → cascading delete. Show: "This workstream contains 5 threads, 3 notes, and 12 memory entries. All will be archived. [Confirm archive] [Cancel]"
- Merging two workstreams → non-reversible. Requires explicit confirmation.

### Cascade Safety

```
Workstream deletion cascade:
  workstream → archive (not hard-delete)
    ├── threads: keep in database, remove workstreamId (become one-off chats)
    ├── notes: keep, remove workstreamId (become standalone)
    ├── artifacts: keep, remove workstreamId
    ├── planner items: archive (status → "cancelled")
    ├── workstream memory: archive (status → "dismissed")
    └── layout state: delete (ephemeral, not needed)
```

No hard deletes for user-facing content. Archived items can be recovered from an admin/settings view. Workstream archival is the standard "delete" action — actual deletion happens only after 90 days of being archived (or never, within Convex storage limits).

### ID Validity

All references between objects use Convex document IDs. When an object is archived:
- Its ID remains valid in the database
- Queries that reference it return the archived object with a status flag
- UI components that receive an archived reference show a "[archived]" indicator instead of breaking
- No dangling references — the ID always resolves, just with a different status

### AI-Created Object Placement

When the AI creates objects (notes, planner items), they need to appear on the canvas:
- **Inside committed workstream**: New item appears in the appropriate group/zone with a brief highlight animation ("pulse-once" glow, 600ms)
- **From outer workspace**: If AI creates a workstream, it appears near the hub with the same settle animation as auto-layout
- Items created by AI are marked with a subtle AI indicator (small ✦ icon) that fades after 24 hours

---

## Synchronization & State Consistency

All surfaces (canvas, sidebar, push-panel, full chat page) must stay in sync. This is non-negotiable for a product that aspires to feel like one coherent system.

### Convex Real-Time Subscriptions

Convex queries are reactive by default. The key surfaces that must use real-time subscriptions (not REST polling):

| Surface | Query | Updates when... |
|---------|-------|-----------------|
| Sidebar chat list | `chats.list` | New chat created from workspace, quick chat, or full chat |
| Workstream node metrics | `workstreams.get` + live counts | New thread/note/artifact added to workstream |
| Planner items | `plannerItems.byWorkstream` | AI or user creates/completes a task |
| Notes list (in structured view) | `notes.list` | AI creates a note, user edits |
| Thread messages (in push-panel) | `messages.list` | Streaming response adds messages |

### Cross-Surface Consistency Guarantees

1. **Chat created in workspace** → appears in sidebar within 1 render cycle (Convex reactive)
2. **Thread forked by AI** (via `fork_thread` tool) → new thread appears in the workstream's thread list + sidebar simultaneously
3. **Note created by AI** → appears in workstream's note group + notes list
4. **Workstream archived** → fades on canvas + removed from sidebar workstream list + quick chat dropdown
5. **Memory saved** → available for next `recall_memory` tool call immediately (Convex mutation → query reactivity)

### Preventing Stale State

- **No cached REST calls** for data that must be live. All mutable data uses Convex `useQuery` hooks.
- **Optimistic updates** for user actions (drag, create, delete) — UI reflects change immediately, Convex confirms asynchronously
- **Conflict resolution**: Last-write-wins for layout state. For content (notes, memory), Convex's transactional mutations prevent conflicts.

---

## Phase 1: Logic & Backend

*Everything in this phase is about making the system correct, efficient, and architecturally sound. No visual changes — pure logic, data, and pipeline work.*

### 1A: Build Stability & Critical Fixes

**Goal**: Get the project building cleanly before any new work.

**Tasks:**

1. **Fix `convex/workstreamMemory.ts:314` build error** — The `existingRows.push()` constructs a manual object missing `_creationTime` (Convex system field). Fix by typing `existingRows` as a partial/projected type that excludes system fields, or by re-querying the inserted document.

2. **Fix variable TDZ in `workstream-focus-panel.tsx:268`** — `handleCloseWithAnimation` is referenced before its declaration. Move the declaration above the first reference or restructure with `useCallback`.

3. **Fix React ref access during render** — `artifact-card.tsx:200` and `chat-composer.tsx` access refs during render. Move to effect or event handler.

4. **Audit all TypeScript errors** — Run `npx tsc --noEmit` and fix all type errors. Run `next build` and ensure clean output.

5. **Fix 57 lint warnings** — Address `any` types, unused variables, and hook rule violations identified in the codebase.

**Files:**
- `convex/workstreamMemory.ts`
- `src/components/workspace/workstream-focus-panel.tsx`
- `src/components/artifacts/artifact-card.tsx`
- `src/components/chat/chat-composer.tsx`

---

### 1B: Memory Architecture Overhaul

**Goal**: Fix the three critical memory bugs and establish clean scoping.

**Bug 1: Cross-workstream memory leakage**

*Problem*: `userMemoryEntries` vector search (in `convex/memory.ts:977-990`) filters by `[userId, orgId]` only. Entries written with `scope: "workstream"` and `sourceWorkstreamId` bleed into global retrieval for unrelated workstreams.

*Fix*:
- Add a new vector index `by_embedding_global` on `userMemoryEntries` that filters `scope = "global"` (or scope is undefined/null for legacy entries)
- In `planMemoryRead()` (`post-process.ts`), use the scoped index for global retrieval
- For workstream-specific memory, only query `workstreamMemory` table (already properly scoped)
- Cross-workstream memory remains accessible but ONLY via explicit AI tool call (see 1C), never auto-injected

*Design principle*: Memory from workstream A should never silently appear in workstream B. But the AI can explicitly recall it when relevant.

**Bug 2: Freshness decay overwrites `updatedAt`**

*Problem*: `runDailyMaintenance()` in `convex/memory.ts` patches `updatedAt` during freshness decay. Expiration checks use `updatedAt` for retention windows, so decayed entries appear fresh forever.

*Fix*:
- Add `lastDecayedAt` field to both `userMemoryEntries` and `workstreamMemory` schemas
- Decay cron updates `freshness` and `lastDecayedAt` but NOT `updatedAt`
- `updatedAt` only changes on genuine content updates (upsert, user edit, extraction)
- Expiration logic uses `updatedAt` (content freshness), decay logic uses `lastDecayedAt` (scheduling)

**Bug 3: Non-embedding dedupe path for workstream memory**

*Problem*: `upsertEntries()` in `convex/workstreamMemory.ts` relies on cosine similarity for deduplication. Callers without embeddings produce zero-filled vectors → similarity stays near zero → duplicates proliferate.

*Fix*:
- Before embedding-based dedup, run a **key + category exact match** check
- If same `key` + `category` exists in the workstream, compare `text` via normalized string similarity (Levenshtein ratio > 0.85 = same entry → update)
- Only fall through to embedding-based dedup when key match fails
- Add a `textHash` field (first 8 chars of SHA-256 of normalized text) for fast exact-text dedup

**Schema changes:**
```
userMemoryEntries: + lastDecayedAt (optional number)
workstreamMemory: + lastDecayedAt (optional number), + textHash (optional string)
```

**Files:**
- `convex/schema.ts` — Add new fields
- `convex/memory.ts` — Fix vector index filter, fix decay to not touch `updatedAt`
- `convex/workstreamMemory.ts` — Add key-based dedup path, fix decay
- `src/lib/orchestrator/post-process.ts` — Use scoped retrieval

---

### 1C: AI Tool System

**Goal**: Give the AI explicit tools for memory, context, and workflow management. Currently the AI is a pure responder — the pipeline does everything around it. In v3, the AI becomes an active agent.

**New tool definitions** (added to the system prompt and handled by the pipeline's tool-call loop):

| Tool | Purpose | When AI should use it |
|------|---------|----------------------|
| `recall_memory` | Search memory by query, with optional scope (global / workstream / cross-workstream) | When the user references past work, preferences, or context not in the current thread |
| `save_memory` | Save a durable fact (key, text, category, confidence) | When the user shares preferences, identity info, corrections, or important decisions |
| `update_memory` | Update existing memory entry by ID | When previous memory is outdated or needs refinement |
| `dismiss_memory` | Mark a memory entry as no longer relevant | When the user corrects or contradicts a memory |
| `get_workstream_context` | Fetch workstream summary: recent threads, notes titles, planner items, linked agents | When the AI needs broader context about the current workstream |
| `create_note` | Create a new note in a workstream | When the conversation produces something worth persisting as a document |
| `update_planner` | Create or update a planner item (deadline, task, milestone) | When deadlines, tasks, or goals are discussed |
| `fork_thread` | Start a new thread with a reason, optionally in a different workstream | When the topic drifts significantly, context window is filling, or a sub-task needs isolation |
| `search_web` | Web search via Tavily (already exists, just exposed as tool) | When current information is needed |

**Implementation approach:**

The pipeline currently uses OpenRouter's chat completion API directly. To add tool calling:

1. **Define tools as OpenRouter function schemas** in a new file `src/lib/orchestrator/tool-definitions.ts`
2. **Extend `runAssistantStreaming()`** to handle `tool_calls` in the response:
   - When the model emits a tool call, pause streaming
   - Execute the tool server-side (Convex queries/mutations)
   - Send the tool result back as a follow-up message
   - Resume streaming with the tool result in context
3. **Tool availability by assignment level:**
   - L0 (quick_reply): No tools
   - L1 (standard): `recall_memory` only
   - L2 (enhanced): `recall_memory`, `save_memory`, `search_web`
   - L3 (orchestrated): All tools
   - L4 (workstream_deep): All tools + `get_workstream_context`, `fork_thread`
4. **Visibility** (Confirmed: collapsible inline blocks): Send SSE events for tool calls. The UI renders them as **collapsible blocks** inline in the assistant's response (same pattern as thinking blocks). Collapsed by default showing "Recalled memory (2 entries)" or "Saved to memory". Expandable to show full details. This builds trust without adding noise.
5. **Token budget**: Tool calls consume tokens from the assignment level budget. The AI must be efficient.

**Key design decisions:**
- Tools COMPLEMENT pipeline-level memory (not replace). The pipeline still injects identity/preferences at L1+. But topic memory, workstream memory, and cross-workstream recall are now tool-driven.
- The AI's tool calls are shown to the user (collapsible, like thinking blocks). This builds trust.
- Memory tools use the same underlying Convex mutations, just exposed as AI-callable functions.

**Files:**
- NEW: `src/lib/orchestrator/tool-definitions.ts`
- MODIFY: `src/lib/orchestrator/streaming.ts` — Add tool-call handling loop
- MODIFY: `src/lib/orchestrator/pipeline.ts` — Pass tools to streaming based on assignment level
- MODIFY: `src/lib/orchestrator/route-plan.ts` — Include tool availability in plan
- NEW: `src/lib/orchestrator/tool-executor.ts` — Server-side tool execution logic

---

### 1D: Multi-Pass Orchestration

**Goal**: Enable the AI to produce responses across multiple passes — pausing, delegating, and resuming with potentially different models or modes.

**Current state**: Single-pass streaming with up to 4 continuations (when response is truncated by length). No ability to switch models mid-response or fork threads.

**v3 architecture:**

The tool-call loop from 1C naturally enables multi-pass:

1. **Model switching via `fork_thread`**: When the AI calls `fork_thread`, the pipeline:
   - Creates a new chat in Convex with the specified workstream
   - Sends a setup message to the new thread with context from the current thread
   - Optionally selects a different model suited to the sub-task (e.g., a research model for deep research)
   - Returns a reference link to the user: "I've started a deeper analysis in a new thread → [Thread link]"
   - The current response continues with the fork result summarized

2. **Mode switching**: The AI can signal a mode change via a tool call:
   - `switch_mode(mode: "research" | "tutor" | "quiz" | ...)`
   - The pipeline adjusts the system prompt and constraints for subsequent content
   - Visual indicator in the response: "Switching to research mode..."

3. **Context window management**: When the AI detects context is filling up:
   - It can call `fork_thread` with reason: "context_window_full"
   - The pipeline compacts the current thread and starts fresh
   - The user sees: "Continuing in a new thread to keep things fast → [link]"

4. **Specialist delegation**: For L3/L4, when `shouldUseMultiAgent` is true:
   - The existing task-graph system handles multi-specialist orchestration
   - New: specialists can now also use tools (memory, search)
   - The synthesizer model produces the final unified response

**Streaming protocol extension:**

Add new SSE event types:
```
event: tool_call    — AI is calling a tool (show indicator)
event: tool_result  — Tool returned (show result)
event: thread_fork  — New thread created (show link)
event: mode_switch  — Mode changed mid-response (show indicator)
event: model_switch — Different model continuing (show in trace)
```

**Files:**
- MODIFY: `src/lib/orchestrator/streaming.ts` — Tool-call loop, new SSE events
- MODIFY: `src/lib/orchestrator/pipeline.ts` — Multi-pass coordination
- NEW: `src/lib/orchestrator/tool-executor.ts` — Handles tool execution including fork_thread
- MODIFY: `src/hooks/use-compact-chat.ts` — Parse new SSE event types
- MODIFY: `src/hooks/use-chat-state.ts` — Handle thread fork events

---

### 1E: Routing Intelligence, Budget Economy & Token Governance

**Goal**: Build a routing and budget system that makes Spectra feel impressive within real school budgets. The system must be smart about model selection, strict about cost, and transparent about what it spends.

#### Budget Architecture

```
Super Admin sets:
  per-school monthly budget (e.g., €10/student)
         │
         ▼
  ┌──────────────────────────────┐
  │     90% for AI + Search      │──→ Model costs + Tavily costs
  │  (tracked, enforced, capped) │    All tracked in usageEvents
  └──────────────────────────────┘
  ┌──────────────────────────────┐
  │     10% buffer for infra     │──→ Convex, Clerk, hosting
  │  (not tracked per-request)   │    Covered by platform margin
  └──────────────────────────────┘

  Degradation curve (percentage of AI+Search budget):
  ┌─────────────────────────────────────────────────┐
  │  0-80%:  Normal routing (all eligible models)   │
  │  80-90%: Expensive models blocked (>€5/M)       │
  │  90-95%: Cheap models only (≤€3/M)              │
  │  95-100%: Free models only                      │
  │  100%+:  Free models only (no hard block,       │
  │          product always responds)               │
  └─────────────────────────────────────────────────┘
```

- Budget is set by super admin per school (org), not per user. Default: €10/student/month.
- The existing `checkUserBudget` system in `convex/usage.ts` already implements the tier degradation curve. Strengthen it with:
  - **Tavily cost inclusion**: Every Tavily search/extract/crawl/research call has a known credit cost. Track these as `usageEvents` alongside model costs.
  - **Never use `:online` model variants** — Spectra has Tavily for search. `:online` variants cost more and duplicate search capability.
  - **No hard block at 100%** — switch to free models. The product must always respond.

#### Model Selection Philosophy

**Favor cheap, high-quality models from competitive providers:**

The best value for school budgets comes from Chinese open-source labs (MiniMax, Kimi/Moonshot, GLM/Zhipu, Qwen, StepFun) and cheap variants from larger providers (GPT Nano, Gemini Flash). These often outperform expensive legacy models while costing a fraction.

**Hard rules:**
- **Cost ceiling**: Default max €5/M input, €5/M output for automated routing. Models above this are only selected when user manually chooses them or when L3/L4 assignment truly requires it.
- **Freshness cutoff**: Models >90 days old: `freshness_multiplier = 0.15`. Models >180 days old: hard blocked (`freshness_multiplier = 0`).
- **No `:online` variants**: Filter from candidates entirely (redundant with Tavily).

**Benchmark integration**: Research whether public APIs exist for model benchmark rankings (e.g., LMSYS Chatbot Arena, OpenRouter model rankings). If available, integrate as a signal:
- Fetch periodically (weekly, via cron)
- Use as a soft scoring factor (not hard requirement): models ranked in top 30 get a quality bonus
- This is advisory, not essential — routing already has capability scoring. Benchmarks add an external quality signal.
- If no reliable API exists, use the existing capability/reliability scoring.

#### Task Decomposition for Cost

Different tasks need different model classes. The plan distinguishes:

```
User-facing quality-critical (use best available within budget):
  ├── Main conversation responses
  ├── Complex reasoning (L2/L3/L4)
  ├── Research synthesis
  └── Document generation (AI-Enhanced editor)

Background / structural intelligence (use cheapest functional):
  ├── Chat title generation        → free/nano model
  ├── Memory extraction            → cheapest capable model
  ├── Topic classification         → free/nano model
  ├── Embedding generation         → cheapest embedding model
  ├── ManageBac data classification → free/nano model
  ├── Workstream routing inference  → cheapest capable model
  └── Compaction summaries         → cheap model

Search (Tavily, tracked separately but within same budget):
  ├── Basic search                 → Tavily search (1 credit)
  ├── Extract                      → Tavily extract (1 credit)
  ├── Deep research                → Tavily research (5 credits)
  └── Crawl                        → Tavily crawl (2 credits)
```

The existing `pickModelAndFallbacks()` function in `post-process.ts` already selects cheap models for background tasks. Strengthen by:
- Explicitly tagging each pipeline step as `quality_critical` or `background`
- Background tasks always use the cheapest model that meets minimum capability requirements
- Never route a background task to a model costing >€1/M

#### Selective Context Assembly

**Core principle**: Never bulk-inject everything. Assemble context in stages, cheaply first:

```
User sends message
  │
  ▼
Step 1: CLASSIFY (free/nano model, ~50 tokens)
  │  → Determine: assignment level, topic, workstream relevance,
  │    whether school data is needed, whether memory is needed
  │
  ▼
Step 2: SELECTIVE FETCH (zero model cost, just queries)
  │  → Only fetch what Step 1 said is needed:
  │    • Memory? → query relevant entries (max 5, by cosine)
  │    • School context? → load cached ManageBac summary
  │    • Workstream context? → load titles + recent activity
  │    • Search? → only if explicitly needed
  │  → Skip everything that isn't relevant
  │
  ▼
Step 3: ASSEMBLE SYSTEM PROMPT (no model cost)
  │  → Build from: base prompt + mode contract + fetched context
  │  → Stay within token budget for assignment level
  │  → Order by relevance (most relevant context first)
  │
  ▼
Step 4: GENERATE (quality model, budget-aware)
  │  → Use the best model the budget tier allows
  │  → Stream response with tool calls
  │
  ▼
Step 5: POST-PROCESS (cheap model, background)
     → Memory extraction, title generation, etc.
     → Cheapest capable model
```

#### Scoring Changes

- Increase `diversity` weight: 7-10% → 12-15% across tiers
- **Score spread**: If top 3 candidates are within 0.05, add random noise (±0.03)
- **Weighted random**: Among candidates within 15% of top score, probability proportional to score
- Show scoring component breakdown in route trace
- **Challenger exploration**: Models with <5 runs get `0.5x` multiplier (up from `0.3x`) in low-stakes

#### Search Cost Accounting

Tavily costs tracked as `usageEvents` with `type: "search"`:
- Each search action shows in the response as a collapsible tool-call block (same as memory)
- Route trace shows search cost alongside model cost
- Budget dashboard shows model costs and search costs separately
- Search disabled at `free_only` tier (existing behavior, keep)

**Files:**
- `src/lib/routing/phase-router.ts` — Freshness cutoff, cost ceiling, score spread, weighted random, benchmark signal
- `src/lib/orchestrator/pipeline.ts` — Task tagging (quality_critical vs background), selective context assembly
- `src/lib/orchestrator/post-process.ts` — Ensure background tasks use cheapest models
- `convex/usage.ts` — Include Tavily costs in budget tracking
- `src/app/api/editor/ai-edit/route.ts` — Verify model is current, use router not hardcoded model
- `src/lib/orchestrator/route-plan.ts` — Cost ceiling enforcement, exploration flag
- NEW (optional): `src/lib/benchmark-sync.ts` — Periodic benchmark data fetch if API exists

---

### 1F: Document Import Pipeline

**Goal**: Let users import notes from Notion, Word, and Apple Notes so they can consolidate everything in Spectra.

**Notion import:**
- Notion exports as Markdown or HTML (via "Export" > "Markdown & CSV" or "HTML")
- Parse Markdown into Tiptap JSON using a markdown-to-prosemirror converter
- Preserve: headings, bold, italic, code blocks, lists, blockquotes, tables, images (as URLs), dividers
- Library: `prosemirror-markdown` (already part of Tiptap ecosystem) or custom marked → Tiptap JSON converter

**Word document import:**
- Use `mammoth` npm package to convert `.docx` → HTML
- Then HTML → Tiptap JSON using `@tiptap/html` utility
- Preserve: headings, formatting, lists, tables, images (embedded as base64 or uploaded)
- Formatting fidelity: good for standard documents, lossy for complex layouts

**Apple Notes import** (Confirmed: all four import sources included):
- Apple Notes has no export API or standard format
- Users can: (a) copy-paste from Apple Notes (preserve formatting via clipboard HTML), (b) share as PDF and use text extraction
- Implement clipboard paste handler that reads HTML from clipboard and converts to Tiptap JSON
- Also support PDF text extraction (via `pdf-parse` or similar) for Apple Notes shared as PDF
- Equal priority with other sources — all four matter for school adoption

**Import UI:**
- Import button in notes toolbar: "Import" dropdown → "From Notion (.md/.html)", "From Word (.docx)", "From Apple Notes (paste/PDF)", "Paste from clipboard"
- Drag-and-drop zone accepts .md, .html, .docx, .pdf files
- Preview step: show imported content before confirming
- Auto-detect format from file extension
- Clipboard paste: enhanced paste handler intercepts Ctrl+V, reads HTML from clipboard, converts to Tiptap JSON preserving formatting from ANY source (Google Docs, Notion web, Word online, Apple Notes)

**Files:**
- NEW: `src/lib/editor/import-notion.ts` — Markdown/HTML → Tiptap JSON
- NEW: `src/lib/editor/import-docx.ts` — Word → HTML → Tiptap JSON (uses mammoth)
- NEW: `src/lib/editor/import-pdf.ts` — PDF text extraction → Tiptap JSON (for Apple Notes PDFs)
- NEW: `src/lib/editor/clipboard-paste.ts` — Enhanced clipboard HTML → Tiptap JSON (handles all sources)
- NEW: `src/components/editor/import-dialog.tsx` — Import UI with drag-drop
- MODIFY: `src/components/editor/tiptap-editor.tsx` — Clipboard paste handler for HTML
- NEW: `package.json` — Add `mammoth`, `pdf-parse` dependencies

---

### 1G: ManageBac Integration Architecture

**Goal**: Redesign ManageBac integration from scratch as a first-class architectural layer. The existing code (`src/lib/managebac.ts`, `src/app/managebac/page.tsx`) is useful for token testing but is not the finished architecture. The new integration must handle: endpoint discovery, privacy-safe field filtering, entity-to-Spectra mapping, sync strategy, conflict resolution, and AI-accessible context — all designed for variability between schools.

#### Privacy-First Ingestion Layer

ManageBac exposes sensitive student data (address, phone, birthday, medical info, parent contacts). **None of this should reach the AI or be stored in Spectra beyond what's needed.**

```
ManageBac API Response (raw)
  │
  ▼
┌─────────────────────────────────────────────────┐
│ PRIVACY FILTER (src/lib/managebac/normalizer.ts)│
│                                                 │
│ ALLOW (stored in Spectra):                      │
│  • Student name, grade level                    │
│  • Subject/class names, codes, levels (HL/SL)   │
│  • Teacher names (for context only)             │
│  • Assignment titles, due dates, descriptions   │
│  • CAS activity titles, strands, hours, status  │
│  • Timetable: day, time, room, subject          │
│  • Announcements: title, summary, date          │
│  • Profile photo URL (for avatar sync)          │
│                                                 │
│ BLOCK (never stored, never sent to AI):         │
│  • Home address, phone number, email (personal) │
│  • Birthday, age, student ID numbers            │
│  • Medical/dietary information                  │
│  • Parent/guardian contact details              │
│  • Behavioral/disciplinary records              │
│  • Internal admin metadata, system IDs          │
│  • Any field not in the explicit ALLOW list      │
│                                                 │
│ → Default: BLOCK. Only ALLOW-listed fields pass.│
└─────────────────────────────────────────────────┘
  │
  ▼
Normalized Spectra Schema (safe for AI, storage, UI)
```

The filter is a **whitelist, not a blacklist**. Unknown fields are dropped by default. This is essential for a school product.

#### Endpoint Discovery & Variability

Schools have different ManageBac configurations. Some may not have CAS enabled, others may not expose certain endpoints. The integration must handle this gracefully.

**Discovery flow on first configuration:**
1. Admin enters ManageBac token in Spectra Admin
2. System probes a priority-ordered list of endpoints:
   - `/api/v2/school` (basic connectivity test)
   - `/api/v2/students` (student listing)
   - `/api/v2/classes` (class listing → subjects)
   - `/api/v2/students/{id}/timetable` (schedule)
   - `/api/v2/students/{id}/cas` (CAS activities, IB-specific)
   - `/api/v2/announcements` (school announcements)
   - `/api/v2/students/{id}/assignments` (if available)
3. Record which endpoints are available + response shapes
4. Store capabilities in `orgs.managebacConfig.availableEndpoints`
5. Graceful fallback: if an endpoint isn't available, skip it. Never crash.

**Base URL variability**: ManageBac has regional instances (.com, .eu, .us, .cn). The existing diagnostic page already probes these. Store the working base URL in config.

#### Entity Mapping: ManageBac → Spectra

```
ManageBac Entity          → Spectra Entity           When
──────────────────────────────────────────────────────────────
Class/Subject              → Workstream (type: subject) Auto-create on first sync
  └─ name, level, code     └─ title, subjectCode,      User can archive unwanted
                              managebacClassId

Assignment                 → Planner item               Auto-create, linked
  └─ title, due date,       └─ type: deadline,           to workstream by class
     description              sourceType: managebac_sync,
                              managebacItemId

CAS Activity               → Planner item (milestone)   Auto-create in CAS workstream
  └─ title, strand,          + Note (if has portfolio     Note only for substantial
     hours, status             content/reflection)         content (not just metadata)

Timetable                  → Enrichment context          Not stored as objects —
  └─ day, time, room,        injected into workstream      cached JSON on workstream
     teacher                  context for AI

Announcements              → Global context              Not stored as objects —
  └─ title, summary,         available to AI via tool       cached, time-limited
     date, url

Profile Photo              → User avatar                 Synced to Clerk metadata
  └─ photo URL               (if Clerk email matches       or stored separately
                              ManageBac student)
```

#### Profile Photo Sync

ManageBac profile photo URLs may be authenticated (require token) or time-limited. Strategy:
1. On sync: download the photo if URL is accessible
2. Store as a Convex file (not just the URL — URLs may expire)
3. Set as user's avatar in Spectra (fallback: Clerk avatar, then initials)
4. Re-sync photo on daily sync cron (detect changes)
5. If photo download fails: keep existing avatar, log warning
6. Privacy: photo is stored per-user, not shared. No access to other students' photos.

#### Sync Strategy

**Daily cron** (existing pattern in `convex/crons.ts`):
1. For each org with ManageBac configured + sync enabled:
2. For each mapped student:
   - Fetch subjects/classes → create or update workstreams (new subjects auto-create, removed subjects don't auto-delete — flag as "no longer in ManageBac" after 30 days)
   - Fetch assignments → create or update planner items (match by `managebacItemId`)
   - Fetch CAS → create or update planner items + notes if applicable
   - Fetch timetable → cache as enrichment context on workstream
   - Fetch profile photo → sync if changed
3. Record sync status + timestamp in `managebacConfig`

**Manual refresh**: Button in workspace toolbar or admin panel triggers immediate sync for current user.

**Conflict resolution — when ManageBac data changes:**

| Scenario | Resolution |
|----------|-----------|
| Assignment due date changed in MB | Update planner item `dueAt`. Show "Updated from ManageBac" indicator. |
| Assignment title changed in MB | Update planner item title. Keep user's local notes unchanged. |
| Assignment deleted in MB | Mark planner item as `sourceDeleted: true`. Show "[Removed from ManageBac]" label. Don't auto-delete — user may have added their own content. |
| CAS activity updated in MB | Update planner item metadata. If linked note exists, don't overwrite local edits — show "Source updated" indicator. |
| Local note edited + MB source changes | **Never overwrite local edits.** Flag conflict: "ManageBac source was updated. [View changes] [Dismiss]" |
| New class added in MB | Auto-create workstream (subject type). |
| Class removed in MB | Flag workstream: "No longer active in ManageBac." Don't auto-archive — student may still need it. |

**Provenance tracking**: Every ManageBac-derived object stores `sourceType: "managebac_sync"` and `managebacItemId`. This enables:
- Re-sync matching (find local object for MB entity)
- Conflict detection (compare local vs. MB state)
- Cascade rules (what happens when MB entity is deleted)
- UI indicators ("from ManageBac" badge)

#### AI Access to School Context

The AI accesses ManageBac-derived data through the same tool system (1C):

- `get_workstream_context` returns enrichment data including timetable, teacher, current unit (if available)
- `recall_memory` can surface school-related memory entries (e.g., "Biology HL is on Mon/Wed/Fri at 9am with Mr. Smith")
- ManageBac announcements available via a dedicated tool or as part of hub context
- **Never bulk-inject all ManageBac data into prompts.** Only load what the classification step (1E) determines is relevant.
- ManageBac data costs zero tokens to fetch (Convex queries) but does consume prompt tokens when included. The selective context assembly from 1E ensures minimal token usage.

#### What Belongs Where

```
GLOBAL (hub-level, all-workstream):
  • Announcements
  • Cross-workstream timetable overview
  • Profile photo sync status

WORKSTREAM-SPECIFIC:
  • Subject schedule (timetable for that subject)
  • Assignments → planner items
  • Teacher name → context for AI
  • Subject code → workstream metadata

CAS WORKSTREAM:
  • All CAS activities → planner milestones
  • CAS reflections → notes (when substantial content exists)
  • CAS hours tracking → planner metadata

NOT IN SPECTRA:
  • Everything in the BLOCK list
  • Internal ManageBac admin data
  • Other students' data
```

#### Admin UI

Redesign the ManageBac admin page (currently a diagnostic test page) into a proper configuration experience:
- Token entry + test connection
- Show discovered endpoints and capabilities
- Student mapping (auto-match by email, manual override)
- Sync toggle + frequency setting
- Last sync status + error display
- Manual sync trigger

This lives in Admin > Integrations, not as a separate route.

**Files:**
- REWRITE: `src/lib/managebac.ts` → `src/lib/managebac/client.ts` (API client)
- NEW: `src/lib/managebac/normalizer.ts` — Privacy filter + entity normalization
- NEW: `src/lib/managebac/sync.ts` — Sync orchestration, conflict resolution
- NEW: `src/lib/managebac/mapper.ts` — MB entity → Spectra entity mapping
- NEW: `convex/managebacSync.ts` — Sync mutations and cron logic
- MODIFY: `convex/crons.ts` — Add ManageBac daily sync cron
- MODIFY: `convex/schema.ts` — Enrich `managebacConfig` with `availableEndpoints`, `lastSyncDetails`
- MODIFY: `src/app/admin/page.tsx` — Add Integrations section
- REMOVE: `src/app/managebac/page.tsx` — Replace with proper admin UI

---

### 1H: Testing & Build Verification

*Folded from former Wave 9. Testing is a Phase 1 concern — the backend must be verified before the UI pass.*

- [ ] `next build` succeeds with zero errors after all Phase 1 changes
- [ ] Memory isolation: Workstream A memory never auto-injected in Workstream B
- [ ] Memory tools: AI can recall, save, update, dismiss via tool calls
- [ ] Thread fork: AI creates new thread, reference visible, original continues
- [ ] Routing: No model >90 days selected. Budget tiers respected.
- [ ] ManageBac: Token test → endpoint discovery → entity sync → planner items created
- [ ] ManageBac: Privacy filter blocks all non-allowlisted fields
- [ ] ManageBac: Conflict resolution — MB assignment update doesn't overwrite local notes
- [ ] Budget: At 95% usage, only cheap models selected. At 100%, free only.
- [ ] Search: Tavily costs tracked in budget alongside model costs
- [ ] Import: .md, .html, .docx, .pdf all produce Tiptap JSON
- [ ] Build: `npx tsc --noEmit` passes. All 57+ lint warnings resolved.

---

## Phase 2: UI & Experience

*Everything in this phase is about making the product feel like a true home — polished, intuitive, and distinctive. Builds on the logic from Phase 1. The defining principle: the canvas IS the world. You never leave it. Zooming into a workstream transforms the representation — you enter it spatially, not via an overlay.*

### 2A: Workspace as Home — The Semantic Zoom Canvas

**Goal**: The workspace canvas is Spectra's home. The user is always on the canvas. Zooming in reveals progressive detail until you're inside a workstream. No overlays, no separate pages for workstream views. The canvas transforms.

#### Core Concept: Semantic Zoom

The workspace is a **bounded, adaptive canvas** — spacious but not infinite. It expands as workstreams are added and contracts as they're archived, with soft edges rather than hard boundaries. Think of it as a world that grows as needed, not an unstructured void. React Flow's `translateExtent` or equivalent constrains panning to a meaningful region around the content cluster, with padding that adapts to the number of active workstreams.

At different zoom levels, the same space reveals different representations:

```
Zoom 0.3-0.5:  OVERVIEW — Workstream nodes as compact badges
                (emoji, title, type color, activity pulse)

Zoom 0.5-0.7:  SUMMARY — Nodes expand, show description + metrics
                (thread count, note count, last activity, agent badge)

Zoom 0.7-0.9:  DETAIL — Node content becomes readable, internal items
                start appearing as previews within the node boundary
                (thread titles visible, note first-lines, planner items)
                → Other workstreams begin fading (50% → 20% opacity)

Zoom 0.9+:     INTERNAL — Soft commit. The workstream's node boundary
                dissolves. Internal content takes over the canvas.
                Other workstreams invisible. Full internal layout active.
                URL updates with ?ws={id} (no flickering — only updates
                once zoom crosses threshold stably)
```

**The dissolution transition**: At the detail→internal threshold, the workstream node's border doesn't just disappear — it dissolves. The border softens, blurs, and fades to transparent over ~400ms as the zoom crosses the threshold. Content that was constrained within the node boundary smoothly expands outward to fill the available canvas space. This is not a particle effect or WebGL trick — it's opacity + blur + scale transitions on the border elements, combined with layout expansion of the inner content. Clean, performant, but clearly animated and intentional.

**Workstream lifecycle and spatial priority:**

Workstreams have lifecycle states that affect their canvas presence:

```
┌─────────┐   no activity    ┌─────────┐   user marks     ┌───────────┐   user action   ┌──────────┐
│ ACTIVE  │ ──── 14+ days ──→│  QUIET  │ ──── done ──────→│ COMPLETED │ ──── archive ──→│ ARCHIVED │
│ opacity │   (auto-detect)  │ opacity │   (manual only)  │ opacity   │   (manual)      │ hidden   │
│   1.0   │                  │   0.7   │                  │   0.35    │                 │ by default│
│ full sz │                  │ 95% sz  │                  │   85% sz  │                 │ toggle   │
└─────────┘                  └─────────┘                  └───────────┘                 └──────────┘
         ↑                            ↑                            │
         └── new activity reactivates ┘                            │
                                                          dashed connections,
                                                          muted colors,
                                                          pushed to periphery
                                                          by auto-layout
```

- **Active**: Full size, full opacity, positioned near hub by auto-layout
- **Quiet**: Slightly faded, auto-detected when no new threads/notes/activity for 14+ days. Still fully functional. Visually recedes.
- **Completed**: User-triggered (manual). Significantly faded, smaller, dashed connections. Pushed toward periphery by auto-layout. Content still accessible.
- **Archived**: Hidden by default. Toggle in toolbar to show/hide. When shown, rendered at 20% opacity at canvas edges.
- **Reactivation**: Any new activity on a quiet workstream returns it to active. Completed workstreams can be reopened manually.

Auto-layout respects lifecycle: active workstreams cluster near the hub, quiet ones drift outward, completed ones are pushed to the periphery. This keeps the canvas calm and focused.

**Key constraints on effects**:
- No orbiting, floating, or continuous ambient motion
- Effects serve the transition — they guide the eye and communicate state change
- The workspace should feel alive in the sense that it responds and transforms, not that it's restless
- Effects must not cause visual fatigue — this is a daily working environment
- Performance: all transitions must maintain 60fps

#### Entry Methods

1. **Zoom (scroll/pinch)**: Natural, exploratory. Progressive detail appears continuously. At the soft-commit threshold, internal layout takes over.
2. **Single click**: Click a workstream node → animated zoom-to-fit that smoothly transitions through the bands and arrives at the committed internal view (~500ms). This is the fast/intentional entry method.

#### Exit Methods

1. **Zoom out**: Scroll/pinch to zoom out. Internal content contracts, node boundary re-forms, other workstreams fade back in. Reverse of the entry transition.
2. **Escape key**: Instant animated zoom-out to the last overview viewport position.
3. **Browser back button**: URL-backed state allows standard back navigation.
4. **Breadcrumb**: A subtle breadcrumb trail at the top of the canvas: `Workspace > Biology HL`. Clicking "Workspace" zooms back to overview. The breadcrumb only appears when inside a committed workstream.

#### Toolbar

- **Show user name**: `"{firstName}'s Workspace"` using Clerk's `useUser()` hook
- File: `src/components/workspace/workspace-toolbar.tsx`

#### Canvas Backgrounds

- **Fix dots mode**: Current implementation uses `BackgroundVariant.Dots` with gap 28, size 0.8. If React Flow's dots aren't rendering, implement custom dot pattern via CSS:
  ```css
  background-image: radial-gradient(circle, var(--text-tertiary) 0.8px, transparent 0.8px);
  background-size: 28px 28px;
  ```
- The background dots/grid persist through zoom levels and into the committed internal view — this is the visual continuity that makes it feel like the same space
- File: `src/components/workspace/workspace-canvas.tsx`

#### Quick Chat Bar — Center Stage

**On the outer workspace (overview/summary zoom):**
- **Position**: Fixed at `bottom-8 left-1/2 -translate-x-1/2`, z-30 — persistent, always visible
- **Width**: Resting 480px, expanded 560px
- **Behavior**:
  - Resting: Subtle, translucent bar with search icon and "Ask anything..." placeholder
  - Focused: Expands height, shows send button, workstream selector dropdown above
  - **Workstream dropdown**: Shows active workstreams. Auto-selects based on routing inference. User can override.
  - After sending (with workstream selected): Animated single-click entry into that workstream, then opens thread in right push-panel
  - After sending (no workstream): Navigates to `/chat`
- **Keyboard**: `Cmd/Ctrl+K` to focus

**Inside a committed workstream (internal zoom):**
- Bar stays visible, scoped to the current workstream (shows e.g. "→ Biology HL" badge)
- Sending a message creates/continues a thread in that workstream
- **Once sent**: Thread opens in the **right push-panel** as a compact but fully functional chat (all visualizations — code, flashcards, citations — just no nested right-panel buttons since this IS the right panel)
- **When right panel is open**: Quick chat bar hides (the panel's composer becomes the input)
- **When right panel closes**: Quick chat bar reappears

- File: `src/components/workspace/chat-side-panel.tsx` → rename to `workspace-command-bar.tsx`

#### Workstream Node Thread Count

- **Problem**: Nodes show "0 threads" even when threads exist
- **Fix**: Use a live Convex query that counts chats with matching `workstreamId` rather than a stored counter. This avoids stale data entirely. Same for `artifactCount` and `lastActivityAt`.
- File: `convex/workstreams.ts`, `src/hooks/use-workspace-data.ts`

#### Auto-Layout Algorithm

Workstream nodes on the outer canvas should be intelligently positioned, not randomly scattered:

**Outer workspace layout (workstream nodes):**

A **constrained force-directed layout** with strong spatial grammar — not purely algorithmic, not a rigid grid.

```
Layout grammar:

               [Quiet subject]
       [Active subject]   [Active subject]
  [Quiet proj]      [HUB]      [Active subject]
       [Active project]   [General]
               [Completed project]

   Inner ring: active workstreams (closer to hub)
   Middle ring: quiet workstreams (further)
   Outer ring: completed (faded, peripheral)

   Angular sectors: grouped by type (subjects cluster,
   projects cluster, general cluster). Sectors are not
   visually boxed — they're invisible spatial regions
   that influence positioning.
```

**Forces (d3-force or similar):**
- **Radial**: All workstreams attracted toward hub center, with distance proportional to lifecycle (active=near, quiet=mid, completed=far)
- **Angular clustering**: Workstreams of the same type repel differently from other types — subjects cluster into one angular sector, projects into another, general into another. Sectors are invisible but felt.
- **Repulsion**: Prevent overlap between all nodes (standard charge force)
- **Within-cluster ordering**: Active workstreams within a cluster are sorted by last activity (most recent = closest to hub)
- When a new workstream is created: simulation runs briefly (~400ms) to find the best position, others adjust smoothly
- User drags override: once a user manually positions a node, it's "pinned" and won't be moved by the algorithm
- Layout settles then stays still — no continuous motion

**Inner workstream layout (items within a committed workstream):**
- Depends on the active view (structured/columns/graph — see 2B)
- New items added by AI or user trigger a settle animation to find their position (~400ms)
- All positions are per-workstream and per-view, saved to persistence layer

**Files:**
- NEW: `src/lib/workspace/auto-layout.ts` — Force-directed layout engine
- MODIFY: `src/components/workspace/workspace-canvas.tsx` — Apply auto-layout on mount and changes

#### Position Persistence (Local-First)

**Two layers of layout state:**

1. **Canonical layout** (computed): The auto-layout algorithm produces a default arrangement based on workstream count, type, lifecycle state, and relationships. This is deterministic — given the same inputs, it produces the same layout. Stored nowhere; recomputed on load.
2. **User overrides** (persisted): When a user drags a node, that position is stored as an explicit override. Only overrides are persisted — not the full layout.

This means:
- A new device with no local state can recompute the canonical layout + apply stored overrides
- Adding a new workstream triggers re-layout for non-overridden nodes only
- Clearing overrides returns to the canonical layout

**Persistence flow:**
- **Immediate**: User drag overrides saved to `localStorage` (keyed by workstream ID)
- **Sync to Convex**: Only when changes exist. Debounced — minimum 45s between syncs. Triggered by meaningful changes (drag end, view switch, item creation), not every frame.
- **On close**: `beforeunload` triggers a final sync. Also `visibilitychange` as a fallback.
- **Cross-device**: Convex stores overrides. On load: compute canonical layout → apply overrides from Convex → apply any newer local overrides.
- **Conflict resolution**: Last-write-wins (timestamp comparison). Local state always takes precedence for the current session.

**Internal workstream layout:**
- Each view (structured/columns/graph) has its own layout state per workstream
- Zone positions in structured view, column order in column view, node positions in graph view
- Same two-layer model: canonical default + user overrides
- Stored as a JSON blob in a `workstreamLayouts` field on the workstreams table (one blob per view type)

**Bandwidth budget**: ~1 Convex mutation per user interaction batch. In a typical 30-minute session with moderate repositioning, expect 5-15 total writes to Convex for layout state.

**Files:**
- NEW: `src/lib/workspace/position-persistence.ts` — Two-layer persistence engine
- NEW: `src/lib/workspace/canonical-layout.ts` — Deterministic default layout computation
- MODIFY: `src/stores/workspace-store.ts` — Local override state management
- MODIFY: `convex/workstreams.ts` — Override storage and batch sync mutation

#### Storyboard: Semantic Zoom Flow

```
FRAME 1 — Overview (zoom ~0.4)
┌──────────────────────────────────────────────────────┐
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ · · · ┌───┐ · · · · ┌───┐ · · · · · · · · · · · · │
│ · · · │Bio│ · · · · │Hub│ · · · · · · · · · · · · │
│ · · · └───┘ · · · · └───┘ · · ┌───┐ · · · · · · · │
│ · · · · · · · · · · · · · · · │Mat│ · · · · · · · │
│ · · · · ┌───┐ · · · · · · · · └───┘ · · · · · · · │
│ · · · · │Eng│ (faded, completed) · · · · · · · · · │
│ · · · · └───┘ · · · · · · · · · · · · · · · · · · │
│ toolbar: [Name's Workspace] [🔍] [+] [⊞] [bg]     │
│                                                      │
│            ┌─────────────────────────┐               │
│            │ 🔍 Ask anything...      │               │
│            └─────────────────────────┘               │
└──────────────────────────────────────────────────────┘
Compact badges. Dots visible. Quick chat bar centered.

FRAME 2 — Summary (zoom ~0.6, hovering near Biology HL)
┌──────────────────────────────────────────────────────┐
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ · · ┌─────────────────────┐ · · · · · · · · · · · · │
│ · · │ 🧬 Biology HL       │ · · ┌───┐ · · · · · · │
│ · · │ Subject · Active     │ · · │Hub│ · · · · · · │
│ · · │ 4 threads · 2 notes  │ · · └───┘ · ┌────┐ · │
│ · · │ Last active: 1h ago  │ · · · · · · │Math│ · │
│ · · └─────────────────────┘ · · · · · · · └────┘ · │
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│                                                      │
│            ┌─────────────────────────┐               │
│            │ 🔍 Ask anything...      │               │
│            └─────────────────────────┘               │
└──────────────────────────────────────────────────────┘
Node expands. Metrics visible. Others still present.

FRAME 3 — Detail (zoom ~0.8, zooming into Biology HL)
┌──────────────────────────────────────────────────────┐
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ ┌──────────────────────────────────┐ · · · · · · · · │
│ │ 🧬 Biology HL                    │ · · · · · · · · │
│ │ ─────────────────────────────── │  ┌───┐ (40% op) │
│ │ Threads:                        │  │Hub│ · · · · · │
│ │  Homework Q3 · Exam Prep        │  └───┘ · · · · · │
│ │ Notes:                           │ · · · · · · · · │
│ │  Chapter 5 Summary               │ · · · · · · · · │
│ │ Planner:                         │ · · · · · · · · │
│ │  ⚡ Essay due Mar 30             │ · · · · · · · · │
│ └──────────────────────────────────┘ · · · · · · · · │
│                                                      │
│           ┌──────────────────────────┐               │
│           │ 🔍 Ask anything... → Bio │               │
│           └──────────────────────────┘               │
└──────────────────────────────────────────────────────┘
Internal items previewing. Others fading. Bar scoped.

FRAME 4 — Internal / Committed (zoom ~1.0+)
┌──────────────────────────────────────────────────────┐
│  Workspace > Biology HL         [Structured ▾] [⊞]  │
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ · Threads · · · · · · · · · · · · · · · · · · · · · │
│ · ─────────────────────────── · · · · · · · · · · · │
│ · Homework Q3    2 msgs · 1h · · · · · · · · · · · │
│ · Exam Prep      5 msgs · 3h · · · Notes · · · · · │
│ · + New thread · · · · · · · · · ──────────────── · │
│ · · · · · · · · · · · · · · · · Chapter 5 Summary · │
│ · · · · · · · · · · · · · · · · 📝 Updated 2h ago · │
│ · · · · · · · · · · · · · · · · · · · · · · · · · · │
│ · Planner · · · · · · · · · · · · · · · · · · · · · │
│ · ⚡ Essay due Mar 30 · · · · · · · · · · · · · · · │
│                                                      │
│           ┌──────────────────────────┐               │
│           │ 🔍 Ask Biology HL...     │               │
│           └──────────────────────────┘               │
└──────────────────────────────────────────────────────┘
Border dissolved. Groups visible with invisible grammar.
Breadcrumb + view toggle appear. Dots persist. Other
workstreams invisible. Quick chat scoped.

FRAME 5 — Internal + Right Push-Panel (thread opened)
┌──────────────────────────────────────────────────────┐
│  Workspace > Biology HL  [Struct▾]│Homework Q3  [↗]×│
│ · · · · · · · · · · · · · · · · ·│                  │
│ · · · · · · · · · · · · · · · · ·│ You: Can you    │
│ · Threads · · · · · · · · · · · ·│ help me with    │
│ · ──────────────────── · · · · · │ question 3?     │
│ · Homework Q3 ← active· · · · · │                  │
│ · Exam Prep · · · · · · · · · · │ Assistant:       │
│ · · · · · · · · · · · · · · · · │ ▸ Recalled memory│
│ · Notes · · · · · · · · · · · · │ Sure! Based on   │
│ · Chapter 5 Summary · · · · · · │ your notes...    │
│ · · · · · · · · · · · · · · · · │                  │
│ · · · · · · · · · · · · · · · · │ ┌──────────────┐│
│ · · · · · · · · · · · · · · · · │ │Ask follow-up…││
│ · · · · · · · · · · · · · · · · │ └──────────────┘│
└──────────────────────────────────────────────────────┘
Canvas pushed left. Panel shows chat with full features.
Quick chat bar hidden (panel composer replaces it).
Tool call blocks visible (collapsible). Active thread
highlighted in the workspace content.
```

---

### 2B: Inside Workstreams — Canvas-Native Views

**Goal**: When zoomed into a workstream's committed internal space, the content lives ON the canvas, not in a dashboard overlay. Three view modes, all spatial and canvas-native. Items are movable within views. A view toggle in the toolbar switches between them.

#### View Toggle

A small toggle in the workspace toolbar (only visible when inside a committed workstream):
`[Structured] [Columns] [Graph]`

Switching views animates the content layout transition (~400ms settle).

#### Structured View (default)

The structured view uses an **invisible layout grammar** — grouping, spacing, subtle separators, and calm hierarchy rather than loud boxed sections. The canvas background bleeds through. Content groups emerge from what actually exists in the workstream, not from a fixed template.

**Scale-adaptive content**: Not every workstream shows every section. Sections appear only when content exists:
- A fresh workstream with 1 thread and 0 notes shows only the thread group
- A mature workstream with threads, notes, planner items, and artifacts shows all relevant groups
- The layout adjusts dynamically as content is created or removed

**Visual grammar (NOT cards):**

```
Canvas at internal zoom — small workstream (2 threads, 1 note):

        Threads
        ─────────────────────────────────
        Homework Q3         2 messages · 1h ago
        Exam Prep           5 messages · 3h ago
        + New thread

                            Chapter 5 Summary
                            ─────────────────────────
                            First paragraph preview...
                            📝 Standard · Updated 2h ago


Canvas at internal zoom — large workstream (many items):

        Threads                              Notes
        ─────────────────────────            ─────────────────────────
        Homework Q3     · 1h ago             Chapter 5 Summary
        Exam Prep       · 3h ago             Lab Report Draft
        IA Research     · 1d ago             Reading Notes
        + New thread                         + New note

        ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

        Planner                              Artifacts
        ⚡ Essay due Mar 30 (2 days)         🗂 Flashcard deck (42 cards)
        • Review Ch 3-5                      📄 Study plan v2
        • Submit draft
        + Add task

        ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

        Science Tutor · linked agent · 12 interactions
```

**Key design rules:**
- **No card borders** on individual items. Items are rows with text, metadata, and subtle hover highlight (`bg-elevated` at 50% opacity)
- **Group headings** are just labels with a thin separator line below — not boxed headers
- **Groups separated** by generous spacing and optional faint dashed divider lines, not hard container boundaries
- **Canvas visible** between and around groups — the background dots/grid shows through
- Groups are React Flow group nodes (for draggability) but rendered with transparent backgrounds
- User can **drag groups** to rearrange spatial layout. Items within groups are list-ordered.
- Clicking any item opens it in the **right push-panel**
- Group headers show count + "New" action (understated, not a big button)

#### Column View

Vertical columns with headings, living on the canvas. More structured than structured view — suited for workstreams with many items that benefit from categorized vertical lists.

```
Canvas at internal zoom:

  Threads            Notes              Tasks              Artifacts
  ───────────────    ───────────────    ───────────────    ───────────────
  Homework Q3        Ch 5 Summary       ⚡ Essay (Mar 30)  🗂 Flashcards
    2 msgs · 1h        📝 · 2h ago       • Review Ch 3-5    42 cards
  Exam Prep          Lab Report           due tomorrow      📄 Study plan
    5 msgs · 3h        📝 · 1d ago      • Submit draft        v2
  IA Research        Reading Notes         next week
    1 msg · 2d         📝 · 3d ago

  + New thread       + New note         + Add task
```

- Columns are canvas-native vertical containers (React Flow group nodes, horizontal arrangement)
- Columns have transparent backgrounds — separated by generous spacing, not visible borders
- Items within columns are vertical list entries with understated hover states
- **Columns can be reordered** by dragging the heading
- **Columns only appear if content exists** — empty categories don't show (scale-adaptive)
- Column order and visibility saved per workstream
- Items clickable → right push-panel

#### Graph View

A relationship-focused mind map / network visualization:

- **Nodes**: Every thread, note, artifact, planner item as a positioned node on the canvas. Node size reflects relative importance (more messages/edits = slightly larger).
- **Edges** (conservative — avoid noise):
  - **Explicit references** (high confidence): A note that was created from a chat, an artifact linked to a thread, a planner item that came from a conversation. These are tracked via existing `source*Id` fields — zero cost.
  - **Temporal proximity** (medium confidence): Items created within the same session or close in time. Simple timestamp comparison — zero cost.
  - **User-created links** (high confidence): User manually connects two items (drag edge from one to another).
  - **Semantic similarity** (expensive — deferred): Embedding-based edges between items with similar content. **NOT in v3 first pass.** This requires embedding every item and running pairwise comparisons — expensive and potentially noisy. Add later once the explicit edge types prove useful. If needed early, limit to items within the same workstream and cap at 3 semantic edges per item.
- **Layout**: Force-directed with type-based clustering. Threads cluster together, notes cluster, etc. Edges pull connected items closer.
- **Fully interactive**: Nodes are freely draggable. Positions saved per workstream.
- **New items**: Auto-placed by the layout algorithm, others gently adjust (~400ms settle)
- **Edge visibility**: User can toggle edge types on/off (e.g., show only explicit references, hide temporal)

All three views use React Flow as the rendering surface, maintaining the canvas metaphor. The background (dots/grid/blank) is visible through all views.

#### Hub Node (at deep zoom)

The hub node also has a committed internal view when zoomed into deeply:
- **Quick notes inbox**: Unassigned notes
- **Cross-workstream planner**: All upcoming deadlines from all workstreams
- **Personal memory summary**: Top 5 memory entries
- **Recent activity**: Last 10 actions across all workstreams
- **Quick actions**: New workstream, new standalone note, new chat

Hub internals use the structured view layout.

**Files:**
- MODIFY: `src/components/workspace/workspace-canvas.tsx` — Semantic zoom bands, dissolution, internal rendering
- NEW: `src/components/workspace/views/structured-view.tsx` — Zone-based layout on canvas
- NEW: `src/components/workspace/views/column-view.tsx` — Column containers on canvas
- NEW: `src/components/workspace/views/graph-view.tsx` — Force-directed relationship map
- NEW: `src/components/workspace/views/hub-internal-view.tsx` — Hub committed view
- MODIFY: `src/components/workspace/workspace-toolbar.tsx` — View toggle, breadcrumb
- MODIFY: `src/stores/workspace-store.ts` — View state per workstream

---

### 2C: Notes Editor Perfection

**Goal**: A single, polished editor that feels as good as Notion and works with AI. Plus document versioning and import.

#### Mode Simplification

**Remove**: The "simple" / "notion" / "agentic" three-way split. Replace with:

- **Standard mode**: Full formatting toolbar (bold, italic, headings H1-H3, bullet list, ordered list, blockquote, code block, divider, undo/redo). Slash commands for block insertion. Drag handles for reordering. This is what "notion-like" was supposed to be, but always available.
- **AI-Enhanced mode**: Everything from Standard PLUS the AI bar at the top. AI can edit inline, suggest, rewrite. Diff preview with accept/reject.

Both modes always show the formatting toolbar. The only difference is the AI bar.

**Migration**: Map existing `editorMode` values — `"simple"` and `"notion"` → `"standard"`, `"agentic"` → `"ai_enhanced"`. Handle in the query layer (return mapped value).

#### Formatting Toolbar (always visible)

- **Buttons**: Bold, Italic, Strikethrough, Code, H1, H2, H3, Bullet List, Ordered List, Blockquote, Code Block, Divider, Undo, Redo
- **Selection toolbar**: Floating on text selection (bold, italic, link, code, highlight, strikethrough)
- **Consistent across both modes** — no more hiding toolbar in "simple" mode

#### Slash Commands (complete Wave 6 gap)

Implement the Tiptap slash command extension:
- `/heading1`, `/heading2`, `/heading3` — Insert heading
- `/bullet` — Bullet list
- `/numbered` — Numbered list
- `/quote` — Blockquote
- `/code` — Code block
- `/divider` — Horizontal rule
- `/table` — Insert table (requires `@tiptap/extension-table`)
- `/todo` — Task list item
- `/image` — Insert image (upload or URL)
- `/callout` — Styled callout block (info, warning, tip)
- `/math` — LaTeX math block (important for IB students)

Use Tiptap's `Extension.create()` with `addKeyboardShortcuts` and `addInputRules` for the `/` trigger. Show a filtered dropdown as user types.

#### Drag Handles

- Add `@tiptap/extension-drag-handle` or implement custom drag handles
- Show grab handle on hover to the left of each block
- Drag to reorder blocks within the document

#### Note Field Fix

- **Remove border on hover**: The note content area should have no visible field boundary. It's a document, not an input field.
- **Remove max-height constraint**: Notes should flow to full available height, no artificial limiting
- **No visible expand behavior**: Content just grows naturally as you type

#### Document Versioning

**AI edits**: Each AI edit (via the AI bar) creates an explicit version entry:
- Full Tiptap JSON snapshot + diff from previous version
- Metadata: instruction given, model used, timestamp, reason
- Individually revertable from version history panel

**Personal edits**: Batched into daily snapshots (or weekly if minimal changes):
- Auto-save triggers a snapshot at end of an editing session (no activity for 60s) or end of day
- If changes are too small to warrant a daily snapshot, batch into weekly
- Stored as Tiptap JSON diff from the previous snapshot (storage efficient)
- Labeled: "Your edits on Mar 28" or "Your edits, Mar 24-28"

**Version history panel**: Timeline view showing all versions (AI and personal), visually distinguished. Click any version to preview. Restore button to revert.

**Storage strategy**: Research best approaches for diff-based storage. Options: JSON structural diff (json-diff), ProseMirror steps (native to Tiptap), or OT-style changeset compression. Priority is storage efficiency — a note with 100 edits should not store 100 full copies.

#### Document Import (connects to Phase 1F)

- Import button in the notes toolbar/header area
- Drag-and-drop .md, .html, .docx, .pdf files onto the editor
- Clipboard paste preserves HTML formatting from any source (Google Docs, Notion web, Apple Notes, Word online)

**Files:**
- MODIFY: `src/components/editor/tiptap-editor.tsx` — Mode simplification, always-visible toolbar
- MODIFY: `src/components/editor/editor-toolbar.tsx` — Two modes, full formatting in both
- NEW: `src/components/editor/slash-command-extension.ts` — Slash commands
- NEW: `src/components/editor/drag-handle-extension.ts` — Drag handles
- NEW: `src/components/editor/version-history-panel.tsx` — Version timeline
- MODIFY: `src/components/editor/ai-bar.tsx` — Only shows in AI-Enhanced mode
- MODIFY: `convex/notes.ts` — Handle mode migration, version storage
- NEW: `convex/noteVersions.ts` — Version history CRUD
- NEW: `src/components/editor/import-dialog.tsx` — Import UI

---

### 2D: Chat & Right Push-Panel UX

**Goal**: The right push-panel is the universal detail surface for threads, notes, artifacts, and route trace. It pushes the canvas to make room. Chat in the panel must be identical in quality to the full chat view.

#### Right Push-Panel Architecture

All detail views (threads, notes, artifacts, route trace) open in the same right push-panel. **The panel width adapts to content type:**

| Content type | Panel width | Rationale |
|-------------|------------|-----------|
| Chat/thread | 380px | Conversation flow is narrow by nature |
| Note/document | 520px | Documents need a readable content column (like Notion's focused width). **Full editor experience** — toolbar, slash commands, AI bar (if AI-Enhanced mode), version history access. No need to expand unless wider view is desired. |
| Artifact viewer | 480px | Code/flashcards need moderate width |
| Route trace | 400px | Diagnostic data, moderate width |

The content column within the note panel should behave like Notion/Affine's focused document width — centered within the panel with comfortable margins, not stretched edge-to-edge.

**Canvas behavior when panel opens/closes:**
- React Flow viewport smoothly resizes to `100% - panelWidth` (~300ms ease-out)
- The viewport adjusts its center point slightly left so the focused workstream content remains centered in the visible canvas area (not pushed to the far left)
- When panel closes: viewport expands back (~250ms ease-in), center point restores
- No flicker, no layout jump — the canvas content slides left/right continuously

**Panel header**: `[Icon + Title] ... [↗ expand] [× close]`
  - Expand icon (↗) opens the content in its full-page route (e.g., `/chat?chatId={id}&from=workspace`)
  - Close icon (×) closes the panel, canvas re-expands
  - Back button in full-page view returns to workspace at the correct zoom level

**State management:**
- Only one panel open at a time. Opening a new item replaces the current panel with a cross-fade (~200ms).
- Panel state is part of the URL: `?ws={id}&panel=chat&thread={threadId}` — so browser back/forward works
- All panels use framer-motion `AnimatePresence` for smooth enter/exit

#### Chat in the Right Panel

When a thread is opened (from quick chat bar submission or from clicking a thread in the workspace):

- **Fully functional**: All visualizations (code, flashcards, citations, quiz, source cards) work
- **Simplified chrome**: No nested right-panel buttons (since this IS the right panel). No route-trace trigger from within the panel.
- **Routing phase display fix**: During "Routing"/"Searching"/"Thinking" phases, do NOT show a typing indicator (3 dots) as a fake assistant message. Show a phase indicator ABOVE the message area:
  ```
  [Route icon] Finding the best approach...
  [Search icon] Searching for context...
  [Brain icon] Thinking...
  ```
  Once streaming begins, the indicator dissolves into the first tokens of the real response.
- **No separator**: No horizontal line between messages and composer. Messages scroll behind the composer with a subtle gradient mask.
- **Composer**: Same as full chat composer but compact. Auto-scoped to the current workstream's mode and agent.
- **Tool call blocks**: Collapsible inline blocks (from Phase 1C) render in the panel identically to full chat.

#### Sidebar Real-Time Updates

- **Problem**: New conversations created in workspace don't appear in the sidebar
- **Fix**: Switch sidebar chat list from REST polling to Convex reactive query. Convex subscriptions automatically push updates when new chats are created anywhere.
- File: `src/components/chat/chat-sidebar.tsx`, `src/hooks/use-chat-state.ts`

#### Thread Opening Behavior

- **From workspace content** (clicking a thread in structured/column/graph view): Opens in right push-panel
- **From quick chat bar** (sending a message): Opens in right push-panel
- **Expand icon (↗)** in panel header: Navigates to `/chat?chatId={id}&from=workspace&ws={workstreamId}`
- Threads NEVER navigate to full chat by default from within the workspace

#### Route Trace Panel

- **Remove right margin**: Set `pr-0` or `mr-0` on the panel container.
- **Score breakdown**: Show per-candidate component scores (capability, cost, freshness, etc.)
- **Selection method**: Show "Top pick" vs "Weighted random from top 3"
- File: `src/components/chat/route-trace-drawer.tsx`

#### URL State Management

- Zoom-based workstream activation: When zoom crosses the commit threshold stably (not during intermediate scroll), update URL with `?ws={id}`
- **No flickering**: Use debounced URL updates (only update after zoom has been stable for 200ms at the threshold)
- Panel state in URL: `?ws={id}&panel=chat&thread={threadId}` or `?ws={id}&panel=note&note={noteId}`
- Browser back/forward works correctly through all states

**Files:**
- MODIFY: `src/components/workspace/workspace-canvas.tsx` — Canvas resize on panel open/close
- NEW: `src/components/workspace/right-push-panel.tsx` — Universal right panel container
- MODIFY: `src/hooks/use-compact-chat.ts` — Fix routing phase display, tool call rendering
- MODIFY: `src/components/chat/chat-sidebar.tsx` — Reactive queries
- MODIFY: `src/hooks/use-chat-state.ts` — Reactive queries
- MODIFY: `src/components/chat/route-trace-drawer.tsx` — Margin fix, score breakdown

---

### 2E: Visual Coherence & Polish

**Goal**: Ensure everything follows the Spectra design system and the canvas feels alive without being distracting.

#### Design System Enforcement

All new and modified components must use:
- CSS variables: `--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--border-default`
- `font-display` for headings
- `--radius-container: 18px` for containers
- No hero containers with rounded-3xl border
- No uppercase eyebrow labels
- No decorative blobs or radial gradients
- `shadow-[0_1px_0_var(--border-default)]` for header lines

#### Animation Language

The canvas should feel alive through responsive transitions, not through continuous motion:

**Zoom transitions:**
- Representation band changes: ~300ms ease-out for content morphing
- Border dissolution at commit threshold: ~400ms, opacity + blur on border elements
- Neighbor workstream fade: proportional to zoom (opacity = `lerp(1, 0, (zoom - 0.7) / 0.5)`)
- No jank — all transitions must be GPU-composited (transform, opacity only)

**Layout transitions:**
- Auto-layout settling: ~400ms spring (stiffness 180, damping 24) when items are added/removed
- View switch (structured → columns → graph): ~400ms cross-fade + position morph
- Zone/column arrangement: items slide to new positions on layout change

**Panel transitions:**
- Right push-panel open: 300ms ease-out slide from right, canvas resize in parallel
- Right push-panel close: 250ms ease-in slide to right
- Panel content swap: 200ms cross-fade
- Quick chat bar hide/show: 200ms opacity + translateY

**Hover and interaction:**
- Workstream nodes: 150ms ease, subtle shadow lift + border tint
- Items in internal views: 150ms, slight bg-elevated highlight
- No scale transforms on hover (breaks spatial metaphor — things don't grow when you look at them)

#### Canvas Visual Continuity

The key to making the workspace feel like "one place":
- Background pattern (dots/grid) persists at all zoom levels, including inside committed workstreams
- No hard visual breaks between overview and internal views
- Color system carries through: workstream accent color tints the internal view subtly
- The toolbar transforms (adds breadcrumb + view toggle when inside) but doesn't jump or re-render

---

### 2F: UI Testing, Performance & Launch Readiness

*Folded from former Wave 9. This is the final pass before school deployment.*

- [ ] **End-to-end flow testing**: Full semantic zoom lifecycle, push-panel flows, chat in panel, note editing, ManageBac sync
- [ ] **Performance targets**:
  - Workspace canvas load (15 workstreams): < 1.5s
  - Semantic zoom band transitions: 60fps
  - Push-panel open/close: 60fps, < 300ms
  - Auto-layout settle: < 400ms, 60fps
  - Memory retrieval: < 500ms
  - Tool call round-trip: < 800ms
  - AI edit response: < 3s
  - Quick chat to first token: < 2s
- [ ] **Route cleanup**: Remove `/artifacts`, `/flashcards`, `/images`, `/bookmarks` → 301 redirect to workspace
- [ ] **Achievements merge into analytics**: Fold gamification data into analytics dashboard
- [ ] **Accessibility**: Keyboard navigation for semantic zoom (arrow keys?), screen reader labels for canvas items, color contrast for all states
- [ ] **Mobile/tablet**: Canvas usable on tablet (touch zoom + pan). Push-panel goes full-width on mobile. Quick chat bar adapts.
- [ ] **Final build**: `next build` clean. All TypeScript errors resolved.

---

## Critical Files Reference

| Purpose | Path |
|---------|------|
| Convex schema | `convex/schema.ts` |
| User memory backend | `convex/memory.ts` |
| Workstream memory backend | `convex/workstreamMemory.ts` |
| Memory crons | `convex/crons.ts` |
| Chat pipeline | `src/lib/orchestrator/pipeline.ts` |
| Streaming engine | `src/lib/orchestrator/streaming.ts` |
| Route planning | `src/lib/orchestrator/route-plan.ts` |
| Post-processing (memory) | `src/lib/orchestrator/post-process.ts` |
| Phase router (model selection) | `src/lib/routing/phase-router.ts` |
| Auto settings | `src/lib/auto-settings.ts` |
| Workspace canvas | `src/components/workspace/workspace-canvas.tsx` |
| Workspace toolbar | `src/components/workspace/workspace-toolbar.tsx` |
| Focus panel (to be replaced by semantic zoom) | `src/components/workspace/workstream-focus-panel.tsx` |
| Quick chat / command bar | `src/components/workspace/chat-side-panel.tsx` → rename to `workspace-command-bar.tsx` |
| Auto-layout engine (NEW) | `src/lib/workspace/auto-layout.ts` |
| Position persistence (NEW) | `src/lib/workspace/position-persistence.ts` |
| Right push-panel (NEW) | `src/components/workspace/right-push-panel.tsx` |
| Structured view (NEW) | `src/components/workspace/views/structured-view.tsx` |
| Column view (NEW) | `src/components/workspace/views/column-view.tsx` |
| Graph view (NEW) | `src/components/workspace/views/graph-view.tsx` |
| AI tool definitions (NEW) | `src/lib/orchestrator/tool-definitions.ts` |
| Tool executor (NEW) | `src/lib/orchestrator/tool-executor.ts` |
| Note versions (NEW) | `convex/noteVersions.ts` |
| Compact chat hook | `src/hooks/use-compact-chat.ts` |
| Workspace store | `src/stores/workspace-store.ts` |
| Workspace data hook | `src/hooks/use-workspace-data.ts` |
| Zoom helpers | `src/lib/workspace/zoom-helpers.ts` |
| Tiptap editor | `src/components/editor/tiptap-editor.tsx` |
| AI bar | `src/components/editor/ai-bar.tsx` |
| Editor toolbar | `src/components/editor/editor-toolbar.tsx` |
| AI edit API | `src/app/api/editor/ai-edit/route.ts` |
| Notes backend | `convex/notes.ts` |
| Chat sidebar | `src/components/chat/chat-sidebar.tsx` |
| Route trace panel | `src/components/chat/route-trace-drawer.tsx` |
| Workstreams backend | `convex/workstreams.ts` |
| Chat state hook | `src/hooks/use-chat-state.ts` |
| App shell | `src/components/layout/app-shell.tsx` |
| Landing page | `src/app/landing/landing-client.tsx` |
| ManageBac client (REWRITE) | `src/lib/managebac.ts` → `src/lib/managebac/client.ts` |
| ManageBac normalizer (NEW) | `src/lib/managebac/normalizer.ts` |
| ManageBac sync (NEW) | `src/lib/managebac/sync.ts` |
| ManageBac mapper (NEW) | `src/lib/managebac/mapper.ts` |
| ManageBac sync backend (NEW) | `convex/managebacSync.ts` |
| Budget/spending | `convex/usage.ts` |
| Spending shared utils | `shared/spending.ts` |
| Model config (free/cheap models) | `src/lib/model-config.ts` |
| Model policy (cost ceiling) | `src/lib/model-policy.ts` |
| Heuristic routing | `src/lib/routing/heuristic.ts` |

---

## Verification Checklist

### Phase 1 Verification
- [ ] `next build` succeeds with zero errors
- [ ] Memory: Create workstream A, chat about topic X → memory saved → switch to workstream B → topic X memory NOT auto-injected → AI uses `recall_memory` tool to access it when asked
- [ ] Memory: Freshness decays daily without resetting `updatedAt`
- [ ] Memory: Duplicate entries are caught by key+text dedup (no embedding needed)
- [ ] Tools: AI calls `save_memory` during conversation → entry appears in Convex → `recall_memory` retrieves it
- [ ] Tools: AI calls `fork_thread` → new thread created → reference shown to user → original thread continues
- [ ] Routing: No model older than 90 days is selected as primary candidate
- [ ] Routing: Candidate scores show meaningful differentiation (not all identical)
- [ ] Routing: Repeated identical prompts sometimes get different models (weighted random)
- [ ] Import: .md file from Notion export → opens in editor with correct formatting
- [ ] Import: .docx file → opens in editor with headings, lists, formatting preserved

### Phase 2 Verification

**Semantic Zoom Canvas:**
- [ ] Workspace toolbar shows "{Name}'s Workspace"
- [ ] Canvas dots background renders correctly and persists through all zoom levels
- [ ] Zoom from overview → summary → detail → internal: representation changes at each band
- [ ] Border dissolution at commit threshold: smooth opacity + blur fade (~400ms)
- [ ] Other workstreams fade out progressively as zoom deepens (50% → 20% → invisible)
- [ ] Single-click on workstream: animated zoom-to-fit + commit (~500ms)
- [ ] Exit methods all work: zoom out, Escape, back button, breadcrumb
- [ ] Breadcrumb appears only when inside a committed workstream
- [ ] URL updates with `?ws={id}` at commit threshold (no flickering)
- [ ] Auto-layout positions workstreams intelligently around hub (no overlap)
- [ ] New workstream creation triggers smooth re-layout (~400ms settle)
- [ ] User-dragged nodes are pinned (not moved by auto-layout)
- [ ] Position persistence: changes saved to localStorage → synced to Convex on close

**Quick Chat Bar:**
- [ ] Persistent bottom-center, always visible on outer workspace
- [ ] Expands on focus with workstream dropdown
- [ ] Auto-selects workstream via routing inference
- [ ] Inside committed workstream: scoped to that workstream
- [ ] Sending message opens thread in right push-panel
- [ ] Bar hides when push-panel is open; reappears when closed

**Internal Views:**
- [ ] Structured view: zone blocks on canvas, clickable items → push-panel
- [ ] Column view: vertical columns on canvas, reorderable
- [ ] Graph view: mind-map layout, freely draggable nodes, relationship edges
- [ ] View toggle in toolbar switches with smooth layout transition
- [ ] Hub node at deep zoom shows: quick notes, planner, memory, activity
- [ ] Thread/artifact counts live (not stale stored values)

**Right Push-Panel:**
- [ ] Opens from right, canvas resizes smoothly to accommodate (~300ms)
- [ ] Closes to right, canvas re-expands (~250ms)
- [ ] Header: `[Icon + Title] ... [↗ expand] [× close]`
- [ ] Expand icon opens full-page view; back button returns to workspace
- [ ] Only one panel at a time; content swaps with cross-fade
- [ ] Chat in panel: no typing indicator during routing (phase indicator instead)
- [ ] Chat in panel: no separator above composer
- [ ] Chat in panel: all visualizations work (code, flashcards, citations)
- [ ] Sidebar updates in real-time when workspace creates chats
- [ ] Route trace: no right margin, score breakdown per candidate

**Editor:**
- [ ] Two modes only (Standard, AI-Enhanced)
- [ ] Formatting toolbar visible in both modes
- [ ] Slash commands work (type "/" → dropdown with 12+ commands)
- [ ] Drag handles for block reordering
- [ ] Note content area: no border on hover, no max-height constraint
- [ ] Version history: AI edits as individual versions, personal edits as daily snapshots
- [ ] Import: .md, .html, .docx, .pdf all produce correctly formatted Tiptap content
- [ ] Clipboard paste preserves formatting from any source

---

## Execution Instructions

Approach this like a high-stakes architecture implementation. The plan describes a complex, interconnected system where the canvas, semantic zoom, push-panels, auto-layout, AI tools, memory, routing, and sync all interact. Misinterpreting one part can cascade into others.

**Rules for the implementation agent:**

1. **The canvas is the world.** A workstream is NOT a panel, NOT a modal, NOT an overlay. It is a space the user enters through semantic zoom. If you find yourself writing code that opens a workstream as a separate component layered on top of the canvas, stop — you've misread the plan.

2. **The right push-panel is ONLY for individual objects** (threads, notes, artifacts, route trace). It pushes the canvas. It does not replace the canvas. It is never used for viewing the workstream itself.

3. **Invisible layout grammar, not cards.** If the structured view looks like a dashboard of cards with borders, you've gone too far. Use spacing, separator lines, subtle regions, and text hierarchy. The canvas background must be visible between groups.

4. **Scale-adaptive content.** Do not render empty sections. A workstream with 1 thread and 0 notes should not show an empty "Notes" zone. Content groups appear only when content exists.

5. **Conservative edges in graph view.** Start with explicit references and temporal proximity only. Do NOT run embedding comparisons for semantic edges in the first pass. Add them later once the explicit edge types prove useful.

6. **No hard deletes.** Archive, don't delete. IDs must always resolve. Cascading "delete" means cascading archive with appropriate status flags.

7. **Local-first positions.** Do not write to Convex on every drag frame. localStorage is immediate, Convex is batched. `beforeunload` saves.

8. **All mutable data uses Convex reactive queries.** No REST polling for data that must stay in sync (sidebar, thread counts, planner items, notes lists).

9. **Test each semantic zoom band independently.** The overview, summary, detail, and internal bands each have different rendering requirements. Verify each band works before composing the transitions between them.

10. **Run `next build` after every major section of work.** Do not accumulate build errors. Fix them as they arise.
