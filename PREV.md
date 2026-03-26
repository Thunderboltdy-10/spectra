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

## Stabilization Pass (March 26, 2026)

### Why this pass was done
- This plan is being stopped early to prepare a new workstream-first architecture.
- The goal of this pass was not new feature design. It was to harden foundational pieces that will survive the redesign: routing, search, agents, reliability, security, and admin recoverability.

### Implemented in this pass (backbone-safe)
- [x] Fixed build-blocking pipeline typing issue in `src/lib/orchestrator/pipeline.ts` (`webResult.strategy` union mismatch).
- [x] Fixed artifact editor autosave dropping metadata-only edits (title/tags) in `src/components/artifacts/artifact-editor.tsx`.
- [x] Enabled restoring non-snapshot artifact versions in version history UI (backend path already supported).
- [x] Added HTML sanitization before document preview injection to close stored XSS path (`src/lib/sanitize-html.ts`, wired in artifact editor).
- [x] Improved phase-router model selection diversity and complexity-aware weighting in `src/lib/routing/phase-router.ts` (less repeated provider/model lock-in).
- [x] Added quick-reply routing bias for true T0 requests in `src/lib/routing/phase-router.ts` (favor fast/mini/flash class models over heavy reasoning variants).
- [x] Added text-first penalty for image-tuned models in non-image chat routing (`src/lib/routing/phase-router.ts`) to prevent normal chat turns from selecting image-specialized models.
- [x] Disabled online-model fallback for research-only search strategies when Tavily fails (`src/lib/orchestrator/retrieval.ts`) to avoid unnecessary research-model spend.
- [x] Increased OpenRouter stream timeout and separated it from base timeout in `src/lib/openrouter.ts` to reduce premature interrupted runs on longer generations.
- [x] Made length auto-continuation budget-aware in `src/lib/orchestrator/streaming.ts` + pipeline wiring (simple=0, normal=1, deep=2).
- [x] Added super-admin bypass for org-active gating so platform owners cannot be locked out when org state is empty (`src/lib/auth-server.ts`).
- [x] Added super-admin platform reset operation (data wipe for runtime/workspace content while preserving core platform identity/school scaffolding) in `convex/superAdmin.ts` + `/api/super-admin/storage` + super-admin UI action.
- [x] Added/updated tests for retrieval fallback behavior, HTML sanitization, dry-run routing API behavior, and compact route integration mocks.
- [x] Verified with real commands:
  - [x] `npm run test:run` passing (191 tests)
  - [x] `npm run build` passing

### Explicitly deferred to the next plan (do not optimize here)
- [ ] Artifact-centric route/UI thesis (`/artifacts` as primary surface) and artifact-heavy UX refinements.
- [ ] Visualization/pyodide/canvas UX polish and rendering redesign.
- [ ] Large memory redesign (layering/relevance strategy) beyond essential stability fixes.
- [ ] Broad UI polish backlog from Phase 7/8/9 and Additional Issues that are likely to be replaced by workstream-first architecture.

### Carry-over focus for the next plan
- Routing quality and transparent model selection.
- Search strategy correctness (Tavily-first, bounded fallback policy).
- Agent orchestration reliability and scoped tooling.
- Core chat robustness under interruption/partial states.
- Safe reset/recovery operations for alpha environment management.

---

## Phase 1: Foundation & Infrastructure Fixes

**Goal**: Fix the broken infrastructure that everything else depends on.

### 1.1 OPENROUTER_API_KEY Error Chain ✅ Complete
- [x] **Problem**: `OPENROUTER_API_KEY missing for ingestion` when attaching files; `OPENROUTER_API_KEY missing for catalog sync` in cron jobs
- [x] **Files**: `convex/ingestQueue.ts:232`, `convex/catalogSync.ts:434`, `convex/soul.ts:106`
- [x] **Fix**: Add proper env var validation at startup. Add graceful degradation paths: lexical fallback for soul (already exists), queue-and-retry for ingestion, skip-and-warn for catalog sync. Surface clear error messages in admin UI when key is missing.

### 1.2 File Policy: 7-Day Auto-Expiry ✅ Complete
- [x] **Problem**: No retention policy for conversation-attached files; storage grows unbounded
- [x] **Files**: `convex/resources.ts`, `convex/crons.ts`
- [x] **Implementation**:
  - [x] Add `expiresAt` field to resources schema (7 days from upload for conversation files, null for My Files and agent resources)
  - [x] New cron job: `cleanup-expired-resources` (daily at 2:00 UTC)
  - [x] Cascade: delete chunks, then storage blob, then resource record
  - [x] No user warning needed (per user preference)
  - [x] Keep: My Files (scope=personal with explicit save), agent resources, pack resources

### 1.3 File Limits & Blocked Extensions ✅ Complete
- [x] **Files**: `convex/resources.ts`, `convex/ingestQueue.ts`
- [x] **Implementation**:
  - [x] Enforce max 5 files per conversation attachment
  - [x] Enforce max 25 files in My Files (already exists but verify)
  - [x] Block video extensions at upload validation: mp4, mov, avi, mkv, webm, flv, wmv
  - [x] Block unsupported: exe, dll, bin, iso, dmg, apk, ipa
  - [x] Add compaction precautions: warn if conversation has many large file contexts

