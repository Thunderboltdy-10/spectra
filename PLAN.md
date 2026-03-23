# Spectra Major Upgrade Plan

## Context

Spectra is a school AI platform routing across 400+ models via OpenRouter. After hands-on testing, the user identified ~30 bugs and systemic issues: the routing always picks the same few models, expensive models are used for trivial tasks (titles, compaction), search doesn't work, analytics are broken, memory/file-upload stalls, the UI has numerous regressions (tables, equations, scroll, responsive), and the platform lacks the polish to convince a school to adopt it over subsidized ChatGPT/Claude.

The goal is a comprehensive upgrade that: (1) makes routing genuinely intelligent and cost-efficient using live OpenRouter data, (2) fixes every identified bug, (3) upgrades analytics/memory/agents to feel production-grade, and (4) positions Spectra's multi-model routing as its competitive moat — better quality at lower cost than any single-model platform.

**Key research finding**: OpenRouter's `/api/v1/models` API returns live pricing, capabilities, context windows, and supported parameters for every model. Per-provider latency/uptime data is available at `/api/v1/models/:author/:slug/endpoints`. Chinese models (DeepSeek, Qwen, MiniMax, Kimi, GLM) now handle 61% of OpenRouter traffic and offer 10-40x cost savings vs Western equivalents. Free models like DeepSeek R1/V3.2, Qwen3 Coder, Gemini Flash are genuinely competitive. Prompt caching (Anthropic: 90% savings, OpenAI: 50%) is a massive cost lever but breaks on every model switch.

---

## Phase 0: Critical Bug Fixes (ship first)

### 0A. Model badge shows outdated selection during streaming
- **Files**: `src/components/chat/chat-messages.tsx`, `src/components/chat/chat-message.tsx`
- **Fix**: The streaming message reads `modelUsed` from persisted data (set after completion). Pass the live `routeTrace` from `use-chat-state.ts` stream state to the currently-streaming assistant message. Prefer `routeTrace?.selected?.modelId` over `message.modelUsed` while `sending === true`.
- Also fixes: right panel orchestration showing outdated model (issue 21), always showing gemma3:12b (issue 27)

### 0B. Thinking blocks rendered as one giant paragraph
- **File**: `src/components/chat/thinking-block.tsx`
- **Fix**: Line 37 splits on `\n{2,}` (double newlines only). Many models emit single-newline separation. Change to also split on `\n` when preceded by a sentence terminator (`.!?:`) or when the next line starts with a bullet/number/heading marker. Remove the `slice(0, 20)` segment cap — show all segments with a "Show more" toggle if >12.

### 0C. Tables don't fit / equations not styled in tables
- **Files**: `src/app/globals.css`, `src/components/chat/markdown-renderer.tsx`
- **Fix**: The `.markdown-table-wrap` has `overflow-x: auto` but `min-width: 480px` on the table forces overflow even in narrow containers. Remove `min-width`, add `max-width: 100%` to table. For equations in tables: add `.chat-markdown td .katex-display { overflow-x: auto; max-width: 100%; }` and ensure `rehype-katex` processes content inside table cells (verify remark-math + rehype-katex plugin order in the ReactMarkdown component chain).

### 0D. Auto-scroll too sticky — hard to break out
- **File**: `src/components/chat/chat-messages.tsx`
- **Fix**: The break threshold is `deltaFromBottom > 140`. Lower to `80`. Add velocity detection: if user scrolls up by >30px in a single scroll event, immediately set `shouldAutoScrollRef = false` regardless of position. The jump-to-bottom button threshold (180px) should also lower to 120px.

### 0E. Tip renders at top of screen (duplicate)
- **Files**: `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-composer.tsx`
- **Fix**: Check if `SmartTipRotator` is mounted in both files. Keep only the one in `chat-composer.tsx` (anchored to the input). Remove any duplicate. If the tip uses a portal, ensure the portal target is the composer wrapper, not `document.body`.

### 0F. User messages should render markdown/equations
- **File**: `src/components/chat/chat-message.tsx`
- **Fix**: User messages currently render via `RichText` (plain text). Wrap user message content in `MarkdownRenderer` with a `userMessage` flag that disables code preview/canvas features but enables math rendering (remark-math + rehype-katex) and basic formatting.

