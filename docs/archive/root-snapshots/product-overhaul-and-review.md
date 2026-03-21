# Spectra V2 Master Overhaul Plan

## 0. Context & Diagnosis

Spectra is an AI educational chatbot routing across 300+ LLM models via OpenRouter, with study modes, two-layer personalization (school + student), and multi-agent orchestration. Built with Next.js 16 + React 19 + Convex + Clerk, deployed on Vercel.

### What works
- Rich model catalog with live OpenRouter snapshot merging
- Three-scope RAG retrieval (pack/personal/agent) with vector search on Convex
- SM-2 spaced repetition with card hashing for cross-deck progress
- Role-based access (student/teacher/admin) with org scoping
- Multi-agent task graph with specialist roles and synthesis
- Gamification layer (streaks, XP, achievements, analytics)
- Budget enforcement with four spending tiers (normal → free_only)
- Auto-settings pipeline with complexity classification, search intent detection, mode suggestion
- Structured output parsing for quiz (`<<QUIZ_START>>`) and flashcards (`<<FLASHCARDS_START>>`)
- Built-in vague-request detection for quiz/flashcard modes with `<<QUIZ_CLARIFY>>` / `<<FLASHCARD_CLARIFY>>`

### What is broken or weak
1. **Search hallucinates**: `retrieval.ts:386-450` model_fallback invents fake URLs
2. **Memory is flat and leaky**: Single `userMemory` table, lexical scoring (0.58 weight), no topic isolation
3. **Routing is static**: Free models get `costFit=1.0`. `repetitionPenalty` capped at 0.18. Same 2-3 models win
4. **Phase progress is fake**: `finalizePhasePlan()` runs only at END. All phases jump to "done" simultaneously
5. **File uploads stall**: Resources show "processing stalled" — background job fails silently
6. **No branching**: `chatBranches` table exists but unused. Editing doesn't create branches
7. **No general interrupt/resume**: Quiz/flashcard have `<<CLARIFY>>` patterns but nothing generalizable
8. **Modes are disconnected**: Each mode is a separate prompt template. "Add more cards" regenerates entire deck
9. **Chat too wide**: Messages fill available width, right panel compresses content
10. **CDN scripts blocked**: Sandbox CSP `default-src 'none'` blocks Mermaid/React CDN scripts
11. **Speech-to-text broken**: `chat-composer.tsx` doesn't watch `speech.transcript`
12. **Contact form blocked**: `/api/contact` not in `isPublicRoute` in `proxy.ts`
13. **Canvas errors**: `label.trim is not a function` in parent save flow
14. **Cost discipline absent**: Simple "hello" runs same pipeline as deep research
15. **School context shallow**: System prompt shows `School: [name]` but not schoolType/curriculum

---

## 1. Product Vision

Spectra should feel like a school-native intelligent study system — not a generic chatbot with drawers.

**Core differentiators vs. ChatGPT/Claude:**
- Hidden contextual continuity (no visible "Projects", system infers context automatically)
- School-aware defaults (IB student gets IB-calibrated responses without saying "I study IB")
- Study mode transforms over shared learning state (explain → quiz → flashcards in one flow)
- Graduated cost discipline (simple stays cheap, complex gets rich orchestration)
- Truthful tool behavior (never hallucinate search results, transparent when search fails)
- Intelligent clarification (ask before guessing, resume naturally)
- Multi-model variety with transparent routing and cost explanation

**What Spectra is NOT:**
- Not a ChatGPT clone with study mode tabs bolted on
- Not a project management tool with explicit workspace creation
- Not an agent framework where users configure workflows

---

## 2. Architecture: Hidden Context Fabric (Memory)

### Current state
- `userMemory`: flat `entries[]` with `{key, value, confidence, extractedAt}`, max 50, 1500 char raw text
- `userSoulPreferences`: structured profile (learningStyle, interests, weakAreas)
- `orgSoulDocs/Chunks`: org-level teaching guidelines with vector search
- Scoring: `lexical * 0.58 + confidence * 0.26 + recency * 0.16` — recency fatally underweighted
- Extraction via `maybeExtractMemory()` in `post-process.ts:611-762` — no topic isolation
- No pending/confirmed states, no workstream concept, no negative links

### Alternatives evaluated

**A. Topic-tag based filtering**: Auto-generate topic tags per conversation. Filter memory entries by tag overlap.
- Pro: Cheap (tags from title generation call), deterministic, debuggable
- Con: Taxonomy drift ("world_war_2" vs "ww2_history"), misses semantic similarity ("French Revolution" ≠ "Napoleonic Wars" by tags), can't rank by relevance (only include/exclude), cross-cutting memories fail ("essay structure" relevant to History AND English)

**B. Embedding-based semantic clustering**: Embed each memory entry. Retrieve by cosine similarity.
- Pro: Handles semantic similarity, graceful degradation, already have Convex vector infrastructure
- Con: No natural topic boundary (math memory retrieves all math-adjacent), latency (50-150ms), every memory needs an embedding

**C. Hybrid structured + semantic** ← CHOSEN
- Structured identity layer (always injected): name, grade, school, learning style, preferences
- Semantic topic layer (retrieved by embedding similarity): subject-specific facts, misconceptions, progress
- Pro: Reuses existing Convex vector indexes (same pattern as `chunks` table). Identity always available. Topic isolation via embedding threshold. Marginal embedding cost: ~$0.000002 per entry
- Con: Slightly more complex than pure tags. Requires embedding each memory entry

**D. Conversation-graph with decay**: Graph of topic nodes with edge-weighted decay.
- Pro: Elegant temporal reasoning
- Con: Convex has no graph query capability. Requires Neo4j/Memgraph alongside Convex. Graph maintenance needs LLM calls per conversation. Disproportionate complexity for the benefit