### 1.4 finish_reason Handling ✅ Complete
- [x] **Problem**: `finish_reason: "length"` parsed but never communicated to UI or handled
- [x] **Files**: `src/lib/openrouter.ts:503,526,566`
- [x] **Implementation**:
  - [x] Include `finishReason` in the `type: "done"` stream event
  - [x] When `finish_reason === "length"`: auto-continue with the partial response as context, prepend "Continue from where you stopped"
  - [x] Cap at 2 continuation rounds to prevent runaway costs
  - [x] Surface subtle indicator: "Expanding response..." during continuation
  - [x] Track truncation rate per model in usage events for routing feedback

### 1.5 Manual Model Selection Fix ✅ Complete
- [x] **Problem**: "Use model" button on model page doesn't work; dropdown doesn't allow manual selection
- [x] **Files**: `src/app/models/page.tsx`, `src/components/chat/chat-composer.tsx`, chat state
- [x] **Fix**: Ensure `routerMode: "manual"` + `manualModel: selectedModelId` propagates correctly from model page to chat state. Fix the model page routing to `/chat?model=...&router=manual`.

### 1.6 System Prompt Token Bloat ✅ Complete
- [x] **Problem**: Even simple prompts show 3500+ tokens. System prompt is too verbose for simple queries.
- [x] **Files**: `src/lib/prompts/policy.ts`
- [x] **Implementation**:
  - [x] Tier the system prompt by pipeline complexity:
    - [x] T0 (simple): Base identity (50 tokens) + mode rules only
    - [x] T1 (light): + memory profile + context summary
    - [x] T2 (full): + guidelines + skills + search block + source rules
    - [x] T3 (multi-agent): Full system prompt
  - [x] Remove redundant instructions that repeat across modes
  - [x] Compress mode rules into denser format
  - [x] Target: T0 system prompt < 400 tokens, T1 < 800, T2 < 1500

### 1.7 Catalog Sync Error Fix ✅ Complete
- [x] **Files**: `convex/catalogSync.ts:434,522`
- [x] **Fix**: Guard `refreshCatalogBase` with env check. If key missing, log warning and return empty without throwing. Catalog data should degrade gracefully (use last cached data).

### 1.8 Schema Preparations for Artifacts ✅ Complete
- [x] **Files**: `convex/schema.ts`
- [x] **New tables** (designed now, populated in Phase 5):
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
- [x] **Indexes**: `artifacts.by_owner_updated`, `artifacts.by_org`, `artifacts.by_type`
- [x] **Migration path**: flashcardDecks, images, bookmarks → artifacts with type field

### 1.9 Compaction Improvements ✅ Complete
- [x] **Problem**: Manual summary only (no LLM summarization); minimum 20 messages; single compaction boundary
- [x] **Files**: `convex/compaction.ts`, `convex/chats.ts`
- [x] **Implementation**:
  - [x] Use a cheap model (via pipeline budget T0) to generate compaction summary instead of manual extraction
  - [x] Lower minimum to 12 messages
  - [x] Preserve unresolved user goals and artifact references in summary
  - [x] Add `compactionQuality` field: "manual" | "llm" | "hybrid"

### 1.10 Missing Database Indexes ✅ Complete
- [x] **Files**: `convex/schema.ts`
- [x] Add indexes:
  - [x] `messages.by_chat_created` (for efficient history loading)
  - [x] `resources.by_org_updated` (for batch processing)
  - [x] `usageEvents.by_org_model_day` (for per-model analytics)
  - [x] `artifacts.by_owner_type` (for filtered artifact views)

---

## Phase 2: Chat Experience & UX Overhaul

**Goal**: Fix every user-facing chat issue from IDEA.md. Make the core experience feel polished and reliable.

### 2.1 Auto-Scroll Fix ✅ Complete
- [x] **Problem**: During generation, scrolling up to read is almost impossible; auto-scroll fights the user
- [x] **Files**: `src/components/chat/chat-messages.tsx`
- [x] **Implementation**:
  - [x] Detect user scroll-up (any upward scroll > 20px) → exit auto-scroll mode immediately
  - [x] Add floating "scroll to bottom" button with down-arrow icon, subtle slide-in animation
  - [x] Clicking button or scrolling to within 100px of bottom → re-engage auto-scroll
  - [x] Use `IntersectionObserver` on a sentinel element at the bottom rather than scroll events
  - [x] Smooth scroll animation when re-engaging (not instant jump)

### 2.2 Message Persistence During Generation ✅ Complete
- [x] **Problem**: Refreshing during generation loses the response; interrupted output not saved; changing pages deletes streaming content
- [x] **Files**: `src/hooks/use-chat-state.ts`, `src/app/api/chats/route.ts`
- [x] **Implementation**:
  - [x] Persist partial responses to Convex every 3 seconds during streaming (debounced)
  - [x] On page change/refresh: save current draft with `cancelled: true` flag
  - [x] On return to conversation: show the partial response with "Response was interrupted" indicator
  - [x] Clicking "back" on sidebar should preserve streaming state, not kill it
  - [x] Add `beforeunload` event handler to trigger save