### 0G. Cancelled/aborted responses not saved
- **File**: `src/hooks/use-chat-state.ts`
- **Fix**: Before calling `abortController.abort()`, check if `accumulatedResponseText` has content. If so, persist it as a message with `cancelled: true` flag (add to messages schema). On the OpenRouter side, the API reports these as "cancelled by user" — that's fine, but the partial content should still be saved locally. Also investigate: some responses auto-cancel without user action — add logging to identify the trigger (likely a race condition in the streaming handler where a new request aborts the old one).

### 0H. Right panel "Why this model" excess right padding
- **File**: `src/components/chat/unified-panel.tsx`
- **Fix**: Audit the route-trace view's padding chain. The panel container likely has `px-4` and the inner content has its own `pr-4`, compounding to ~32px right padding. Reduce inner content right padding.

### 0I. Clarification questions lost on reload
- **Files**: `src/hooks/use-chat-state.ts`, `convex/chats.ts`
- **Fix**: The `clarificationBlock` is React-only state. Persist it to the chat document's `recentContext` field (already in schema). On chat load, rehydrate `clarificationBlock` from the persisted context. Clear it when the user answers and submits.

### 0J. Message editing should create branch and allow re-send
- **Files**: `src/hooks/use-chat-state.ts`, `src/components/chat/chat-message.tsx`
- **Fix**: Schema already supports `parentMessageId` + `siblingIndex` + `chatBranches` table. When user edits and confirms, insert the edited message as a new sibling (increment `siblingIndex`), set `parentMessageId` to the original's parent, then trigger a new send. Show sibling navigation arrows (already partially wired with `onNavigateSibling` prop).

---

## Phase 1: Dynamic Model Catalog & Routing Intelligence

### 1A. Live catalog sync from OpenRouter API

**Current state**: `convex/catalogSync.ts` fetches ~120 models daily, stores basics. Does NOT fetch endpoint data or `supported_parameters`.

**Changes**:
- **`convex/catalogSync.ts`**: Expand `refreshCatalog` to fetch up to 400 models. Parse `supported_parameters` (especially `tools`, `structured_outputs`, `reasoning`, `web_search_options`). For top 60 models by usage, call `/api/v1/models/:author/:slug/endpoints` to get per-provider latency (p50), throughput (p50), uptime %.
- **`convex/schema.ts`**: Extend `modelCatalog` table with: `supportedParameters: v.optional(v.array(v.string()))`, `promptCachingSupported: v.optional(v.boolean())`, `cachePricingReadPerM: v.optional(v.number())`, `cachePricingWritePerM: v.optional(v.number())`, `endpointLatencyP50Ms: v.optional(v.number())`, `endpointUptimePercent: v.optional(v.number())`, `inputModalities: v.optional(v.array(v.string()))`, `outputModalities: v.optional(v.array(v.string()))`.
- **`convex/crons.ts`**: Add a secondary cron every 6 hours that refreshes pricing + endpoint stats only (lighter than full metadata sync).
- **`src/lib/openrouter.ts`**: Add `fetchModelEndpoints(author: string, slug: string)` function.
- **`src/lib/openrouter-catalog-cache.ts`**: Reduce `CACHE_TTL_MS` from 2 hours to 30 minutes.

### 1B. Convert MODEL_CONFIG to role-based resolution

**Current state**: `src/lib/model-config.ts` hardcodes 15 model IDs that go stale.

**Changes**:
- **New file `src/lib/model-roles.ts`**: Define roles (`utilityFree`, `tutorFast`, `tutorHigh`, `reasoningFree`, `reasoningPaid`, `codeFree`, `searchFast`, `embedding`, `imageGen`) with resolution criteria (e.g., `utilityFree`: free, fast, >90% uptime, any capability).
- **`src/lib/model-config.ts`**: Keep current values as **static fallbacks** only. Add `resolveModelForRole(role, catalog): string` that queries the live catalog. The resolved model is cached for 30 minutes.
- **`src/lib/model-config.ts`**: Update `ROUTER_FALLBACKS` to be generated from the catalog — for each primary model, pick 3-4 fallbacks from the same capability class sorted by cost.
- **Utility task models**: Title generation (`src/lib/orchestrator/post-process.ts`), compaction (`src/lib/orchestrator/history.ts`), and prompt enhancement (`src/app/api/enhance-prompt/route.ts`) should all resolve via `utilityFree` role — guaranteed free, fast model. Current gpt-5.4-nano for enhancement is paid; switch to free.