### Why Hybrid wins
- The `chunks` table already has a Convex vector index with `filterFields: ["orgId", "packId", "agentId", "ownerUserId", "scope"]`. Adding `"memory"` scope requires zero new infrastructure
- ChatGPT's flat memory injection (everything into every request) causes documented cross-contamination with 300+ complaint threads. Retrieval-based selection is essential
- Mem0's benchmark shows 26% improvement over flat injection via dual-store (structured + semantic)
- The structured identity layer guarantees core personalization is never lost
- Embedding-based retrieval naturally solves WWII/French contamination: similarity threshold filters irrelevant memories

### Proposed: Three-layer memory architecture

#### Layer 1: School/Org Context (static, admin-managed)
- **Contains**: schoolType, country, curriculum, grading scale, pedagogical defaults, teaching guidelines (orgSoulDocs)
- **Never contains**: individual student data
- **Decay**: Never — admin-managed
- **Retrieval**: Always injected for org members. Compact (~100 tokens)
- **Files**: `pipeline.ts:1566-1573` (expand runtime context block), `convex/schema.ts` (add `curriculum`, `examBoard`, `gradeLevels` to `orgs`)

#### Layer 2: Durable Global Profile (structured, always injected)
- **Contains**: Identity (name, grade, role), academic profile (subjects, strengths, weaknesses), preferences (learning style, communication style, difficulty)
- **Never contains**: One-off topics, homework tasks, specific flashcard content
- **Decay**: Never expires. Overwritten only by explicit correction or confirmed update
- **Retrieval**: Always injected (~200 tokens max)
- **Implementation**: Unify `userMemory` identity entries + `userSoulPreferences` into a single structured profile. Add `category` field: `"identity" | "academic" | "preference"`. Entries with these categories are always injected regardless of topic.
- **Conflict resolution**: Most recent confirmed value wins. User corrections override LLM extractions.

#### Layer 3: Topic-Specific Memory (embedding-based, retrieved by relevance)
- **Contains**: Subject-specific facts, per-topic misconceptions, study progress, material associations
- **Never contains**: Cross-topic generalizations, one-off tasks, session-specific context
- **Decay**: Active while topic active. Dormant after 30 days. Archived after 90 days
- **Retrieval**: Embed current message → vector search `userMemoryEntries` → inject top 5 results above similarity threshold (≥0.52, matching existing RAG threshold)

**New table: `userMemoryEntries`**
```
userId: id<"users">
orgId: id<"orgs">
text: string            // the memory content
embedding: float64[]    // 3072-dim vector (same as chunks)
category: "topic" | "artifact" | "correction"
confidence: number      // 0-1
status: "pending" | "confirmed"
sourceType: "extraction" | "user_explicit" | "correction"
sourceChatId: optional id<"chats">
relatedArtifacts: optional string[]  // flashcard deck IDs, quiz IDs
negativeTopicLinks: optional string[]  // "don't associate with X"
createdAt, updatedAt: timestamps
```
Vector index: `by_embedding` with `filterFields: ["userId", "orgId"]`

**Anti-contamination**: WWII memory has embedding distant from "French vocabulary" query → doesn't retrieve. No tags to drift.

**Cross-cutting memories**: "Student struggles with essay structure" has embedding close to both "History essay" and "English essay" → retrieves for both. This is correct behavior.

### Memory Write Router

New function `routeMemoryWrite()` in `post-process.ts`, called after `maybeExtractMemory()`:

```
For each extracted fact:
  1. Is it identity? (name, grade, school, curriculum) → Layer 2, immediate, high confidence
  2. Is it a confirmed preference? (learning style, difficulty) → Layer 2, immediate
  3. Is it topic-specific? (subject knowledge, misconception) → Layer 3
     - First mention → status: "pending", confidence * 0.5
     - Second mention in different chat → promote to "confirmed", full confidence
  4. Is it an artifact reference? → Layer 3 with category: "artifact"
  5. Is it a one-off task? → DISCARD (don't store)
```

### Memory Read Planner

New function `planMemoryRead()` in pipeline.ts, replacing `buildRelevantMemoryProfile()`:

```
1. Always inject Layer 1 (org context, ~100 tokens)
2. Always inject Layer 2 (global profile, ~200 tokens)
3. Embed current message (reuse RAG embedding if available)
4. Vector search userMemoryEntries filtered by userId+orgId
5. Filter results: exclude entries with negativeTopicLinks matching query topic
6. Filter results: only "confirmed" entries (skip "pending")
7. Take top 5 above threshold (≥0.52)
8. Format as bullet list, inject as memory block (~300 tokens max)
Total injection: ~600 tokens max
```

### Correction Pathways
Detect in `parseUserDirectives()` (`auto-settings.ts`):
- **"forget this" / "forget about X"**: Delete matching entries from `userMemoryEntries`
- **"this association is wrong"**: Add negative topic link to entry
- **"don't bring this up for [topic]"**: Add negative topic link
- **"remember that I..."**: Immediate high-confidence write, status: "confirmed", sourceType: "user_explicit"
- **"update my profile"**: Direct Layer 2 update

### Memory Management UI
Add "Memory" tab in `unified-panel.tsx` settings:
- Grouped by confidence (high → low)
- Show source conversation link
- Delete per entry, "forget all about [topic]" button
- Show pending entries with confirm/dismiss

---

## 3. Architecture: Request Controller (Routing/Orchestration)

