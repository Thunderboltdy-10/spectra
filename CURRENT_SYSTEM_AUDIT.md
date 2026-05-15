# Current Implementation System Audit Report

**Date**: May 15, 2026  
**Audit Mode**: SPEC / READ-ONLY  
**Scope**: Complete Current AI Integration Layer - Post Changes

---

## 1. Executive Summary

This report documents the current state of the Spectra AI integration system after significant architectural changes. The user reports extensive modifications to routing, tool calls (code agent-like behaviour), workspace and artifact implementation, memory capabilities, sub-agent launching mid-execution, and output waiting capabilities. The system was intended to follow SPEC.md but the implementation is reportedly incomplete and the codebase contains "slop" from multiple architecture changes layered on poorly-edited previous files.

**Key Findings:**

1. **Architecture**: The system now uses a unified orchestration pipeline (`src/lib/orchestrator/pipeline.ts`, ~6370 lines) that serves three surfaces: chat, workspace, and artifacts. Despite apparent unification, each surface has significantly different behavior.

2. **Model Routing**: Model anchoring WAS IMPLEMENTED (post audit) via `StableModelAnchor` in `src/lib/model-anchor.ts`. The "New Router" commit (176c7bb) introduced `phase-router.ts` as the primary weighted scoring router. However, users report the model still changes mid-conversation and the system "forgets the conversation". **CRITICAL: The exploration system has a 10% random chance to switch models even when anchor is valid.**

3. **Streaming**: The system uses Server-Sent Events (SSE) with NDJSON streaming. Runtime events are still converted to legacy format for client consumption via `toLegacyChatStreamEvent()`. **CRITICAL BUG: workspace-v2/app.tsx line 503-504 returns "Thinking…" for ALL phases regardless of actual phase.**

4. **Tools**: 24 AI tools are defined (`src/lib/orchestrator/tool-definitions.ts`) with access controlled by assignment levels (L0-L4). However, tools are still represented as "thinking notes" in UI with minimal error visibility. **ISSUE: Task-graph allowedTools are NOT enforced on subagents.**

5. **Multi-Agent**: The system supports specialist agents via task graph orchestration (`src/lib/orchestrator/task-graph.ts`). However, no shared run journal exists - specialists return isolated outputs. Workers only receive summarized dependency results (max 700 chars), not shared state.

6. **Critical Problems**:
   - Model switching still occurs mid-conversation (user reports "actually changing the model EVERY time") - Root causes: 10% exploration chance, recent model penalty (0.7x for last 3 turns), provider rotation penalty
   - File attachments not used at all by models, especially when router changes model mid-conversation
   - Conversation forgetting/hallucination issues - Known issue documented in `docs/manual-repro/model-switch-context-regression.md`
   - Clarification repeatedly asks the same generic question about "how i want to receive the answer" - Fallback questions are generic templates
   - Cross-page behavioral inconsistency (chat has full features, workspace/artifact have limited)
   - No file attachments in workspace/artifacts - QuickChat component exists but props not wired up

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
│  │ useChatState hook    │  │ useChatPanel   │  │  Zustand stores            │     │
│  │ (full chat state)    │  │ (lightweight)  │  │  (workspace, editor)        │     │
│  └──────────────────────┘  └────────────────┘  └──────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API ROUTE LAYER                                     │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐      │
│  │ /api/chat       │  │ /api/workspace-data   │  │ /api/resources          │      │
│  │ (main AI entry) │  │ (workspace queries)   │  │ (file uploads)          │      │
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
│  │  agents.ts  │  │ memory.ts   │  │    rag.ts   │  │ ingestQueue.ts   │        │
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
| Model Routing | `src/lib/routing/phase-router.ts`, `src/lib/routing/heuristic.ts`, `src/lib/model-broker.ts`, `src/lib/model-selection.ts`, `src/lib/model-anchor.ts` |
| Model Catalog | `convex/models.ts`, `convex/curatedModelRegistry.ts`, `src/lib/openrouter-catalog-cache.ts` |
| Streaming | `src/lib/chat/streaming.ts`, `src/lib/orchestrator/runtime-contract.ts` |
| Pipeline | `src/lib/orchestrator/pipeline.ts`, `src/lib/orchestrator/pipeline-controller.ts` |
| Tools | `src/lib/orchestrator/tool-definitions.ts`, `src/lib/orchestrator/tool-executor.ts` |
| Multi-Agent | `src/lib/orchestrator/task-graph.ts`, `src/lib/orchestrator/streaming.ts` |
| Clarification | `src/lib/orchestrator/clarification.ts`, `src/components/chat/clarification-card.tsx` |
| Files/Resources | `convex/resources.ts`, `convex/ingestQueue.ts`, `src/lib/attachments/normalizer.ts` |
| Workspace | `convex/workspaceItems.ts`, `convex/workspaceItemSync.ts` |
| Artifacts | `convex/artifacts.ts`, `src/lib/artifacts.ts` |
| Memory | `convex/memory.ts`, `convex/workstreamMemory.ts` |
| Agents | `convex/agents.ts`, `src/lib/agent-matching.ts` |
| Managebac | `src/lib/managebac/client.ts`, `convex/managebacSync.ts` |

---

## 3. Model Routing and Anchoring - Current State

### 3.1 Model Anchoring Implementation (Post-Audit)

**NEW - Model Anchoring EXISTS** (found in current codebase):

The implementation uses `StableModelAnchor` (defined in `<local-workspace>` lines 6-17):

```typescript
export type StableModelAnchor = {
  modelId: string;
  source: ModelAnchorSource;
  routeKey: string;  // Built from mode + tier + capabilities + needsSearch + needsRag
  reason: string;
  requiredCapabilities: ModelCapability[];
  spendingTier: SpendingTier;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  metadataUpdatedAt?: number;
};
```