### 1C. Model stickiness within conversations

**Current state**: `phase-router.ts` applies a **penalty** of 0.08 for reusing the same model (antiLockIn). This is backwards for conversations — it forces unnecessary switching that breaks prompt caching.

**Changes in `src/lib/routing/phase-router.ts`**:
- Add `conversationTurnCount` to `PhaseRoutingInput`
- When `conversationTurnCount > 2` AND `previousModelUsed` is still healthy (reliability > 0.6):
  - Apply `stickinessBonus = 0.15` instead of penalty
  - If model supports prompt caching: increase to `0.20`
  - If attachments present in conversation: increase to `0.25`
- Require a minimum score improvement of `0.12` over the sticky model before allowing a switch
- When a switch IS forced (model down, context overflow), log it clearly in routeTrace

### 1D. Broader model diversity & exploration

**Changes in `src/lib/routing/phase-router.ts`**:
- Increase exploration rate from 10% to 15% for low-stakes tasks
- Lower provider diversity penalty threshold from 35% to 25%
- Add model-family grouping: treat `deepseek/*`, `qwen/*`, `google/gemma-*` as families; penalize when one family dominates >40% of recent 20 selections
- Ensure the candidate pool includes models from at least 4 different providers in the top-10 scored candidates. If not, boost the highest-scoring model from an underrepresented provider.
- The key models currently missing from routing decisions (per user feedback): OpenAI (non-nano), Kimi/Moonshot, ZhipuAI GLM, MiniMax (non-M2.5), StepFun. These are available on OpenRouter but the catalog sync may not be pulling them — verify and fix in 1A.

### 1E. Prompt caching integration

**Changes**:
- **`src/lib/openrouter.ts`**: When model ID starts with `anthropic/`, add `cache_control: { type: "ephemeral" }` to the system message content block. This enables Anthropic's automatic caching with 5-min TTL.
- **`src/lib/usage-tracking.ts`**: Parse `prompt_tokens_details.cached_tokens` and `cache_creation_input_tokens` from OpenRouter response. Record `cacheSavingsCents` alongside existing cost tracking.
- **`src/lib/routing/phase-router.ts`**: In stickiness calculation (1C), check if model has `promptCachingSupported === true` from catalog. If so, add extra +0.05 to stickiness bonus.

---

## Phase 2: Context Management & Search

### 2A. Always-auto compaction at 90% context window

**Changes**:
- **`src/lib/orchestrator/history.ts`**:
  - Change threshold from `0.75` to `0.90` on line 34
  - Remove all fallback turn-count heuristics (lines 41-44: the `turns >= 24`, `denseModes && turns >= 16` etc.) — let context window percentage be the sole trigger
  - Add **observation masking** as the primary compaction strategy: before LLM summarization, replace search result blocks and RAG citation blocks in messages older than the last 8 turns with 1-line summaries like `[Search: "query" — 6 results]`. Recalculate token estimate after masking. Only trigger LLM summarization if still above 90%.
  - Raise minimum from 10 to 14 messages
- **Remove compaction toggle from UI**:
  - `src/components/chat/unified-panel.tsx` — remove `AutoChoice` for compaction
  - `src/components/chat/chat-composer.tsx` — remove compaction from the options row
  - `src/hooks/use-chat-state.ts` — remove `autoCompaction` state, always treat as "auto"
  - Keep the `autoCompaction` prop in types for backward compat but ignore it

### 2B. Fix search (SearXNG + fallback)

**Current state**: 8 public SearXNG instances all failing. Search returns 0 results.

**Changes**:
- **`src/lib/search/searxng.ts`**:
  - Update the `DEFAULT_SEARXNG_INSTANCES` list — many are dead. Research and replace with currently-live instances.
  - Increase timeout from 4s to 6s for the first batch
  - Add retry with increased timeout (8s) if first batch returns 0 results
  - Reduce batch size from 3 to 2 to avoid rate limiting
