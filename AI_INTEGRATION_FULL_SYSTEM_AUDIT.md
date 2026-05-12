# AI Integration System Full Audit Report

**Date**: May 12, 2026  
**Audit Mode**: SPEC / READ-ONLY  
**Scope**: Complete AI Integration Layer

---

## 1. Executive Summary

This report documents the complete architecture, behavior, and failure modes of the Spectra AI integration system. The system is a complex multi-layered orchestration platform that combines model routing, streaming responses, tool execution, multi-agent collaboration, file/resource management, and workspace/artifact integration.

**Key Findings:**

1. **Architecture**: The system uses a unified orchestration pipeline (`src/lib/orchestrator/pipeline.ts`, ~6184 lines) that serves three surfaces: chat, workspace, and artifacts. Despite apparent unification, each surface has significantly different behavior.

2. **Model Routing**: The system employs a sophisticated multi-phase routing system with heuristic routing (`src/lib/routing/heuristic.ts`), capability-first brokering (`src/lib/model-broker.ts`), and phase-based selection (`src/lib/routing/phase-router.ts`). However, model selection is NOT anchored at the conversation level—each message can trigger re-routing, leading to potential instability.

3. **Streaming**: The system uses Server-Sent Events (SSE) with NDJSON streaming. Runtime events flow through a unified contract (`src/lib/orchestrator/runtime-contract.ts`) but are converted to legacy format for client consumption, creating potential for divergence between internal state and displayed UI.

4. **Tools**: 24 AI tools are defined (`src/lib/orchestrator/tool-definitions.ts`) with access controlled by assignment levels (L0-L4). Tool execution flows through a dedicated executor (`src/lib/orchestrator/tool-executor.ts`, 1270 lines).

5. **Multi-Agent**: The system supports specialist agents with task graph orchestration (`src/lib/orchestrator/task-graph.ts`). Six task roles are defined: workflow_planner, retriever, web_researcher, vision_interpreter, code_helper, curriculum_planner, fact_checker, pedagogy_coach, exam_strategist, critic, and synthesizer.

6. **Critical Problems**:
   - No conversation-level model anchoring (each message re-routes)
   - Cross-page behavioral inconsistency (chat has full features, workspace/artifact have limited)
   - Decorative "thinking" UI that may not reflect actual model state
   - Clarification flow breaks conversation continuity
   - File resources can enter unrecoverable failed states that still count toward limits

---

## 2. Current Architecture: Plain-English System Map

### 2.1 High-Level Component Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACES                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐    │
│  │   Chat UI    │  │  Workspace UI    │  │      Artifact UI                │    │
│  │ /chat page   │  │  /workspace      │  │      /artifacts                │    │
│  └──────────────┘  └──────────────────┘  └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              STATE MANAGEMENT                                    │
│  ┌──────────────────────┐  ┌────────────────┐  ┌──────────────────────────┐     │
│  │ useChatState hook   │  │ useChatPanel   │  │  Zustand stores          │     │
│  │ (full chat state)   │  │ (lightweight)  │  │  (workspace, editor)      │     │
│  └──────────────────────┘  └────────────────┘  └──────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API ROUTE LAYER                                     │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐      │
│  │ /api/chat       │  │ /api/workspace-data   │  │ /api/resources        │      │
│  │ (main AI entry) │  │ (workspace queries)  │  │ (file uploads)        │      │
│  └─────────────────┘  └──────────────────────┘  └────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATION PIPELINE                                   │
│                     (src/lib/orchestrator/pipeline.ts)                           │
│                                                                                 │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐        │
│  │   Pipeline    │──│   Route      │──│   Streaming │──│   Tool      │        │
│  │   Controller  │  │   Plan       │  │   Engine    │  │   Executor  │        │
│  └───────────────┘  └──────────────┘  └──────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND SERVICES (Convex)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐         │
│  │  chats.ts   │  │ artifacts.ts│  │ resources.ts│  │ workspaceItems.ts│        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐         │
│  │  agents.ts  │  │ memory.ts   │  │    rag.ts   │  │ ingestQueue.ts  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL PROVIDERS                                       │
│  ┌─────────────────────────────────────┐  ┌────────────────────────────┐       │
│  │      OpenRouter API                 │  │      Convex Storage        │       │
│  │ (model routing, chat, embeddings)   │  │ (file storage, database)   │       │
│  └─────────────────────────────────────┘  └────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Entry Points

1. **Chat Page** (`/chat`): Full AI feature set via `ChatLayout` component (`src/components/chat/chat-layout.tsx`)
2. **Workspace** (`/workspace`): Simplified AI via `QuickChat` component in workspace chrome (`src/components/workspace-v2/chrome.tsx`)
3. **Artifacts** (`/artifacts`): Per-artifact AI via `ArtifactAISurface` component (`src/components/artifacts/artifact-ai-surface.tsx`)

### 2.3 Key File Locations by Domain

| Domain | Primary Files |
|--------|---------------|
| Model Routing | `src/lib/routing/heuristic.ts`, `src/lib/routing/phase-router.ts`, `src/lib/model-broker.ts`, `src/lib/model-selection.ts` |
| Model Catalog | `convex/models.ts`, `convex/curatedModelRegistry.ts`, `src/lib/openrouter-catalog-cache.ts` |
| Streaming | `src/lib/chat/streaming.ts`, `src/lib/orchestrator/runtime-contract.ts` |
| Pipeline | `src/lib/orchestrator/pipeline.ts`, `src/lib/orchestrator/pipeline-controller.ts` |
| Tools | `src/lib/orchestrator/tool-definitions.ts`, `src/lib/orchestrator/tool-executor.ts` |
| Multi-Agent | `src/lib/orchestrator/task-graph.ts`, `src/lib/orchestrator/streaming.ts` |
| Clarification | `src/lib/orchestrator/clarification.ts`, `src/components/chat/clarification-card.tsx` |
| Files/Resources | `convex/resources.ts`, `convex/ingestQueue.ts`, `src/lib/attachments/normalizer.ts` |
| Workspace | `convex/workspaceItems.ts`, `convex/workspaceItemSync.ts` |
| Artifacts | `convex/artifacts.ts`, `src/lib/artifacts.ts` |

---

## 3. AI Run Lifecycle: From User Action to Persisted Result

### 3.1 Complete Lifecycle Flow