**Anchor persistence flow** (Pipeline.ts lines 2344-2369):
1. Previous message's `routeTrace.requestPlan.modelAnchor` is retrieved
2. If not available, a new anchor is built from `previousAssistantTurn.modelUsed`
3. The anchor is passed to `selectModelForPhase()` as `modelAnchor` input
4. `resolveStableModelAnchor()` in phase-router.ts determines whether to reuse or replace

**When anchor IS reused** (model-anchor.ts lines 135-140):
- If existing anchor hasn't expired (`expiresAt > now`)
- If `routeKey` matches current route requirements
- If model is still allowed in spending tier
- If model supports required capabilities
- If model exists in current catalog

### 3.2 CRITICAL ISSUES - Why Anchoring Still Fails

Despite the implementation existing, users report:
- "actually changing the model EVERY time"
- "forgetting the conversation for some reason and hallucinating everything"
- Model "always asked the same question about how i want to receive the answer, but then forgetting"

**Known Issue**: Model switch context regression is documented in `docs/manual-repro/model-switch-context-regression.md` - when switching models mid-conversation, context can be lost and assistant may ask to re-upload the same image.

**Verified failure points (from code analysis):**

1. **10% Exploration Mode (HIGH SEVERITY)** - `phase-router.ts` lines 609-611:
   ```typescript
   const explorationRoll = hashToUnit(`${input.seedKey}:${input.phaseId}:explore`);
   const shouldExplore = explorationRoll < 0.1;  // 10% chance!
   ```
   When ALL conditions are met (T0/T1 request, low stakes, message <=260 chars, not research/marker/exam mode), the system enters exploration mode 10% of the time and **boosts a random challenger model by 1.5x**, overriding the anchor.

2. **Recent Model Penalty (MEDIUM SEVERITY)** - `phase-router.ts` lines 356-365:
   - Last 3 turns: 0.7x multiplier
   - Last 5 turns: 0.85x multiplier
   - Last 10 turns: 0.92x multiplier
   This aggressively encourages rotation and works directly against anchor reuse.

3. **Provider Rotation Penalty (LOW-MEDIUM)** - `phase-router.ts` lines 367-375:
   Same provider in recent turns gets penalized (0.62x to 0.85x), further fragmenting conversation continuity.

4. **Weighted Random Selection** - `phase-router.ts` lines 993-998:
   When top candidates are within 85% of each other, deterministic hash-based random pick occurs. This introduces non-deterministic behavior.

5. **Score Noise Addition** - `phase-router.ts` lines 973-987:
   When top 3 scores differ by <= 0.05, deterministic noise (up to ±0.03) is added to break ties, which can flip the winner.

6. **Anchor expiration** - Default TTL is 30 minutes (line 29 of model-anchor.ts). After expiration, model can change even in same conversation.

7. **Route key matching** - Anchor only reuses if `routeKey` matches (built from mode, tier, capabilities, search/rag). Simple mode changes can trigger anchor replacement.

8. **Cost discipline penalty** - Phase-router applies strong penalties for expensive models in non-L4 assignments (lines 817-836), which could override anchor stability.

9. **Route plan rebuild per message** - Each message rebuilds the route plan fresh, even with anchor passing. The anchor compatibility check may be failing.

### 3.3 "Why This Model" Explanation

**EXISTS** - in multiple places:

1. **In model-anchor.ts** (lines 158-174):
```typescript
const whyParts = [
  reuseReason ?? params.routeReason,
  requiredCapabilities.length > 0 ? `required ${requiredCapabilities.join(", ")}` : "text chat capable route",
  params.needsSearch ? "search-aware route data" : undefined,
  stalePenalty > 0 ? `stale metadata penalty ${stalePenalty.toFixed(2)}` : undefined,
  fallbackReason,
].filter((part): part is string => Boolean(part));
```

2. **In phase-router.ts** (lines 1043-1044):
```typescript
row.modelId === selectedModelId ? `why_this_model ${anchorResolution.whyThisModel}` : undefined,
```

---

## 4. Streaming and Events - Current State

### 4.1 Streaming Protocol

**Format**: Server-Sent Events (SSE) with NDJSON (newline-delimited JSON)

**Event Schema Duality** - STILL EXISTS:
- **Runtime Events** (`src/lib/orchestrator/runtime-contract.ts`): Internal format
- **Legacy Chat Events** (`toLegacyChatStreamEvent()`): Client format

This conversion is lossy—some runtime events map to different legacy events:
- `mode_switched` → `mode_switch`
- `navigation_instruction` → `thread_fork`
- `model_selected` → `route_model`

### 4.2 Event Types

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

### 4.3 Stream Phase Lifecycle

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

---

## 5. Thinking / Trace / Status UI - Current State

### 5.1 ThinkingBlock Component

**Location**: `src/components/chat/thinking-block.tsx`

**Features:**
- Displays thinking content with expandable sections
- Animated "Thinking" indicator during streaming
- Renders thinking segments with labels
- Shows execution timeline from route trace
- Props: `content`, `streaming`, `routeTrace`, `segments`

### 5.2 RouteTraceDrawer Component

**Location**: `src/components/chat/route-trace-drawer.tsx`

**Features:**
- Detailed model decision timeline
- Shows route plan, candidates, phases, timing
- Displays token breakdown: system, history, memory, sources
- Props: `open`, `onClose`, `trace`, `showCostDetails`

### 5.3 CRITICAL ISSUE - Hard-coded Fake Labels STILL PRESENT

The system STILL uses fake hard-coded labels based on pipeline phase, NOT actual model events:

**Locations where fake/hard-coded labels are generated:**