- **`src/lib/orchestrator/retrieval.ts`**: Add `:online` model suffix fallback — when SearXNG returns 0 results AND the task requires search, re-route the request to `${selectedModel}:online` (OpenRouter feature that attaches web search results to any model). This costs extra per-request ($0.005 for web_search) but guarantees results.
- **Stream search status to UI**: In `src/lib/orchestrator/pipeline.ts`, emit `{ type: "search_status", status: "completed" | "failed", sourceCount: N }` events. In `src/components/chat/chat-messages.tsx`, show an inline badge: "Checked N web sources" or "Web search unavailable".

### 2C. Model attachment context preservation

- **`src/lib/routing/phase-router.ts`**: When `hasAttachments === true`, set stickiness bonus to maximum (0.25). Never switch models when the conversation contains unprocessed attachments.
- **`src/lib/orchestrator/pipeline.ts`**: When a model switch is forced despite attachments, include a `[Context: User uploaded file "X.docx" — key content: ...]` summary block from the RAG chunks in the system prompt for the new model.

---

## Phase 3: UI/UX Fixes

### 3A. Orchestrator panel auto-opens on orchestration
- **File**: `src/components/chat/chat-layout.tsx`
- Watch `streamPhase`. When it transitions from idle to `routing`/`searching`/`thinking`, auto-open the right panel to orchestration tab via `usePanel().open("route-trace")`. Only auto-open once per send (not if user manually closed it during that response).

### 3B. Canvas integrated into right panel system
- **Files**: `src/components/chat/code-canvas.tsx`, `src/context/panel-context.tsx`, `src/components/chat/chat-layout.tsx`
- Add `"canvas"` to the panel view type union. When canvas opens, it replaces the current right panel content. When the right panel is already showing something, canvas takes priority. Back button returns to previous panel view.

### 3C. Mermaid preview fix
- **Files**: `src/lib/code-sandbox.ts`, `src/components/chat/code-preview.tsx`
- Add Mermaid `mermaid.parse(code)` validation before rendering — catch syntax errors and show a clean error message with the problematic line highlighted, not raw syntax dump.
- Set `min-height: 200px` on the mermaid iframe to prevent layout shift during rendering. Add `contain: layout` CSS.

### 3D. Code/preview split view
- **Files**: `src/components/chat/markdown-renderer.tsx` (CodeBlock component), `src/components/chat/code-canvas.tsx`
- Replace the Eye/EyeOff toggle with a resizable split pane: left = syntax-highlighted code, right = live preview. Use a CSS `resize` handle or a lightweight split-pane library. Default 50/50 split. In canvas mode, the split is more prominent with a draggable divider.

### 3E. Live preview cleanup
- **File**: `src/lib/code-sandbox.ts`
- In `wrapHtml()`, inject CSS reset into the iframe: normalize heading sizes, remove default margins/padding, add `font-family: system-ui`. The preview should look like embedded content, not a standalone page.

### 3F. Small viewport responsive fixes
- **Files**: `src/components/chat/chat-layout.tsx`, `src/components/chat/chat-sidebar.tsx`, `src/components/chat/unified-panel.tsx`
- At `<768px`: sidebar becomes a full-screen overlay with blur backdrop (already partially done). Right panel also becomes full overlay — remove the arrow/toggle button at small viewports, make it dismissible by tapping the blurred background.
- Floating buttons (notification, timer, feedback, info): move into the header bar at small viewports instead of floating at bottom-right.
- Sidebar width: cap at `max-w-[85vw]` on mobile.

### 3G. Search bar overflow when expanded
- **File**: `src/components/chat/chat-composer.tsx`
- When the textarea exceeds 3 lines: add `max-h-[200px] overflow-y-auto` to the textarea wrapper. The mode/model selector pills and action buttons should remain outside the scrollable area (below it, inline with send button).

### 3H. Enhancer too aggressive
- **File**: `src/app/api/enhance-prompt/route.ts`
- Add guards: skip enhancement for messages < 25 chars, messages that are questions with < 10 words, or messages classified as T0/T1 complexity by auto-settings. Only enhance T2+ (medium complexity and above).

### 3I. Research mode uses too many tables
- **File**: `src/lib/prompts/policy.ts`
- Add to research mode system prompt: "Prefer prose and bullet lists for presenting information. Use tables ONLY when directly comparing 3+ items across multiple dimensions. Never use a table when a simple list would suffice."

