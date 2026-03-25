# Spectra Master Plan

## Context

Spectra is an AI-powered learning platform for schools, currently targeting EU schools first. After deep codebase analysis, competitive research, and user testing feedback captured in IDEA.md, the product has significant gaps across routing, memory, search, file handling, orchestration, UX, and architectural coherence. The current state feels fragmented, with broken backend logic, under-polished UI, and features that don't reach production quality.

**The core thesis**: Spectra must not be "ChatGPT with a school logo." Research proves pedagogically designed AI doubles learning outcomes while unrestricted ChatGPT harms them by 17%. Spectra's path to market is through genuine pedagogical design, institutional safety through the SOUL system, and a signature feature no competitor has.

**The signature feature**: The **Artifacts Workspace** — a living, version-tracked, multi-view workspace where AI-generated and manually-created artifacts (study plans, timetables, notes, flashcard decks, documents, code, diagrams) coexist. Agents can propose edits, users confirm. This replaces the separate images, flashcards, bookmarks, and achievements pages with something transformative.

**Key strategic decisions from user input**:
- EU schools first (GDPR, EU AI Act, Moodle priority)
- Tavily as selective agentic search tool layer (not always-on), SearXNG fully removed
- Mem0 integrated into Convex/Vercel infrastructure (no extra hosting costs)
- tldraw SDK for diagrams/canvas
- Teachers guide through Agents, not surveillance dashboards
- Agents are central — guided wizard creation with resource upload
- Heuristic routing reimagined (no learned router, no classifier)
- Artifacts Workspace as the KEY differentiator
- Product quality first, GTM later

---

## Phase 1: Foundation & Infrastructure Fixes

**Goal**: Fix the broken infrastructure that everything else depends on.

### 1.1 OPENROUTER_API_KEY Error Chain
- **Problem**: `OPENROUTER_API_KEY missing for ingestion` when attaching files; `OPENROUTER_API_KEY missing for catalog sync` in cron jobs
- **Files**: `convex/ingestQueue.ts:232`, `convex/catalogSync.ts:434`, `convex/soul.ts:106`
- **Fix**: Add proper env var validation at startup. Add graceful degradation paths: lexical fallback for soul (already exists), queue-and-retry for ingestion, skip-and-warn for catalog sync. Surface clear error messages in admin UI when key is missing.

### 1.2 File Policy: 7-Day Auto-Expiry
- **Problem**: No retention policy for conversation-attached files; storage grows unbounded
- **Files**: `convex/resources.ts`, `convex/crons.ts`
- **Implementation**:
  - Add `expiresAt` field to resources schema (7 days from upload for conversation files, null for My Files and agent resources)
  - New cron job: `cleanup-expired-resources` (daily at 2:00 UTC)
  - Cascade: delete chunks, then storage blob, then resource record
  - No user warning needed (per user preference)
  - Keep: My Files (scope=personal with explicit save), agent resources, pack resources

### 1.3 File Limits & Blocked Extensions
- **Files**: `convex/resources.ts`, `convex/ingestQueue.ts`
- **Implementation**:
  - Enforce max 5 files per conversation attachment
  - Enforce max 25 files in My Files (already exists but verify)
  - Block video extensions at upload validation: mp4, mov, avi, mkv, webm, flv, wmv
  - Block unsupported: exe, dll, bin, iso, dmg, apk, ipa
  - Add compaction precautions: warn if conversation has many large file contexts

### 1.4 finish_reason Handling
- **Problem**: `finish_reason: "length"` parsed but never communicated to UI or handled
- **Files**: `src/lib/openrouter.ts:503,526,566`
- **Implementation**:
  - Include `finishReason` in the `type: "done"` stream event
  - When `finish_reason === "length"`: auto-continue with the partial response as context, prepend "Continue from where you stopped"
  - Cap at 2 continuation rounds to prevent runaway costs
  - Surface subtle indicator: "Expanding response..." during continuation
  - Track truncation rate per model in usage events for routing feedback

### 1.5 Manual Model Selection Fix
- **Problem**: "Use model" button on model page doesn't work; dropdown doesn't allow manual selection
- **Files**: `src/app/models/page.tsx`, `src/components/chat/chat-composer.tsx`, chat state
- **Fix**: Ensure `routerMode: "manual"` + `manualModel: selectedModelId` propagates correctly from model page to chat state. Fix the model page routing to `/chat?model=...&router=manual`.

### 1.6 System Prompt Token Bloat
- **Problem**: Even simple prompts show 3500+ tokens. System prompt is too verbose for simple queries.
- **Files**: `src/lib/prompts/policy.ts`
- **Implementation**:
  - Tier the system prompt by pipeline complexity:
    - T0 (simple): Base identity (50 tokens) + mode rules only
    - T1 (light): + memory profile + context summary
    - T2 (full): + guidelines + skills + search block + source rules
    - T3 (multi-agent): Full system prompt
  - Remove redundant instructions that repeat across modes
  - Compress mode rules into denser format
  - Target: T0 system prompt < 400 tokens, T1 < 800, T2 < 1500

### 1.7 Catalog Sync Error Fix
- **Files**: `convex/catalogSync.ts:434,522`
- **Fix**: Guard `refreshCatalogBase` with env check. If key missing, log warning and return empty without throwing. Catalog data should degrade gracefully (use last cached data).

### 1.8 Schema Preparations for Artifacts
- **Files**: `convex/schema.ts`
- **New tables** (designed now, populated in Phase 5):
  ```
  artifacts: {
    ownerUserId, orgId, type, title, content (JSON),
    layout (JSON for canvas position/grouping),
    status: "active" | "archived",
    pinnedAt, createdAt, updatedAt
  }
  artifactVersions: {
    artifactId, diff (JSON patch), authorType: "user" | "agent",
    authorAgentId?, sourceChatId?, sourceMessageId?,
    createdAt
  }
  ```
- **Indexes**: `artifacts.by_owner_updated`, `artifacts.by_org`, `artifacts.by_type`
- **Migration path**: flashcardDecks, images, bookmarks → artifacts with type field

### 1.9 Compaction Improvements
- **Problem**: Manual summary only (no LLM summarization); minimum 20 messages; single compaction boundary
- **Files**: `convex/compaction.ts`, `convex/chats.ts`
- **Implementation**:
  - Use a cheap model (via pipeline budget T0) to generate compaction summary instead of manual extraction
  - Lower minimum to 12 messages
  - Preserve unresolved user goals and artifact references in summary
  - Add `compactionQuality` field: "manual" | "llm" | "hybrid"

### 1.10 Missing Database Indexes
- **Files**: `convex/schema.ts`
- Add indexes:
  - `messages.by_chat_created` (for efficient history loading)
  - `resources.by_org_updated` (for batch processing)
  - `usageEvents.by_org_model_day` (for per-model analytics)
  - `artifacts.by_owner_type` (for filtered artifact views)

---

## Phase 2: Chat Experience & UX Overhaul

**Goal**: Fix every user-facing chat issue from IDEA.md. Make the core experience feel polished and reliable.

### 2.1 Auto-Scroll Fix
- **Problem**: During generation, scrolling up to read is almost impossible; auto-scroll fights the user
- **Files**: `src/components/chat/chat-messages.tsx`
- **Implementation**:
  - Detect user scroll-up (any upward scroll > 20px) → exit auto-scroll mode immediately
  - Add floating "scroll to bottom" button with down-arrow icon, subtle slide-in animation
  - Clicking button or scrolling to within 100px of bottom → re-engage auto-scroll
  - Use `IntersectionObserver` on a sentinel element at the bottom rather than scroll events
  - Smooth scroll animation when re-engaging (not instant jump)