1. **workspace-v2/app.tsx lines 501-513** (MOST PROBLEMATIC):
   ```typescript
   function runtimePhaseLabel(event: ChatStreamEvent): string | null {
     if (event.type === "phase" && typeof event.phase === "string") {
       if (event.phase === "thinking") return "Thinking…";
       return "Thinking…";  // <-- ALL phases return "Thinking…"!
     }
     return detail || "Thinking…";  // Fallback also hardcoded
   }
   ```
   This is a critical bug - ALL pipeline phases show "Thinking…" regardless of actual phase.

2. **pipeline.ts line 2698**: Default label `String(eventSegment?.label ?? "Thinking")`

3. **message-state.ts line 121**: Default label `String(event.segment.label ?? "Thinking")`

4. **unified-panel.tsx lines 798-812**: Phase label mapping table (routing → "Plan route", analysis → "Analyze", authoring → "Draft response", etc.)

5. **chat-header.tsx lines 36-43**: PHASE_CONFIG with labels like "compacting...", "routing...", "searching...", "thinking..."

**Problem**: The system uses `runtimePhaseLabel()` to map phases to display strings, NOT actual model events. Users see pipeline phase indicators, not actual model reasoning.

### 5.4 Trace UI Issues

1. **Decorative vs Real**: The "Thinking" label appears during streaming but may not reflect actual model reasoning—it's a pipeline phase indicator, not a model thought process display.

2. **Duplicated Headings**: `routeTrace` appears in both collapsed (thinking block) and expanded (route trace drawer) views, with duplicated information.

3. **Not meaningful text**: The thinking segments contain generic phase labels, not actual model reasoning.

4. **Sub-agent display**: Worker activity is shown via `helper_worker_started/finished` events, but the display is basic.

5. **Tool calls in trace**: Tools appear as thinking notes but the representation is minimal.

---

## 6. Tool Integration - Current State

### 6.1 Tool Definitions

**File**: `src/lib/orchestrator/tool-definitions.ts` (645 lines)

**24 AI Tools** organized by assignment level (L0-L4):

| Category | Tools |
|----------|-------|
| Memory | `inspect_runtime_context`, `recall_memory`, `save_memory`, `update_memory`, `dismiss_memory`, `get_workstream_context` |
| Skills | `search_skills`, `load_skill` |
| Workspace/Artifact | `propose_actions`, `apply_actions`, `get_version_history`, `create_note`, `create_workstream`, `create_widget`, `update_widget`, `move_widget`, `attach_items_to_workstream`, `list_merge_candidates`, `update_workstream_layout`, `suggest_workspace_from_topic`, `surface_result`, `update_planner` |
| Planning/Mode | `fork_thread`, `search_web`, `switch_mode` |

### 6.2 Tool Access by Assignment Level

- **L0**: No tools
- **L1**: 2 tools (`inspect_runtime_context`, `recall_memory`)
- **L2**: 5 tools (L1 + `search_skills`, `save_memory`, `search_web`)
- **L3**: 14 tools (L2 + `load_skill`, `propose_actions`, `apply_actions`, `get_version_history`, `update_memory`, `dismiss_memory`, `create_note`, `update_planner`, `surface_result`, `switch_mode`)
- **L4**: 21 tools (all tools)

### 6.3 CRITICAL ISSUES with Tools

1. **Tool Errors Not Visible**: Tool execution errors are not clearly visible to users - only shows basic summary, no error codes, no detailed context, no recovery suggestions.

2. **Tool Definitions Gap**: `create_note` exists in tool-definitions.ts but actual artifact creation uses `create_artifact` action type. The naming is inconsistent.

3. **Tool Call UI**: Tools appear as "thinking notes" in the trace - represents tool execution as part of model thinking, not separate operations.

4. **Limited to L0-L4**: Not all tools available to all users.

5. **Tool consistency**: Workspace vs chat have different tool subsets.

---

## 7. Clarification System - Current State

### 7.1 Clarification Detection

**File**: `src/lib/orchestrator/clarification.ts`

**needsClarification()** function checks:
- Request class: Must be T2 or higher
- Study mode: Excluded from quiz/flashcard modes
- Conflict detection: `hasConflictingDirectives()` - conflicting instructions (e.g., "latest" but "don't search")
- Research specificity: `lacksResearchSpecificity()` - vague research in research mode
- Vague enhanced requests: `isVagueEnhancedRequest()` - generic requests like "help me"
- Previous turn: Returns null if last assistant message was already clarification (prevents loops)

### 7.2 CRITICAL ISSUE - Clarification "Slop"

User specifically reports:
- "it always asked the same question about how i want to receive the answer, but then forgetting"

This indicates:
1. Clarification is asking generic questions that don't add value
2. The clarification context is being lost between messages
3. The system is not learning from clarification responses

### 7.3 How Clarification UI Renders

**Component**: `src/components/chat/clarification-card.tsx`

**Rendering**:
- Extracts `clarificationBlock` from message's `routeTrace`
- Renders `ClarificationCard` with:
  - Context text
  - Questions (supports `free_text`, `single_choice`, `multi_choice`, `confirmation`)
  - Submit button that formats answers as structured text

### 7.4 Critical Issues with Clarification

1. **Breaks Conversation Continuity**: The clarification appears as a visible user prompt, not a continuation of the same assistant run. This creates visual discontinuity.

2. **Creates Duplicate Messages**: After user answers clarification, the response appears as a new assistant message, not continuation of the interrupted one.

3. **Generic Questions**: The system asks the same generic question repeatedly instead of specific clarifying questions.

4. **Context Not Preserved**: Clarification context is lost between messages.

---

## 8. File and Resource Pipeline - Current State

### 8.1 Resource States