### 3J. "Socratic question for you" feels forced
- **File**: `src/lib/prompts/policy.ts`
- Modify tutor mode prompt: replace any instruction that mandates ending with a question. New instruction: "Adapt your response style to the student's engagement level. When the student is actively working through a problem, ask guiding questions. When they need a clear explanation, give it directly. Do not append a formulaic question to every response."

### 3K. Mode switching mid-conversation
- **File**: `src/hooks/use-chat-state.ts`
- When `mode` changes and `messages.length > 2`, show a lightweight confirmation: "Switch to {mode}? This may change how the AI responds." Store per-message mode (already in schema) so the conversation history preserves the original mode context.

### 3L. Mermaid in search causes layout shift
- **File**: `src/components/chat/code-preview.tsx`
- Set explicit `height` and `min-height` on the preview container before the mermaid render completes. Use the code line count to estimate height: `Math.max(200, lineCount * 24)px`. Apply `overflow: hidden` during render, switch to `visible` after.

---

## Phase 4: Analytics Overhaul

### 4A. Default to current month, not oldest
- **File**: `src/components/analytics/analytics-dashboard.tsx`
- Change `selectedMonthIndex` initialization from `0` to `availableMonths.length - 1`. This is likely a 1-line fix.

### 4B. Date range picker
- **Files**: `src/components/analytics/analytics-dashboard.tsx`, `src/app/api/analytics/route.ts`, `convex/analytics.ts`
- Replace the month pager with a proper date range selector (current month / last 7 days / last 30 days / custom range). Pass `startDate`/`endDate` to the API instead of hardcoded `days: 30`.

### 4C. Larger, richer charts
- **File**: `src/components/analytics/analytics-dashboard.tsx`
- Increase chart heights: activity chart from 112px to 280px, quiz trend to 220px. Add click-to-drill-down on chart data points. Add a new `TimeOfDayHeatmap` component showing when the student is most active.

### 4D. Cost tracking display
- **New file**: `src/components/analytics/cost-chart.tsx`
- **Files**: `src/app/api/analytics/route.ts`, `convex/analytics.ts`
- Add a cost breakdown chart: daily spend in cents, broken down by model tier (free/cheap/mid/premium). Query `usageEvents` for `costCents` per day. Join with `modelCatalog` for current pricing to show accurate per-model costs. Add a stat strip item: "Est. cost this month: $X.XX".

### 4E. Model usage leaderboard with costs
- **File**: `src/components/analytics/analytics-dashboard.tsx`
- Extend the existing model leaderboard to show: model name, request count, total tokens, total cost. Sort by cost descending by default.

---

## Phase 5: Memory, Agents & Tools

### 5A. Fix file upload "Processing stalled"
- **Files**: `convex/resources.ts`, `src/lib/ingest.ts`, `shared/resource-processing.ts`
- Root cause: `RESOURCE_PROCESSING_STALE_MS` is likely too short for large files. The embedding call in `ingest.ts` can timeout for PDFs with many pages.
- Fix: Increase stale detection timeout. Add incremental progress updates during chunking (update `updatedAt` after each chunk batch). Add a manual "Retry" button in `unified-panel.tsx` that resets the resource status to `uploaded` and re-triggers ingestion. Show clear error messages: "File too large" / "Embedding failed" / "Unsupported format".

### 5B. Richer memory system
- **File**: `src/lib/orchestrator/post-process.ts`, `convex/memory.ts`
- Increase `MEMORY_MAX_ENTRIES` from current limit to 80
- Add tiered decay: `identity` entries never decay, `academic` at 180 days, `preference` at 90 days, `topic` at 45 days
- Add memory surfacing: when the AI uses a memory entry in its response, note it in the routeTrace so the user can see "Used memory: student prefers visual explanations"