### Current state
- `pipeline.ts` is ~1500 lines of linear execution
- `buildRoutePlan()` at line 967 determines which tool bundles activate
- `runAutoSettingsPipeline()` at line 593 classifies complexity (simple/medium/complex)
- `classifyComplexity()` in `auto-settings.ts:236-263` already scores: word count (35%), complex verbs (20%), multipart (18%), domain terms (20%), word length (5%), question type (5-12%)
- Every request runs the same pipeline regardless of classification

### Alternatives evaluated

**A. Pipeline with conditional gates** (what exists now, slightly enhanced)
- Pro: Simple, low risk, builds on existing code
- Con: Still linear, hard to test stages in isolation, hard to add non-linear flows, 1500-line function keeps growing

**B. State machine refactor** ← CHOSEN
- Define `PipelineState` type, discrete stage functions, `PipelineController`
- Each stage takes state, returns enriched state. Controller decides next stage
- Pro: Testable, composable, enables interrupt/resume, positions for future LLM planner
- Con: 2-3 days of refactoring effort
- NOT a framework adoption (no LangGraph, no Semantic Kernel). Just restructuring existing code

**C. Event-driven / reactive pipeline**
- Pro: Decoupled, extensible
- Con: Spectra's pipeline is request-response (HTTP streaming). Event-driven is for long-running background processes. Debugging is harder. Convex's reactive system already handles data events

**D. Planner-executor with LLM planner**
- Pro: Self-modifying plan, adapts to request
- Con: Adds $0.0001 + 200-400ms latency to EVERY request including trivial ones. The planner must be correct — wrong routing silently degrades quality. Premature until heuristic misclassification >5%

### Why State Machine wins
- Formalizes the conditional logic that already exists in pipeline.ts into testable stages
- Each stage is a pure function: `(PipelineState) → PipelineState` — unit testable
- The controller replaces the linear flow with explicit decision points
- Enables interrupt/resume: controller can pause between stages and resume later
- Positions for future LLM planner as a drop-in replacement for the heuristic controller
- LangGraph uses this exact pattern (directed graph with typed state) at production scale

### Proposed: PipelineController with cost-tiered execution

#### PipelineState type
```typescript
type PipelineState = {
  // Input
  message: string; mode: StudyMode; directives: UserDirectives;
  // Classification
  requestClass: "T0" | "T1" | "T2" | "T3";
  complexity: "simple" | "medium" | "complex";
  // Accumulated results
  autoSettings?: AutoSettingsResult;
  routePlan?: RoutePlan;
  searchResults?: SearchResults;
  ragResults?: RagResults;
  memoryProfile?: string;
  learningContext?: LearningContext;
  modelSelection?: PhaseRoutingDecision;
  // Execution
  executionPlan: string[]; // which stages to run
  completedStages: string[];
  phaseUpdates: PhaseUpdate[];
  // Cost
  costAccumulator: number;
  costBudget: number;
};
```

#### Request Classification (extends existing `classifyComplexity()`)

Map existing complexity to request classes using existing heuristic (NO new LLM call):

| Class | Budget | Detection (extending auto-settings.ts:236-263) |
|-------|--------|------------------------------------------------|
| T0: Trivial | <$0.001 | complexity="simple" AND <30 chars AND no attachments AND mode∈{auto,general,tutor} AND not first message |
| T1: Standard | <$0.01 | complexity="simple" or "medium" AND no explicit search/research directive |
| T2: Enhanced | <$0.05 | complexity="complex" OR mode∈{research,marker,exam} OR has attachments OR explicit search |
| T3: Complex | <$0.15 | multi-agent triggered (existing `shouldUseMultiAgent()`) AND tier allows AND budget permits |

**Cost envelope enforcement**: `cheap_only` tier caps at T1. `free_only` caps at T0.

#### Execution plan by class

| Stage | T0 | T1 | T2 | T3 |
|-------|----|----|----|----|
| classifyRequest | ✓ | ✓ | ✓ | ✓ |
| autoSettings | skip | ✓ | ✓ | ✓ |
| buildRoutePlan | skip | ✓ | ✓ | ✓ |
| memoryRead | skip | ✓ (Layer 1+2 only) | ✓ (all layers) | ✓ (all layers) |
| ragRetrieval | skip | if resources exist | ✓ | ✓ |
| webSearch | skip | skip | if search enabled | ✓ |
| modelSelection | cheapest free | standard routing | enhanced routing | best available |
| clarificationCheck | skip | skip | ✓ | ✓ |
| generation | single-agent | single-agent | single-agent | single or multi |
| postProcess | title only | title + memory | full | full |

**Key savings**: T0 requests skip auto-settings, route planning, memory, RAG, search, and memory extraction. A "hello" costs <$0.001 instead of running the full pipeline.

#### Discrete stage functions (refactored from pipeline.ts)

```typescript
async function stageClassify(state: PipelineState): Promise<PipelineState>
async function stageAutoSettings(state: PipelineState): Promise<PipelineState>
async function stageRoutePlan(state: PipelineState): Promise<PipelineState>
async function stageMemoryRead(state: PipelineState): Promise<PipelineState>
async function stageRetrieve(state: PipelineState): Promise<PipelineState>  // RAG + search
async function stageModelSelect(state: PipelineState): Promise<PipelineState>
async function stageClarify(state: PipelineState): Promise<PipelineState>
async function stageGenerate(state: PipelineState): Promise<PipelineState>
async function stagePostProcess(state: PipelineState): Promise<PipelineState>
```

Each stage: reads state → does work → returns enriched state + emits real-time phase events.

Controller loop:
```typescript
for (const stageName of state.executionPlan) {
  if (shouldSkip(stageName, state)) continue;
  send({ type: "phase_update", phaseId: stageName, status: "in_progress" });
  state = await stages[stageName](state);
  send({ type: "phase_update", phaseId: stageName, status: "completed" });
  state.completedStages.push(stageName);
  if (state.needsClarification) break; // interrupt
}
```