**Database states** (convex/schema.ts):
| State | Description |
|-------|-------------|
| `uploaded` | Initial state after file upload |
| `processing` | Being parsed and embedded |
| `processed` | Successfully indexed |
| `failed` | Processing failed |

**Runtime status mapping** (convex/resources.ts):
| Status | Runtime Status |
|--------|----------------|
| `uploaded` | `"uploaded"` |
| `processing` | `"processing"` |
| `processed` | `"indexed"` |
| `failed` | `"failed_processing"` |
| (no storageId) | `"storage_missing"` |

### 8.2 File Types Supported

**Documents**: pdf, docx, pptx, xlsx, txt, md, rtf, odt, csv, json, yaml, yml, xml
**Code**: py, js, ts, java, cpp, c, go, rs, sql, sh
**Images**: png, jpg, jpeg, gif, webp, svg
**Audio**: mp3, wav, m4a
**Blocked**: Videos (mp4, mov, etc.), Executables (EXE, DLL, etc.)

### 8.3 CRITICAL ISSUES - User Reports

User specifically reports:
- "file attachments not being used at all by models (especially when the router changes the model mid-conversation)"

This indicates:
1. File attachments are NOT being passed to models correctly
2. Model switching causes file context to be lost
3. Even when files are attached, models don't see them

### 8.4 What Was Fixed (Post-Audit)

1. **Failed Files DO NOT Count Toward Limits** - Confirmed in code:
```typescript
// convex/resources.ts lines 47-53
export function isUsableResourceForLimit(resource: ResourceLifecycleFields) {
  return resource.saveToLibrary !== false && resource.status !== "failed" && Boolean(resource.storageId);
}
```

2. **Failed Files CAN Be Removed** - Users can delete any resource including failed ones.

3. **Only indexed documents are usable** - Failed files are skipped in AI context:
```typescript
// src/lib/attachments/normalizer.ts
if (!isRuntimeUsableAttachment(resource)) {
  skipped.push({ reason: "File was not included in model context." });
}
```

---

## 9. Workspace AI Integration - Current State

### 9.1 How Workspace AI is Triggered

**Entry Point**: `QuickChat` component (`src/components/shared/quick-chat.tsx`)
- Used throughout workspace via `chrome.tsx`
- Accepts text input, triggers AI via `onSubmit`

**Backend Pipeline**: Receives `workstreamId` from client request

### 9.2 CRITICAL ISSUES - User Reports

User specifically reports:
- Workspace is "the most complex of them all"
- It needs to be targeted "even if i didnt specifically target"

### 9.3 Workspace AI Capabilities (vs Chat)

**What's DIFFERENT:**

| Feature | Chat | Workspace |
|---------|------|-----------|
| **Agent selection** | Yes | No |
| **Model selection** | Yes | No |
| **Mode selection** | Yes (12 modes) | No - hardcoded "general" |
| **Thinking level control** | Yes | No - hardcoded "low" |
| **File attachments** | Yes (5 max) | No |
| **Speech-to-text** | Yes | Partial |
| **Auto-settings control** | Yes | No |
| **Slash commands** | Yes (advanced) | Basic |

**Key Gap Analysis:**
1. **No explicit workspace context sent to AI** - Unlike chat which sends `artifactId` and `scopeLevel`, workspace only sends `workstreamId`
2. **No item-aware context** - When items are selected, the AI doesn't receive their content
3. **No tool/results from workspace items** - Chat can reference artifacts/threads; workspace AI creates them but doesn't read them as context
4. **Fixed thinking level** - Always "low", no option for medium/high
5. **No file attachment support** - Users cannot attach files in workspace AI

### 9.4 Workspace Context Sent to Model

**buildWorkstreamRouteContext()** (pipeline.ts lines 1532-1609):
- activeWorkstream metadata (title, description, subjectCode, linkedAgentId, lastActivityAt, defaultMode, defaultThinking, counts)
- recent artifact/note/planner titles (last 4 each)
- candidate workstreams

**Tool: get_workstream_context**:
- AI can explicitly call to get concise summary

### 9.5 Workspace AI Implementation Details

**Trigger Point**: `CommandBar` component in `chrome.tsx` contains `QuickChat` (line 753). When user submits message, `handleSendMessage` (app.tsx line 2036) processes it.

**Processing Flow** (app.tsx):
1. Parse commands like `/note`, `/task`, `/thread`, `/workspace`, `/widget`
2. For regular AI queries: call `createWorkspaceRuntimeThread` (line 2278) → creates chat via `/api/chats`
3. Stream using `createChatStream` (line 2318) with hardcoded params:
   - `mode`: "general"
   - `thinkingLevel`: "low"
   - `routerMode`: "auto"
   - `workstreamId`: normalized runtime workstream ID
   - `scopeLevel`: "workspace" (if workstreamId exists) or "global"

### 9.6 CRITICAL - useChatPanel Not Actually Used

**Issue**: Workspace uses direct `createChatStream` calls instead of the `useChatPanel` hook. This means:
- Less standardized handling
- Potential inconsistencies with chat
- The hook exists (311 lines) but is bypassed

### 9.7 Surface Determination Edge Cases

**Location**: pipeline.ts lines 1198-1203

```typescript
const currentWorkstreamFocusSurface = (): "workspace" | "panel" | "chat" | "none" => {
  if (!activeWorkstreamId) return "none";
  if (clientScopeLevel === "workspace") return "workspace";
  if (clientScopeLevel === "artifact") return "panel";
  return body.chatId ? "chat" : "panel";  // Inconsistent: uses chatId existence
};
```

This returns "panel" for new chats in workspace context, which differs from main surface determination logic.

---

## 10. Artifact AI Integration - Current State

### 10.1 Artifact Types