### 2.2 Message Persistence During Generation
- **Problem**: Refreshing during generation loses the response; interrupted output not saved; changing pages deletes streaming content
- **Files**: `src/hooks/use-chat-state.ts`, `src/app/api/chats/route.ts`
- **Implementation**:
  - Persist partial responses to Convex every 3 seconds during streaming (debounced)
  - On page change/refresh: save current draft with `cancelled: true` flag
  - On return to conversation: show the partial response with "Response was interrupted" indicator
  - Clicking "back" on sidebar should preserve streaming state, not kill it
  - Add `beforeunload` event handler to trigger save

### 2.3 Progress State Machine
- **Problem**: Shows "Thinking" even when generating; "done" state never completes; progress doesn't depend on model/prompt
- **Files**: `src/components/chat/chat-layout.tsx`, stream phase handling
- **Implementation**:
  - Explicit state machine: `idle → routing → [searching] → thinking → generating → [synthesizing] → done`
  - Each state has:
    - Label (lowercase): "routing...", "searching...", "thinking...", "generating...", "synthesizing...", "done"
    - Elapsed timer (with lowercase 's' for seconds — already noted in IDEA.md)
    - Color indicator matching state
  - "Done" state: trigger explicitly when stream ends AND post-processing completes (title gen, memory write, etc.)
  - Show "done" for 2 seconds, then fade to idle
  - Model-dependent: if model doesn't support thinking, skip "thinking" state

### 2.4 Conversation Title Generation
- **Problem**: Title not created consistently; should be 3-5 word summary of initial prompt
- **Files**: `src/lib/orchestrator/post-process.ts`
- **Implementation**:
  - Always generate title after first user message, using a cheap model
  - Format: 3-5 words, no quotes, no "User asks about...", just the topic
  - Examples: "WW2 Flashcards for IB", "Quadratic Formula Help", "Crow Brawl Stars Paragraph"
  - If title generation fails, fall back to first 5 words of user message

### 2.5 Right Panel Fixes
- **Problem**: Panels open with lots of empty space; default should be orchestration; auto-open has no animation; route trace is shown instead of orchestration
- **Files**: `src/components/chat/unified-panel.tsx`, `src/components/chat/chat-layout.tsx:276-301`
- **Implementation**:
  - Default auto-open panel: orchestration (not route-trace)
  - Apply same sliding animation for auto-open as manual open (use CSS transition, not instant render)
  - Fix empty space: panel should use `width: fit-content` with `max-width: 420px`, not fixed width
  - Route trace content should fill available width; remove right-side dead space
  - Canvas panel: same fix — no blank space at right

### 2.6 Dark Mode Overhaul
- **Problem**: Dark mode is "horrible"; current `#13111a` too dark/purple
- **Files**: `src/app/globals.css`
- **Implementation**:
  - Change dark mode `--bg-primary` to `#2D2D2B` (warm dark, as specified in IDEA.md)
  - Adjust `--bg-secondary`, `--bg-elevated`, `--bg-tertiary` to complement the warmer base
  - Keep text colors warm (already correct: `--text-secondary: #b8adb0`)
  - Ensure all borders, shadows, and overlays work with new base
  - Test every component in dark mode: sidebar, chat, panels, modals, dropdowns, code blocks

### 2.7 <<Tag Skeleton Rendering
- **Problem**: Spectra's custom tags (`<<QUIZ_START>>`, `<<FLASHCARDS_START>>`, `<<DOCUMENT_START>>`) show raw text while being written; should show skeleton until tag is closed
- **Files**: `src/components/chat/markdown-renderer.tsx`, `src/components/chat/quiz-reveal.tsx`, `src/components/chat/flashcard-reveal.tsx`
- **Implementation**:
  - Detect opening tags in streaming content
  - While tag is open (no closing tag yet), render a type-appropriate skeleton:
    - `<<QUIZ_START>>`: Quiz skeleton (question placeholders with option circles)
    - `<<FLASHCARDS_START>>`: Card skeleton (flippable card placeholder)
    - `<<DOCUMENT_START>>`: Document skeleton (page with lines)
  - On closing tag: parse content and render the real component
  - Smooth transition from skeleton to real content

### 2.8 Branch/Edit System Fix
- **Problem**: `1/2` and `2/2` branch navigation shows overlapping prompts; edit popup too narrow; slow UI update after edit submit
- **Files**: `src/components/chat/chat-message.tsx`, `src/components/chat/chat-messages.tsx`
- **Implementation**:
  - Fix branch rendering: only show the active branch's user message, with prev/next arrows
  - When viewing branch 2/2, do NOT show branch 1/1's prompt above it
  - Edit popup: set `min-width: min(600px, 90vw)` instead of current narrow default
  - On edit submit: immediately show the new user message with loading state, don't wait for API

### 2.9 Settings Consolidation
- **Problem**: Old/deprecated settings panel still accessible from tips; settings button disappears during generation
- **Files**: `src/components/chat/chat-settings-drawer.tsx`, `src/components/global-utility-dock.tsx`
- **Implementation**:
  - Remove all references to the old/deprecated settings panel
  - Keep only the drawer accessible from sidebar toggle and header button
  - Settings button: always visible in header, even during generation (just move stop button to its left)
  - Tips that say "open settings" should point to the current settings drawer, not old panel

### 2.10 Notification Redesign
- **Problem**: Response-ready notification should look like achievements-unlocked; clicking should navigate to conversation
- **Files**: `src/components/` (notification component), `convex/notifications.ts`
- **Implementation**:
  - Redesign notification toast: use the same animation style as achievement unlocks (slide-in from top-right, with subtle glow)
  - Include: conversation title, mode icon, model used
  - Click action: navigate to that conversation and scroll to the new message
  - Stack notifications if multiple arrive (max 3 visible)
  - Sound: optional subtle notification sound (off by default, toggleable in settings)

### 2.11 Sidebar Rendering Optimization
- **Problem**: All messages rendered in sidebar at load; should lazy-render
- **Files**: `src/components/chat/chat-sidebar.tsx`
- **Implementation**:
  - Initially render only the 20 most recent conversations
  - On scroll: load more with `IntersectionObserver` (batch of 20)
  - Maintain scroll position on re-render
  - Ensure persistence is not broken: conversation IDs always tracked, just DOM elements lazy
  - Fix: last sidebar nav button getting blurred/cut off — add `pb-4` padding to nav container

### 2.12 UI Break When Switching Chats
- **Problem**: Entire UI sometimes breaks when switching between chats; buttons and headings shift far left; note appears in chat heading section
- **Files**: `src/components/chat/chat-layout.tsx`
- **Implementation**:
  - Add error boundary around chat message area with graceful fallback UI
  - Investigate race condition: switching chat while streaming may leave stale state
  - Add cleanup: when `selectedChatId` changes, abort any in-flight streams, clear draft state
  - Ensure chat heading section has fixed positioning that doesn't depend on message content

### 2.13 Flashcard Reminder Intrusiveness
- **Problem**: Flashcard reminder and idea may be too intrusive
- **Files**: proactive banner components
- **Implementation**:
  - Rate-limit flashcard suggestions: max 1 per session, and only after 3+ educational exchanges
  - Make dismissible with "Don't show again" option (stored in user preferences)
  - Reduce visual weight: thin banner, not card-style