### 2.3 Progress State Machine ✅ Complete
- [x] **Problem**: Shows "Thinking" even when generating; "done" state never completes; progress doesn't depend on model/prompt
- [x] **Files**: `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-header.tsx`, stream phase handling
- [x] **Implementation**:
  - [x] Explicit state machine: `idle → routing → [searching] → thinking → generating → [synthesizing] → done`
  - [x] Each state has:
    - [x] Label (lowercase): "routing...", "searching...", "thinking...", "generating...", "synthesizing...", "done"
    - [x] Elapsed timer (with lowercase 's' for seconds — already noted in IDEA.md)
    - [x] Color indicator matching state
  - [x] "Done" state: trigger explicitly when stream ends AND post-processing completes (title gen, memory write, etc.)
  - [x] Show "done" for 2 seconds, then fade to idle
  - [x] Model-dependent: if model doesn't support thinking, skip "thinking" state

### 2.4 Conversation Title Generation ✅ Complete
- [x] **Problem**: Title not created consistently; should be 3-5 word summary of initial prompt
- [x] **Files**: `src/lib/orchestrator/post-process.ts`
- [x] **Implementation**:
  - [x] Always generate title after first user message, using a cheap model
  - [x] Format: 3-5 words, no quotes, no "User asks about...", just the topic
  - [x] Examples: "WW2 Flashcards for IB", "Quadratic Formula Help", "Crow Brawl Stars Paragraph"
  - [x] If title generation fails, fall back to first 5 words of user message

### 2.5 Right Panel Fixes ✅ Complete
- [x] **Problem**: Panels open with lots of empty space; default should be orchestration; auto-open has no animation; route trace is shown instead of orchestration
- [x] **Files**: `src/components/chat/unified-panel.tsx`, `src/components/chat/chat-layout.tsx:276-301`
- [x] **Implementation**:
  - [x] Default auto-open panel: orchestration (not route-trace)
  - [x] Apply same sliding animation for auto-open as manual open (use CSS transition, not instant render)
  - [x] Fix empty space: panel should use `width: fit-content` with `max-width: 420px`, not fixed width
  - [x] Route trace content should fill available width; remove right-side dead space
  - [x] Canvas panel: same fix — no blank space at right

### 2.6 Dark Mode Overhaul ✅ Complete
- [x] **Problem**: Dark mode is "horrible"; current `#13111a` too dark/purple
- [x] **Files**: `src/app/globals.css`
- [x] **Implementation**:
  - [x] Change dark mode `--bg-primary` to `#2D2D2B` (warm dark, as specified in IDEA.md)
  - [x] Adjust `--bg-secondary`, `--bg-elevated`, `--bg-tertiary` to complement the warmer base
  - [x] Keep text colors warm (already correct: `--text-secondary: #b8adb0`)
  - [x] Ensure all borders, shadows, and overlays work with new base
  - [x] Test every component in dark mode: sidebar, chat, panels, modals, dropdowns, code blocks

### 2.7 <<Tag Skeleton Rendering ✅ Complete
- [x] **Problem**: Spectra's custom tags (`<<QUIZ_START>>`, `<<FLASHCARDS_START>>`, `<<DOCUMENT_START>>`) show raw text while being written; should show skeleton until tag is closed
- [x] **Files**: `src/components/chat/chat-messages.tsx`, `src/components/chat/quiz-reveal.tsx`, `src/components/chat/flashcard-reveal.tsx`
- [x] **Implementation**:
  - [x] Detect opening tags in streaming content
  - [x] While tag is open (no closing tag yet), render a type-appropriate skeleton:
    - [x] `<<QUIZ_START>>`: Quiz skeleton (question placeholders with option circles)
    - [x] `<<FLASHCARDS_START>>`: Card skeleton (flippable card placeholder)
    - [x] `<<DOCUMENT_START>>`: Document skeleton (page with lines)
  - [x] On closing tag: parse content and render the real component
  - [x] Smooth transition from skeleton to real content

### 2.8 Branch/Edit System Fix ✅ Complete
- [x] **Problem**: `1/2` and `2/2` branch navigation shows overlapping prompts; edit popup too narrow; slow UI update after edit submit
- [x] **Files**: `src/components/chat/chat-message.tsx`, `src/components/chat/chat-messages.tsx`
- [x] **Implementation**:
  - [x] Fix branch rendering: only show the active branch's user message, with prev/next arrows
  - [x] When viewing branch 2/2, do NOT show branch 1/1's prompt above it
  - [x] Edit popup: set `min-width: min(600px, 90vw)` instead of current narrow default
  - [x] On edit submit: immediately show the new user message with loading state, don't wait for API

### 2.9 Settings Consolidation ✅ Complete
- [x] **Problem**: Old/deprecated settings panel still accessible from tips; settings button disappears during generation
- [x] **Files**: `src/components/chat/chat-settings-drawer.tsx`, `src/components/chat/chat-header.tsx`
- [x] **Implementation**:
  - [x] Remove all references to the old/deprecated settings panel
  - [x] Keep only the drawer accessible from sidebar toggle and header button
  - [x] Settings button: always visible in header, even during generation (just move stop button to its left)
  - [x] Tips that say "open settings" should point to the current settings drawer, not old panel

### 2.10 Notification Redesign ✅ Complete
- [x] **Problem**: Response-ready notification should look like achievements-unlocked; clicking should navigate to conversation
- [x] **Files**: `src/components/notification-toast.tsx`, `src/components/notification-bell.tsx`, `src/hooks/use-chat-state.ts`
- [x] **Implementation**:
  - [x] Redesign notification toast: use the same animation style as achievement unlocks (slide-in from top-right, with subtle glow)
  - [x] Include: conversation title, mode icon, model used
  - [x] Click action: navigate to that conversation and scroll to the new message
  - [x] Stack notifications if multiple arrive (max 3 visible)
  - Sound: optional subtle notification sound (off by default, toggleable in settings) — deferred