**16 Types** (`src/lib/artifact-types.ts`):
- Study Plans & Timetables: `study_plan`, `timetable`, `quiz`
- Notes & Documents: `note`, `document`
- Flashcard Decks: `flashcard_deck`
- Generated Media: `code_project`, `diagram`, `image`, `visualization`, `concept_map`, `code_output`, `whiteboard`
- Saved Items: `bookmark`
- Collections: `collection`, `custom`

### 10.2 Artifact Tools Available to AI

- `create_artifact` - Create new artifact
- `patch_artifact` - Full content replacement
- `replace_range` - Replace text range
- `insert_block` - Insert block at index
- `delete_block` - Delete block range
- `rename_artifact` - Rename artifact
- `restore_artifact_version` - Restore previous version
- `create_child_artifact` - Create child from parent
- `generate_flashcards_from_artifact` - Generate flashcards
- `generate_quiz_from_artifact` - Generate quiz

### 10.3 CRITICAL ISSUES

1. **No file attachments in AI surface**: Artifact AI uses QuickChat without file support
2. **Mode locked to "general"**: Artifact AI uses `mode="general"`, `thinkingLevel="low"`
3. **Per-artifact threads**: Less persistent than full chat
4. **Minimal trace UI**: Route trace not prominently displayed
5. **AI Surface Text Append Limitation**: Only detects simple patterns for appending

---

## 11. Memory System - Current State

### 11.1 Memory Storage

**Categories**: identity, academic, preference, topic, artifact, correction

**Retention windows**:
- identity: eternal
- academic: 180 days
- preference: 90 days
- topic/artifact: 45 days
- correction: 180 days

**Max entries**: 80 memory entries, 1500 raw chars

### 11.2 Memory Scopes

- `global` - User-wide persistent memory (identity, academic, preference categories)
- `workstream` - Workstream-specific memory (concept, progress, preference, deadline, correction, resource_link)
- `cross_workstream` - Explicit cross-workstream recall

### 11.3 Memory Tools

- `recall_memory` - Search global, workstream, or cross-workstream memory
- `save_memory` - Save explicit user memories with key/text/category
- `update_memory` - Update existing memory entries
- `dismiss_memory` - Dismiss/archive memory entries

### 11.4 CRITICAL ISSUES - Memory Across Surfaces

1. **Surface-Based Memory Scope Mismatch**: Memory scopes are determined by assignment level (L4 vs personalTask), NOT by active surface (chat vs workspace)

2. **Cross-Surface Memory Retrieval**: No mechanism to recall memories from different surfaces (chat vs workspace)

3. **Workstream Memory Only for L4**: Workstream memory is ONLY retrieved for L4 (workstream deep) assignments, not for regular workspace interactions

4. **Memory Extraction Always Enabled**: Same extraction logic runs regardless of whether user is in chat or workspace

5. **Workstream-Scoped Memory NOT Auto-Retrieved** (memory.ts line 999):
   - The `retrieveRelevantEntries` function explicitly filters OUT entries where `scope === "workstream"`
   - Only accessible via recall tool with explicit `cross_workstream` scope
   - Impact: Users lose access to workstream-specific context when not using recall tool

6. **Double Storage of Workstream Memory**:
   - When in workstream context, memory is written to both:
     - `userMemoryEntries` with scope="workstream"
     - `workstreamMemory` table
   - Creates redundancy and potential inconsistency

7. **Free Tier Memory Restrictions** (post-process.ts lines 588-592):
   - Only allows explicit user directives (`user_explicit` source type) or corrections
   - Blocks all extraction-based memory writes
   - Impact: Free tier users don't get automatic memory extraction

---

## 12. Agents System - Current State

### 12.1 Agent Data Model

- Basic identity: name, description, category, subjectArea, gradeLevel
- System prompt and behavior configuration
- Avatar: avatarEmoji, avatarIcon
- Model preferences: preferredModel, preferredMode, modelAllowlist, modelDenylist
- Tool permissions: allowedTools
- Guidelines: guidelinesSummary, guidelinesTopicMap, guidelinesRubricHints, guidelinesMisconceptions, guidelinesVocabulary, guidelinesExamStructure
- Visibility: public/private/shared with accessLevel

### 12.2 Multi-Agent Orchestration

**Task Roles**:
- workflow_planner, retriever, web_researcher, vision_interpreter, code_helper, curriculum_planner, fact_checker, pedagogy_coach, exam_strategist, critic, synthesizer

**Orchestration Profiles**:
- simple_direct, search_synthesis, artifact_builder, study_transform, image_analysis, workspace_action, agent_delegation, teacher_marking, long_context_reconstruction

### 12.3 CRITICAL ISSUES - Agent Tool Capability Mismatch

1. **HIGH PRIORITY - Capability ID Mismatch**:
   - Location: `src/components/agents/agent-builder-form.tsx:418`
   - Problem: Sends `allowedTools: capabilities` where capabilities are IDs like "search", "flashcards", "quiz", "document", "diagram"
   - Actual tool names in `tool-definitions.ts` are different (e.g., "search_web", "create_note")
   - Impact: Agent's allowedTools will contain invalid values that won't map to actual available tools

2. **allowedTools Not Properly Processed**: No conversion function exists to map "search" → "search_web", "flashcards" → "create_note"

3. **Agent Guidelines Not Fully Utilized**: Only guidelinesSummary and guidelinesTopicMap are used in system prompt - guidelinesRubricHints, guidelinesMisconceptions, guidelinesVocabulary, guidelinesExamStructure are stored but not included

4. **Task-Graph allowedTools NOT Enforced on Subagents** (task-graph.ts):
   - Each profile has `allowedTools: string[]` (e.g., `["search_web", "create_note"]`)
   - BUT this restriction is NOT actually applied during subagent execution
   - Subagents can use any tool the primary model can use
   - The profile's `allowedTools` is only documentation in system prompt, not enforcement