### 5C. Skill loading system for agents
- **New file**: `src/lib/skills/skill-registry.ts`
- Create a skill registry that agents can query. Skills are markdown instruction files (similar to Claude Code's SKILL.md) stored in `public/skills/` or fetched from a skills API. Categories: `visualization`, `code`, `flashcard`, `research`, `writing`, `math`. The system prompt composer checks the agent's `allowedTools` and the current mode to inject relevant skill instructions.
- Install community skills for: Mermaid diagram generation, LaTeX math formatting, interactive SVG creation, spaced repetition optimization, Socratic dialogue patterns.

### 5D. Expanded artifact types
- **Files**: `src/lib/code-sandbox.ts`, `src/lib/prompts/policy.ts`
- Add Pyodide (Python in WebAssembly) support: detect `language-python` code blocks, offer a "Run" button that loads Pyodide from CDN and executes in the iframe sandbox. Support `matplotlib` output as inline SVG.
- Add interactive React component artifacts: the existing JSX/TSX preview already works. Enhance the prompt to encourage generating interactive components for math (sliders for function parameters), science (simulations), and data visualization.

---

## Phase 6: Strategic Enhancements

### 6A. OpenRouter `:online` as primary search
- Beyond the fallback in 2B, consider making `:online` the default search strategy (instead of SearXNG). Cost: ~$0.005/request for web search. Benefit: far more reliable, model-native integration, no self-hosted infra. Keep SearXNG as the free fallback for orgs on tight budgets.

### 6B. Benchmark-aware routing (stretch goal)
- **New file**: `src/lib/routing/benchmark-data.ts`
- Fetch benchmark data weekly from Artificial Analysis API (10 free requests/day). Store Chatbot Arena ELO, LiveBench scores, coding/math/reasoning subscores per model. Use these as a quality signal in the phase router's scoring — replace the subjective `capabilities.reasoning` ratings with actual benchmark data.

### 6C. Cost dashboard for admins
- **File**: `src/app/admin/page.tsx`
- Add a "Cost" section to the admin panel showing: total org spend this month, per-student average, model breakdown, projected monthly cost, budget utilization %. Alert when approaching budget limits.

---

## Verification Plan

### After Phase 0:
- Send a message and verify the model badge updates immediately (not after completion)
- Send a message that triggers thinking — verify paragraphs are properly separated
- Send a message with a table + equations — verify table scrolls and equations render inside cells
- Scroll up during streaming — verify auto-scroll breaks easily
- Verify only one tip displays, properly anchored to the composer
- Type an equation in user message — verify it renders with KaTeX
- Cancel a response mid-stream — verify partial content is saved

### After Phase 1:
- Check `convex/modelCatalog` table — verify it contains 300+ models with pricing, capabilities, endpoints
- Start a conversation, check routeTrace — verify the model stays consistent across 5+ turns
- Verify title generation uses a free model (check routeTrace or console logs)
- Run 20 queries across different topics — verify at least 6 different model providers appear in selections
- Check that Kimi, MiniMax, GLM, StepFun models appear in routing decisions (not just the usual 3-4)

### After Phase 2:
- Have a 30+ turn conversation — verify compaction triggers automatically around 90% context, no toggle in UI
- Test search: ask "What happened in the news today?" — verify web sources appear or a clear fallback message shows
- Upload a file, then continue chatting — verify the model doesn't switch away from the one that has the file context

### After Phase 3:
- Submit a prompt that triggers orchestration — verify right panel auto-opens to orchestration tab
- Open a code block with preview — verify split-pane slider works
- Open a Mermaid diagram — verify no syntax error dump, no layout shift
- Test at 375px viewport width — verify sidebar overlays, right panel overlays, no floating buttons

### After Phase 4:
- Open analytics — verify it defaults to current month
- Verify charts are full-width and tall (280px+ for activity)
- Verify cost data appears and looks accurate
- Compare displayed cost with actual OpenRouter dashboard

### After Phase 5:
- Upload a PDF — verify it processes to completion (no "stalled")
- Check memory entries — verify more than 50 can exist
- Try Python code block — verify "Run" button appears and executes via Pyodide

---

## Priority Order (if time-constrained)

1. **Phase 0** — Every bug fix is high-visibility, low-risk
2. **Phase 1A + 1B** — Live catalog + role resolution = foundation for everything else
3. **Phase 1C** — Model stickiness = immediate cost savings + better UX
4. **Phase 2B** — Search fix = most user-visible broken feature
5. **Phase 4A** — Analytics month default = 1-line fix, high impact
6. **Phase 2A** — Always-auto compaction = removes confusing toggle
7. **Phase 3A-3F** — UI fixes in order of visibility
8. **Phase 5A** — File upload fix = blocking feature
9. **Phase 1D + 1E** — Diversity + caching = cost optimization
10. Everything else