#### Model selection improvements (in `phase-router.ts`)

1. **Free model ceiling**: Cap `costFit()` at 0.70 for free models (line 154-161)
2. **New weights**: `fit*0.20 + reliability*0.16 + freshness*0.13 + cost*0.15 + latency*0.10 + context*0.10 + antiLockIn*0.16`
3. **Increased diversity**: `repetitionPenalty` cap 0.18→0.35, per-hit 0.06→0.12
4. **Exploration**: 10% chance of random from top 5, using time-seeded hash
5. **Provider diversity**: >35% same provider in last 10 chats → 0.10 penalty
6. **Cross-conversation tracking**: Store last 20 models in `userMemory` or dedicated field
7. **Better utility models**: `preferFree: true` → `preferFree: false` for title/memory extraction (tiny cost, large quality gain)

#### forceMultiAgent guardrails
NEVER honor unless ALL: tier allows (not cheap_only/free_only), org has `orchestratorV2Enabled`, request class ≥ T2, user not over soft budget. If denied: log, explain in route trace, proceed single-agent.

#### Route trace (enhanced)
```typescript
type RouteTrace = {
  requestClass: "T0" | "T1" | "T2" | "T3";
  classificationReason: string;
  stepsExecuted: string[];
  stepsSkipped: { step: string; reason: string }[];
  modelSelection: { selected: string; score: number; topCandidates: { model: string; score: number }[] };
  searchStatus: "real_search" | "model_knowledge" | "skipped";
  costEstimate: number; actualCost: number;
};
```

---

## 4. Architecture: Intelligent Clarification (Interrupt/Resume)

### Current state
- Quiz mode has `<<QUIZ_CLARIFY>>`: "What topic? How many questions? What difficulty?"
- Flashcard mode has `<<FLASHCARD_CLARIFY>>`: "What topic? How many cards? What detail level?"
- Both already emit clarification as assistant messages → user answers → next pipeline run
- No generalized clarification outside quiz/flashcard
- No cached intermediate results

### Alternatives evaluated

**A. Full state serialization in Convex**
- Serialize entire pipeline state to `suspendedTasks` table. Resume by loading.
- Con: Pipeline state is large/complex (RAG results, search results, model catalog). Stale data after 30 min. Schema coupling — every pipeline change requires serialization update. Extensive retrofit of existing code

**B. Lightweight checkpoint + replay**
- Store stage IDs + outputs. On resume, replay pipeline using cached results.
- Pro: Like `@convex-dev/workflow` journal pattern
- Con: Stages must be idempotent (existing pipeline has side effects). Performance cost proportional to completed stages

**C. Two-phase response** ← CHOSEN
- Phase 1: Cheap classification + clarification check. If ambiguous, emit clarification as normal assistant message
- Phase 2: User answers → next turn runs full pipeline with answer in conversation history
- Pro: Zero infrastructure, natural UX, extends existing `<<QUIZ_CLARIFY>>` pattern, no stale state
- Con: Cannot resume mid-generation. Expensive intermediate results (search/RAG) lost between turns

**D. Agent loop with tool calls**
- "Ask clarification" as a Vercel AI SDK tool call that suspends the loop
- Con: LLM decides when to ask (unreliable). Token cost multiplied. Latency per tool call round-trip. Incompatible with current streaming architecture

### Why Two-Phase wins
- The codebase already implements this for quiz and flashcard modes. Generalizing costs almost nothing
- Zero new infrastructure (no workflow engine, no suspended state table, no serialization)
- Natural conversation UX: AI asks, user answers, pipeline runs fresh with full context
- No stale state problems — everything is recomputed
- For the rare case where expensive intermediate results matter: add lightweight `recentContext` cache

### Proposed: Generalized clarification + context cache

#### Generalize existing pattern

Add `needsClarification()` check in `stageClarify()` of the controller:

```typescript
function needsClarification(state: PipelineState): ClarificationBlock | null {
  // Already handled by mode prompts for quiz/flashcard
  if (state.mode === "quiz" || state.mode === "flashcard") return null; // let the model handle via <<CLARIFY>>

  // General clarification triggers:
  if (state.requestClass >= "T2" && isVagueRequest(state)) {
    return buildClarificationBlock(state);
  }
  if (state.mode === "research" && lacksSpecificity(state)) {
    return buildResearchClarification(state);
  }
  if (hasConflictingDirectives(state)) {
    return buildConflictResolution(state);
  }
  return null; // proceed without asking
}
```

**When to ask**: Ambiguous T2+ requests, vague research topics, conflicting directives
**When NOT to ask**: T0/T1 requests, clear intent, quiz/flashcard (already handled), user gave explicit instructions
**Max questions**: 1 clarification block per exchange (may contain 2-3 sub-questions). Never ask twice in a row.

#### Clarification UI

```typescript
type ClarificationBlock = {
  context: string; // "Before I start researching..."
  questions: {
    id: string;
    text: string;
    type: "free_text" | "single_choice" | "multi_choice" | "confirmation";
    options?: { id: string; label: string; description?: string }[];
  }[];
};
```

Emit as structured assistant message with metadata flag `{ type: "clarification" }`. Frontend renders as `ClarificationCard` with appropriate input types (radio buttons, checkboxes, text input). After user submits, answers become a normal user message.

#### Context cache for expensive intermediate results

For T2+ requests where clarification happens AFTER search/RAG:

Add optional `recentContext` field to `chats` table:
```
recentContext: optional string (JSON)
recentContextAt: optional number (timestamp)
```

When pipeline completes search/RAG but then needs clarification:
1. Cache search + RAG results in `recentContext` (max 2000 tokens)
2. Emit clarification