5. **No Shared State Between Workers**:
   - Workers do NOT share state directly during execution
   - Each specialist receives only summarized dependency results (max 700 chars per dependency)
   - No centralized run journal
   - Redundant work if multiple specialists need similar context
   - No way to progressively build on intermediate results

6. **Specialist System Prompts Are Minimal**:
   - Each specialist gets only a one-line role description from SPECIALIST_PROMPTS
   - They don't receive full agent guidelines or agent-specific context
   - Could limit specialist performance for specialized agents

---

## 13. Managebac Integration - Current State

### 13.1 What's IMPLEMENTED

| Feature | Status |
|---------|--------|
| API Client | Complete |
| Endpoint Discovery (8 endpoints) | Complete |
| Data Normalization | Complete |
| Entity Mapping | Complete |
| Token Encryption | Complete |
| User Resolution (email matching) | Complete |
| Full Sync Logic | Complete |
| Scheduled Sync | Complete |
| Admin Config API | Complete |
| Database Schema | Complete |
| Unit Tests | Complete |

### 13.2 What's MISSING

| Feature | Status | Notes |
|---------|--------|-------|
| **Admin UI Page** | Missing | Page redirects to `/admin`, no dedicated settings UI |
| **Manual Student Linking** | Missing | No self-service for students to link their account |
| **Webhook Endpoint** | Missing | No real-time updates, only polling |
| **Sync Error UI** | Missing | Admins can't view detailed sync errors |
| **CSV Import for Mappings** | Missing | No bulk student mapping import |
| **Granular Sync Control** | Partial | Only org-level enable/disable |

---

## 14. Cross-Page Consistency - Current State

### 14.1 Feature Comparison

| Feature | Chat Page | Workspace | Artifacts |
|---------|-----------|-----------|-----------|
| **Model Routing** | Full auto/manual | Auto only | Auto only |
| **Mode Options** | All modes (12+) | general only | general only |
| **Thinking Levels** | low/medium/high | low only | low only |
| **Trace UI** | Full timeline | Minimal chips | Minimal |
| **Full Tools** | Yes (24 tools) | Subset | Yes (via useChatPanel) |
| **File Attachments** | Yes (5 max) | No | No |
| **Message Persistence** | Full | Ephemeral threads | Per-artifact |
| **Orchestration Panel** | Yes (UnifiedPanel) | No | No |

### 14.2 Hook Differences

**useChatState (Main Chat - `/chat`):**
- Full draft persistence with localStorage
- File handling with compression, thumbnail generation
- Full model/agent selection
- Proactive features: Streak at risk, flashcard reminders
- Auto-save drafts: 500ms debounced

**useChatPanel (Embedded - workspace/artifacts):**
- Lightweight streaming
- No file upload
- No draft persistence
- Minimal state
- Workspace notifications on completion

### 14.3 CRITICAL ISSUES

1. **Mode Selection**: `/chat` has full mode picker; `/workspace` and `/artifacts` are hardcoded to `"general"` mode

2. **File Attachments**: `/chat` has full file support; workspace/artifacts have no attachment capability

3. **Tool Selection**: Model/agent selection only available in `/chat`; workspace/artifacts have no such controls

4. **Draft Persistence**: Only `/chat` has draft auto-save; workspace/artifacts lose input on navigation

---

## 15. Top Root-Cause Design Flaws

### 15.1 Model Anchoring Still Unstable

**Problem**: Despite anchor implementation existing, users report model changes "EVERY time"
**Impact**: No conversation stability, context loss, hallucination
**Root Cause**: 
- Anchor TTL (30 min) expires mid-conversation
- Route key mismatch triggers re-route
- Cost penalties override anchor stability
- 10% exploration chance causes random switches

### 15.2 File Attachments Not Working

**Problem**: User reports "file attachments not being used at all by models"
**Impact**: Files attached but model doesn't see them
**Root Cause**:
- File context not preserved when model switches
- Normalization may be failing
- Image vs document handling differences

### 15.3 Clarification Asking Generic Questions

**Problem**: "always asked the same question about how i want to receive the answer, but then forgetting"
**Impact**: User frustration, no learning from responses
**Root Cause**:
- Clarification generation is too generic
- Clarification context not persisted
- No loop prevention beyond immediate previous turn

### 15.4 Cross-Page Behavioral Divergence

**Problem**: Chat has full features, workspace/artifacts have simplified behavior
**Impact**: Users experience inconsistent AI
**Root Cause**: Different hooks (useChatState vs useChatPanel), different config (full modes vs "general")

### 15.5 Decorative "Thinking" UI

**Problem**: Users see "Thinking", "Analyzing", "Writing response" labels that are pipeline phase indicators
**Impact**: UI implies capabilities that don't exist
**Root Cause**: `runtimePhaseLabel()` maps phases to display strings; no actual model thinking extraction

### 15.6 Agent Tool Capability Mismatch

**Problem**: Agent builder sends UI capability IDs but tools expect different names
**Impact**: Agents don't work as configured
**Root Cause**: No mapping between "search" -> "search_web", "flashcards" -> "create_note"

### 15.7 Memory Not Shared Across Surfaces

**Problem**: Chat memory not accessible in workspace AI, and vice versa
**Impact**: Inconsistent context across surfaces
**Root Cause**: Different memory scopes per surface, workstream memory only for L4

---

## 16. Hidden Issues - Silent Failures and Edge Cases

### 16.1 Silent Error Swallowing (HIGH PRIORITY)

Multiple places in the codebase silently swallow errors with empty catch blocks:

**Locations and examples** (pipeline.ts):
- Line 198: `await recordOpenRouterUsage({...}).catch(() => {});`
- Line 5928: `void convexMutation("analytics:recordSession", {...}).catch(() => {});`
- Line 5907: `await convexMutation("models:recordModelQualitySignals", {...}).catch(() => {});`

**Pattern**: `.catch(() => {})` throughout the codebase

**Impact**: Silent failures in usage tracking, analytics, and model quality signal recording could lead to data loss without any indication to the user or logs.

### 16.2 Known Model Switch Context Regression

**Documented in**: `docs/manual-repro/model-switch-context-regression.md`

**Problem**: When switching models mid-conversation, context can be lost. The assistant may behave as if the conversation started from scratch and ask to re-upload the same image.

**Pass Criteria** (from docs):
- No new chat created
- Message history remains continuous
- Image context remains available

### 16.3 Promise.allSettled Without Error Handling

**Location**: `convex/resources.ts` line 744

```typescript
const scheduleResults = await Promise.allSettled(
  chunks.map(async (chunk) => {...})
);
// No checking of scheduleResults for rejected promises
```

### 16.4 Token Budget Edge Cases

**Locations**: pipeline.ts lines 4083, 4091, 4098, 4404, 4453

Different maxTokens values are hardcoded based on mode:
```typescript
maxTokensPerSpecialist: routePlan.responseBudget === "deep" ? 750 : 600,
maxTokensPerSpecialist: effectiveMode === "research" ? (routePlan.responseBudget === "deep" ? 1300 : 1100) : 900,
```

**Edge Case**: If a model doesn't support the requested maxTokens, the request could fail without proper fallback.

### 16.5 Context Compaction May Lose Important Information

**Location**: `convex/chats.ts` lines 116-179

Compaction summary is limited to 2000 characters:
```typescript
return lines.join("\n").slice(0, 2000);  // Line 104
```

**Edge Case**: Nuanced context may be lost during compaction.

### 16.6 Race Conditions in Async Operations

**Locations**: Multiple places in `src/hooks/use-chat-state.ts`

```typescript
void refreshPersonalResources().catch(() => {});  // Line 952
void updateChatSettingsById(chatId, { agentId: nextAgentId ?? null }).catch(() => {});  // Line 1636
```

Multiple async operations fire without waiting, could cause state inconsistencies.

### 16.7 API Key Degraded Mode

**Location**: `convex/env.ts`

When API keys are missing, features run in "degraded mode" rather than failing securely:
```typescript
if (!hasOpenRouterKey) {
  console.warn("[env] OPENOPENROUTER_API_KEY missing at startup; some features will run in degraded mode.");
}
```

---

## 17. Additional Observations

### 17.1 User's Specific Complaints Summary

1. **Model switches every time** - Anchoring implemented but unstable
2. **File attachments not used by models** - Context lost on model switch
3. **Conversation forgetting/hallucination** - Context not preserved properly
4. **Clarification asks generic questions repeatedly** - Poor question generation, no context retention
5. **Too many .md files in route folder** - Need to investigate this
6. **System feels like "slop"** - Multiple architecture changes layered on poorly-edited files

### 17.2 What Was Done Well (Post-Audit)

1. Model anchoring WAS implemented
2. Failed files no longer count toward limits
3. Failed files can be deleted
4. Phase-router.ts added as new primary router
5. WhyThisModel explanation exists
6. Task graph multi-agent system in place
7. Managebac backend fully implemented
8. Agent matching system exists

### 17.3 What Still Needs Fixing

1. Model stability in conversation (despite anchor existing)
2. File context preservation across model switches
3. Clarification question quality and context retention
4. Cross-surface feature parity
5. Agent tool capability mapping
6. Remove fake/hard-coded thinking labels
7. Tool error visibility
8. Memory across surfaces

---

## 18. Database Schema - AI-Related Tables

### 18.1 Key Tables and Fields

| Table | Key AI-Related Fields |
|-------|---------------------|
| **messages** | `thinkingContent`, `routeTrace`, `content`, `citations`, `modelRequested`, `modelUsed`, `whyThisResponse`, `usageIn`, `usageOut` |
| **chats** | `mode`, `thinkingLevel`, `routerMode`, `manualModel`, `usePersonalResources`, `contextSummary`, `compactedUntilMessageId` |
| **resources** | `status` (uploaded/processing/processed/failed), `scope`, `contentHash`, `storageId`, `parsedCharCount`, `error`, `processingAttempts` |
| **chunks** | `resourceId`, `text`, `embedding` (3072-dim), vector index |
| **agents** | `systemPrompt`, `preferredModel`, `guidelinesSummary`, `guidelinesTopicMap`, `allowedTools`, `modelAllowlist` |
| **userMemoryEntries** | `key`, `text`, `embedding` (3072-dim), `category`, `confidence`, `sourceType`, `scope`, `freshness` |
| **workstreamMemory** | `workstreamId`, `key`, `text`, `textHash`, `embedding` (3072-dim), `category`, `confidence`, `sourceType`, `status` |
| **modelCatalog** | `modelId`, `contextLength`, `inputCostPerM`, `outputCostPerM`, `capabilities`, `benchmarkMMLU`, `arenaElo` |
| **modelRuntimeStats** | `successCount`, `failureCount`, `avgLatencyMs`, `qualityScore`, `challengerState` |

### 18.2 Schema Issues

1. **Route Trace Type Safety**: `routeTrace` is stored as `v.optional(v.any())` - no schema validation, defined in TypeScript but not enforced at DB level

2. **Thinking Content Format**: `thinkingContent` is just a string - UI parses into "thinking segments" client-side

3. **Memory Status Transitions**:
   - userMemoryEntries: `pending` → `confirmed`
   - workstreamMemory: `active` → `superseded` → `dismissed`