### 2.11 Sidebar Rendering Optimization ✅ Complete
- [x] **Problem**: All messages rendered in sidebar at load; should lazy-render
- [x] **Files**: `src/components/chat/chat-sidebar.tsx`
- [x] **Implementation**:
  - [x] Initially render only the 20 most recent conversations
  - [x] On scroll: load more with `IntersectionObserver` (batch of 20)
  - [x] Maintain scroll position on re-render
  - [x] Ensure persistence is not broken: conversation IDs always tracked, just DOM elements lazy
  - [x] Fix: last sidebar nav button getting blurred/cut off — add `pb-4` padding to nav container

### 2.12 UI Break When Switching Chats ✅ Complete
- [x] **Problem**: Entire UI sometimes breaks when switching between chats; buttons and headings shift far left; note appears in chat heading section
- [x] **Files**: `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-error-boundary.tsx`, `src/hooks/use-chat-state.ts`
- [x] **Implementation**:
  - [x] Add error boundary around chat message area with graceful fallback UI
  - [x] Investigate race condition: switching chat while streaming may leave stale state
  - [x] Add cleanup: when `selectedChatId` changes, abort any in-flight streams, clear draft state
  - [x] Ensure chat heading section has fixed positioning that doesn't depend on message content

### 2.13 Flashcard Reminder Intrusiveness ✅ Complete
- [x] **Problem**: Flashcard reminder and idea may be too intrusive
- [x] **Files**: `src/hooks/use-chat-state.ts`, `src/components/chat/chat-messages.tsx`
- [x] **Implementation**:
  - [x] Rate-limit flashcard suggestions: max 1 per session, and only after 3+ educational exchanges
  - [x] Make dismissible with "Don't show again" option (stored in user preferences)
  - [x] Reduce visual weight: thin banner, not card-style

### 2.14 Memory Update Indication ✅ Complete
- [x] **Problem**: No clear indication when memory gets updated
- [x] **Files**: `src/hooks/use-chat-state.ts`, `src/components/chat/chat-message.tsx`, `src/components/chat/chat-messages.tsx`
- [x] **Implementation**:
  - [x] After a memory write: show subtle inline indicator below the assistant message: "Memory updated" with brain icon
  - [x] Clickable: opens a small popover showing what was saved
  - In settings: link to "View all memories" (future: dedicated memory management page) — deferred to Phase 8

---

## Phase 3: Routing & Model Selection Revolution

**Goal**: Fundamentally reimagine heuristic routing to be diverse, cache-aware, reliable, and transparent.

### 3.1 Provider Coverage Expansion ✅ Complete
- [x] **Problem**: Always the same candidates (Seed, Claude, Gemini). Missing OpenAI, Mistral, MiniMax, Moonshot, Z.ai
- [x] **Files**: `convex/catalogSync.ts`, `convex/curatedModelRegistry.ts`, `src/lib/routing/heuristic.ts`
- [x] **Implementation**:
  - [x] Expand curated model registry with models from all major providers
  - [x] Add provider diversity as a first-class routing signal
  - [x] Curated tiers (illustrative examples — **never hardcode specific models**; tiers are populated dynamically from catalog sync):
    - [x] **Budget heroes**: e.g. DeepSeek V3.x, Qwen 3.x, Seed 2.x, Gemma — whatever is cheapest and capable at any given time
    - [x] **Balanced**: e.g. GPT-4o-mini class, Claude Haiku class, Gemini Flash class, Mistral Small class
    - [x] **Premium**: e.g. GPT-4o class, Claude Sonnet class, Gemini Pro class, DeepSeek R1 class
    - [x] **Heavy**: e.g. Claude Opus class, GPT-5 class, Gemini Ultra class (gated by cost cap)
  - [x] **Note**: Model landscape changes rapidly. Tier assignment must be derived from catalog pricing + capability scores, not from a hardcoded list. New models entering the catalog auto-slot into the correct tier.
  - [x] Each tier: minimum 4 different providers represented

### 3.2 Diversity Scoring ✅ Complete
- [x] **Problem**: Same models chosen repeatedly; scores feel unreliable
- [x] **Files**: `src/lib/routing/phase-router.ts`
- [x] **Implementation**:
  - [x] Add `recentModelUsage` tracking (last 20 requests per user, stored in session/memory)
  - [x] Diversity penalty: if model was used in last 3 requests, apply 0.7x score multiplier; last 5: 0.85x; last 10: 0.92x
  - [x] Provider diversity: if same provider used in last 2 requests, apply 0.8x multiplier
  - [x] **Exceptions** (no diversity penalty applied):
    - [x] User explicitly pins a model (manual mode)
    - [x] Model supports prompt caching AND cache is not stale (conversation has recent messages within cache TTL, typically < 5 min, and history has not been compacted since last use)
  - [x] Surface the diversity logic in route trace so user can see why a different model was chosen