### 2.14 Memory Update Indication
- **Problem**: No clear indication when memory gets updated
- **Files**: chat message rendering, memory write flow
- **Implementation**:
  - After a memory write: show subtle inline indicator below the assistant message: "Memory updated" with brain icon
  - Clickable: opens a small popover showing what was saved
  - In settings: link to "View all memories" (future: dedicated memory management page)

---

## Phase 3: Routing & Model Selection Revolution

**Goal**: Fundamentally reimagine heuristic routing to be diverse, cache-aware, reliable, and transparent.

### 3.1 Provider Coverage Expansion
- **Problem**: Always the same candidates (Seed, Claude, Gemini). Missing OpenAI, Mistral, MiniMax, Moonshot, Z.ai
- **Files**: `convex/catalogSync.ts`, `convex/curatedModelRegistry.ts`, `src/lib/routing/heuristic.ts`
- **Implementation**:
  - Expand curated model registry with models from all major providers
  - Add provider diversity as a first-class routing signal
  - Curated tiers (illustrative examples — **never hardcode specific models**; tiers are populated dynamically from catalog sync):
    - **Budget heroes**: e.g. DeepSeek V3.x, Qwen 3.x, Seed 2.x, Gemma — whatever is cheapest and capable at any given time
    - **Balanced**: e.g. GPT-4o-mini class, Claude Haiku class, Gemini Flash class, Mistral Small class
    - **Premium**: e.g. GPT-4o class, Claude Sonnet class, Gemini Pro class, DeepSeek R1 class
    - **Heavy**: e.g. Claude Opus class, GPT-5 class, Gemini Ultra class (gated by cost cap)
  - **Note**: Model landscape changes rapidly. Tier assignment must be derived from catalog pricing + capability scores, not from a hardcoded list. New models entering the catalog auto-slot into the correct tier.
  - Each tier: minimum 4 different providers represented

### 3.2 Diversity Scoring
- **Problem**: Same models chosen repeatedly; scores feel unreliable
- **Files**: `src/lib/routing/phase-router.ts`
- **Implementation**:
  - Add `recentModelUsage` tracking (last 20 requests per user, stored in session/memory)
  - Diversity penalty: if model was used in last 3 requests, apply 0.7x score multiplier; last 5: 0.85x; last 10: 0.92x
  - Provider diversity: if same provider used in last 2 requests, apply 0.8x multiplier
  - **Exceptions** (no diversity penalty applied):
    - User explicitly pins a model (manual mode)
    - Model supports prompt caching AND cache is not stale (conversation has recent messages within cache TTL, typically < 5 min, and history has not been compacted since last use)
  - Surface the diversity logic in route trace so user can see why a different model was chosen

### 3.3 Cache-Aware Prioritization
- **Problem**: If a model has cached tokens from recent conversation, it should be prioritized (lower latency, lower cost)
- **Files**: `src/lib/routing/phase-router.ts`, `src/lib/openrouter.ts`
- **Implementation**:
  - Track which model was last used per conversation
  - If conversation has recent messages (< 5 min) with same model, apply 1.3x boost (cache likely warm)
  - If conversation history was compacted, cache is stale — no boost
  - OpenRouter supports prompt caching for some models; track which models support it
  - Include cache-awareness in route trace explanation

### 3.4 Scoring Overhaul
- **Problem**: Current scoring (reliability, latency, freshness) produces unreliable results; lane weights feel arbitrary
- **Files**: `src/lib/routing/phase-router.ts:87-244`
- **Implementation**:
  - Replace lane system (stable/fresh/challenger) with a unified weighted score:
    ```
    score = (0.30 * capability_match)
          + (0.25 * cost_fit)
          + (0.15 * reliability)
          + (0.10 * latency_fit)
          + (0.08 * diversity)
          + (0.07 * cache_bonus)
          + (0.05 * freshness)
    ```
  - `capability_match`: How well the model's capabilities match the request requirements (vision, reasoning, code, search)
  - `cost_fit`: How well the model's cost fits the tier budget
  - Normalize all scores to 0-1 range
  - Add randomized exploration: with 10% probability, boost a random non-top candidate by 1.5x (prevents lock-in)
  - Show full scoring breakdown in route trace

### 3.5 Prompt Interpretation for Model/Orchestration Requests
- **Problem**: User says "use GPT-4" but system doesn't listen; searching through all model names by keyword doesn't work; orchestration keywords not detected
- **Files**: `src/lib/orchestrator/route-plan.ts`, `src/lib/auto-settings.ts`
- **Implementation**:
  - Add explicit intent detection for model requests: "use [model]", "switch to [model]", "try [model]"
  - Fuzzy match against model names/aliases (GPT-4 → openai/gpt-4o, Claude → anthropic/claude-sonnet)
  - If match found: override router mode to manual for that request
  - For orchestration: detect "use multiple models", "collaborate", "get different perspectives"
  - Surface what was detected in route trace

### 3.6 Cost Cap Enforcement
- **Problem**: 30/M cap not consistently enforced; budget not hard-enforced during streaming
- **Files**: `src/lib/model-selection.ts:156-168`, `src/lib/orchestrator/pipeline-controller.ts:166-236`
- **Implementation**:
  - Strict 30/M input+output cap for automatic routing (no exceptions)
  - Manual selection: warn if model exceeds 30/M, require explicit confirmation
  - During streaming: track cumulative token usage. If multi-agent total exceeds budget by 150%, abort remaining specialists
  - Add `usageBudgetRemaining` to pipeline state, decrement as tokens arrive

### 3.7 Parallel Specialist Execution
- **Problem**: Multi-agent specialists run sequentially (5x latency)
- **Files**: `src/lib/orchestrator/streaming.ts:237`, `src/lib/orchestrator/task-graph.ts`
- **Implementation**:
  - Build dependency DAG from task graph
  - Independent specialists (no `dependsOn` overlap) execute in parallel via `Promise.all`
  - Dependent specialists wait for their dependencies
  - Cap concurrent specialists at 3 (balance between speed and cost)
  - Stream specialist progress to UI in real-time (which specialists are active)

### 3.8 Token Count Accuracy
- **Problem**: Simple prompts show 3500+ tokens because the system prompt is bloated with mode rules, memory, skills, and guidelines even for trivial requests. This is the real issue — not display, but actual waste.
- **Root cause**: System prompt tiering (Phase 1.6) is the primary fix. With a T0 system prompt < 400 tokens, simple requests will show reasonable token counts.
- **Implementation**:
  - Display actual token usage from API response, not estimated
  - Separate display: "Input: X tokens | Output: Y tokens" (not combined)
  - For context: show what contributed to input (system prompt, history, memory, sources) — helps debug why tokens are high
  - Token count always visible to all users (no toggle/hiding — transparency matters)