On next turn:
1. Check `recentContext` — if exists and <5 minutes old, inject as "Previous search context"
2. Skip re-executing search/RAG for the clarification answer
3. Clear cache after use

This handles the one weakness of two-phase: losing expensive intermediate results. The cache is lightweight (single field on existing table), auto-expires, and is only used for T2+ requests.

---

## 5. Architecture: Learning Object & Mode Transforms

### Current state
- Each mode has a separate prompt template in `policy.ts` (tutor lines 50-64, marker 66-69, quiz 83-124, flashcard 126-155, etc.)
- No shared state between modes
- "Add more cards" regenerates entire deck
- Mode switching via `suggestMode()` in `auto-settings.ts:401-470` (8-step history-aware logic)
- Mode auto-switch already streamed to client via `mode_update` event

### Proposed: LearningContext object

```typescript
type LearningContext = {
  topics: string[];
  keyFacts: { fact: string; source: "model" | "search" | "rag" | "user"; confidence: number }[];
  misconceptions: string[];
  quizableFacts: string[];
  flashcardCandidates: { front: string; back: string }[];
  difficultyLevel: number; // 1-5
  uncertaintyGaps: string[];
  nextSteps: string[];
};
```

#### Where it lives
New field on `chats` table: `learningContext: optional(v.string())` (JSON serialized, max 3000 chars)

#### How it's populated (near-zero marginal cost)
Piggyback on existing `maybeExtractMemory()` call in post-processing. Same utility model, extended prompt:

```
Current extraction prompt: "Extract durable student facts..."
Extended: "Also extract:
- key facts stated in this response (max 5)
- potential misconceptions identified (max 3)
- facts suitable for quiz questions (max 5)
- flashcard candidates as front/back pairs (max 5)
- uncertainty gaps the student should explore further (max 3)"
```

Estimated additional tokens: ~100 output. Cost: negligible (same model call, slightly longer response).

Merge with existing LearningContext (append, deduplicate by content).

#### Mode transforms

**Quiz from explain**: When switching to quiz after explanation:
- Prompt includes: "Generate questions targeting these specific facts from the lesson: {learningContext.quizableFacts}"
- Difficulty calibrated to `learningContext.difficultyLevel`

**Flashcard from explain**: When switching to flashcard:
- Use `learningContext.flashcardCandidates` directly
- "Add more" → append candidates NOT already in deck

**Research from explain**: When user asks for deeper research:
- Use `learningContext.uncertaintyGaps` as search queries

**Explain after quiz**: When user asks to explain wrong answers:
- Target `learningContext.misconceptions` in explanation