### 3.3 Cache-Aware Prioritization ✅ Complete
- [x] **Problem**: If a model has cached tokens from recent conversation, it should be prioritized (lower latency, lower cost)
- [x] **Files**: `src/lib/routing/phase-router.ts`, `src/lib/openrouter.ts`
- [x] **Implementation**:
  - [x] Track which model was last used per conversation
  - [x] If conversation has recent messages (< 5 min) with same model, apply 1.3x boost (cache likely warm)
  - [x] If conversation history was compacted, cache is stale — no boost
  - [x] OpenRouter supports prompt caching for some models; track which models support it
  - [x] Include cache-awareness in route trace explanation

### 3.4 Scoring Overhaul ✅ Complete
- [x] **Problem**: Current scoring (reliability, latency, freshness) produces unreliable results; lane weights feel arbitrary
- [x] **Files**: `src/lib/routing/phase-router.ts:87-244`
- [x] **Implementation**:
  - [x] Replace lane system (stable/fresh/challenger) with a unified weighted score:
    ```
    score = (0.30 * capability_match)
          + (0.25 * cost_fit)
          + (0.15 * reliability)
          + (0.10 * latency_fit)
          + (0.08 * diversity)
          + (0.07 * cache_bonus)
          + (0.05 * freshness)
    ```
  - [x] `capability_match`: How well the model's capabilities match the request requirements (vision, reasoning, code, search)
  - [x] `cost_fit`: How well the model's cost fits the tier budget
  - [x] Normalize all scores to 0-1 range
  - [x] Add randomized exploration: with 10% probability, boost a random non-top candidate by 1.5x (prevents lock-in)
  - [x] Show full scoring breakdown in route trace

### 3.5 Prompt Interpretation for Model/Orchestration Requests ✅ Complete
- [x] **Problem**: User says "use GPT-4" but system doesn't listen; searching through all model names by keyword doesn't work; orchestration keywords not detected
- [x] **Files**: `src/lib/orchestrator/route-plan.ts`, `src/lib/auto-settings.ts`
- [x] **Implementation**:
  - [x] Add explicit intent detection for model requests: "use [model]", "switch to [model]", "try [model]"
  - [x] Fuzzy match against model names/aliases (GPT-4 → openai/gpt-4o, Claude → anthropic/claude-sonnet)
  - [x] If match found: override router mode to manual for that request
  - [x] For orchestration: detect "use multiple models", "collaborate", "get different perspectives"
  - [x] Surface what was detected in route trace

### 3.6 Cost Cap Enforcement ✅ Complete
- [x] **Problem**: 30/M cap not consistently enforced; budget not hard-enforced during streaming
- [x] **Files**: `src/lib/model-selection.ts:156-168`, `src/lib/orchestrator/pipeline-controller.ts:166-236`
- [x] **Implementation**:
  - [x] Strict 30/M input+output cap for automatic routing (no exceptions)
  - [x] Manual selection: warn if model exceeds 30/M, require explicit confirmation
  - [x] During streaming: track cumulative token usage. If multi-agent total exceeds budget by 150%, abort remaining specialists
  - [x] Add `usageBudgetRemaining` to pipeline state, decrement as tokens arrive

### 3.7 Parallel Specialist Execution ✅ Complete
- [x] **Problem**: Multi-agent specialists run sequentially (5x latency)
- [x] **Files**: `src/lib/orchestrator/streaming.ts:237`, `src/lib/orchestrator/task-graph.ts`
- [x] **Implementation**:
  - [x] Build dependency DAG from task graph
  - [x] Independent specialists (no `dependsOn` overlap) execute in parallel via `Promise.all`
  - [x] Dependent specialists wait for their dependencies
  - [x] Cap concurrent specialists at 3 (balance between speed and cost)
  - [x] Stream specialist progress to UI in real-time (which specialists are active)

### 3.8 Token Count Accuracy ✅ Complete
- [x] **Problem**: Simple prompts show 3500+ tokens because the system prompt is bloated with mode rules, memory, skills, and guidelines even for trivial requests. This is the real issue — not display, but actual waste.
- [x] **Root cause**: System prompt tiering (Phase 1.6) is the primary fix. With a T0 system prompt < 400 tokens, simple requests will show reasonable token counts.
- [x] **Implementation**:
  - [x] Display actual token usage from API response, not estimated
  - [x] Separate display: "Input: X tokens | Output: Y tokens" (not combined)
  - [x] For context: show what contributed to input (system prompt, history, memory, sources) — helps debug why tokens are high
  - [x] Token count always visible to all users (no toggle/hiding — transparency matters)

### 3.9 New Model Onboarding & Challenger Lane ✅ Complete
- [x] **Problem**: When new models appear in the catalog (via catalog sync), they have no reliability/latency data. They need a path to get tested without destabilizing routing for all users.
- [x] **Implementation**:
  - [x] **Challenger lane**: New models (< 5 total runs across all users) are flagged as `challenger`
  - [x] Challengers are eligible for selection but only when:
    - [x] The request is low-stakes (T0/T1 tier, simple question)
    - [x] Random exploration roll succeeds (10% probability from 3.4)
    - [x] No other model with warm cache is available for this conversation
  - [x] **Light offline evaluation loop**:
    - [x] After each response from a challenger model, store quality signals: finish_reason, user feedback (thumbs), response length, latency
    - [x] Weekly batch job: compute reliability + latency scores for challengers that have accumulated 5+ data points
    - [x] If reliability > 0.6 after 12 runs: promote to normal routing pool
    - [x] If reliability < 0.3 after 12 runs: demote to deprioritized (0.3x score multiplier, not fully removed)
  - [x] **Catalog sync**: New models from OpenRouter catalog automatically enter as challengers. No manual curation needed for entry — only tier assignment is automatic based on pricing + capabilities.
  - [x] This ensures the routing system adapts to the model landscape over time without manual intervention, while protecting users from untested models on important requests.