### 3.9 New Model Onboarding & Challenger Lane
- **Problem**: When new models appear in the catalog (via catalog sync), they have no reliability/latency data. They need a path to get tested without destabilizing routing for all users.
- **Implementation**:
  - **Challenger lane**: New models (< 5 total runs across all users) are flagged as `challenger`
  - Challengers are eligible for selection but only when:
    - The request is low-stakes (T0/T1 tier, simple question)
    - Random exploration roll succeeds (10% probability from 3.4)
    - No other model with warm cache is available for this conversation
  - **Light offline evaluation loop**:
    - After each response from a challenger model, store quality signals: finish_reason, user feedback (thumbs), response length, latency
    - Weekly batch job: compute reliability + latency scores for challengers that have accumulated 5+ data points
    - If reliability > 0.6 after 12 runs: promote to normal routing pool
    - If reliability < 0.3 after 12 runs: demote to deprioritized (0.3x score multiplier, not fully removed)
  - **Catalog sync**: New models from OpenRouter catalog automatically enter as challengers. No manual curation needed for entry — only tier assignment is automatic based on pricing + capabilities.
  - This ensures the routing system adapts to the model landscape over time without manual intervention, while protecting users from untested models on important requests.

---

## Phase 4: Agent Revolution

**Goal**: Make agents the primary teacher tool and a powerful student tool. Guided creation, resource-aware, auto-routed.