4. **Vector Embeddings**: All use 3072 dimensions (EMBEDDING_DIMENSIONS constant)

---

## 19. Unknowns / Things Not Verifiable from Repo

### 17.1 Not Verifiable

1. **Actual OpenRouter behavior**: Can't verify actual response format without live testing
2. **Live model catalog freshness**: How often metadata refreshes
3. **Real user behavior patterns**: How users actually interact
4. **Production error rates**: Can't determine from code
5. **Cost actual vs estimated**: Token tracking accuracy
6. **Model quality feedback**: How `recordModelQualitySignals()` affects routing
7. **Memory retention**: How long entries persist
8. **RAG effectiveness**: Can't verify retrieval quality without testing

### 17.2 Need Live Testing To Verify

1. Model anchoring actually working in practice
2. File attachments actually being passed to models
3. Clarification flow end-to-end
4. Cross-page behavior consistency
5. Memory across surfaces working

---

## 20. Summary: What the User Is Experiencing

The user is experiencing a system that:
- HAS the architectural pieces (anchoring, memory, tools, agents) but
- DOESN'T work correctly in practice (model switches, files don't work, forgetting)
- FEELS like "slop" from multiple architecture changes
- WORKS BETTER in /chat but poorly in /workspace and /artifacts

The root causes are:
1. **Implementation != Working** - Anchoring exists but is unstable due to 10% exploration chance, recent model penalty, provider rotation
2. **Context not preserved** - Files, memory, conversation context lost on model switch (known regression documented)
3. **Incomplete features** - Workspace/artifacts are reduced versions of chat (no file attachments, hardcoded mode/thinking)
4. **Poor quality questions** - Clarification generates generic repetitive questions with 5-minute TTL context
5. **No cross-surface consistency** - Different behavior in different parts of the app
6. **Silent failures** - Multiple `.catch(() => {})` patterns swallow errors without logging

### Additional Root Causes Discovered

7. **Fake labels everywhere** - workspace-v2/app.tsx returns "Thinking…" for ALL phases
8. **Memory double storage** - Workstream memory written to both userMemoryEntries AND workstreamMemory
9. **Task-graph tools not enforced** - Subagents can use any tool, profile allowedTools is documentation only
10. **No worker shared state** - Specialists only receive summarized dependency results, no run journal
11. **Workstream memory L4-only** - Lower assignment levels don't get workstream memory even in workspace context

---

## 21. Recommended Investigation Areas

1. **Model anchor instability** - Debug why anchor is being replaced even when should be reused
   - Priority: Remove or reduce 10% exploration chance
   - Priority: Review recent model penalty (0.7x for last 3 turns)
   - Priority: Review provider rotation penalty

2. **File context pipeline** - Trace how files are passed to models and where it fails

3. **Clarification generation** - Check question generation logic for quality

4. **Memory persistence** - Verify memory is being read/written correctly across surfaces

5. **Agent tool mapping** - Fix the capability ID to tool name mapping

6. **Silent error handling** - Replace `.catch(() => {})` with proper error logging

7. **UI fake labels** - Fix workspace-v2/app.tsx to return actual phase labels

8. **Workspace/Artifact feature parity** - Wire up file attachments, mode/thinking selection

---

## 22. Complete File Inventory for AI System

### Routing & Model Selection
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/routing/phase-router.ts` | 1080 | Primary weighted scoring router |
| `src/lib/model-anchor.ts` | 175 | Stable model anchoring for conversation |
| `src/lib/model-selection.ts` | 606 | Model catalog types and ranking |
| `src/lib/model-broker.ts` | 374 | Capability-first broker filtering |
| `src/lib/routing/heuristic.ts` | 1210 | Legacy heuristic-based routing |
| `src/lib/runtime/model-guardrails.ts` | 131 | Quality floor, freshness filtering |

### Pipeline & Orchestration
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/orchestrator/pipeline.ts` | ~6370 | Main orchestration pipeline (MONOLITHIC) |
| `src/lib/orchestrator/task-graph.ts` | ~400 | Multi-agent orchestration |
| `src/lib/orchestrator/runtime-contract.ts` | ~350 | Runtime event types |
| `src/lib/orchestrator/clarification.ts` | ~400 | Clarification detection |

### Tools & Execution
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/orchestrator/tool-definitions.ts` | 645 | 24 AI tool definitions |
| `src/lib/orchestrator/tool-executor.ts` | ~300 | Tool execution engine |

### Memory
| File | Lines | Purpose |
|------|-------|---------|
| `convex/memory.ts` | ~600 | Personal/global memory |
| `convex/workstreamMemory.ts` | ~400 | Workstream-scoped memory |
| `src/lib/orchestrator/post-process.ts` | ~700 | Memory extraction |

### Agents
| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/agent-matching.ts` | ~300 | Agent selection for messages |
| `convex/agents.ts` | ~400 | Agent storage and queries |
| `src/lib/orchestrator/specialists.ts` | ~250 | Specialist system prompts |

### UI Components
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/chat/thinking-block.tsx` | ~200 | Thinking display |
| `src/components/shared/execution-timeline.tsx` | ~500 | Premium timeline component |
| `src/components/chat/route-trace-drawer.tsx` | ~400 | Route explanation drawer |
| `src/components/chat/model-routing-badge.tsx` | ~150 | Model badge UI |
| `src/components/chat/clarification-card.tsx` | ~150 | Clarification UI |

### Backend (Convex)
| File | Purpose |
|------|---------|
| `convex/chats.ts` | Chat session management |
| `convex/messages.ts` | Message storage |
| `convex/resources.ts` | File upload/processing |
| `convex/chunks.ts` | RAG embeddings |
| `convex/models.ts` | Model catalog |
| `convex/managebacSync.ts` | Managebac integration |

---

**End of Report**

---