---

## Phase 4: Agent Revolution

**Goal**: Make agents the primary teacher tool and a powerful student tool. Guided creation, resource-aware, auto-routed.

### 4.1 Guided Agent Creation Wizard ✅ Complete
- [x] **Problem**: Agent creation is too simple; doesn't feel like it could work
- [x] **Files**: `src/app/agents/new/page.tsx`, `src/components/agents/agent-builder-form.tsx`, `src/app/api/agents/extract-metadata/route.ts`, `src/app/api/agents/preview/route.ts`, `convex/resources.ts`
- [x] **Implementation**:
  - [x] Multi-step wizard:
    1. [x] **Identity**: Name, subject area, grade level, description
    2. [x] **Resources**: Upload files (mark schemes, specs, textbooks, exam papers). Real-time processing status.
    3. [x] **Behavior**: Generated system prompt from uploaded resources (using cheap model). User can review and edit.
    4. [x] **Capabilities**: Select tools (search, flashcard generation, quiz creation, document generation, diagram creation)
    5. [x] **Access**: Private (student's own), class (shared with class), school (all students)
    6. [x] **Preview**: Test conversation with the agent before publishing
  - [x] Auto-generate from resources: parse uploaded files to extract:
    - [x] Topic map (what subjects/units are covered)
    - [x] Rubric hints (grading criteria)
    - [x] Misconceptions (common errors)
    - [x] Key vocabulary
    - [x] Exam format/structure
  - [x] Store extracted metadata in agent schema for routing

### 4.2 Agent Auto-Routing Integration ✅ Complete
- [x] **Problem**: Agents are not considered during routing; user must manually select
- [x] **Files**: `src/lib/orchestrator/route-plan.ts`, `src/lib/orchestrator/pipeline.ts`, `src/hooks/use-chat-state.ts`, `convex/chats.ts`
- [x] **Implementation**:
  - [x] When user sends a message in general/auto mode:
    1. [x] Check user's available agents (school + personal)
    2. [x] Match message content against agent topic maps (keyword + semantic similarity)
    3. [x] If strong match (score > 0.7): auto-select agent and notify user ("Using Physics Agent for this question")
    4. [x] If moderate match (0.4-0.7): suggest agent ("This seems related to Physics. Want to use your Physics Agent?")
    5. [x] If no match: proceed without agent
  - [x] Agent context injection: when agent is active, include its system prompt, resources, and topic map in pipeline
  - [x] Agent-specific model preferences: if agent has `modelAllowlist`, filter routing candidates

### 4.3 Agent Resource Processing ✅ Complete
- [x] **Problem**: Agents should hold and use files/resources (specs, mark schemes, etc.)
- [x] **Files**: `convex/resources.ts`, `convex/rag.ts`, `convex/agents.ts`, `src/lib/orchestrator/retrieval.ts`
- [x] **Implementation**:
  - [x] Agents get their own resource scope (already partially exists: `scope: "agent"`)
  - [x] Resources uploaded during wizard flow get processed through ingestion pipeline
  - [x] Agent RAG: when agent is active, retrieval scoped to agent's resources first, then fallback to general
  - [x] Agent topic map used to filter RAG results (only chunks matching agent's domain)
  - [x] Max 20 resources per agent (teachers can update/replace)

### 4.4 Student Agent Creation ✅ Complete
- [x] **Problem**: Students should also create agents for their own needs
- [x] **Implementation**:
  - [x] Students can create private or public agents
  - [x] Private: only the creator can use them
  - [x] Public: visible to all students in the school (moderated by school admin)
  - [x] Student agents have simpler wizard (skip some teacher-specific steps)
  - [x] Student agents limited to 5 resources each
  - [x] Example use cases: "My Essay Helper", "Math Homework Agent", "Language Practice Agent"

### 4.5 Agent Dropdown Redesign ✅ Complete
- [x] **Problem**: Agent dropdown is too simple; doesn't feel powerful
- [x] **Files**: `src/components/chat/chat-composer.tsx` (agent selector section)
- [x] **Implementation**:
  - [x] Grid layout with agent cards (not a flat list)
  - [x] Each card: avatar, name, subject tag, resource count, usage count
  - [x] Sections: "Recommended" (auto-detected from recent activity), "School Agents" (teacher-created), "My Agents" (student-created), "All Agents"
  - [x] Search and filter by subject
  - [x] Quick-create button at the bottom
  - [x] Show when agent was last updated

---

## Phase 5: Artifacts Workspace (Signature Feature) ✅ Complete

**Goal**: Build the living workspace that is Spectra's core differentiator. This replaces images, flashcards, bookmarks, and achievements with a unified, multi-view, version-tracked artifact system.

### 5.1 Artifact Schema & Types ✅ Complete
- [x] **Files**: `convex/schema.ts` (extended from Phase 1.8 with `tags`, `linkedAgentId`, `linkedChatId`, `snapshot`, `description`, `authorType: "system"`)
- [x] **Artifact types**: study_plan, timetable, note, flashcard_deck, document, code_project, diagram, image, bookmark, collection
- [x] **Type metadata**: `src/lib/artifact-types.ts` — labels, icons, colors, section groupings for all 10 types
- [x] **Backend**: `convex/artifacts.ts` — full CRUD (create, update, list, get, archive, restore, delete, togglePin, restoreVersion, getStats, getVersions)
- [x] **API**: `src/app/api/artifacts/route.ts` — GET (list, get, stats, versions) + POST (create, update, archive, restore, delete, togglePin, restoreVersion)

### 5.2 Artifacts Page — Multi-View Architecture ✅ Complete
- [x] **New route**: `/artifacts` (replaces `/images`, `/flashcards`, `/bookmarks`, `/achievements`)
- [x] **Views** (togglable via toolbar):
  - [x] **A. Canvas View** (`src/components/artifacts/canvas-view.tsx`): Zone-based layout with Active Projects, Study Tools, Recent, Archived zones. Cards auto-sorted into zones by pin/recency/type.
  - [x] **B. Timeline View** (`src/components/artifacts/timeline-view.tsx`): Chronological vertical timeline grouped by date, with color-coded type dots and connector spine.
  - [x] **C. Sections View** (`src/components/artifacts/sections-view.tsx`, default): Collapsible sections by type (Pinned, Study Plans & Timetables, Flashcard Decks, Notes & Documents, Generated Media, Saved Items). Grid layout within each section.
  - [x] **D. Graph View** (`src/components/artifacts/graph-view.tsx`): SVG-based force-directed relationship graph. Nodes=artifacts, edges=shared tags/agent/chat/type. Hover highlights connected nodes.
- [x] **Toolbar**: Search, type filter pills, view mode toggle, archive filter, refresh, create button
- [x] **Stats strip**: Total, active this week, pinned, archived (inline stat strip, no card grid)
- [x] **Empty state**: Contextual illustration with guidance text

### 5.3 Artifact Creation Flows ✅ Complete
- [x] **From chat**: "Artifact" button on every assistant message (`chat-message.tsx`). Auto-detects type from content (flashcards, documents, code, notes). Saves with `linkedChatId` and `sourceMessageId`.
- [x] **Manual**: "New" button on artifacts page opens `CreateArtifactDialog` — 2-step flow (type selection → details with title and tags)
- [x] **Auto-detection**: Content type detection via tag patterns (`<<FLASHCARDS_START>>`, `<<DOCUMENT_START>>`, code blocks)
- [x] **Toast with action**: "Saved as artifact" toast with "View" link to `/artifacts`

### 5.4 Artifact Editor ✅ Complete
- [x] **Rich editor per type** (`src/components/artifacts/artifact-editor.tsx`):
  - [x] `note`: Textarea with Manrope font, generous padding
  - [x] `study_plan`: Description field + milestone list with checkboxes, add/remove
  - [x] `timetable`: Day/time/subject slot editor with add/remove
  - [x] `flashcard_deck`: Card grid with front/back textareas, add/remove cards
  - [x] `code_project`: Language selector + monospace code textarea with dark background
  - [x] `document`: Read-only preview with download button
  - [x] `image`: Image viewer with prompt display
  - [x] `bookmark`: URL or saved message preview with notes field
  - [x] `diagram`/`collection`/generic: JSON editor fallback
- [x] **All types**: inline title editing, tag editing, archive/delete/pin actions, save button with dirty tracking
- [x] **Version history panel**: Slide-in right panel with version timeline, author type, description, restore buttons

### 5.5 Agent-Artifact Interaction ✅ Complete
- [x] **Read access**: Artifacts linked to agents via `linkedAgentId` field
- [x] **Write access**: User-confirmed only — "Artifact" button in chat, agent-proposed creation through structured output
- [x] **Version links**: Every version stores `sourceChatId`, `sourceMessageId`, `authorAgentId` for full provenance
- [x] **Author tracking**: Versions track `authorType: "user" | "agent" | "system"` for attribution

### 5.6 Version History & Diff Storage ✅ Complete
- [x] **Storage strategy**: Every edit creates `artifactVersions` entry with `diff` (operation type + previous content)
- [x] **Snapshots**: Full content snapshot stored every 10th version for fast reconstruction
- [x] **Version history UI**: Timeline panel in artifact editor with date/author/description
- [x] **Restore**: Click any snapshot version to restore (creates new version pointing to restored state)
- [x] **Conversation links**: Each version optionally links to `sourceChatId` and `sourceMessageId`

### 5.7 Migration from Existing Pages ✅ Complete
- [x] **Route redirects**: `next.config.ts` redirects `/flashcards` → `/artifacts?type=flashcard_deck`, `/images` → `/artifacts?type=image`, `/bookmarks` → `/artifacts?type=bookmark`, `/achievements` → `/artifacts`
- [x] **Sidebar navigation**: Replaced Flashcards, Bookmarks, Achievements, Images nav items with single "Artifacts" link (Layers icon)
- [x] **Tour steps**: Added artifacts workspace guided tour in `app-shell.tsx`

### 5.8 Artifacts as Memory ✅ Complete
- [x] **Key concept**: Artifacts serve as structured, persistent memory accessible via tags and linked agents
- [x] **Agent context**: Artifacts linked to agents via `linkedAgentId` — agents can query user's artifacts for context
- [x] **Study plan tracking**: Study plan artifacts with milestones let agents know ongoing work
- [x] **Flashcard tracking**: Flashcard deck artifacts let agents know study topics

---

## Phase 6: Search, Sources & Research Mode ✅ Complete

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
  - Model icons improvement. Some are much smaller than others (the ones automatically generated, that dont have the actual icon)
  - Icon shown when dropdown collapsed should mirror the icon of provider (auto keeps agent current icon)

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
1. [x] RAG failure silently returns fallback — should warn user when no sources found despite expecting them ✅ Complete
2. [x] No circuit breaker for model failures — same failing model retried immediately ✅ Complete
3. [x] Memory extraction NLP too narrow (regex only matches "prefer", "goal", "struggle") ✅ Complete
4. [x] Cost budget not hard-enforced during multi-agent streaming — can exceed declared budget ✅ Complete
5. [x] Mode fallback to "general" loses pedagogical structure without warning ✅ Complete
6. [x] Quiz/flashcard format validation is client-side only — malformed output passes through ✅ Complete
7. [x] Thinking level parameter doesn't actually enable extended thinking in models that support it ✅ Complete
8. Agent guidelines topic map not used to filter RAG results
9. No artifact resource cleanup/retention policy
10. [x] Max tokens per mode are hardcoded — should adapt to model's context window ✅ Complete

### From Frontend Analysis
11. Auto-scroll race condition during heavy streaming
12. [x] Panel history limited to 10 entries — could overflow on complex interactions ✅ Complete
13. [x] Canvas panel auto-collapses sidebar unexpectedly ✅ Complete
14. [x] Mobile composer can be covered by keyboard ✅ Complete
15. [x] Chat title rename has no loading state during API call ✅ Complete
16. [x] Flashcard SM-2 quality rating mappings non-intuitive (1, 0, 2, 4, 5) ✅ Complete
17. [x] No request deduplication — double-click sends two requests ✅ Complete
18. [x] No rate limiting on client-side message sending ✅ Complete
19. [x] Toast notifications don't persist or have history ✅ Complete
20. [x] No keyboard shortcuts for common chat actions beyond Cmd+K ✅ Complete

### From Backend Analysis
21. Memory fingerprint deduplication is not atomic — race condition with concurrent writes
22. `negativeTopicLinks` array grows unbounded (up to 12 items, no cleanup)
23. [x] No hybrid search (BM25 + vector) — vector-only misses keyword matches ✅ Complete
24. [x] Resource processing is serial in cron job — no parallelization ✅ Complete
25. Message branching parent/sibling tracking has no foreign key constraints
26. Orphaned chunks possible if resource deletion doesn't cascade properly
27. No bulk mutation API for resources — each upload is separate
28. Content deduplication via `contentHash` exists in schema but is unused
29. [x] Chat listing by pack requires full scan — missing index ✅ Complete
30. [x] Vector search returns topK*8 then filters — wastes compute on irrelevant results ✅ Complete
31. Usage aggregation upsert runs in critical path on every message
32. Compaction summary is manual-only — no LLM-driven summarization
33. Embedding model change would require complete re-index of all data

### From Cross-Analysis
34. System prompt too verbose → inflates token count even for simple queries
35. [x] No graceful handling when Convex backend is unreachable ✅ Complete
36. No export format for artifacts (only chat has export)
37. [x] No conversation templates or quick-start flows for new users ✅ Complete
38. Model leaderboard based on limited internal data — not very useful
39. No A/B testing infrastructure for routing experiments
40. No observability dashboard for pipeline health metrics
41. Research mode has no structured output format (unlike quiz/flashcard)
42. No progressive loading for very long conversations
43. Agent resources are not versioned — teacher updates replace without history
44. No collaborative features (sharing artifacts between students)
45. [x] Missing breadcrumb navigation on nested admin pages ✅ Complete
46. [x] No error boundary recovery UX — errors crash the whole page ✅ Complete
47. [x] Custom theme picker complexity (primary/secondary) doesn't match user mental model ✅ Complete
48. [x] No way to "pin" a model for the rest of a conversation ✅ Complete
49. Clarification questions are generic and repetitive across sessions
50. No semantic caching of embeddings for repeated queries
51. [x] Provider icon coverage is incomplete — many show generic fallback ✅ Complete
52. No diff view for comparing artifact versions
53. [x] Study reminders cron generates at fixed time — not timezone-aware ✅ Complete
54. Generated documents (DOCX/PDF/PPTX) lack design consistency, and require polished results. Achievable through skills written as md files, and downloaded from internet (frontend-design for instance). Can be loaded through tools to prevent massive injection of context
55. No telemetry for measuring actual learning outcomes
56. Memory upload through "My Files" (or automatically saved after attached through chat) is not reliable, and usually fails

---

## Phase Dependency Graph

```
Phase 1 (Foundation) ──────────────────────────────┐
    │                                              │
    ├── Phase 2 (Chat UX) ─────────────────────────┤
    │       │                                      │
    │       ├── Phase 9 (UI Polish)                │
    │       │                                      │
    ├── Phase 3 (Routing) ─────────────────────────┤
    │       │                                      │
    │       ├── Phase 4 (Agents) ──────────────────┤
    │       │       │                              │
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