#### Flashcard append fix
In pipeline.ts, when mode=flashcard and user says "add more":
1. Fetch existing `flashcardDecks` for this chat
2. Fetch `learningContext.flashcardCandidates`
3. Prompt: include existing cards (don't repeat) + candidates + "generate N NEW additional cards"
4. After generation: APPEND to existing deck via Convex mutation `flashcardDecks.addCards`
5. Re-render combined deck

#### Mode switching suggestions
After substantive tutor/explain responses, if LearningContext has 5+ quizable facts OR 5+ flashcard candidates:
- Render subtle action buttons below response: `[Quiz yourself]` `[Make flashcards]` `[Research deeper]`
- Not intrusive text — just tappable chips
- Clicking sets mode and sends a pre-filled message

---

## 6. Architecture: Truth/Evidence Layer

### Fix 1: Kill hallucinated search
In `retrieval.ts:386-450`, rewrite model_fallback prompt:
```
"Provide a concise briefing from your training knowledge ONLY.
DO NOT fabricate, invent, or guess any URLs.
Begin with: 'Note: Web search was unavailable.'"
```
Stream `{ type: "search_status", status: "model_fallback" }` → frontend shows banner.
Add to `policy.ts`: "If search results are marked as model_fallback, be transparent about source."

### Fix 2: Parallel SearxNG
In `searxng.ts`: Query 3 instances in parallel (first success wins). Reduce timeout from 6.5s to 4s. Track health with 5-minute cooldown.

### Fix 3: Real-time phase progress
In controller loop (Section 3), BEFORE and AFTER each stage:
```typescript
send({ type: "phase_update", phaseId: stageName, status: "in_progress" });
state = await stages[stageName](state);
send({ type: "phase_update", phaseId: stageName, status: "completed", detail });
```
Frontend: `planned`→clock, `in_progress`→spinner, `completed`→check, `skipped`→skip, `failed`→x

### Fix 4: Source provenance
Extend Citation type with `provenance: "web_search" | "rag_retrieval" | "model_knowledge" | "user_provided"`.
Source cards: web=globe+cyan, rag=document+blue, model=brain+gray, user=user+green.

---

## 7. Architecture: UI/Product System

### 7A. Chat width reduction
Target: `max-w-[680px] mx-auto` on message container + composer. Creates generous side margins, makes content readable, gives right panel room without compressing chat.
**Files**: `chat-messages.tsx`, `chat-composer.tsx`, `chat-layout.tsx`

### 7B. Right panel slide animation
`unified-panel.tsx`: `transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease`

### 7C. Setting pill visual distinction
`chat-composer.tsx` SettingPill: Off=gray/dim, Auto=animated gradient border (subtle rotation via `@keyframes`)+sparkle icon, On=solid accent fill. Size: `h-9`→`h-8`. Hover: React state + debounce (replace CSS `group-hover`).

### 7D. Orchestrator progress UI
Real-time phase list from controller events. Spinner for in_progress, check for completed, skip for skipped. Auto-collapse when done.

### 7E. Sidebar collapsed fixes
Streak/XP: stack vertically. Timer/feedback: portal rendering. Notifications: remove `overflow: hidden`.

### 7F. Header alignment
Shared `--header-height: 56px`. Both headers use same height + bottom shadow.

### 7G. Model display on chat switch
Clear on `selectedChatId` change. Skeleton until model known from `modelUsed` field.

### 7H. Source cards sizing
Reduce height ~50%. Compact horizontal layout. Domain + title only, expand on click.

### 7I. Inline code preview
`markdown-renderer.tsx`: "Code / Preview" toggle on previewable blocks (HTML/CSS/JS/React/Mermaid). Toggle between SyntaxHighlighter and CodePreview inline.

### 7J. Preview sandbox fix
**Root cause confirmed**: CSP `default-src 'none'` in `code-sandbox.ts:6` blocks all CDN scripts. Mermaid loads from `cdn.jsdelivr.net/npm/mermaid@11` (blocked). React loads React+ReactDOM+Babel from CDN (all blocked).

**Fix**: Relax CSP to allow jsdelivr CDN within the sandboxed iframe:
```
script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net;
```
The iframe is already sandboxed with `sandbox="allow-scripts"` (no same-origin, no popups, no forms). Adding CDN to CSP within a sandboxed iframe is safe — the worst case is the CDN script runs inside an isolated sandbox with no access to the parent page.

**PostMessage scoping**: Add unique `frameId` to each iframe instance. In `code-sandbox.ts` RESIZE_SCRIPT, include `frameId` in events. In `code-preview.tsx`, filter events by `frameId` instead of accepting all `window.postMessage` events.

### 7K. Branch navigation UI
Schema: Add `parentMessageId`, `siblingIndex`, `siblingCount` to `messages` table (all optional, existing messages unaffected).
Edit flow: Create sibling message + new response branch. Display `◀ 2/3 ▶` on messages with `siblingCount > 1`.

### 7L. Clarification UI
New `ClarificationCard` component in `chat-messages.tsx`. Renders structured questions with appropriate input types. Submit sends answers as user message.

---

## 8. Architecture: School Context

### 8A. Rich school context injection
Extend runtime context in `pipeline.ts:1566-1573`:
```
School: ${orgName} (${schoolType} school, ${country})
Curriculum: ${curriculum} — ${examBoard}
System: Assume student follows ${curriculum}. Calibrate vocabulary, examples, assessment.
```
New fields on `orgs`: `curriculum`, `examBoard`, `gradeLevels`, `pedagogyNotes`

### 8B. Curriculum-aware defaults
When IB: Use IB rubric criteria, command terms (analyze, evaluate, discuss), academic source priority.
When AP: Similar AP calibration.
Fallback: General with no specific calibration.

### 8C. Dynamic school branding
`providers.tsx` or `layout.tsx`: Read `org.primaryColor`/`accentColor` → set `--brand-primary`/`--brand-secondary` CSS vars. Replace hardcoded accents throughout.

---

## 9. Proactive Continuity

### "Stay silent unless valuable" policy
Surface ONLY when: 5+ flashcards due, streak at risk today, active study plan has pending items, new chat matches recent topic.
NEVER: random suggestions, generic tips, topics inactive 30+ days, more than 1 suggestion per session.

### Implementation
Existing cron (`generateDailyStudyReminders`) already generates notifications. On new chat, check `artifactIndex` for continuations. Show as dismissible banner above composer.

---

## 10. Preserved Bug & Polish Backlog

★ = addressed by architectural redesign. ● = standalone fix.

### Critical Bugs
- ● **Contact form auth**: Add `/api/contact` to `isPublicRoute` in `proxy.ts:4`
- ★ **Search hallucination**: Section 6, Fix 1
- ● **File upload stalled**: Retry if `status=processing` and `updatedAt > 90s`. Surface errors. Gate RAG if 0 resources
- ● **Canvas label.trim**: Guard `String(label ?? "")` in parent save handler (not in code-canvas.tsx itself)
- ● **Speech-to-text**: Add `useEffect` watching `speech.transcript` in `chat-composer.tsx`. Dynamic `recognition.lang`

### Landing Page
- ● **Logo SVG redesign**: Proper 3D ribbon folding, clean color boundaries, synced favicon
- ● **Hero model names**: Remove versions → "Claude", "GPT", "Gemini", "Deepseek"
- ● **Prism animation**: Internal refraction gradient, fix text clipping, animate text reveal
- ● **Mode card animation**: `transform-origin: center center`, reduce scale 15%
- ● **Soul diagram pulse**: Animated dot along SVG paths on AI Core hover
- ● **Sidebar "Spectra" text**: Add below school name in sidebar

### Flashcard & Study
- ★ **Add more cards**: Section 5 (append via LearningContext)
- ● **Manual flashcard editing**: Inline edit on card faces → Convex mutation
- ● **Flashcard UI polish**: Remove duplicate progress bar, add gap-4 between card and rating buttons
- ● **Spaced repetition reminders**: Wire existing cron notifications to new chat surface
- ★ **Mode switching**: Section 5 (action chips below response)

### Chat UI
- ★ **Chat width**: Section 7A (680px max)
- ★ **Setting pills**: Section 7C (auto/off/on distinction)
- ★ **Phase progress**: Section 6 Fix 3 (real-time)
- ★ **Right panel animation**: Section 7B
- ★ **Header alignment**: Section 7F
- ★ **Sidebar collapsed**: Section 7E
- ★ **Model display on switch**: Section 7G
- ★ **Source cards**: Section 7H
- ★ **Preview sandbox**: Section 7J (CSP fix)
- ★ **Branching**: Section 7K
- ● **Token count**: Ensure `done` event sums ALL subcalls
- ● **Title generation**: `preferCheap` not `preferFree`, add retry

### Routing
- ★ **Model diversity**: Section 3 (new weights, free ceiling, exploration, provider diversity)
- ★ **RAG gating**: Skip embedding if 0 processed resources
- ★ **forceMultiAgent**: Section 3 (guardrails)

---

## 11. Phased Implementation Strategy

### Phase 0: Foundation & Instrumentation
**Goal**: Fix critical bugs. Add classification infrastructure.

1. Fix contact form auth (`proxy.ts`)
2. Fix search hallucination (rewrite model_fallback, add search_status event)
3. Fix file upload stalled (retry + error surfacing)
4. Fix speech-to-text (transcript watcher)
5. Fix canvas label.trim
6. Add `classifyRequest()` extending existing `classifyComplexity()` → T0-T3
7. Add real-time phase events at each pipeline step
8. Fix token count (sum all subcalls)
9. Fix title generation (`preferCheap`, retry)
10. Add `learningContext` field to `chats` schema (prep for Phase 3)

**Test gate**: Contact form works. Search shows model_knowledge banner. STT transcribes. Simple messages classified T0/T1. Phase progress shows real transitions.

### Phase 1: Controller + Routing + Truth
**Goal**: State machine refactor. Cost-tiered execution. Model diversity.

1. Extract pipeline.ts into discrete stage functions + PipelineState
2. Implement PipelineController with execution plan by request class
3. Add cost gates (skip search/RAG/multi-agent for T0/T1)
4. Rebalance routing weights (free ceiling, antiLockIn, repetition penalty)
5. Add exploration epsilon, provider diversity penalty
6. Gate forceMultiAgent behind tier + feature + budget
7. Parallel SearxNG queries
8. Enhanced route trace with request class
9. Gate RAG if 0 processed resources
10. Use `preferCheap` for utility models

**Test gate**: "Hello" stays T0 (<$0.001). Research escalates to T2. 10 messages use 5+ models. forceMultiAgent denied for cheap_only.

### Phase 2: Hidden Memory Fabric
**Goal**: Embedding-based topic memory. Anti-contamination. Corrections.

1. Create `userMemoryEntries` Convex table with vector index
2. Implement memory write router with pending/confirmed states
3. Implement embedding-based memory read (reuse RAG vector infrastructure)
4. Add Layer 2 always-inject for identity/profile entries
5. Implement negative topic links
6. Implement correction pathways in `parseUserDirectives()`
7. Add Memory Management UI in unified-panel.tsx
8. Enhance school context injection (Layer 1)
9. Expand runtime context with curriculum, examBoard, gradeLevels

**Test gate**: WWII memory NOT injected for French request. "Forget X" removes entries. Identity facts stored immediately. Memory UI shows entries with delete.

### Phase 3: Learning Object + Mode Integration
**Goal**: Shared learning state. Mode transforms. Flashcard append.

1. Implement LearningContext extraction (piggyback on memory extraction)
2. Implement mode transforms using LearningContext
3. Fix flashcard "add more" to append
4. Add manual flashcard editing
5. Fix flashcard UI (progress bar, spacing)
6. Add mode switching suggestion chips
7. Wire spaced repetition reminders to notification surface

**Test gate**: After explain, quiz uses extracted facts. "Add more" appends. Mode switch chips appear after 5+ facts.

### Phase 4: Clarification + Proactive Continuity
**Goal**: Generalized clarification. Context cache. Continuations.

1. Implement `needsClarification()` in controller's `stageClarify()`
2. Implement `ClarificationCard` frontend component
3. Add `recentContext` cache field to `chats` table
4. Implement context cache write/read with 5-minute TTL
5. Implement continuation suggestions on new chat
6. Wire streak/flashcard reminders to dismissible banner

**Test gate**: Vague research request triggers clarification. Clear request proceeds. Due flashcards show banner.

### Phase 5: UI/Product System
**Goal**: Premium feel. Working previews. Branching.

1. Chat width 680px
2. Right panel slide animation
3. Setting pill auto/off/on distinction
4. Orchestrator progress UI
5. Sidebar collapsed fixes
6. Header alignment
7. Model display on switch
8. Source cards compact
9. Inline code/preview toggle
10. CSP fix for preview sandbox (`https://cdn.jsdelivr.net`)
11. PostMessage scoping (frameId)
12. Branch navigation (schema + UI)
13. Composer spacing/buttons
14. School branding CSS vars
15. Landing page polish (logo, prism, mode cards, soul diagram, hero names)

**Test gate**: Chat readable at 680px. Panel slides. Auto pills distinct. Previews work. Branches navigable.

### Phase 6: Polish & Reliability
**Goal**: End-to-end validation. Cost audit. Regressions.

Run all scenario tests (Section 12). Fix issues found.

---

## 12. Testing & Evaluation Plan

| # | Scenario | Expected | Validates |
|---|----------|----------|-----------|
| 1 | "hello" | T0, <$0.001, no search/RAG/memory | Cost discipline |
| 2 | "What is photosynthesis?" | T1, school context injected | Standard routing |
| 3 | "Research climate change" | T2, real SearxNG OR transparent fallback | Search truth |
| 4 | SearxNG down + research | "Model knowledge" banner, no fake URLs | Fallback honesty |
| 5 | "Make flashcards" (vague) | Clarification via `<<FLASHCARD_CLARIFY>>` | Existing clarification |
| 6 | "Research X" (vague, T2) | General clarification question | New clarification |
| 7 | User answers clarification | Pipeline runs with full context | Resume flow |
| 8 | "Add more cards" | Appended, no duplicates | Flashcard fix |
| 9 | Upload PDF → ask about it | Processes, RAG retrieves, citations | File + RAG |
| 10 | WWII chat → new French chat | No WWII memory in French | Memory isolation |
| 11 | "Remember I study IB HL" | Layer 2 identity, high confidence | Memory write |
| 12 | "Forget about WWII" | Entries removed | Correction |
| 13 | "Use Claude" in free_only | Denied, route trace explains | Tier enforcement |
| 14 | "Use sub-agents" on simple Q | Denied if T0/T1 | Multi-agent gate |
| 15 | Multiple code previews | No cross-iframe events | PostMessage scope |
| 16 | Orchestrator during research | Real-time phase transitions | Phase truth |
| 17 | 10 varied messages | 5+ different models | Routing diversity |
| 18 | Edit a message | Branch created, navigation visible | Branching |
| 19 | IB school student question | IB-calibrated response | School context |
| 20 | Explain → "quiz me" | Quiz targets explained facts | Learning object |

### Cost checks (target)
- T0: <$0.002 avg | T1: <$0.01 avg | T2: <$0.05 avg | T3: <$0.15 avg
- 100 mixed requests: <$1.50 total

---

## 13. Cost Discipline Model

### Real cost breakdown (from codebase analysis)
- Background overhead per request: ~$0.0005-0.002 (title + memory + embedding)
- Simple free model response: $0.00
- Mid-range paid response: $0.005-0.02
- Multi-agent (full): $0.03-0.24

### What prevents token drain
1. **Request classification**: T0 skips auto-settings, memory, RAG, search, memory extraction
2. **RAG gating**: Skip if 0 processed resources (saves embedding call)
3. **Multi-agent gating**: T3 only, tier + budget + feature checks
4. **Utility model quality**: Pay $0.001 more for title/memory to avoid retries
5. **LearningContext**: Piggybacks on memory extraction (zero marginal cost)
6. **Clarification**: $0.001 question saves $0.05+ wasted T2 response

### Progressive budget enforcement (enhancing existing)
- Under 80%: all tiers available
- 80-95%: T3 blocked, T2 requires explicit user selection
- 95-100%: T2+T3 blocked, only T0+T1
- Over: free models only (existing `free_only` tier)

---

## 14. Risks & Tradeoffs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Embedding-based memory retrieval adds latency (50-150ms) | Slight delay on T1+ requests | Reuse RAG embedding if available (same message), parallelize with other pipeline steps |
| State machine refactor breaks existing flows | Pipeline regression | Extract stages incrementally, keep existing tests passing at each step |
| Two-phase clarification loses expensive intermediate results | Re-execution cost on resume | recentContext cache (5-min TTL) caches search/RAG results between turns |
| Request classification errors (T0 when should be T2) | Degraded response quality | Conservative default (T1 for ambiguous). Log decisions. Tune from real usage |
| Memory schema migration | Existing data needs handling | New fields optional. Existing entries default to "confirmed", no category. No destructive migration |
| Branching adds schema complexity | Data model complexity | Optional fields with defaults. Branch UI only appears when siblingCount > 1 |

### Key architectural tradeoff: Embedding-based memory vs. Topic tags
**Chose embeddings because**: Reuses existing Convex vector infrastructure. Handles semantic similarity (French Revolution ↔ Napoleonic Wars). No taxonomy drift. Cost negligible ($0.000002/entry).
**Gave up**: Debuggability (tags are human-readable, embeddings are not). Speed (tag filtering is O(1) index lookup, vector search is slower).
**If embeddings prove too slow**: Fall back to tag-based filtering as Layer 3b alongside embeddings.

### Key architectural tradeoff: State machine vs. pipeline-with-gates
**Chose state machine because**: Testable stages. Enables interrupt/resume. Positions for future LLM planner. Formalizes existing conditional logic.
**Gave up**: Simplicity of single function. Familiarity of current code.
**Risk mitigation**: Incremental extraction. Each stage must pass existing integration tests before extracting the next.

---

## Appendix: Key Files

| File | Role |
|------|------|
| `src/lib/orchestrator/pipeline.ts` | Main pipeline (~1500 lines) → refactor target |
| `src/lib/routing/phase-router.ts` | Model scoring → rebalance weights |
| `src/lib/orchestrator/retrieval.ts` | RAG + search → fix hallucination |
| `src/lib/orchestrator/post-process.ts` | Memory extraction + title → extend for LearningContext |
| `src/lib/orchestrator/task-graph.ts` | Multi-agent DAG → guard forceMultiAgent |
| `src/lib/orchestrator/streaming.ts` | Streaming → real-time phase events |
| `src/lib/prompts/policy.ts` | System prompts → inject LearningContext, school context |
| `src/lib/auto-settings.ts` | Classification → extend to T0-T3, generalize clarification |
| `src/lib/search/searxng.ts` | Search → parallel instances |
| `src/lib/code-sandbox.ts` | Preview sandbox → CSP fix |
| `src/lib/flashcard-format.ts` | Flashcard parsing → append support |
| `convex/schema.ts` | Database schema → new tables/fields |
| `convex/memory.ts` | Memory CRUD → new userMemoryEntries |
| `convex/rag.ts` | Vector search → reuse for memory retrieval |
| `src/components/chat/chat-layout.tsx` | Layout → width reduction |
| `src/components/chat/chat-composer.tsx` | Composer → pill states, spacing |
| `src/components/chat/unified-panel.tsx` | Right panel → animation, memory UI |
| `src/components/chat/chat-messages.tsx` | Messages → branching, clarification UI |
| `src/components/chat/markdown-renderer.tsx` | Rendering → inline preview, sources |
| `src/components/chat/code-preview.tsx` | Preview iframe → frameId scoping |
| `src/hooks/use-chat-state.ts` | State management → controller integration |
| `src/proxy.ts` | Auth middleware → contact form fix |