### 4.1 Guided Agent Creation Wizard
- **Problem**: Agent creation is too simple; doesn't feel like it could work
- **Files**: `src/app/agents/new/page.tsx`, `convex/agents.ts`
- **Implementation**:
  - Multi-step wizard:
    1. **Identity**: Name, subject area, grade level, description
    2. **Resources**: Upload files (mark schemes, specs, textbooks, exam papers). Real-time processing status.
    3. **Behavior**: Generated system prompt from uploaded resources (using cheap model). User can review and edit.
    4. **Capabilities**: Select tools (search, flashcard generation, quiz creation, document generation, diagram creation)
    5. **Access**: Private (student's own), class (shared with class), school (all students)
    6. **Preview**: Test conversation with the agent before publishing
  - Auto-generate from resources: parse uploaded files to extract:
    - Topic map (what subjects/units are covered)
    - Rubric hints (grading criteria)
    - Misconceptions (common errors)
    - Key vocabulary
    - Exam format/structure
  - Store extracted metadata in agent schema for routing

### 4.2 Agent Auto-Routing Integration
- **Problem**: Agents are not considered during routing; user must manually select
- **Files**: `src/lib/orchestrator/route-plan.ts`, `src/lib/orchestrator/pipeline.ts`
- **Implementation**:
  - When user sends a message in general/auto mode:
    1. Check user's available agents (school + personal)
    2. Match message content against agent topic maps (keyword + semantic similarity)
    3. If strong match (score > 0.7): auto-select agent and notify user ("Using Physics Agent for this question")
    4. If moderate match (0.4-0.7): suggest agent ("This seems related to Physics. Want to use your Physics Agent?")
    5. If no match: proceed without agent
  - Agent context injection: when agent is active, include its system prompt, resources, and topic map in pipeline
  - Agent-specific model preferences: if agent has `modelAllowlist`, filter routing candidates

### 4.3 Agent Resource Processing
- **Problem**: Agents should hold and use files/resources (specs, mark schemes, etc.)
- **Files**: `convex/resources.ts`, `convex/rag.ts`, `convex/agents.ts`
- **Implementation**:
  - Agents get their own resource scope (already partially exists: `scope: "agent"`)
  - Resources uploaded during wizard flow get processed through ingestion pipeline
  - Agent RAG: when agent is active, retrieval scoped to agent's resources first, then fallback to general
  - Agent topic map used to filter RAG results (only chunks matching agent's domain)
  - Max 20 resources per agent (teachers can update/replace)

### 4.4 Student Agent Creation
- **Problem**: Students should also create agents for their own needs
- **Implementation**:
  - Students can create private or public agents
  - Private: only the creator can use them
  - Public: visible to all students in the school (moderated by school admin)
  - Student agents have simpler wizard (skip some teacher-specific steps)
  - Student agents limited to 5 resources each
  - Example use cases: "My Essay Helper", "Math Homework Agent", "Language Practice Agent"

### 4.5 Agent Dropdown Redesign
- **Problem**: Agent dropdown is too simple; doesn't feel powerful
- **Files**: `src/components/chat/chat-composer.tsx` (agent selector section)
- **Implementation**:
  - Grid layout with agent cards (not a flat list)
  - Each card: avatar, name, subject tag, resource count, usage count
  - Sections: "Recommended" (auto-detected from recent activity), "School Agents" (teacher-created), "My Agents" (student-created), "All Agents"
  - Search and filter by subject
  - Quick-create button at the bottom
  - Show when agent was last updated

---

## Phase 5: Artifacts Workspace (Signature Feature)

**Goal**: Build the living workspace that is Spectra's core differentiator. This replaces images, flashcards, bookmarks, and achievements with a unified, multi-view, version-tracked artifact system.

### 5.1 Artifact Schema & Types
- **Files**: `convex/schema.ts` (prepared in Phase 1.8)
- **Artifact types**:
  ```
  study_plan    — Structured plan with timeline, milestones, tasks
  timetable     — Weekly/daily schedule with slots
  note          — Rich text note with formatting
  flashcard_deck — Collection of flashcards with spaced repetition data
  document      — Generated DOCX/PDF/PPTX
  code_project  — Code with preview capability
  diagram       — tldraw canvas or Mermaid
  image         — Generated or uploaded image
  bookmark      — Saved message or external link
  collection    — Container grouping other artifacts
  ```
- **Schema details**:
  ```
  artifacts: {
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
    type: v.string(),  // artifact type enum
    title: v.string(),
    content: v.any(),  // JSON structure varies by type
    layout: v.optional(v.any()),  // canvas position, section, group
    tags: v.optional(v.array(v.string())),
    linkedAgentId: v.optional(v.id("agents")),
    linkedChatId: v.optional(v.id("chats")),
    status: v.string(),  // "active" | "archived"
    pinnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  }
  artifactVersions: {
    artifactId: v.id("artifacts"),
    diff: v.any(),  // JSON patch (RFC 6902) for storage efficiency
    snapshot: v.optional(v.any()),  // full snapshot every 10th version
    authorType: v.string(),  // "user" | "agent" | "system"
    authorAgentId: v.optional(v.id("agents")),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    description: v.optional(v.string()),  // "Updated study plan based on today's session"
    createdAt: v.number()
  }
  ```

### 5.2 Artifacts Page — Multi-View Architecture
- **New route**: `/artifacts` (replaces `/images`, `/flashcards`, `/bookmarks`, `/achievements`)
- **Views** (togglable):

  **A. Structured Canvas (Default)**
  - tldraw-powered canvas with predefined layout zones
  - Artifacts rendered as cards on the canvas
  - Cards can be dragged to reposition within zones
  - Zones: "Active Projects", "Study Tools", "Recent", "Archived"
  - Cards show: type icon, title, last updated, linked agent badge
  - Click card: opens artifact editor/viewer
  - Not fully freeform — auto-layout within zones with manual override
  - Smooth, polished navigation with zoom/pan controls

  **B. Timeline View**
  - Chronological vertical timeline of artifact creation and updates
  - Each entry: artifact card with version diff summary
  - Filter by type, agent, date range
  - Shows progression: "Created Study Plan → Updated after Physics session → Added new milestones"

  **C. Workspace Sections View**
  - Collapsible sections organized by type
  - "Active Projects" (pinned artifacts at top)
  - "Study Plans & Timetables"
  - "Notes & Documents"
  - "Flashcard Decks"
  - "Generated Media" (images, diagrams, code)
  - "Saved Items" (bookmarks)
  - Grid layout within each section

  **D. Graph View**
  - Relationship graph showing connections between artifacts
  - Nodes: artifacts. Edges: shared agent, shared conversation, shared topic tags
  - Powered by React Flow or tldraw in graph mode
  - Click node: preview artifact. Double-click: open editor.
  - Useful for understanding how study materials connect

### 5.3 Artifact Creation Flows
- **From chat**: When the model generates structured output (document, flashcards, study plan, code), offer "Save as Artifact" button below the output
- **From agent**: Agent proposes artifact creation in chat. User confirms with button.
- **Manual**: "New Artifact" button on artifacts page. Select type, fill in details.
- **From import**: Upload a file → create an artifact of matching type
- **Auto-detection**: System detects artifact-worthy output (study plan, timetable) and suggests saving

### 5.4 Artifact Editor
- **Rich editor per type**:
  - `note`: Rich text editor (Tiptap or ProseMirror)
  - `study_plan`: Structured form with timeline, milestones, checkable tasks
  - `timetable`: Weekly grid with drag-to-fill slots
  - `flashcard_deck`: Card list with add/edit/delete, preview flip
  - `code_project`: Code editor with live preview (reuse code-canvas)
  - `diagram`: tldraw canvas (from Phase 7)
  - `document`: Read-only preview with download buttons
  - `image`: View with metadata
  - `bookmark`: Link with notes field
- **All types**: title editable, tags editable, archive/delete actions, version history panel

### 5.5 Agent-Artifact Interaction
- **How it works**:
  1. During chat, agent detects relevance to an existing artifact (by topic tags, type match, or explicit reference)
  2. Agent generates proposed changes
  3. In chat: agent says "I'd suggest updating your [Study Plan] based on what we discussed. [Update Artifact] button"
  4. User clicks button → changes applied → new version created with diff
  5. Version links back to the chat message and agent that proposed it
- **Read access**: Agents in any chat can read user's artifacts (filtered by topic relevance)
- **Write access**: Only through user confirmation (never auto-apply)
- **Implementation**:
  - New tool in the system prompt: `update_artifact` — agent outputs proposed changes in structured format
  - Frontend parses and renders the proposal with an "Apply" button
  - On apply: mutation creates new version with JSON patch diff

### 5.6 Version History & Diff Storage
- **Storage strategy**:
  - Every edit creates a `artifactVersions` entry
  - Store as JSON Patch (RFC 6902) for space efficiency
  - Every 10th version: store full snapshot (for faster reconstruction)
  - Display: timeline of versions with diff visualization
  - Restore: click any version to restore (creates new version pointing to restored state)
- **Conversation links**: Each version optionally links to `sourceChatId` and `sourceMessageId`

### 5.7 Migration from Existing Pages
- **Flashcard decks** → artifacts with type `flashcard_deck`, migrate `flashcardDecks` table data
- **Generated images** → artifacts with type `image`, migrate `images` table data
- **Bookmarks** → artifacts with type `bookmark`
- **Redirect old routes** (`/flashcards`, `/images`, `/bookmarks`) to `/artifacts?type=...`
- **Sidebar navigation**: Replace individual links with single "Artifacts" link

### 5.8 Artifacts as Memory
- **Key concept**: Artifacts serve as structured, persistent memory
- When an agent reads a user's artifacts, it gains context about ongoing work without needing conversation history
- Study plan artifacts → agent knows what the student is working on
- Flashcard decks → agent knows what the student is studying
- This reduces reliance on conversation-based memory and prevents the confusion described in IDEA.md

---

## Phase 6: Search, Sources & Research Mode

**Goal**: Replace broken SearXNG with Tavily as a selective, agentic search tool layer. Resurrect research mode. Implement proper source rendering.

### 6.1 Tavily Integration as Tool Layer
- **Files**: Replace `src/lib/orchestrator/retrieval.ts:326-477` (SearXNG + model fallback)
- **Implementation**:
  - Install `@tavily/core` SDK
  - Four Tavily tools available to the pipeline:
    - **Search**: Normal source discovery (up to 5 results). Used for time-sensitive queries, fact-checking.
    - **Extract**: Read specific page content. Used when a search result needs full reading.
    - **Crawl**: Traverse a site/section. Used only for research mode deep dives.
    - **Research**: Multi-step investigation. Used only for explicit deep research requests.
  - Tool selection logic (in route-plan.ts):
    - Simple factual question → Search (max 3 results for cost)
    - Research mode → Search + selective Extract (read top 2-3 results)
    - Deep research / explicit "research this thoroughly" → Research tool
    - "Read this URL" → Extract on that specific URL
    - Crawl: only when user explicitly asks to explore a site
  - Cost minimization:
    - Search only when `isTimeSensitive` or mode is research
    - Max 5 search results for normal queries, 8 for research
    - Extract only the top 1-2 most relevant search results
    - Never auto-crawl; crawl only on explicit user request
    - Cache search results for identical queries within 30 minutes

### 6.2 Fallback to :online Models
- **Condition**: Only when Tavily API call fails (timeout, error, key missing)
- **Implementation**:
  - Try Tavily first
  - On failure: fall back to `:online` model suffix (current behavior)
  - Never run both (prevent double costs)
  - Log fallback events for monitoring

### 6.3 Remove SearXNG Entirely
- **Files**: Remove all SearXNG references:
  - `convex/schema.ts`: Remove `searxngEnabled` from org schema (or deprecate)
  - `src/lib/orchestrator/retrieval.ts`: Remove `searxngSearch()` function
  - Any SearXNG configuration in settings/admin
  - Remove SearXNG toggle from admin UI

### 6.4 Source Rendering: Inline Pills + Source Blocks
- **Problem**: Sources not rendered inline; only icon visible; live sources shown (should be removed)
- **Implementation**:
  - **Inline source pills**: Superscript numbered badges within text (e.g., "The war ended in 1945[1]")
    - On hover: show source card (favicon, title, domain, snippet)
    - On click: open source URL in new tab
  - **Source block**: Collapsible section at the bottom of the response
    - Each source: favicon, title, domain, snippet, relevance indicator
    - Sources grouped by type: "Web Sources", "From Your Files", "From Agent Resources"
  - Remove "live sources" section entirely (only show regular sources)
  - Source data structure in messages:
    ```
    citations: [{ url, title, domain, snippet, sourceType, relevanceScore, inlinePositions: [number] }]
    ```

### 6.5 Research Mode Resurrection
- **Problem**: Research mode never returns good results; orchestration not available
- **Implementation**:
  - Research mode pipeline:
    1. Parse research question → extract sub-questions
    2. Tavily Search for each sub-question (parallel, max 3 sub-questions)
    3. Tavily Extract on top 2 results per sub-question
    4. Synthesize findings with source attribution
    5. Include "Source Reliability" assessment per source
  - Enable multi-agent orchestration for research mode:
    - `web_researcher` specialist uses Tavily
    - `fact_checker` specialist cross-references claims
    - `synthesizer` merges findings
  - Research mode output format: structured sections with inline citations, conclusion, further questions

### 6.6 Clarification Questions Improvement
- **Problem**: Pre-research clarification questions are always the same and generic; UI doesn't persist on reload
- **Implementation**:
  - Generate clarification questions based on the actual prompt (using cheap model), not from a fixed list
  - Make them specific and useful: "Which aspect of climate change? (causes / effects / policy / specific region)"
  - Prefer multiple-choice format for quick selection
  - Persist clarification state in chat messages (not just ephemeral UI state)
  - Limit to 2-3 questions max; don't ask if prompt is already specific enough

### 6.7 Route Trace Visibility for Search
- **Implementation**:
  - Show in route trace: which Tavily tool was called, with what query, how many results
  - Show: which results were selected for extraction
  - Show: cost of search operation
  - Show: whether search was triggered by heuristic or user request

---

## Phase 7: Visualizations, Preview & Diagrams

**Goal**: Integrate tldraw, fix Mermaid, implement adaptive preview, and add automatic diagram detection.

### 7.1 tldraw SDK Integration
- **Files**: New component, integrated into artifacts and chat
- **Implementation**:
  - Install `tldraw` package
  - Create `<DiagramCanvas>` component wrapping tldraw editor
  - Use `useTldrawAgent(editor)` for AI-generated diagrams
  - Diagram generation flow:
    1. LLM outputs diagram spec as JSON: `{ nodes: [...], edges: [...], layout: "..." }`
    2. Converter transforms spec into tldraw shapes
    3. tldraw renders the diagram
  - Student interaction: click and drag elements, add annotations, ask AI to modify
  - Export: SVG, PNG for assignments
  - Integration points:
    - In artifacts page: diagram artifacts use tldraw
    - In chat: complex diagrams open in tldraw canvas
    - In graph view: artifacts page graph uses tldraw or React Flow

### 7.2 Adaptive Preview System
- **Problem**: Split preview is disliked; preview should be default; no simultaneous code+preview for simple items
- **Files**: `src/components/chat/code-preview.tsx`, `src/components/chat/markdown-renderer.tsx`
- **Implementation**:
  - **Simple renderable code** (Mermaid, short HTML, simple CSS):
    - Show preview by default (not code)
    - Toggle button: "Show Code" / "Show Preview"
    - Preview inherits chat background (no white background in dark mode)
    - No top bar — just the rendered output
    - Expand/reset buttons in the main code block header (not in a sub-bar)
  - **Complex code** (long HTML, React components, multi-file):
    - Show code in chat with "Open in Canvas" button
    - Canvas: fullscreen tldraw/code-canvas with editor + preview side by side
  - **Complexity threshold**: >30 lines or imports React/external libs → canvas; else inline preview
  - No split preview in chat — always one or the other

### 7.3 Mermaid Stability Fixes
- **Problem**: Things shift during generation; syntax errors; flickering when typing in search bar
- **Files**: `src/components/chat/mermaid-preview.tsx`, `src/components/chat/markdown-renderer.tsx`
- **Implementation**:
  - Don't re-render Mermaid until the code block is complete (detect closing ```)
  - During streaming: show skeleton placeholder with estimated height
  - After complete: render once with `mermaid.render()`
  - Syntax error handling: catch render errors, show "Diagram has syntax issues" with the raw code as fallback
  - Fix search bar flicker: memoize Mermaid renders with `React.memo` + stable keys; search bar state changes should not trigger message re-renders

### 7.4 Automatic Diagram Detection
- **Implementation**:
  - Add lightweight classifier in post-processing (runs on cheap model):
    - Input: assistant response text
    - Output: { shouldDiagram: boolean, diagramType: "flowchart" | "timeline" | "comparison" | "hierarchy" | "concept_map", suggestedContent: string }
  - Trigger conditions (heuristic, no model call needed):
    - Process explanations with 3+ sequential steps
    - Comparisons of 3+ items
    - Hierarchical structures (taxonomy, organization)
    - Timeline of events
    - Cause-effect chains
  - When triggered: append diagram below the text response
  - Frequency limit: max 1 auto-diagram per 5 messages (don't overdo it)

### 7.5 Preview Background Fix
- **Problem**: Preview sits on white background, clashes with dark mode
- **Implementation**:
  - Preview container: `background: var(--bg-primary)` (inherits theme)
  - For HTML previews that need white background (e.g., documents): wrap in iframe with its own styles
  - Mermaid: configure mermaid theme to match dark/light mode

### 7.6 Canvas/Preview Extra Space Fix
- **Problem**: Canvas and route trace panels have lots of blank space at the right
- **Implementation**:
  - Panel content: `width: 100%` with proper padding
  - Remove any fixed-width constraints on panel content
  - Route trace and canvas should use full panel width

---

## Phase 8: Memory & Personalization (Mem0)

**Goal**: Replace the current custom memory system with Mem0 for better relevance, less confusion, and hybrid search.

### 8.1 Mem0 Integration — Real Migration on Convex/Vercel
- **Research findings**: Mem0 delivers 26% accuracy uplift over OpenAI's memory, 91% latency reduction, 90% token reduction
- **Commitment**: Full Mem0 integration, not partial. The current custom memory system is replaced.
- **Architecture** (no extra hosting costs — runs on existing Convex + Vercel):
  - Use `mem0` npm package as a library within Convex actions (not as a separate hosted service)
  - Mem0's storage backend: configure to use Convex as the underlying store (custom adapter)
    - Mem0 needs a vector store → use Convex's existing vector indexes on `userMemoryEntries`
    - Mem0 needs a graph store → use a new `memoryGraph` Convex table for entity relationships
    - Mem0 needs a KV store → use existing `userMemoryEntries` with category-based key structure
  - Mem0's LLM calls: route through OpenRouter (same API key, same infrastructure, no extra cost beyond normal token usage)
  - **Migration path**:
    1. Create Convex adapter for Mem0's storage interfaces
    2. Migrate existing `userMemoryEntries` data into Mem0-compatible format
    3. Replace `routeMemoryWrite` and `retrieveRelevantEntries` with Mem0's `add()` and `search()`
    4. Deprecate legacy `userMemory` table
  - **What Mem0 gives us that the current system doesn't**:
    - Hybrid graph+vector+KV retrieval (not just vector)
    - Automatic entity extraction and relationship tracking
    - Built-in contradiction detection and memory merging
    - Configurable memory types with different retention policies
    - Battle-tested deduplication (not fingerprint-based race condition)

### 8.2 Hybrid Search Implementation
- **Problem**: Current vector-only search misses keyword-exact matches
- **Implementation**:
  - Add BM25 scoring alongside vector search for memory retrieval
  - Reciprocal Rank Fusion to merge results:
    ```
    RRF_score = Σ 1/(k + rank_i) for each retrieval method
    ```
    where k = 60 (standard constant)
  - Apply to both memory entries and RAG chunks
  - Expected improvement: 15-30% better recall

### 8.3 Relevance Threshold & Scoring
- **Problem**: Current threshold 0.52 too low, allows irrelevant memories
- **Implementation**:
  - Raise minimum threshold from 0.52 to 0.65
  - Three-factor scoring:
    - `relevance` (0.6 weight): cosine similarity from vector search
    - `recency` (0.25 weight): exponential decay from last access/update
    - `importance` (0.15 weight): LLM-rated significance score (1-10) assigned at storage time
  - Max 5 memory entries injected per turn (down from unlimited)
  - Category-based injection strategy:
    - `identity` + `preference`: Always inject (system prompt, max 3 entries)
    - `academic` + `topic`: Inject only when relevance > 0.7 (max 2 entries)
    - `correction`: Inject when same topic recurs (high importance weight)
    - `artifact`: Never auto-inject — agent reads artifacts directly

### 8.4 Contradiction Detection
- **Problem**: Old memories persist even when user's preferences change
- **Implementation**:
  - Before storing new memory: check existing memories in same category
  - If semantic similarity > 0.8 with existing entry but content differs: mark old entry as superseded
  - Store new entry with reference to superseded entry
  - Display in memory management: "Updated: [old] → [new]"

### 8.5 Memory Extraction Improvement
- **Problem**: Current heuristic extraction (regex) misses most preferences
- **Implementation**:
  - Use cheap model for memory extraction (every N messages, not every message):
    - Run extraction every 3rd assistant response (not every one)
    - Input: last 3 exchange pairs
    - Output: new memory entries with category and importance score
  - Extraction prompt: focused on durable preferences, goals, and corrections
  - Filter: ignore one-off tasks (current regex is too narrow — expand but keep the filter)

### 8.6 Memory Update Visibility
- **Connects to Phase 2.14**
- User can see updated memories (route/page for memory management)
- Each memory shows: content, category, importance, last updated, source conversation
- User can edit, delete, or archive memories
- Experimental nature acknowledged in UI: "Memory is experimental — you can review and edit what's saved"

### 8.7 Artifacts as Structured Memory
- **Key integration**: When agents need context about a student's ongoing work, they read artifacts instead of injecting conversation-based memory
- This prevents the IDEA.md confusion scenario: asking about Brawl Stars shouldn't trigger WW2 context
- Artifacts are accessed by relevance to the current query topic, not injected wholesale

---

## Phase 9: UI Polish, Dropdowns & Design System

**Goal**: Fix all remaining IDEA.md UI issues. Redesign dropdowns, slash commands, and visual polish.

### 9.1 Mode Dropdown Redesign
- **Problem**: Should be grid blocks like landing page, not a flat list
- **Files**: `src/components/chat/chat-mode-selector.tsx`
- **Implementation**:
  - Grid layout (3 columns) with mode cards
  - Each card: mode icon, name, brief description (1 line)
  - Scrollable if more than 9 modes
  - Card size: compact but readable
  - Mode color indicator on each card
  - Active mode highlighted with border

### 9.2 Model Dropdown Redesign
- **Problem**: Needs provider sidebar with icons; many providers missing icons; search should work
- **Files**: `src/components/chat/` (model selector)
- **Implementation**:
  - Left sidebar: provider icons vertically stacked
    - Top: Star icon = "Recommended" (default view)
    - Then: Providers ranked by popularity (OpenAI, Anthropic, Google, Meta, DeepSeek, Mistral, etc.)
    - Hover on icon: tooltip with provider name
  - Right area: model list filtered by selected provider
  - Search bar at top: filters across all providers
  - Model cards: name, cost indicator, capability tags (vision, reasoning, code)
  - Missing provider icons: create simple fallback icons (first letter of provider name in colored circle)
  - Selection behavior: clicking a model changes selection (replaces). Ctrl+click adds to selection (for multi-model experiments)

### 9.3 Model Page Redesign
- **Problem**: Two models per row is too wide; should be three
- **Files**: `src/app/models/page.tsx`
- **Implementation**:
  - 3 models per row at 1080p, 4 at 1440p
  - Left sidebar: provider icons (same as dropdown but larger, showing text if space allows)
  - Right: leaderboard (keep existing)
  - Model cards: narrower, denser information
  - "Use Model" button: navigate to `/chat?model=...&router=manual` (fix from Phase 1.5)

### 9.4 Slash Command Improvements
- **Problem**: User types commands but doesn't know how to execute; needs to manually type model IDs
- **Files**: `src/components/chat/slash-command-menu.tsx`, `src/components/chat/chat-layout.tsx:321-395`
- **Implementation**:
  - When `/` is typed: show command menu in the dynamic bar above the search field
  - For `/model`: show model picker inline (same as dropdown)
  - For `/mode`: show mode grid inline
  - For `/search`: show toggle (on/off/auto) as buttons
  - For `/agent`: show agent picker inline
  - For `/export`: show format options (markdown, pdf, text)
  - Pressing Enter on a command with options: expand the option picker, don't try to send

### 9.5 Dynamic Search Bar (Dynamic Island Concept)
- **Problem**: Top part of search bar should be dynamic and show contextual extensions
- **Files**: `src/components/chat/chat-composer.tsx`
- **Implementation**:
  - Above the textarea: a contextual strip that shows relevant info:
    - Active agent badge (if agent selected)
    - Active mode badge (if not default)
    - File attachment thumbnails (if files attached)
    - Slash command options (if / typed)
    - Search status (if search active)
  - Strip is minimal, small, and only shows when relevant
  - Smooth expand/collapse animation
  - Think of it as a "context bar" that shows what's active

### 9.6 Table Layout Fix
- **Problem**: Some columns too wide, others too narrow; text overflows
- **Files**: `src/components/chat/markdown-renderer.tsx` (table rendering)
- **Implementation**:
  - Use `table-layout: auto` with `max-width: 100%` and `overflow-x: auto` for wide tables
  - Set sensible `min-width` for columns based on header text length
  - Long text cells: wrap with `word-break: break-word`, not overflow
  - Responsive: on narrow screens, tables scroll horizontally with subtle scroll indicator

### 9.7 Custom Color Theme Fix
- **Problem**: Primary/secondary is for school branding; user theme should be single color selection
- **Files**: `src/app/globals.css`, theme picker component
- **Implementation**:
  - User theme picker: single color selection (not primary/secondary)
  - Selected color generates a palette automatically:
    - Accent: the selected color
    - Accent-hover: 10% lighter
    - Accent-muted: 30% opacity
  - Adjust intensity and alpha automatically — no glaring colors
  - Preset palettes: keep slate, zinc, rose but fix pink (too glaring → reduce saturation)
  - School branding (primary/secondary) stays separate — admin-only setting

### 9.8 Feedback System Overhaul
- **Problem**: No auto-screenshots; feedback unordered; no toggle/star/filter
- **Files**: `src/components/feedback-widget.tsx`, `src/app/super-admin/feedback/page.tsx`
- **Implementation**:
  - Auto-screenshot: use `html2canvas` with `allowTaint: false` (already fixed in PREV.md)
    - Capture on feedback open (not on submit — captures the issue state)
    - Compress to 60% quality, max 1MB
  - Feedback management (super-admin):
    - Sort by: date, category, status
    - Status: new, reviewed, starred, shipped, dismissed
    - Star/toggle individual feedback items
    - Filter: "Show unresolved only" toggle
    - Bulk actions: mark as shipped, dismiss
    - Export: bullet-pointed list of non-shipped feedback (copyable)

### 9.9 Animation Improvements
- **Problem**: Model selection moment and similar transitions need cool but brief effects
- **Implementation**:
  - Model determined: subtle shimmer/pulse on the model badge (200ms)
  - Agent activated: brief glow on agent badge
  - Artifact created: success animation on the card (scale 1.02 → 1.0, 300ms)
  - Achievement unlocked: existing style (already good per IDEA.md)
  - Don't overdo: all effects < 400ms, no bounce, no physics simulations

### 9.10 Remaining UI Fixes
- **Chat search field**: Remove 2-3px of margin (make slightly wider)
- **Feedback tab**: Don't highlight super-admin tab when on feedback
- **Outdated settings**: Remove completely (old right panel, manage account buttons)
- **Last sidebar button**: Fix clipping with proper padding and mask gradient adjustment

---

## Phase 10: Analytics & Gamification Hub

**Goal**: Merge achievements with analytics into a unified hub. Fix dashboard layout.

### 10.1 Analytics + Achievements Hub
- **New route**: `/hub` (replaces `/analytics` and `/achievements`)
- **Layout**:
  - Top strip: XP total, current streak (animated), level/rank
  - Main area: tabbed sections
    - "Activity": usage chart, mode breakdown, session history (existing Recharts components)
    - "Achievements": grid of earned/unearned achievements with progress bars
    - "Stats": subject breakdown, model usage distribution, token consumption
  - Sidebar/right area: recent milestones, next achievements close to unlock

### 10.2 Dashboard Study Studio Card Fix
- **Problem**: "Study Studio" top card too big; streak/XP badges should be in the same row
- **Files**: dashboard component
- **Implementation**:
  - Inline stat strip: streak, XP, level in a single row
  - Remove the oversized container card
  - Use `divide-x` separator style (per SKILL.md conventions)

---

## Phase 11: Testing & Verification Strategy

### 11.1 End-to-End Test Scenarios
- Full chat flow: send message → routing → model selection → streaming → persistence → title generation
- Artifact flow: generate in chat → save as artifact → edit → version history → agent reads artifact
- Agent flow: create agent with resources → auto-route to agent → agent uses resources in response
- Search flow: time-sensitive query → Tavily search → sources rendered inline → source pills clickable
- Memory flow: user states preference → memory saved → future query uses memory → memory visible in settings
- File flow: upload file → process → use in RAG → 7-day expiry → cleanup
- Branch flow: edit message → create branch → navigate between branches
- Compaction flow: long conversation → compact → summary preserved → continue chatting

### 11.2 Edge Case Testing
- Model returns `finish_reason: "length"` → auto-continuation works
- Tavily API down → :online fallback kicks in
- OPENROUTER_API_KEY missing → graceful degradation
- Very long conversation (100+ messages) → compaction + performance
- Concurrent artifact edits from chat + manual
- User switches chat while streaming → partial response saved
- Dark mode on every component
- Mobile responsive on every page

### 11.3 Performance Benchmarks
- Time to first token: < 2 seconds for T0/T1 requests
- Full response time: < 10 seconds for simple questions
- Artifact page load: < 1 second
- Memory retrieval: < 500ms
- Search (Tavily): < 2 seconds
- Auto-scroll: 60fps during streaming

---

## Additional Issues Found (50+ beyond IDEA.md)

### From Orchestration Analysis
1. RAG failure silently returns fallback — should warn user when no sources found despite expecting them
2. No circuit breaker for model failures — same failing model retried immediately
3. Memory extraction NLP too narrow (regex only matches "prefer", "goal", "struggle")
4. Cost budget not hard-enforced during multi-agent streaming — can exceed declared budget
5. Mode fallback to "general" loses pedagogical structure without warning
6. Quiz/flashcard format validation is client-side only — malformed output passes through
7. Thinking level parameter doesn't actually enable extended thinking in models that support it
8. Agent guidelines topic map not used to filter RAG results
9. No artifact resource cleanup/retention policy
10. Max tokens per mode are hardcoded — should adapt to model's context window

### From Frontend Analysis
11. Auto-scroll race condition during heavy streaming
12. Panel history limited to 10 entries — could overflow on complex interactions
13. Canvas panel auto-collapses sidebar unexpectedly
14. Mobile composer can be covered by keyboard
15. Chat title rename has no loading state during API call
16. Flashcard SM-2 quality rating mappings non-intuitive (1, 0, 2, 4, 5)
17. No request deduplication — double-click sends two requests
18. No rate limiting on client-side message sending
19. Toast notifications don't persist or have history
20. No keyboard shortcuts for common chat actions beyond Cmd+K

### From Backend Analysis
21. Memory fingerprint deduplication is not atomic — race condition with concurrent writes
22. `negativeTopicLinks` array grows unbounded (up to 12 items, no cleanup)
23. No hybrid search (BM25 + vector) — vector-only misses keyword matches
24. Resource processing is serial in cron job — no parallelization
25. Message branching parent/sibling tracking has no foreign key constraints
26. Orphaned chunks possible if resource deletion doesn't cascade properly
27. No bulk mutation API for resources — each upload is separate
28. Content deduplication via `contentHash` exists in schema but is unused
29. Chat listing by pack requires full scan — missing index
30. Vector search returns topK*8 then filters — wastes compute on irrelevant results
31. Usage aggregation upsert runs in critical path on every message
32. Compaction summary is manual-only — no LLM-driven summarization
33. Embedding model change would require complete re-index of all data

### From Cross-Analysis
34. System prompt too verbose → inflates token count even for simple queries
35. No graceful handling when Convex backend is unreachable
36. No export format for artifacts (only chat has export)
37. No conversation templates or quick-start flows for new users
38. Model leaderboard based on limited internal data — not very useful
39. No A/B testing infrastructure for routing experiments
40. No observability dashboard for pipeline health metrics
41. Research mode has no structured output format (unlike quiz/flashcard)
42. No progressive loading for very long conversations
43. Agent resources are not versioned — teacher updates replace without history
44. No collaborative features (sharing artifacts between students)
45. Missing breadcrumb navigation on nested admin pages
46. No error boundary recovery UX — errors crash the whole page
47. Custom theme picker complexity (primary/secondary) doesn't match user mental model
48. No way to "pin" a model for the rest of a conversation
49. Clarification questions are generic and repetitive across sessions
50. No semantic caching of embeddings for repeated queries
51. Provider icon coverage is incomplete — many show generic fallback
52. No diff view for comparing artifact versions
53. Study reminders cron generates at fixed time — not timezone-aware
54. Generated documents (DOCX/PDF/PPTX) lack design consistency
55. No telemetry for measuring actual learning outcomes

---

## Phase Dependency Graph

```
Phase 1 (Foundation) ──────────────────────────────┐
    │                                               │
    ├── Phase 2 (Chat UX) ─────────────────────────┤
    │       │                                       │
    │       ├── Phase 9 (UI Polish)                 │
    │       │                                       │
    ├── Phase 3 (Routing) ─────────────────────────┤
    │       │                                       │
    │       ├── Phase 4 (Agents) ──────────────────┤
    │       │       │                               │
    │       │       └── Phase 5 (Artifacts) ◄──────┘
    │       │               │
    │       ├── Phase 6 (Search/Sources)
    │       │
    │       └── Phase 7 (Visualizations)
    │
    ├── Phase 8 (Memory/Mem0) ── depends on Phase 1 + Phase 5
    │
    ├── Phase 10 (Analytics Hub) ── depends on Phase 5
    │
    └── Phase 11 (Testing) ── final, after all phases
```

---

## Priority Order (what closes the gap fastest)

1. **Phase 1** — Nothing works reliably without this
2. **Phase 2** — Users see and feel this immediately
3. **Phase 3** — Routing quality defines the AI experience
4. **Phase 4** — Agents are the teacher value proposition
5. **Phase 6** — Search/research currently non-functional
6. **Phase 5** — The signature differentiator (depends on 4)
7. **Phase 7** — Visualizations enhance everything
8. **Phase 8** — Memory quality improves over time
9. **Phase 9** — Polish and visual refinement
10. **Phase 10** — Hub consolidation
11. **Phase 11** — Ongoing verification