```
USER ACTION
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. INPUT PREPARATION (Frontend)                                              │
│    - useChatState hook captures user input                                  │
│    - File attachments normalized via normalizeAttachments()                │
│    - Draft message persisted to localStorage                                │
│    - streamPhase set to "idle"                                              │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼ POST to /api/chat
    │
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. PIPELINE INITIALIZATION (pipeline.ts)                                    │
│    - Parse request body (input, mode, thinkingLevel, attachments, etc.)    │
│    - Fetch active workstream context if workstreamId provided              │
│    - Determine surface: "chat" | "workspace" | "artifact"                  │
│    - Build routing context (classifyRequest stage)                         │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. ROUTE PLAN CONSTRUCTION (route-plan.ts + pipeline-controller.ts)        │
│    - classifyRequest: T0-T3 request class determination                     │
│    - autoSettings: Mode/thinking level inference                           │
│    - buildRoutePlan: Build RoutePlan object with:                          │
│      * taskClass, assignmentLevel, tokenBudgetTarget                       │
│      * allowedToolBundles, retrievalScopes, memoryScopes                   │
│      * orchestrationProfile, searchPlan, workspaceAction                  │
│    - emit "phase_update" event: "compacting"                               │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. CONTEXT PREPARATION                                                       │
│    - memoryRead: Query user/workstream memory                              │
│    - ragRetrieval: Vector search against resources (if scope enabled)      │
│    - webSearch: Execute search if needed                                   │
│    - emit phase events: "routing", "searching"                             │
│    - Build layered context: system + history + memory + retrieval          │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. MODEL SELECTION (phase-router.ts)                                        │
│    - selectModelForPhase() based on RoutePlan requirements                 │
│    - runCapabilityFirstBroker() for capability-first selection             │
│    - emit "model_selected" event with routeTrace                            │
│    - Model selection NOT anchored per conversation                        │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 6. CLARIFICATION CHECK (clarification.ts)                                   │
│    - needsClarification() checks for:                                       │
│      * Conflicting directives (e.g., "latest" + "don't search")          │
│      * Lacks research specificity in research mode                         │
│      * Vague enhanced requests                                              │
│    - If clarification needed:                                               │
│      - Generate clarification block via LLM                                  │
│      - Store in route.trace.clarificationBlock                            │
│      - Emit "phase_update" with clarification_interrupt                     │
│      - STREAM STOPS HERE - user sees ClarificationCard                     │
│    - If no clarification: Continue to generation                           │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7. EXECUTION PHASE                                                           │
│                                                                              │
│    RoutePlan.orchestrationProfile determines execution:                    │
│                                                                              │
│    A) "simple_direct": Single model, no specialists                        │
│       - runAssistantStreaming()                                            │
│       - Tool loop: completion → tool_call → tool_result → completion       │
│       - Max tool rounds: 10                                                 │
│                                                                              │
│    B) Multi-agent (search_synthesis, artifact_builder, etc.):            │
│       - runCollaborativeStreaming()                                         │
│       - buildTaskGraph() creates nodes for planner/specialists/critic     │
│       - executeGraph() runs nodes respecting dependencies                 │
│       - emit "agent_summoned", "collab_progress", "collab_done" events    │
│       - Synthesis phase merges all specialist outputs                     │
│                                                                              │
│    Streaming events emitted during execution:                              │
│    - "delta": Token-by-token response chunks                                │
│    - "thinking": Reasoning content                                          │
│    - "thinking_segment": Structured thinking phases                        │
│    - "tool_call": Tool invocation started                                   │
│    - "tool_result": Tool execution completed                               │
│    - "helper_worker_started/finished": Sub-agent status                   │
│    - "phase_update": Pipeline phase progress                                │
│    - "mode_switched": Study mode changed                                    │
│    - "artifact_patch_applied": Artifact modified                            │
│    - "widget_created/updated": Workspace mutation                          │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 8. POST-PROCESSING                                                           │
│    - Memory write: extractAndStoreMemory() if shouldWriteMemory            │
│    - Artifact auto-save: generateArtifactResources() if policy="auto"     │
│    - Workspace sync: syncWorkspaceItemForChat/Artifact/Planner             │
│    - Citations formatted and attached to message                           │
│    - Route trace finalized with execution events                           │
└──────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 9. STREAM COMPLETION                                                         │
│    - Emit "done" event with:                                               │
│      * messageId, routeTrace, modelUsed, activeModel                      │
│      * citations, thinkingContent, renderInstructions                     │
│      * artifactUpdates                                                      │
│    - Client accumulates via ChatMessageAccumulator                          │
│    - Message persisted to Convex (chats.ts mutation)                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stream Event Conversion

The system maintains two event schemas:
1. **Runtime Events** (`src/lib/orchestrator/runtime-contract.ts`): Internal format
2. **Legacy Chat Events** (`toLegacyChatStreamEvent()`): Client format

This conversion is lossy—some runtime events map to different legacy events:
- `mode_switched` → `mode_switch`
- `navigation_instruction` → `thread_fork`
- `model_selected` → `route_model`

### 3.3 Key State Variables

**Frontend (useChatState hook):**
- `streamPhase`: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing"
- `streamModelUsed`: Currently streaming model ID
- `draftResponses`: Per-chat accumulated response text
- `draftThinkings`: Per-chat accumulated thinking content
- `activeStreamIds`: Set of chat IDs with active streams

**Backend (pipeline.ts):**
- `route.trace`: Full RouteTrace with candidates, phases, execution events
- `route.trace.clarificationBlock`: Clarification questions if interrupt triggered
- `route.trace.selected`: Final model selection
- `recentContextCache`: Cached retrieval/search for clarification reuse

---

## 4. Model Routing and Model Identity

### 4.1 Model Registry Architecture

**Three Registry Layers:**

1. **Curated Model Registry** (`convex/curatedModelRegistry.ts`):
   - Static metadata for specific models (release dates, benchmarks, arena ELO)
   - Models: GPT-4.1-mini, GPT-4o, Claude Sonnet 4.5, Claude Opus 4.1, Gemini 2.5 Pro, DeepSeek R1/V3, Llama 3.3, Qwen3-32B, MiniMax M2.5
   - Function: `lookupCuratedModelMeta(modelId)` with prefix matching

2. **Model Catalog** (`convex/models.ts`):
   - Database table `modelCatalog` populated from OpenRouter
   - Seeded defaults: tutorFast (Step 3.5 Flash), tutorHigh (MiniMax M2.5), marker (Qwen3 Next 80B), multimodal (Gemma 3 27B Vision), openrouterAuto, glmAir, gptOss, markerHard
   - Functions: `listModels`, `listFeaturedModels`, `recordModelRun`, `evaluateChallengerLane`

3. **Live OpenRouter Catalog** (`src/lib/openrouter-catalog-cache.ts`):
   - Client-side 30-minute TTL cache
   - Function: `getLiveCatalogSnapshot()` fetches from OpenRouter or falls back to DB
   - Limits to 260 models, deduplicates by modelId

### 4.2 Routing Components

**Heuristic Router** (`src/lib/routing/heuristic.ts`):
- `chooseModelRoute(input)`: Main entry point
- `dynamicRouteFromCatalog(params)`: Catalog-driven routing
- `rankCandidates(params)`: Scoring and ranking
- Features: Manual mode, OpenRouter auto delegation, free tier routing, tutor complexity upgrade, conversation continuity

**Phase Router** (`src/lib/routing/phase-router.ts`):
- `selectModelForPhase(input)`: Phase-level selection
- `buildPhasePlan(params)`: Build routing phase plan
- Integrates capability-first broker
- Exploration mode (10% random selection within score window)

**Model Broker** (`src/lib/model-broker.ts`):
- `runCapabilityFirstBroker(params)`: Main broker selection
- `scoreBrokerCandidate(model, intent)`: Candidate scoring
- Dynamic weights by request type:
  - T0/quick: capability 18%, cost 26%, latency 24%, reliability 10%, diversity 14%
  - High stakes T3: capability 34%, reliability 18%, cost 19%, freshness 8%, context 8%

**Model Selection** (`src/lib/model-selection.ts`):
- `rankCatalogModels(params)`: Multi-factor scoring
- Factors: Reliability (22%), recency (18%), mode match (20%), cost (13%), speed (10%), reasoning (12%), context (10%), latency (8%)
- `pickModelAndFallbacks(params)`: Returns selected model + ranked fallbacks

### 4.3 Model Configuration

**Model Config** (`src/lib/model-config.ts`):
- `MODEL_CONFIG`: Role-based model IDs (utilityFree, tutorFast, tutorHigh, marker, multimodal, autoRouter, etc.)
- `EMERGENCY_MODEL_FALLBACKS`: Static fallback chains
- `ROUTER_FALLBACKS`: Dynamic fallback chains
- Functions: `resolveModelForRole()`, `getRouterFallbacks()`, `getRecommendedModelsForMode()`

**Model Policy** (`src/lib/model-policy.ts`):
- Cost caps per routing lane: utility: 6, fast_chat: 10, deep_reasoning: 10, vision: 25, image_gen: varies
- Default: $8/million tokens, Cheap threshold: $3/million

### 4.4 Critical Issues with Model Routing

1. **No Conversation-Level Anchoring**: Model is re-selected for each message using only the current message context, not the conversation history. This means:
   - Follow-up messages may route to different models than the original
   - No stability guarantee within a thread
   - Previous model choice reasons are lost

2. **Over-Switching Risk**: The `routePlan` is built fresh for each request. If the input characteristics change slightly, different models may be selected, causing visible instability in long conversations.

3. **Hard-Coded Fallbacks**: While the system has sophisticated routing, the `MODEL_CONFIG` contains hard-coded model IDs that may become stale as provider offerings change.

4. **Model ID Mismatch Risk**: The UI shows `routeTrace?.selected?.modelId` but this is the result of the routing decision, not necessarily what the model actually used (though in practice they should match).

5. **Chinese/Open-Weight Providers**: The system includes Chinese models (DeepSeek, Qwen, MiniMax) in the curated registry, but there's no indication of preferential treatment or special handling for these providers versus Western alternatives.

---

## 5. Conversation-Level Model Anchoring and Switching Behavior

### 5.1 Current Behavior

**The system does NOT anchor model selection at the conversation level.** Each user message triggers:

1. Fresh `RoutePlan` construction from the current message
2. New model selection via `selectModelForPhase()`
3. No reference to previously selected model for the same chat

**Evidence:**
- `pipeline.ts` line ~1100: `routePlan` is built from `body.input` alone
- `phase-router.ts`: No conversation context parameter
- `use-chat-state.ts`: `streamModelUsed` is set per-stream, not preserved across messages

### 5.2 Switching Scenarios

| Scenario | Current Behavior |
|----------|------------------|
| User sends first message | RoutePlan built, model selected fresh |
| User sends follow-up | RoutePlan built fresh, likely same model (by coincidence) |
| User changes mode | RoutePlan rebuilt, different model likely |
| User switches model manually | Stored in `manualModel`, but still re-routes for next message |
| Model fails mid-stream | Fallback chain used, may switch to different model |
| Context window pressure | Compaction triggered, but no model change |

### 5.3 Impact on User Experience

- **Visible instability**: Users may see model badges change mid-conversation
- **Context loss risk**: If model switches, the new model may not have full context awareness
- **Tool inconsistency**: Different models have different tool capabilities
- **No "why this model"**: The `whyThisResponse` field exists but is generated from generic routing explanation, not actual reasoning

### 5.4 What SHOULD Happen vs What DOES Happen

**Ideal**: Once a model is selected for a conversation, subsequent messages should either:
1. Use the same model by default, OR
2. Have explicit user action to change models

**Actual**: Each message re-evaluates routing from scratch.

---

## 6. Streaming, Events, and Run State

### 6.1 Streaming Protocol

**Format**: Server-Sent Events (SSE) with NDJSON (newline-delimited JSON)

**Server-side** (`pipeline.ts` line ~6177):
```typescript
return new Response(stream.readable, {
  headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  },
});
```

**Client-side** (`streaming.ts`):
- Uses `response.body.getReader()` 
- Decodes and parses each line as JSON
- Yields `ChatStreamEvent` objects

### 6.2 Event Types

**Runtime Events** (`src/lib/orchestrator/runtime-contract.ts`):

| Event Type | Description | Streamed? |
|------------|-------------|-----------|
| `delta` | Text response chunks | Yes |
| `thinking` | Reasoning content | Yes |
| `thinking_segment` | Structured thinking phases | Yes |
| `tool_call` | Tool invocation started | Yes |
| `tool_result` | Tool execution completed | Yes |
| `skill_loaded` | Runtime skill loaded | Yes |
| `memory_read` | Memory retrieval | Yes |
| `memory_write` | Memory storage | Yes |
| `action_proposed` | Proposed action | Yes |
| `action_applied` | Action executed | Yes |
| `artifact_patch_applied` | Artifact modified | Yes |
| `widget_created/updated` | UI widgets | Yes |
| `render_instruction` | Render directives | Yes |
| `navigation_instruction` | Thread/workstream navigation | Yes |
| `model_selected` | Model chosen for execution | Yes |
| `mode_switched` | Study mode changed | Yes |
| `phase_update` | Pipeline phase progress | Yes |
| `done` | Stream complete | Yes |
| `error` | Stream failed | Yes |

### 6.3 Stream Phase Lifecycle

**Frontend phases** (`use-chat-state.ts`):
- `idle`: No active stream
- `compacting`: Context compaction in progress
- `routing`: Model selection in progress
- `searching`: RAG or web search in progress
- `thinking`: Model generating response
- `generating`: Response being streamed
- `synthesizing`: Multi-agent synthesis in progress

**Backend phases** (`pipeline-controller.ts`):
- `classifyRequest` → `autoSettings` → `buildRoutePlan` → `memoryRead` → `ragRetrieval` → `webSearch` → `modelSelection` → `clarificationCheck` → `multiAgent` → `generation` → `rehydration` → `postProcess`

### 6.4 Message Accumulation

**ChatMessageAccumulator** (`src/lib/chat/message-state.ts`):
- Accumulates `assistantContent`, `thinkingContent`, `thinkingSegments`
- Tracks `modelUsed`, `activeModel`, `executionPath`, `citations`
- Handles `cancel()` for stream abort

### 6.5 Issues with Streaming

1. **Event Schema Duality**: Runtime events are converted to legacy format, losing fidelity
2. **Phase Mismatch**: Backend phases differ from frontend phases, causing potential UI confusion
3. **No partial output guarantees**: If stream is interrupted, UI state may be inconsistent
4. **Model appears at end**: `model_selected` event comes after routing, but UI often needs to display model earlier

---

## 7. Thinking / Trace / Status UI

### 7.1 ThinkingBlock Component

**Location**: `src/components/chat/thinking-block.tsx`

**Features:**
- Displays thinking content with expandable sections
- Animated "Thinking" indicator during streaming
- Renders thinking segments with labels
- Shows execution timeline from route trace
- Props: `content`, `streaming`, `routeTrace`, `segments`

### 7.2 RouteTraceDrawer Component

**Location**: `src/components/chat/route-trace-drawer.tsx`

**Features:**
- Detailed model decision timeline
- Shows route plan, candidates, phases, timing
- Displays token breakdown: system, history, memory, sources
- Props: `open`, `onClose`, `trace`, `showCostDetails`

### 7.3 ExecutionTimeline Component

**Location**: `src/components/shared/execution-timeline.tsx`

Visual timeline of pipeline phases with timing information.

### 7.4 Phase Labels (What Users See)

The UI displays labels such as:
- "Analyzing"
- "Writing response"
- "authoring"
- "analysis"
- "checking files"
- "Routing workspace request…"
- "Searching workspace context…"

**CRITICAL**: Many of these labels are hard-coded UI guesses based on `streamPhase`, not actual model events. The system:
- Uses `runtimePhaseLabel()` to map phases to display strings
- Does NOT emit detailed step-by-step status from the model
- Makes assumptions about what the model is doing based on pipeline stage

### 7.5 Trace UI Issues

1. **Decorative vs Real**: The "Thinking" label appears during streaming but may not reflect actual model reasoning—it's a pipeline phase indicator, not a model thought process display.

2. **Duplicated Headings**: `routeTrace` appears in both collapsed (thinking block) and expanded (route trace drawer) views, with duplicated information.

3. **Not meaningful text**: The thinking segments contain generic phase labels, not actual model reasoning.

4. **Sub-agent display**: Worker activity is shown via `helper_worker_started/finished` events, but the display is basic—may not accurately represent what the sub-agent is doing.

5. **Tool calls in trace**: Tools appear as thinking notes but the representation is minimal—hard to understand what each tool did.

---

## 8. Clarification / Ask-User Flow

### 8.1 How Clarification is Detected

**File**: `src/lib/orchestrator/clarification.ts`

**needsClarification()** function checks:
- Request class: Must be T2 or higher
- Study mode: Excluded from quiz/flashcard modes
- Conflict detection: `hasConflictingDirectives()` - conflicting instructions (e.g., "latest" but "don't search")
- Research specificity: `lacksResearchSpecificity()` - vague research in research mode
- Vague enhanced requests: `isVagueEnhancedRequest()` - generic requests like "help me"
- Previous turn: Returns null if last assistant message was already clarification (prevents loops)

### 8.2 Clarification is NOT a Tool Call

Clarification is a **special interrupt state**, not a tool call or model output:

1. Detected during pipeline execution (after model selection, before generation)
2. Stored in `route.trace.clarificationBlock`
3. Toolchain receives `clarification_interrupt` or `clarification_not_needed`
4. LLM generates context-specific questions (via `clarification-generator.ts`)
5. Falls back to heuristic block if generation fails

### 8.3 How Clarification UI Renders

**Component**: `src/components/chat/clarification-card.tsx`

**Rendering** (`chat-messages.tsx` lines 859-922):
- Extracts `clarificationBlock` from message's `routeTrace`
- Renders `ClarificationCard` with:
  - Context text
  - Questions (supports `free_text`, `single_choice`, `multi_choice`, `confirmation`)
  - Submit button that formats answers as structured text

### 8.4 How Answers Flow Back

**User submission** (`clarification-card.tsx` lines 172-183):
```typescript
const lines = ["Clarification answers:"];
for (const question of block.questions) {
  lines.push(`- ${question.id}: ${answer}`);
}
lines.push("Please continue with this scope.");
onSubmit?.(lines.join("\n"));
```

**Detection** (`clarification.ts` lines 358-398):
- `isClarificationFollowUpMessage()` detects responses
- Checks for "Clarification answers:" prefix, structured format

**Context Reuse** (`pipeline.ts` lines 1122-1138, 2009-2055):
- If user responds to clarification, `shouldReuseRecentContext` = true
- Retrieval/search results from cached `RecentContextSnapshot` are reused
- Cache cleared after reuse

### 8.5 Critical Issues with Clarification

1. **Breaks Conversation Continuity**: The clarification appears as a visible user prompt, not a continuation of the same assistant run. This creates visual discontinuity.

2. **Creates Duplicate Messages**: After user answers clarification, the response appears as a new assistant message, not continuation of the interrupted one.

3. **Status Persistence Issues**: Clarification state may not persist correctly across page reloads (though there is rehydration logic in `use-chat-state.ts` lines 1204-1243).

4. **Model Context Format**: The formatted answer text ("Clarification answers:\n- question_id: answer") is a hack—should be structured context.

---

## 9. Tool Integration

### 9.1 Tool Definitions

**File**: `src/lib/orchestrator/tool-definitions.ts` (645 lines)

**24 AI Tools** organized by assignment level (L0-L4):

| Category | Tools |
|----------|-------|
| Memory | `inspect_runtime_context`, `recall_memory`, `save_memory`, `update_memory`, `dismiss_memory` |
| Skills | `search_skills`, `load_skill` |
| Workspace | `get_workstream_context`, `create_note`, `create_workstream`, `create_widget`, `update_widget`, `move_widget`, `attach_items_to_workstream`, `list_merge_candidates`, `update_workstream_layout`, `suggest_workspace_from_topic` |
| Artifact | `propose_actions`, `apply_actions`, `get_version_history` |
| Planning/Mode | `update_planner`, `fork_thread`, `search_web`, `surface_result`, `switch_mode` |

### 9.2 Tool Access by Assignment Level

- **L0**: No tools
- **L1**: 2 tools
- **L2**: 5 tools
- **L3**: 14 tools
- **L4**: All 24 tools

### 9.3 Tool Execution

**File**: `src/lib/orchestrator/tool-executor.ts` (1270 lines)

**executeOrchestratorTool()**:
```typescript
{
  name: AiToolName;
  rawArguments: string;
  context: ToolCallContext;  // actorClerkId, chatId, workstreamId, artifactId, mode, spendingTier
}
```

**Returns**:
```typescript
{
  name: string;
  summary: string;
  modelPayload: object;  // Data for AI context
  eventPayload: object;  // Data for UI events
  modeSwitch?: StudyMode;
  threadFork?: object;
  loadedSkill?: object;
  runtimeEventType: string;
}
```

### 9.4 Tool Loop Execution

**In runAssistantStreaming** (`streaming.ts`):
- Up to 10 tool rounds
- For each tool call:
  1. Emit `tool_call` event
  2. Execute tool via `executeTool()`
  3. Handle side effects (skill load, mode switch, thread fork)
  4. Emit `tool_result` event with summary and result
  5. Add tool result to message history for next iteration

### 9.5 Tool UI Display

Tools appear as "thinking notes" in the trace:
- `tool_call` event shows tool name and arguments
- `tool_result` event shows summary
- No detailed input/output display
- Errors are swallowed or minimal

### 9.6 Critical Issues with Tools

1. **No structured error display**: Tool errors are not clearly visible to users
2. **Limited to L0-L4**: Not all tools available to all users
3. **Tool consistency**: Workspace vs chat have different tool subsets
4. **No tool chaining visibility**: Hard to understand tool execution flow
5. **Weak abstraction**: Tool executor directly calls Convex mutations—brittle

---

## 10. Worker / Sub-Agent Orchestration

### 10.1 Task Graph System

**File**: `src/lib/orchestrator/task-graph.ts`

**Task Roles**:
- `workflow_planner` - Design execution workflow
- `retriever` - Extract evidence from materials
- `web_researcher` - Summarize web evidence
- `vision_interpreter` - Describe visual inputs
- `code_helper` - Review and fix code
- `curriculum_planner` - Create learning plans
- `fact_checker` - Verify claims
- `pedagogy_coach` - Optimize explanations
- `exam_strategist` - Focus on exam constraints
- `critic` - Audit claims for correctness
- `synthesizer` - Merge specialist outputs

### 10.2 Orchestration Profiles

**Defined in RoutePlan** (`types/index.ts`):
- `simple_direct` - Single model, no specialists
- `search_synthesis` - Research with fact-checking
- `artifact_builder` - Building documents/artifacts
- `study_transform` - Flashcards, quizzes, notes
- `image_analysis` - Vision + fact checking
- `workspace_action` - Workspace mutations
- `agent_delegation` - Explicit multi-agent
- `teacher_marking` - Rubric-based feedback
- `long_context_reconstruction` - Context restoration

### 10.3 Graph Execution

**buildTaskGraph()** creates nodes for:
- Planner (if multi-step)
- Specialists (based on profile)
- Critic (if enabled)
- Synthesizer (always for multi-agent)

**executeGraph()**:
- Runs nodes respecting dependencies
- Supports concurrent execution (maxConcurrency)
- Enforces budget limits (tokens, time, subcalls)
- Returns `{result, tokens, durationMs}` per node

### 10.4 Specialist Model Selection

**getSpecialist()** (`specialists.ts`):
- Selects appropriate model based on role requirements (vision, search, reasoning)
- Respects spending tier constraints
- Checks catalog availability

### 10.5 Sub-Agent Communication

**Events** (`streaming.ts`):
- `agent_summoned`: "Agent launched" - sends agent role, model, reason
- `collab_progress`: "Agent progress" - sends status, preview
- `collab_done`: "Agent finished" - sends result
- `collab_synthesizing`: "Synthesis phase" - merges all findings

**No shared memory**: Each specialist runs independently with only the original prompt and their specific context. No shared journal or intermediate state.

### 10.6 Critical Issues with Workers

1. **No shared run journal**: Specialists return isolated outputs, not a collaborative workspace
2. **Weak orchestration**: Results are just appended, not intelligently merged
3. **Excessive spawning**: Profile selection can launch many workers with limited coordination
4. **No intermediate progress visibility**: User sees only start/finish, not what each specialist is doing
5. **Agent traces are cosmetic**: Shown as messages, not actual structured tool traces

---

## 11. File and Resource Pipeline

### 11.1 File Upload Flow

**API Routes**:
- `/api/resources/route.ts` - Main resource uploads
- `/api/personal-resources/route.ts` - My Files
- `/api/packs/[id]/resources/route.ts` - Pack resources

**Client-side** (`resource-upload-validation.ts`):
- `validateResourceUploadFile()` - Validates type, extension, MIME
- `normalizedResourceMimeType()` - Normalizes MIME types
- `uploadToConvexStorage()` - Uploads to Convex storage
- `sha256OfFile()` - Computes hash for deduplication

### 11.2 Supported File Types

**Documents**: PDF, DOCX, PPTX, XLSX, TXT, MD, RTF, ODT, CSV, JSON, YAML, XML
**Code**: PY, JS, TS, JAVA, CPP, C, GO, RS, SQL, SH
**Images**: PNG, JPG, JPEG, GIF, WEBP, SVG
**Audio**: MP3, WAV, M4A

**Blocked**: Videos (MP4, MOV, etc.), Executables (EXE, DLL, etc.)

### 11.3 Resource Processing

**Backend** (`convex/ingestQueue.ts`):

1. **Upload**: File to Convex storage, resource record with status "uploaded"
2. **Enqueue**: `enqueueResourceProcessing()` schedules via scheduler
3. **Process**: `processResource()` runs background:
   - Parse file based on type (PDF, DOCX, etc.)
   - Extract text chunks into pages
   - Generate embeddings via OpenRouter API
   - Store chunks with embeddings
4. **Complete**: Status changes to "processed" with parsed text and embeddings

**Statuses**: `uploaded` → `processing` → `processed` | `failed`

### 11.4 My Files System

**Limits** (`convex/constants.ts`):
- Max personal files: 25 (students)
- Max pack files: 30 (teachers)
- Max chunks per file: 240
- Max chars per file: 250,000

### 11.5 File-to-Context Pipeline

**Retrieval** (`convex/rag.ts`):

1. **Vector Search**: Query embedding vs stored chunk embeddings
2. **Filter by Scope**: Pack/Agent/Personal
3. **Score & Rank**: Embedding similarity + topic relevance
4. **Deduplicate**: Remove duplicate chunks from same resource
5. **Source Block**: Format as text block for model

**Normalization** (`src/lib/attachments/normalizer.ts`):
- `normalizeAttachments()` - Prepares attachments for model input
- Fetches resource metadata, gets download URLs, extracts quick text
- Prepares image blocks for vision models

### 11.6 Error Handling for Failed Files

**Retry Logic**:
- Max 3 processing attempts before marking failed
- Auto-retry via `retryStaleResourcesInternal`
- Manual retry via `/api/personal-resources` with `action=retry_processing`

**Stale Detection**:
- Resources marked "stale" if processing >5min (uploaded) or >5min (processing)

**Error Messages**: Stored in `resource.error` field

### 11.7 Critical Issues with Files/Resources

1. **Failed files still count toward limit**: A failed file counts toward the 25-file limit even though it cannot be used
2. **Failed images not removable**: A failed-processing image may not be removable from the UI
3. **"Resource not found"**: Users see this error when resource is missing or access denied
4. **Model says "not fully processed"**: Models may comment on incomplete file processing
5. **No resource cleanup**: Failed resources may become orphaned
6. **Processing status not removable**: Users cannot clear failed processing status

---

## 12. Workspace AI Integration

### 12.1 How Workspace AI is Triggered

**Entry Point**: `QuickChat` component (`src/components/shared/quick-chat.tsx`)
- Used throughout workspace via `chrome.tsx`
- Accepts text input, triggers AI via `onSubmit`

**Backend Pipeline** (`pipeline.ts` lines 1042-1091):
- Receives `workstreamId` from client request
- Fetches active workstream: planner items, notes, artifacts, linked agents
- Scope determined by `currentWorkstreamFocusSurface()` → "workspace" | "panel" | "chat" | "none"

### 12.2 Workspace Context Sent to Model

**buildWorkstreamRouteContext()** (`pipeline.ts` lines 1505-1580):
```typescript
{
  activeWorkstream: {
    id, title, description, subjectCode, linkedAgentId,
    lastActivityAt, defaultMode, defaultThinking,
    artifactCount, noteCount, plannerItemCount, threadCount,
    recentArtifactTitles: [...],  // last 4
    recentNoteTitles: [...],      // last 4
    recentPlannerTitles: [...]    // last 4
  },
  candidates: [...]  // other available workstreams
}
```

**Tool: get_workstream_context**:
- AI can explicitly call to get concise summary
- Includes: metadata, recent threads, notes, planner items (up to 5 each)

### 12.3 How AI Creates/Updates Workspace Items

**Action Engine** (`action-engine.ts`):
- `create_widget`: Creates widget/item via `workspaceItems:createWidget`
- `update_widget`: Updates properties via `workspaceItems:updateWidget`
- `attach_items_to_workstream`: Attaches chats/artifacts/planner items
- `update_workstream_layout`: Bulk layout update
- `create_note`: Creates artifact via `artifacts:create`
- `update_planner_item`: Manages planner items

### 12.4 How Artifacts Become Workspace Items

**WorkspaceItemSync** (`convex/workspaceItemSync.ts`):

- **syncWorkspaceItemForArtifact**: Maps artifact types to workspace types:
  - `board` → "board"
  - `diagram/concept_map/timeline/image/visualization` → "visualization"
  - `bookmark/reference` → "reference"
  - `audio/video/media` → "media"
  - default → "document"

- **syncWorkspaceItemForChat**: Creates/updates for chat threads
- **syncPlannerWorkspaceProjection**: Creates for planner items

### 12.5 Workspace Projection Mechanism

**Schema** (`workspaceItems` table):
- Identity: orgId, ownerUserId, workstreamId
- Type: "thread" | "document" | "planner" | "board" | "visualization" | "media" | "reference" | "custom" | "utility"
- Spatial: x, y, width, height, zIndex
- State: category, status, pinned, collapsed, hidden
- Provenance: "user" | "ai" | "system"

### 12.6 Critical Issues with Workspace Integration

1. **Simplified AI behavior**: Workspace AI uses `mode="general"`, `thinkingLevel="low"`, limited tools
2. **No file attachments**: Workspace AI does not support file attachment UI
3. **Ephemeral threads**: Messages stored but tied to workspace items, less persistent than chat
4. **Minimal trace UI**: Only runtime request chips, no full execution timeline
5. **Workspace desync risk**: Chat state and workspace state can diverge
6. **Not deterministic for agents**: Workspace behavior is too simplified for reliable agent reasoning

---

## 13. Artifact AI Integration

### 13.1 Artifact Detection

**route-plan.ts**:
- `isArtifactRequest()`: Detects if user wants artifact
- `detectRequestedArtifactFormats()`: Extracts desired formats (docx, pdf, pptx, html)
- Keywords: pdf, docx, pptx, slides, presentation, study guide, worksheet, handout, document, artifact, report, deck

**Artifact Save Policy**:
- `auto`: confidence >= 0.82
- `prompt`: confidence >= 0.60
- `none`: confidence < 0.60

### 13.2 Artifact Types

**16 Types** (`src/lib/artifact-types.ts`):
- Study Plans & Timetables: `study_plan`, `timetable`, `quiz`
- Notes & Documents: `note`, `document`
- Flashcard Decks: `flashcard_deck`
- Generated Media: `code_project`, `diagram`, `image`, `visualization`, `concept_map`, `code_output`, `whiteboard`
- Saved Items: `bookmark`
- Collections: `collection`, `custom`

### 13.3 Artifact Generation

**generateArtifactResources()** (`src/lib/artifacts.ts`):
- Main generation function
- `parseGeneratedDocument()`: Parses AI response for document blocks
- Document block format: `<<DOC_START>>{...json...}<<DOC_END>>`

**Export Formats** (`document-export.ts`):
- `buildDocxBytes`, `buildPdfBytes`, `buildPptxBytes`, `buildHtmlBytes`

### 13.4 Artifact Streaming/Saving

**pipeline.ts** lines 5539-5577:
- Auto-generation when `artifactSavePolicy === "auto"` and mode is "document" or has generated content
- Creates downloadable attachments (docx, pdf, pptx, html)
- Stores as resources via `resources:createUploadUrl` and `resources:registerResource`

### 13.5 Artifact Tools Available to AI

- `create_artifact` - Create new artifact
- `create_child_artifact` - Create child from parent
- `patch_artifact` - Full content replacement
- `replace_range` - Replace text range
- `insert_block` - Insert block at index
- `delete_block` - Delete block range
- `rename_artifact` - Rename artifact
- `restore_artifact_version` - Restore previous version
- `generate_flashcards_from_artifact` - Generate flashcards
- `generate_quiz_from_artifact` - Generate quiz

### 13.6 Critical Issues with Artifacts

1. **No file attachments in AI surface**: Artifact AI uses QuickChat without file support
2. **Per-artifact threads**: Less persistent than full chat
3. **Minimal trace UI**: Route trace not prominently displayed
4. **Document block format is brittle**: Relies on specific `<<DOC_START>>` format
5. **Mode locked to "general"**: Artifact AI uses `mode="general"`, `thinkingLevel="low"`

---

## 14. Cross-Page Consistency

### 14.1 Feature Comparison

| Feature | Chat Page | Workspace | Artifacts |
|---------|-----------|-----------|-----------|
| **Model Routing** | Full auto/manual | Auto only | Auto only |
| **Mode Options** | All modes (tutor, quiz, flashcard, etc.) | general only | general only |
| **Thinking Levels** | low/medium/high | low only | low only |
| **Trace UI** | Full timeline | Minimal chips | Minimal |
| **Full Tools** | Yes (24 tools) | Subset | Yes (via useChatPanel) |
| **File Attachments** | Yes (5 max) | No | No |
| **Message Persistence** | Full | Ephemeral threads | Per-artifact |
| **Orchestration Panel** | Yes (UnifiedPanel) | No | No |

### 14.2 Shared Components

- **useChatPanel hook**: Lightweight chat panel used by artifacts, widgets
- **QuickChat component**: Used in workspace chrome, artifact AI surface
- **Streaming implementation**: Shared `createChatStream()`

### 14.3 Behavioral Inconsistencies

1. **Model selection**: Chat allows manual model selection; workspace/artifacts auto-only
2. **Tool access**: Chat has full 24 tools; workspace has limited subset
3. **Phase labels**: Chat shows full phases; workspace shows custom chips
4. **Clarification**: Chat has full clarification flow; workspace/artifacts may not
5. **Memory**: Chat has memory tools; workspace/artifacts limited
6. **Persistence**: Chat fully persists; workspace/artifacts are more ephemeral

### 14.4 Why This Matters

- Users switching between pages experience different AI capabilities
- Agents cannot rely on consistent behavior across surfaces
- Code duplication: Similar logic replicated in different hooks
- Hard to maintain consistency as features evolve

---

## 15. Recent Changes and Likely Regressions

### 15.1 Recent Git History (Last 30 commits)

```
176c7bb New Router
a1a2ef7 Shimmer animation, improved model UI
f439329 Improved chat and streaming UI
424ffc9 Fix chat UI issues, streamline model selection, and resolve streaming bugs
fe8df8b Added suspense tags
76a4095 Fixed new chat + AI in workspace and artifacts
b59769e New chat fix
0f92f9b Fixed build
dd55d7f Real commitment
ded68ff New thinking
d2a4c09 Crashing out
ab4f0c2 Again.
3aec4d3 Error rendering
03a654d Fixed build issues
13e168b Blocked lyra
0f2ff79 Actual AI hooking
```

### 15.2 Likely Regressions from "New Router" (176c7bb)

1. **Router change**: Complete routing overhaul likely affected model selection stability
2. **Shimmer animation**: Visual change to thinking UI, may have broken event synchronization
3. **Streaming UI fixes**: Previous commits indicate streaming bugs were being actively fixed

### 15.3 Other Notable Changes

- **76a4095**: Fixed new chat + AI in workspace and artifacts - suggests previous broken state
- **ded68ff**: "New thinking" - likely thinking UI refactor
- **0f2ff79**: "Actual AI hooking" - suggests previous AI was not properly connected

### 15.4 What Was Likely Affected

1. **Model anchoring**: The "New Router" commit likely removed or modified conversation-level model anchoring
2. **Streaming events**: Multiple streaming fixes suggest event schema changes
3. **Cross-page consistency**: Workspace/artifact fixes suggest divergence from chat behavior

---

## 16. Top Root-Cause Design Flaws

### 16.1 No Conversation-Level Model Anchoring

**Problem**: Each message re-routes from scratch using only current message context.
**Impact**: Model switches mid-conversation visible to users, no stability, context loss risk.
**Root Cause**: RoutePlan built fresh in `pipeline.ts` line ~1100 from `body.input` alone, no conversation history reference.

### 16.2 Decorative "Thinking" UI

**Problem**: Users see "Thinking", "Analyzing", "Writing response" labels that are pipeline phase indicators, not actual model reasoning.
**Impact**: UI implies capabilities (model thoughts) that don't exist.
**Root Cause**: `runtimePhaseLabel()` maps phases to display strings; no actual model thinking extraction.

### 16.3 Cross-Page Behavioral Divergence

**Problem**: Chat has full features, workspace/artifacts have simplified behavior.
**Impact**: Users experience inconsistent AI; agents cannot rely on consistent behavior.
**Root Cause**: Different hooks (`useChatState` vs `useChatPanel`), different config (full modes vs "general").

### 16.4 Clarification Breaks Conversation Continuity

**Problem**: Clarification appears as visible user prompt, not continuation of same assistant run.
**Impact**: Creates visual discontinuity, duplicate messages.
**Root Cause**: Clarification stored in `route.trace.clarificationBlock`, rendered as separate message.

### 16.5 Event Schema Duality

**Problem**: Runtime events converted to legacy format for client, losing fidelity.
**Impact**: UI shows simplified events, internal state more rich.
**Root Cause**: `toLegacyChatStreamEvent()` function converts runtime → legacy with mapping.

### 16.6 Tool Errors Swallowed

**Problem**: Tool execution errors not clearly visible to users.
**Impact**: Users don't know when tools fail, cannot recover.
**Root Cause**: Error handling minimal in `tool-executor.ts`, not surfaced to UI.

### 16.7 File Resource Failure Not Recoverable

**Problem**: Failed files count toward limit, may not be removable, processing status not clearable.
**Impact**: Users stuck with broken resources, hit limits prematurely.
**Root Cause**: Resource status tracking in `resources.ts`, no cleanup/removal mechanisms.

### 16.8 No Shared Run Journal for Workers

**Problem**: Sub-agents return isolated outputs, not a collaborative workspace.
**Impact**: Workers don't build on each other, results just appended.
**Root Cause**: Task graph executes independently, no shared state.

### 16.9 Weak Workspace Projection

**Problem**: Workspace items can desync from chat state, AI-created items may not project correctly.
**Impact**: Workspace doesn't reflect AI activity accurately.
**Root Cause**: Sync happens after generation, can fail silently.

### 16.10 Hard-Coded Model IDs

**Problem**: MODEL_CONFIG contains hard-coded model IDs that may become stale.
**Impact**: Routing uses outdated models, no dynamic discovery.
**Root Cause**: Static configuration in `model-config.ts` not tied to live catalog.

---

## 17. Top Root-Cause Bugs

### 17.1 Model Selection Not Stable Within Conversation

**Bug**: Each follow-up message routes to potentially different model.
**Evidence**: `phase-router.ts` has no conversation context parameter.
**Fix**: Anchor model selection at chat level, only re-route on explicit user action.

### 17.2 Failed Resources Still Count Toward Limits

**Bug**: A failed file counts toward 25-file limit but cannot be used.
**Evidence**: `constants.ts` limits, no failed-file exclusion in count.
**Fix**: Exclude failed resources from usable count.

### 17.3 Clarification Creates Duplicate Messages

**Bug**: After user answers clarification, response appears as new message.
**Evidence**: `clarification.ts` flow, messages stored separately.
**Fix**: Treat clarification as continuation of same run.

### 17.4 Workspace AI Has No File Attachment

**Bug**: Users cannot attach files in workspace AI.
**Evidence**: `chrome.tsx` QuickChat doesn't support files, no file UI.
**Fix**: Add file attachment support to workspace AI.

### 17.5 Model Switch Mid-Stream Not Handled

**Bug**: If model fails mid-generation, fallback may switch silently.
**Evidence**: Fallback chain in `model-config.ts`, no UI notification.
**Fix**: Notify user of model switch, preserve partial response.

### 17.6 Stream/UI State Desync

**Bug**: If stream interrupted, UI may show inconsistent state.
**Evidence**: `ChatMessageAccumulator` has `cancel()` but partial state remains.
**Fix**: Implement proper stream recovery or cleanup.

### 17.7 Artifact Document Block Format Brittle

**Bug**: Relies on specific `<<DOC_START>>{...json...}<<DOC_END>>` format.
**Evidence**: `document-generator.ts` parsing logic.
**Fix**: Use structured tool output instead of text parsing.

### 17.8 Route Trace Duplicated in Views

**Bug**: Same trace appears in collapsed and expanded views.
**Evidence**: `thinking-block.tsx` and `route-trace-drawer.tsx` both use routeTrace.
**Fix**: Show summary in collapsed, details in expanded only.

### 17.9 Memory Not Shared Across Surfaces

**Bug**: Chat memory not accessible in workspace AI, and vice versa.
**Evidence**: Different memory scopes per surface.
**Fix**: Unify memory system across surfaces.

### 17.10 "Why This Model" is Cosmetic

**Bug**: `whyThisResponse` field uses generic explanation, not actual routing reasoning.
**Evidence**: Generated in pipeline, not from actual decision log.
**Fix**: Use actual RoutePlan decision factors.

---

## 18. Top Root-Cause Misleading UX Behaviors

### 18.1 "Thinking" Label During Stream

**Misleading**: Implies model is "thinking" in human sense.
**Actual**: Just pipeline phase indicator.
**Severity**: Medium - users may overestimate AI reasoning.

### 18.2 Model Badge Shows Selection, Not Execution

**Misleading**: Shows which model was selected, not which executed.
**Actual**: Should match in practice, but no guarantee.
**Severity**: Low - likely always match.

### 18.3 Tool Call Appears as "Thinking Notes"

**Misleading**: Implies tool execution is part of model thinking.
**Actual**: Tool is separate execution with results.
**Severity**: Medium - misrepresents tool independence.

### 18.4 Multi-Agent Shows "Collaborators"

**Misleading**: Implies agents are collaborating in real-time.
**Actual**: Sequential execution with result merging.
**Severity**: Medium - exaggerates collaboration.

### 18.5 File Shows as "Attached" When Failed

**Misleading**: Failed files still show in attachment UI.
**Actual**: Failed files cannot provide context.
**Severity**: High - user may think failed file is being used.

### 18.6 "Analyzing" During RAG Retrieval

**Misleading**: Implies model is analyzing content.
**Actual**: System is doing vector search.
**Severity**: Medium - misrepresents what's happening.

### 18.7 Route Trace Shows "Decision" Timeline

**Misleading**: Implies model made these decisions.
**Actual**: Pipeline made decisions, model just executed.
**Severity**: Medium - conflates routing with model.

### 18.8 Clarification Shows as User Message

**Misleading**: Implies user asked this, not AI requested clarification.
**Actual**: AI triggered clarification, user providing answers.
**Severity**: High - breaks conversation model.

### 18.9 Workspace "AI-Native" Label

**Misleading**: Implies deep AI integration.
**Actual**: Simplified AI with basic context.
**Severity**: Medium - overstates capabilities.

### 18.10 Artifact "Generated" Shows Immediately

**Misleading**: Implies artifact is ready.
**Actual**: Generation may still be processing.
**Severity**: Low - usually fast, but can lag.

---

## 19. Top Places Where Agents Would Lack Context

### 19.1 Model Selection Logic

**Context Gap**: Agents don't know why specific model was selected.
**Evidence**: `whyThisResponse` is cosmetic, actual decision factors not exposed.
**Impact**: Agents can't replicate or understand routing.

### 19.2 Tool Execution Details

**Context Gap**: Agents don't see full tool input/output.
**Evidence**: Only summary shown in trace, not full execution details.
**Impact**: Agents can't debug tool failures.

### 19.3 Sub-Agent Reasoning

**Context Gap**: Agents don't see what sub-agents are doing.
**Evidence**: Only start/finish events, no intermediate state.
**Impact**: Can't understand multi-agent workflow.

### 19.4 Memory Contents

**Context Gap**: Agents don't know what's in memory.
**Evidence**: Memory tool returns results, but not what's stored.
**Impact**: Can't understand context来源.

### 19.5 Retrieval Results

**Context Gap**: Agents see citations, not full retrieved content.
**Evidence**: Citations shown, full chunks not displayed.
**Impact**: Can't verify retrieval quality.

### 19.6 Clarification Generation

**Context Gap**: Agents don't see how clarification was generated.
**Evidence**: Generated via LLM, but prompt/log not exposed.
**Impact**: Can't improve clarification quality.

### 19.7 Workspace Projection Logic

**Context Gap**: Agents don't know how artifacts become workspace items.
**Evidence**: `workspaceItemSync.ts` logic, but not exposed to agents.
**Impact**: Can't predict workspace layout.

### 19.8 Phase Timing

**Context Gap**: Agents don't know how long each phase took.
**Evidence**: Execution timeline exists, but not for agents.
**Impact**: Can't optimize performance.

### 19.9 Model Fallback Chain

**Context Gap**: Agents don't know fallback order.
**Evidence**: Fallbacks defined but not exposed.
**Impact**: Can't handle fallback scenarios.

### 19.10 Cost/Token Tracking

**Context Gap**: Agents don't see token usage breakdown.
**Evidence**: `routeTrace.tokenBreakdown` exists but not always shown.
**Impact**: Can't optimize for cost.

---

## 20. Top Architectural Improvements That Should Be Considered

### 20.1 Conversation-Level Model Anchoring

**Direction**: Introduce explicit model anchoring with override reasons.
**Implementation**: Store selected model in chat metadata, only re-route on explicit user action or mode change.

### 20.2 Separate Real Events from Decorative UI

**Direction**: Distinguish actual model events from pipeline phase indicators.
**Implementation**: Add flag to indicate real vs cosmetic events, update UI accordingly.

### 20.3 Unified AI Run Event Schema

**Direction**: Use single event schema across chat, workspace, artifacts.
**Implementation**: Remove `toLegacyChatStreamEvent()` conversion, update all consumers.

### 20.4 Clarification as Run Continuation

**Direction**: Represent clarification as continuation of same assistant run.
**Implementation**: Don't create new message, append clarification context to current run.

### 20.5 Removable Recoverable Resources

**Direction**: Make resource processing status removable, recoverable, excluded from count.
**Implementation**: Add delete/retry for failed resources, exclude from limits until processed.

### 20.6 Unified Model Registry

**Direction**: Replace hard-coded model IDs with live catalog-driven selection.
**Implementation**: Remove static MODEL_CONFIG, use catalog exclusively.

### 20.7 Shared Run Journal for Workers

**Direction**: Implement shared state for multi-agent execution.
**Implementation**: Add journal that accumulates worker progress, visible to all participants.

### 20.8 Unified Surface Behavior

**Direction**: Ensure consistent AI behavior across chat, workspace, artifacts.
**Implementation**: Refactor to single hook with surface-specific config, not separate hooks.

### 20.9 Tool Execution Transparency

**Direction**: Make tool input/output fully visible.
**Implementation**: Expand tool trace UI, show full execution details, not just summaries.

### 20.10 Explicit Context Sharing

**Direction**: Make context flow explicit across surfaces.
**Implementation**: Add context bridge so workspace can access chat memory, artifacts can access workspace context.

---

## 21. Existing Tests

### 21.1 Test File Inventory

**Frontend Tests** (58 files):
- `request-planning.test.ts`
- `flashcard-routing.test.ts`
- `route-plan.test.ts`
- `attachments.test.ts`
- `model-selection.test.ts`
- `routing.test.ts`
- `message-state.test.ts`
- `streaming-tool-loop.test.ts`
- `task-graph.test.ts`
- `phase-router.test.ts`
- `clarification.test.ts`
- `resource-processing.test.ts`
- `artifacts.test.ts`
- `agent-matching.test.ts`
- Many more...

**Backend Tests** (5 files):
- `chat-branching.test.ts`
- `workstream-assignment.test.ts`
- `ghosts.test.ts`
- `streakLogic.test.ts`
- `compaction.test.ts`

### 21.2 What's Tested

| Area | Test Coverage |
|------|---------------|
| Model Routing | Yes (routing.test.ts, phase-router.test.ts, model-selection.test.ts) |
| Route Plan | Yes (route-plan.test.ts) |
| Streaming | Yes (streaming-tool-loop.test.ts, stream-buffer.test.ts) |
| Tools | Partial (task-graph.test.ts) |
| Clarification | Yes (clarification.test.ts) |
| Memory | Partial |
| Artifacts | Yes (artifacts.test.ts) |
| Resources | Yes (resource-processing.test.ts, attachments.test.ts) |
| Multi-Agent | Partial (task-graph.test.ts) |

### 21.3 What's NOT Tested

- **Model anchoring**: No test for conversation-level model stability
- **Cross-page consistency**: No test comparing chat vs workspace vs artifacts
- **Clarification flow end-to-end**: Partial test, not full integration
- **Failed file handling**: Not extensively tested
- **Workspace projection**: Not tested
- **Event schema conversion**: No test for runtime → legacy conversion
- **Sub-agent orchestration**: Partial test only

---

## 22. Missing Tests

### 22.1 Critical Missing Tests

1. **Conversation Model Stability Test**
   - Send multiple messages, verify model doesn't change mid-conversation
   - Check that mode change triggers re-route, not random messages

2. **Cross-Page Behavior Test**
   - Test same input produces consistent behavior across chat/workspace/artifacts
   - Verify tool access, mode options, file attachment consistency

3. **Clarification End-to-End Flow**
   - User message triggers clarification
   - User provides answers
   - Continue generation with clarification context
   - Verify single message result, not duplicate

4. **Failed Resource Handling**
   - Upload file that fails processing
   - Verify it doesn't count toward limit
   - Verify it can be deleted or retried

5. **Workspace Projection Test**
   - AI creates artifact
   - Verify workspace item is created
   - Verify item position/content is correct

### 22.2 Recommended Additional Tests

- Stream interruption and recovery
- Tool error handling visibility
- Memory across surfaces
- Model fallback chain behavior
- Cost/token tracking accuracy
- Route trace display correctness

---

## 23. Unknowns / Things Not Verifiable from Repo

### 23.1 Not Verifiable

1. **Actual OpenRouter behavior**: The code calls OpenRouter API but can't verify actual response format or behavior without live testing.

2. **Live model catalog freshness**: How often `getLiveCatalogSnapshot()` refreshes from actual OpenRouter vs cache.

3. **Real user behavior patterns**: How users actually interact with clarification, what causes most re-routes.

4. **Production error rates**: Can't determine from code how often things actually fail in production.

5. **Cost actual vs estimated**: Whether token tracking accurately reflects actual cost.

6. **Model quality feedback**: How `recordModelQualitySignals()` affects future routing.

7. **Memory retention**: How long memory entries persist and how they're expired.

8. **RAG effectiveness**: Can't verify retrieval quality without testing against actual documents.

### 23.2 Partially Verifiable

1. **Event flow**: Can trace code path but not verify runtime behavior
2. **Tool execution**: Can trace to Convex mutations but not verify actual execution
3. **File processing**: Can trace to `ingestQueue.ts` but not verify background jobs

---

## 24. Final Diagnosis: What System Actually Does vs Appears to Do

### 24.1 Appears to Do

The system presents itself as:
- A unified AI assistant with consistent behavior across surfaces
- An intelligent model router that chooses optimal models per request
- A collaborative multi-agent system with real-time agent coordination
- An AI-native workspace with deep integration
- A transparent system showing model thinking and decision-making

### 24.2 Actually Does

The system actually:
- Has three divergent implementations (chat full, workspace/artifacts simplified)
- Re-selects model for each message without conversation anchoring
- Shows pipeline phase indicators as "thinking" UI
- Executes sub-agents sequentially, not in real-time collaboration
- Has limited workspace AI with no file attachments
- Converts rich runtime events to simplified legacy format
- Breaks conversation continuity with clarification interrupts

### 24.3 Key Mismatch Summary

| Appearance | Reality |
|------------|----------|
| Unified AI | Three separate implementations |
| Intelligent routing | Fresh routing per message, no anchoring |
| Model "thinking" | Pipeline phase labels |
| Real collaboration | Sequential execution |
| AI-native workspace | Simplified AI with basic context |
| Transparent events | Converted/losing fidelity |
| Continuous conversation | Clarification breaks continuity |

---

## 25. Summary: System Mental Model

The Spectra AI system is a sophisticated orchestration platform that:

1. **Accepts user input** from three surfaces (chat, workspace, artifacts) with different capabilities
2. **Builds a RoutePlan** for each message using request classification, not conversation history
3. **Selects a model** fresh each time using capability-first brokering, with no anchoring
4. **Retrieves context** from memory, RAG, and web search
5. **Executes** either single-model direct generation or multi-agent collaboration
6. **Streams events** that are rich internally but converted to legacy format for display
7. **Produces outputs** including text, artifacts, workspace items, and memory writes
8. **Shows UI** that implies capabilities (thinking, decision-making) that don't actually exist

The system is well-architected in terms of component separation, but suffers from:
- **Inconsistent behavior** across surfaces
- **Cosmetic UI** that overstates capabilities  
- **Missing conversation stability** (model anchoring)
- **Broken clarification flow** (conversation continuity)
- **Brittle resource handling** (failed files)

A redesign should focus on unifying the surface behavior, implementing model anchoring, separating real events from UI decoration, and fixing the clarification flow to preserve conversation continuity.

---

**End of Report**