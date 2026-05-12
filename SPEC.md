# SPEC.md — Spectra AI Runtime Rebuild

## Read these attached files first

Use the attached files as direct context, not as decorative references:

- `@AI_INTEGRATION_FULL_SYSTEM_AUDIT.md` — source-of-truth audit of the current AI architecture, broken assumptions, root causes, code areas, and test gaps.
- `@image.png` — current Spectra AI experience/problem screenshot. Treat it as evidence of the broken visual/runtime experience: fake or generic trace text, poor hierarchy, clarification rendered incorrectly, model identity changes feeling disconnected, and AI activity not feeling like one coherent run.
- `@claude1.png` — visual reference for a stronger activity timeline: compact, readable, concrete, grouped, and based on actual operations.
- `@claude2.png` — visual reference for a stronger agent/research trace: tool/search events are obvious, grouped, collapsible, and not pretending to be hidden chain-of-thought.

Do not merely copy the visual references. Use them as a quality bar. Spectra should go beyond them by making the runtime itself more coherent, not just by imitating their styling.

---

## What this is

This is not another audit prompt.

This is not a prompt to write a spec.

This is the implementation spec.

You are expected to edit the codebase and rebuild the AI integration so Spectra becomes a coherent AI-native environment across chat, workspace, artifacts, files, tools, memory, and orchestration.

Spectra should not feel like a normal chatbot with a canvas bolted on. It should feel like an AI operating environment for school/work/research: a place where context, files, artifacts, workspace objects, tools, and model choices are all part of one transparent system.

The current AI layer is below that standard. The audit shows the system presents itself as unified, intelligent, collaborative, and transparent, but actually has divergent implementations, per-message re-routing, decorative thinking UI, weak workspace/artifact integration, brittle resource handling, and clarification that breaks continuity.

This is a redesign-level implementation. Do not be timid. If the existing architecture cannot support the required behaviour, replace or consolidate it. Avoid adding one more patch on top of an already fragile system.

---

## External product and architecture lessons to internalize

These are not features to blindly copy. They are design constraints that show what mature agent/chat systems already treat as normal.

### OpenAI Agents-style runtime

OpenAI’s Agents SDK exposes concepts that Spectra needs internally even if Spectra does not use that SDK directly:

- persistent sessions for maintaining working context inside an agent loop;
- human-in-the-loop interruptions where a run pauses and later resumes from the same run state;
- tracing that records LLM generations, tool calls, handoffs, guardrails, and custom events;
- multi-agent handoffs and tool/delegation patterns.

Translate this into Spectra as: durable AI runs, resumable clarification, first-class events, and explicit tool/worker traces.

### ChatGPT Agent-style UX

ChatGPT Agent shows that long-running work needs visible narration, interrupt/resume control, connector/file access, and real tool activity. The important point is not the exact UI. The important point is that agentic work is not just final text: the user must understand what is happening, what context is being used, when the system is stuck, and how to steer it without losing progress.

Translate this into Spectra as: visible run state, pause/cancel/resume where possible, real event timeline, and clarification that continues the same run rather than creating a fake user message.

### ChatGPT Apps/Projects-style context

ChatGPT’s app/project model treats uploaded files, connected tools, and project instructions as first-class context inside the conversation. It does not make the user guess whether a file is “attached but not processed” or “saved but inaccessible.”

Translate this into Spectra as: files/resources have honest state, project/workspace context is explicit, and the assistant can explain exactly which resources were used.

### Claude/Claude Code-style agent control plane

Claude Code’s interesting part is not only the model. It is the control plane: memory, scoped rules, tools, permissions, status visibility, file operations, execution boundaries, subagents, and explicit environment separation. Anthropic also warns that multiple execution environments can confuse an agent if not clearly distinguished.

Translate this into Spectra as: tools have clear execution environments, worker agents use structured shared context, the UI shows real actions, and the runtime never lets the model assume browser/server/sandbox/local state is shared when it is not.

### Claude Artifacts-style workspace

Artifacts work because the generated object becomes a persistent sidecar to the conversation, not just text. Spectra should use this idea but go further: artifacts should project into workspace, have provenance, update through events, and remain connected to the run that created or changed them.

Translate this into Spectra as: artifact creation/update is a structured operation with versioning, run events, workspace projection, and follow-up context.

### Manus-style “deliver work” framing

Manus positions itself around delivering finished work using browser and file-system tools, not just answering. That framing matters. Spectra should not just answer about school work; it should create notes, plans, artifacts, quizzes, workspace structures, and reusable outputs.

Translate this into Spectra as: every serious AI run should understand whether it is answering, transforming, creating, organizing, or operating.

### OpenRouter and Artificial Analysis routing lessons

OpenRouter exposes model metadata such as model id, canonical slug, context length, modalities, supported parameters, pricing, top provider information, and supported tool/structured-output/reasoning parameters. OpenRouter also supports prompt caching on supported providers and response caching for identical successful requests.

Artificial Analysis can add external model quality/speed/price signals when available.

Translate this into Spectra as: do not hard-code stale model IDs as the main intelligence. Route from live/cached metadata, family preferences, capability constraints, recent model freshness, price/latency, and observed reliability.

---

## Product ambition

Spectra’s AI should feel like the centre of the app, not a side panel.

The user should be able to trust that:

- the selected model is intentional;
- the same conversation does not randomly bounce across models;
- files that appear attached are actually usable or visibly not ready;
- tool calls are real operations with results;
- clarification does not fracture the conversation;
- artifacts and workspace items are created through visible structured operations;
- model switching or fallback does not lose context;
- the UI shows what the system is actually doing;
- `/chat`, `/workspace`, and `/artifacts` share one runtime language.

A run should feel like a coherent piece of work. It may involve retrieval, tools, files, artifacts, subagents, and final text, but it should still visually and structurally be one assistant run.

---

## Core implementation doctrine

### 1. Runtime first, UI second

Do not try to fix the AI UI by renaming labels. The UI is bad because the runtime events are not coherent enough. Build a better runtime event model first, then render it well.

### 2. Real events only

Remove fake hard-coded thinking steps. If there is no real event, show a minimal neutral waiting state. If there is a real event, show it precisely.

### 3. One AI system, three surfaces

`/chat`, `/workspace`, and `/artifacts` may have different layouts, but they must share the same run/event/tool/model/resource architecture.

### 4. Stable model identity

A conversation needs an anchor model. The router may be smart, but it must not behave like it is randomly model-hopping.

### 5. Tools are not prose

Tool calls must be structured operations with schemas, statuses, results, errors, side effects, and UI cards.

### 6. Files are state machines

Resources are not just blobs. They have upload, processing, indexing, attachment, My Files, deletion, retry, and model-availability state.

### 7. Artifacts and workspace items are first-class outputs

Creating an artifact or workspace item is not a side effect hidden behind generated text. It is a runtime event and a persisted object.

### 8. Human input can pause a run

Clarification should pause and resume the same run, not create a separate visible user prompt.

### 9. Workers are rare and useful

Subagents should be launched only when they improve reliability. They need shared state and visible summaries, not chaotic transcript spam.

### 10. Redesign is allowed

If the existing code path is too brittle, replace it. Do not preserve a broken abstraction just because it already exists.

---

## Worker policy

Do not use worker sub-agents for broad repo discovery, generic audits, or reading files.

Use at most 3 worker sub-agents active at any time.

Workers are allowed only for concrete implementation tracks such as:

- model routing + anchoring;
- AI run/event persistence;
- resource/files repair;
- frontend runtime timeline components;
- artifact/workspace integration;
- test implementation.

Each worker must produce code-level output that can be merged. No worker should simply “think about the problem”.

The main agent is responsible for architecture, integration, final decisions, test coverage, and avoiding duplicate/conflicting changes.

---

## Target mental model

Think of Spectra’s AI runtime as an operating system layer for AI work.

A user action starts an `AiRun`.

An `AiRun` owns:

- model selection;
- context assembly;
- file/resource checks;
- retrieval;
- tool calls;
- clarification interruptions;
- worker delegation;
- artifact operations;
- workspace mutations;
- memory reads/writes;
- streamed answer text;
- errors/fallbacks;
- final persisted output.

The run emits `AiRunEvent`s.

The UI renders the run as one assistant execution.

Messages are outputs of runs; they are not the run itself.

Artifacts are outputs or mutated objects of runs; they are not detached side effects.

Workspace items are projections of run outputs or direct workspace operations; they are not magic UI state.

Files/resources are context objects with availability state; they are not just attachments.

Model anchors are conversation/runtime policy; they are not a badge shown after completion.

---

## Required domain objects

Adapt names to the existing codebase if needed, but these concepts must exist.

### `AiRun`

A durable or rehydratable execution object.

Fields should include at least:

```ts
AiRun = {
  id: string;
  surface: "chat" | "workspace" | "artifact";
  status:
    | "queued"
    | "routing"
    | "checking_context"
    | "waiting_for_clarification"
    | "running"
    | "streaming"
    | "applying_side_effects"
    | "completed"
    | "failed"
    | "cancelled";
  userId: string;
  orgId?: string;
  conversationId?: string;
  threadId?: string;
  workspaceId?: string;
  workstreamId?: string;
  artifactId?: string;
  parentRunId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  input: {
    text: string;
    attachments: RuntimeAttachmentRef[];
    selectedItems?: RuntimeSelectionRef[];
    mode?: string;
    userSelectedModelId?: string;
  };
  selectedModel?: SelectedModelSnapshot;
  modelAnchorBeforeRun?: ModelAnchorSnapshot;
  modelAnchorAfterRun?: ModelAnchorSnapshot;
  contextPackageId?: string;
  finalMessageId?: string;
  error?: RuntimeError;
};
```

### `AiRunEvent`

A durable event or at least stream-rehydratable event. Events power the UI.

Suggested event types:

```ts
type AiRunEvent =
  | { type: "run_started"; runId: string; at: number }
  | { type: "model_selected"; runId: string; model: SelectedModelSnapshot; reason: ModelSelectionReason; at: number }
  | { type: "model_fallback"; runId: string; from: string; to: string; reason: string; at: number }
  | { type: "context_package_created"; runId: string; summary: ContextPackageSummary; at: number }
  | { type: "resource_checked"; runId: string; resourceId: string; status: RuntimeResourceStatus; usable: boolean; reason?: string; at: number }
  | { type: "retrieval_started"; runId: string; scope: string[]; at: number }
  | { type: "retrieval_completed"; runId: string; sources: RetrievedSourceSummary[]; at: number }
  | { type: "tool_call_started"; runId: string; toolCallId: string; name: string; title: string; argsPreview?: unknown; at: number }
  | { type: "tool_call_progress"; runId: string; toolCallId: string; summary: string; at: number }
  | { type: "tool_call_completed"; runId: string; toolCallId: string; resultPreview?: unknown; resultRef?: string; at: number }
  | { type: "tool_call_failed"; runId: string; toolCallId: string; error: RuntimeError; at: number }
  | { type: "clarification_requested"; runId: string; toolCallId: string; questions: ClarificationQuestion[]; at: number }
  | { type: "clarification_answered"; runId: string; toolCallId: string; answers: Record<string, unknown>; at: number }
  | { type: "worker_started"; runId: string; workerId: string; role: string; goal: string; model?: SelectedModelSnapshot; at: number }
  | { type: "worker_progress"; runId: string; workerId: string; summary: string; at: number }
  | { type: "worker_completed"; runId: string; workerId: string; resultSummary: string; resultRef?: string; at: number }
  | { type: "worker_failed"; runId: string; workerId: string; error: RuntimeError; at: number }
  | { type: "artifact_created"; runId: string; artifactId: string; title: string; artifactType: string; at: number }
  | { type: "artifact_updated"; runId: string; artifactId: string; patchSummary: string; versionId?: string; at: number }
  | { type: "workspace_item_created"; runId: string; workspaceItemId: string; title: string; itemType: string; at: number }
  | { type: "workspace_item_updated"; runId: string; workspaceItemId: string; patchSummary: string; at: number }
  | { type: "memory_read"; runId: string; summary: string; at: number }
  | { type: "memory_written"; runId: string; summary: string; at: number }
  | { type: "text_delta"; runId: string; delta: string; at: number }
  | { type: "answer_started"; runId: string; at: number }
  | { type: "answer_completed"; runId: string; messageId: string; at: number }
  | { type: "run_failed"; runId: string; error: RuntimeError; at: number }
  | { type: "run_completed"; runId: string; at: number };
```

Do not display hidden chain-of-thought. If provider reasoning metadata is needed for continuity, store/pass it privately according to provider requirements. User-visible UI should show operational summaries and tool activity, not private reasoning.

### `ModelAnchor`

A conversation/workstream/artifact-level model identity.

```ts
ModelAnchor = {
  id: string;
  scopeType: "conversation" | "workspace" | "artifact";
  scopeId: string;
  modelId: string;
  canonicalSlug?: string;
  provider?: string;
  family: "deepseek" | "glm" | "kimi" | "minimax" | "qwen" | "mimo" | "openai" | "anthropic" | "google" | "other";
  selectedAt: number;
  lastUsedAt: number;
  selectedBy: "router" | "user" | "fallback";
  manualOverride: boolean;
  selectionReason: ModelSelectionReason;
  capabilityProfile: ModelCapabilityProfile;
  freshness?: ModelFreshness;
  pricing?: ModelPricingSnapshot;
  cachePolicy?: ModelCachePolicy;
  fallbackHistory?: ModelFallbackRecord[];
};
```

### `ContextPackage`

The assembled model context for a run.

It should include:

- user message;
- conversation history summary/window;
- model anchor/route reason;
- active surface context;
- workspace/workstream context;
- current artifact context;
- selected workspace items;
- attached resources;
- processed text snippets;
- image/file blocks for compatible models;
- retrieval results;
- memory entries;
- tool availability;
- token budget decisions;
- omissions/truncations.

This object does not have to be shown directly, but the runtime must be able to explain which context was included and which was skipped.

### `ResourceState`

Separate upload/storage/indexing/attachment states. Do not collapse them.

```ts
ResourceRuntimeStatus =
  | "local_pending"
  | "uploading"
  | "uploaded"
  | "processing"
  | "indexed"
  | "failed_processing"
  | "storage_missing"
  | "detached"
  | "deleted"
  | "unavailable";
```

A resource can be attached to a run/conversation without being usable. The UI must show that honestly.

---

## Model routing V2

### Required behaviour

Model routing should be dynamic, metadata-driven, and stable.

Default family preference for automatic routing:

1. DeepSeek
2. GLM / Z.ai
3. Kimi / Moonshot
4. MiniMax
5. Qwen
6. MiMo / Xiaomi if available
7. Other strong open or cost-efficient models
8. Closed-source premium models only when capability justifies it or the user explicitly chooses them

This is a family preference, not a list of hard-coded exact model IDs.

For each family, select the latest/strongest compatible currently available model using live/cached metadata.

### Anchor policy

For a normal follow-up in the same conversation/thread, reuse the existing anchor model.

Re-route only when there is an explicit reason:

- user manually selects another model;
- current model is unavailable;
- provider returns an error requiring fallback;
- current model lacks required modality;
- current model lacks tool/structured-output support required by the run;
- current model lacks enough context length;
- user changes mode/task class substantially;
- user asks for high reasoning/coding/vision capability beyond anchor;
- policy/cost/safety constraints require another model.

Every re-route must produce a `model_fallback` or `model_selected` event with a real reason.

Bad reason:

> “Chosen because it is best for this task.”

Good reason:

> “Kept `deepseek/...` because this is a follow-up in the same conversation and the anchor supports text, tools, and the current context budget.”

Good reason:

> “Switched to `kimi/...` because the new message includes images and the anchor model does not expose image input in the current OpenRouter model metadata.”

Good reason:

> “Switched to fallback `glm/...` because the anchored DeepSeek endpoint returned a provider error after the first attempt.”

### Metadata sources

Use server-side cached metadata from:

- OpenRouter `/api/v1/models`;
- OpenRouter supported parameters and architecture fields;
- OpenRouter pricing/context/provider fields;
- OpenRouter prompt/response caching support where available;
- Artificial Analysis benchmarks/pricing/speed if configured;
- local curated fallback metadata;
- local observed reliability from previous runs.

Do not expose API keys client-side.

If Artificial Analysis is unavailable, routing still works using OpenRouter + curated metadata + observed reliability.

If OpenRouter metadata is unavailable, routing falls back to known safe curated models, but records that the decision used stale/offline metadata.

### Freshness policy

Prefer fresh models.

- Models older than ~90 days should be penalized for automatic routing unless still clearly superior.
- Models older than ~120 days should almost never win automatic routing unless manually selected or uniquely capable.
- If release date cannot be known, treat freshness as uncertain rather than fresh.

Freshness should not override capability. A new weak model should not beat a slightly older but clearly superior model for a hard task.

### Cost policy

Use price as a meaningful factor, not the only factor.

The user prefers strong models under roughly `$10 / 1M input+output combined` when possible. Treat this as a preference band, not a brittle absolute rule, because pricing formats differ.

For low-stakes tasks, cost and speed should matter strongly.

For hard artifact/research/coding tasks, capability and reliability should dominate.

### Caching policy

Same-model continuity matters for:

- prompt caching;
- stable behaviour;
- user trust;
- fewer context conversion bugs.

Use OpenRouter/provider caching where useful, but do not rely on identical-response caching for dynamic tool runs.

The router should know whether prompt caching can be enabled for a provider/model and should keep stable prefixes/tool schemas/context ordering where possible.

### “Why this model” UI

Bring back the visible “why this model” affordance beside the model name.

It should open a concise explanation based on actual route data:

- anchor reused or new selection;
- selected model/family/provider;
- alternatives considered;
- capability requirements;
- modality/tool/context requirements;
- price/freshness/latency reasoning;
- cache continuity;
- fallback reason if applicable;
- whether the decision was user/manual/router/fallback.

The explanation must not be generic marketing copy.

The model badge must appear when the model is selected, not after the final answer completes.

---

## Streaming V2

### Required behaviour

The answer text must stream token-by-token wherever the provider supports it.

Runtime events must stream separately from answer text.

The user should see, in order:

1. assistant run starts;
2. model selected;
3. context/resources checked;
4. real retrieval/tool/worker/artifact/workspace events if they occur;
5. answer text starts streaming;
6. run completes;
7. persisted final state matches streamed state.

If a provider cannot stream, show that explicitly in runtime state and avoid fake incremental text.

### No lossy legacy event contract

The audit says runtime events are converted into a weaker legacy client shape. Remove or isolate that conversion.

If compatibility requires a temporary adapter, make it one-way, typed, and tested. Do not let the weaker legacy schema determine new runtime behaviour.

### Rehydration

Refreshing the page during or after a run should not destroy the run’s meaning.

At minimum, after refresh the UI should recover:

- final message;
- selected model;
- model reason;
- tool events;
- resource events;
- artifact/workspace events;
- clarification pending/completed state;
- errors.

For active runs, recover as much as the backend supports. If live reconnection is not possible, show an honest stale/interrupted state with recovery options.

### Cancellation

A user cancellation should:

- stop streaming;
- mark run cancelled;
- preserve partial answer if useful;
- preserve completed tool/artifact/resource events;
- avoid stuck spinners;
- not create duplicate assistant messages.

---

## Thinking/status UI V2

### Remove fake labels

Remove hard-coded labels such as:

- “Analyzing”
- “Writing response”
- “analysis”
- “authoring”
- generic “checking files” if no real file check event exists

Only display a label if it comes from a real runtime event.

If the model is working but no real event exists yet, show only:

> Thinking…

or similarly minimal neutral text.

Do not pretend to expose hidden chain-of-thought.

### Timeline design

Build a polished timeline/activity component inspired by `@claude1.png` and `@claude2.png`, but better suited to Spectra.

The timeline should:

- be calm and compact;
- group related events;
- avoid duplicate headings;
- support collapsed/expanded states;
- show useful titles;
- show status icons/states;
- show errors clearly;
- not dominate the final answer;
- remain readable on long runs;
- feel premium rather than debuggy.

### Components to implement/consolidate

Create or refactor toward:

- `AiRunHeader`
- `AiModelBadge`
- `WhyThisModelPopover`
- `AiRunTimeline`
- `AiRunEventGroup`
- `ToolCallCard`
- `WorkerCard`
- `ClarificationInlineCard`
- `ResourceStatusCard`
- `ArtifactOperationCard`
- `WorkspaceMutationCard`
- `RuntimeErrorCard`

Do not scatter event rendering across unrelated message components.

### Visual hierarchy

The current problem shown in `@image.png` is not just content; it is hierarchy.

Fix:

- model identity should be clear but not huge;
- event titles should be at least as visually strong as details;
- nested/collapsed headings should not repeat the same text;
- the answer should be visually separate from the trace;
- clarification should look like an inline interaction, not a new message;
- tool cards should look operational, not like prose;
- failed files should look failed, not silently attached.

---

## Clarification / human-in-the-loop

Clarification must be implemented as a resumable run interruption.

Current broken behaviour: the assistant asks a clarification, the user answers, and that answer becomes a visible user prompt bubble. This makes the conversation look like two separate assistant turns and confuses the model/UI state.

Required flow:

1. User sends request.
2. `AiRun` starts.
3. Runtime decides clarification is required.
4. Runtime emits `clarification_requested` with structured questions.
5. UI renders `ClarificationInlineCard` inside the assistant run.
6. Run status becomes `waiting_for_clarification`.
7. User answers inside the card.
8. Client sends structured answers to resume endpoint/action with `runId` and `toolCallId`.
9. Runtime emits `clarification_answered`.
10. Same run resumes with clarification result injected as tool/context data.
11. Final answer appears under the same assistant run.

The clarification answer should not be rendered as a normal user chat message.

It can remain visible inside the card as submitted input.

### Clarification should be rare

Do not ask pointless questions like “What outcome do you want?” when the user’s intent is already clear.

Ask only if the missing information materially changes the answer or side effect.

Clarification should be bypassed when:

- the system can safely infer the missing parameter;
- a reasonable default exists;
- the user explicitly wants the agent to decide;
- the question is low-stakes;
- asking would degrade flow more than it helps.

### Clarification persistence

Pending clarification must survive refresh.

If the run cannot be resumed, show a specific recoverable error.

Do not create hidden duplicate runs.

---

## Tool system V2

Tools must become first-class runtime operations.

A tool has:

- name;
- schema;
- permission level;
- execution environment;
- input;
- output;
- model payload;
- user-visible summary;
- side effects;
- error state;
- events;
- persistence.

Tools should not be represented only as thinking notes.

### Required tool categories

Implement/consolidate tools around these categories:

#### Context tools

- inspect current runtime context;
- search/read files/resources;
- search/read workspace items;
- search/read artifacts;
- recall memory;
- search web if enabled.

#### Creation tools

- create artifact;
- update artifact;
- create note;
- create workspace item;
- update workspace item;
- create planner item;
- create quiz/flashcards if relevant.

#### Interaction tools

- ask user / clarification;
- request approval for consequential action;
- propose action before applying if risk requires it.

#### Orchestration tools

- launch worker;
- write/read run journal;
- summarize worker result;
- mark task/subtask complete.

#### Runtime tools

- switch model with reason;
- retry failed tool/resource;
- attach/detach resource;
- save memory.

### Tool UI

Every user-relevant tool call should render as a `ToolCallCard`.

Show:

- title;
- running/done/failed state;
- concise input preview;
- concise result preview;
- error and recoverability;
- created/updated object links;
- whether the result was passed back to the model.

Do not dump raw JSON by default. Make details expandable.

### Tool errors

Tool errors must be visible and specific.

Bad:

> Internal error.

Good:

> File deletion failed because the storage object was missing, but the resource record can still be cleaned up. Retrying cleanup.

Good:

> Workspace projection failed, but the artifact was created and saved.

### Execution environments

If there are multiple execution environments, name them clearly:

- server tool;
- browser/client tool;
- sandbox/code execution tool;
- external connector tool;
- Convex mutation/query;
- provider-hosted tool.

The model must not be allowed to assume state is shared across environments.

Do not implement unsafe arbitrary client-side command execution. Browser-side tools must be whitelisted, permissioned, and specific.

---

## Workers / subagents V2

Workers should feel like real delegated specialists, not random extra model calls.

Default: no workers.

Use workers only when:

- the task has separable subproblems;
- evidence gathering and synthesis benefit from parallelism;
- code implementation has independent tracks;
- a critic/checker can catch real errors;
- a worker can use a different context/tool set without polluting main context.

Maximum 3 active workers.

### Shared run journal

Workers need shared state.

Implement or consolidate a run journal:

```ts
RunJournalEntry = {
  id: string;
  runId: string;
  author: "orchestrator" | "worker";
  workerId?: string;
  kind: "plan" | "finding" | "decision" | "constraint" | "error" | "artifact" | "resource" | "handoff" | "test_result";
  title: string;
  body: string;
  refs?: Array<{ type: "file" | "resource" | "artifact" | "workspaceItem" | "event" | "test"; id: string }>;
  createdAt: number;
};
```

The orchestrator writes the task decomposition. Workers write findings and outputs. The orchestrator reads the journal before final synthesis.

Workers should not create separate visible assistant messages unless the user asks for a transcript.

Worker UI should show:

- worker role;
- goal;
- model;
- status;
- progress summary;
- result summary;
- errors.

No fake worker cards.

---

## File/resource pipeline V2

The resource system must be rebuilt or repaired until it is reliable.

The current failure modes are product-breaking:

- files attach but do not save to My Files;
- failed files count toward totals;
- failed images cannot be removed;
- deletion can throw “Resource not found”;
- models say files are not processed;
- model switching can lose file context.

### Separate concepts

Do not collapse these concepts:

- storage object;
- resource DB record;
- processing job;
- extracted text/chunks;
- embeddings/indexing;
- My Files membership;
- message/run attachment;
- workspace attachment;
- artifact attachment;
- model-context availability.

### Required file lifecycle

1. User selects file.
2. UI creates local pending attachment.
3. File uploads to storage.
4. Resource record is created.
5. Attachment relation is created for the current run/conversation/surface.
6. My Files membership is created if product policy says attached files should be saved there.
7. Processing job starts.
8. Status events stream to the run.
9. Resource becomes usable when text/image/context is available.
10. If processing fails, retry/remove remains possible.

### Status rules

A failed resource must be removable.

A missing storage object must not prevent cleanup.

Failed resources should not count as usable files.

If failed files must count somewhere, separate “failed/recoverable files” from “usable file total”.

A resource can be attached but not usable. The UI must show that state.

A resource can be saved in My Files but not attached to the current run. The UI must show that state.

A resource can be usable for one model but not another due to modality. The router/context builder must handle that.

### Context rules

Model switching must not lose file context.

The context package owns the resource references and prepared representations. When the model switches, the system adapts the representation or selects a compatible model.

Examples:

- image attached + text-only anchor model → route to vision model or preprocess image through vision tool;
- PDF still processing → answer can proceed only if enough extracted text exists or user is told it is not ready;
- failed DOCX → not included in model context; show failed resource card;
- text file processed → include selected chunks with citations/provenance.

### UI rules

Resource chips/cards should show:

- filename;
- type;
- size;
- upload state;
- processing/indexing state;
- My Files saved state;
- current-run attached state;
- model-available state;
- retry/remove/open actions;
- reason if unavailable.

Never make a failed file look successfully attached.

---

## Context package V2

The assistant should know what context it has, and the UI should be able to show a summary.

Build a context package per run.

It should include:

- conversation window;
- conversation summary if compacted;
- model anchor and route reason;
- active workspace/workstream;
- selected workspace items;
- current artifact;
- recent relevant artifacts;
- relevant notes/planner items;
- attached resources;
- processed resource content;
- retrieval hits;
- memory entries;
- available tools;
- token budget allocation;
- omitted/skipped context and reasons.

The model should not have to infer from scattered state. The context builder should assemble a deliberate package.

If context is skipped, record why:

- not processed;
- too large;
- incompatible modality;
- low relevance;
- missing permission;
- failed resource;
- model context limit.

This powers both debugging and user trust.

---

## Workspace integration V2

Workspace AI should not be a weak quick-chat clone.

It should be the same runtime operating in workspace context.

When a run starts in workspace, include:

- active workspace/workstream;
- visible or selected items;
- item positions if relevant;
- recent notes/artifacts/threads/planner items;
- pinned context;
- currently open/active artifact if any;
- available workspace tools;
- user’s instruction.

The assistant should be able to:

- create note;
- create artifact;
- update artifact;
- create workspace item;
- update workspace item;
- attach existing item to workstream;
- organize/move items if supported;
- create planner item;
- explain workspace state;
- use attached files.

### Workspace projection

Any chat/artifact/planner/resource output that should appear in workspace must go through a clear projection path.

Emit events:

- `workspace_item_created`
- `workspace_item_updated`
- `workspace_projection_failed`

Projection failure must be visible and recoverable.

Do not silently desync chat state and workspace state.

---

## Artifact integration V2

Artifact AI should be a first-class runtime surface.

Artifact creation/update should be structured, versioned, and visible.

Avoid brittle generated-text markers when a structured tool can create or update the artifact.

### Required behaviour

The assistant can:

- create artifact;
- update artifact;
- create child artifact;
- rename artifact;
- restore version;
- generate quiz/flashcards from artifact;
- export if export infrastructure exists;
- project artifact into workspace;
- explain what changed.

Artifact events must appear in the run timeline.

Artifact state must persist before the UI claims success.

If artifact creation succeeds but workspace projection fails, show both facts:

> Artifact created. Workspace projection failed; retry available.

### Artifact context

When running inside an artifact surface, include:

- current artifact content/summary;
- artifact version metadata;
- linked workspace/workstream;
- relevant chat thread;
- selected text/range if any;
- user instruction;
- available artifact tools.

Artifact AI should not lose the surrounding workspace/chat context.

---

## Memory and personalization

Memory should support the runtime, not silently mutate state.

Memory reads/writes should be represented as events when user-relevant.

Do not over-save.

Save only:

- explicit user memory requests;
- durable preferences;
- durable project/application state;
- long-term context that materially improves future runs.

Memory should be available across chat/workspace/artifact where relevant.

Memory events should say what category was read/written without exposing unnecessary private data.

---

## Cross-surface consistency

Unify behaviour across:

- `/chat`
- `/workspace`
- `/artifacts`

Shared:

- `AiRun` creation;
- model anchoring;
- event streaming;
- context package;
- file/resource state;
- tool execution;
- clarification;
- artifact operations;
- workspace projection;
- errors;
- persistence;
- “why this model”.

Allowed differences:

- chat can expose more controls;
- workspace can use compact timeline by default;
- artifact panel can emphasize artifact operations;
- different default tool sets per surface.

Not allowed:

- workspace loses files;
- artifact AI reroutes every follow-up while chat anchors;
- clarification works in chat but becomes a user bubble elsewhere;
- model badge means different things on different surfaces;
- tools are cards in chat but hidden side effects in workspace;
- artifact creation works in chat but not workspace.

---

## UI quality bar

The AI frontend must look like part of a serious premium product.

The current AI interface looks like a debug trace and a chat UI fighting each other.

Improve:

- spacing;
- typography;
- hierarchy;
- iconography;
- collapse/expand behaviour;
- event grouping;
- error states;
- model badge placement;
- answer/trace separation;
- file status display;
- artifact/workspace operation display.

The timeline should be useful while running and unobtrusive after completion.

A completed run can collapse to:

- model badge;
- 2–4 meaningful event summaries;
- final answer;
- expandable details.

A running long task can expand live and show precise progress.

Do not overload short normal answers with unnecessary visual noise.

---

## Error and recovery model

Every important failure should answer three questions:

1. What failed?
2. What still succeeded?
3. What can the user/system do next?

Examples:

- “File indexing failed. The file is uploaded but unavailable to the model. Retry or remove.”
- “The selected model failed. Switched to GLM fallback and preserved the same context package.”
- “Artifact was created, but workspace projection failed. Retry projection.”
- “The run was interrupted. Partial answer saved; continue or discard.”
- “This image cannot be read by the anchored model. Switching to a vision-capable model.”

Avoid raw server errors in the user UI. Keep details expandable for debugging.

---

## Testing requirements

Do not finish without tests around the new behaviour.

### Model routing / anchoring

Tests must cover:

- first message selects a compatible preferred model family;
- follow-up reuses anchor;
- manual override persists;
- capability mismatch triggers re-route;
- fallback records reason;
- stale models are penalized;
- missing live metadata falls back gracefully;
- `why this model` is based on real route data.

### Streaming/events

Tests must cover:

- `model_selected` arrives before answer completion;
- `text_delta` streams incrementally;
- tool events stream separately;
- run completion persists message and events;
- cancellation does not leave stuck UI;
- event rehydration after refresh.

### Thinking/status UI

Tests must cover:

- no hard-coded fake labels render without matching events;
- minimal “Thinking…” appears when no event exists;
- collapsed and expanded timeline do not duplicate headings;
- tool cards render running/done/failed states;
- model badge appears early.

### Clarification

Tests must cover:

- clarification pauses same run;
- clarification answer does not create visible user bubble;
- run resumes with structured answers;
- pending clarification survives refresh;
- clarification loop prevention.

### Tools

Tests must cover:

- tool call creates started/completed events;
- failed tool creates failed event;
- tool result returns to model context;
- artifact tool persists artifact and event;
- workspace tool persists item and event.

### Files/resources

Tests must cover:

- upload creates resource;
- processing status transitions;
- failed file can be retried;
- failed file can be removed;
- missing storage object still allows cleanup;
- failed files do not count as usable files;
- image/PDF/text resource availability is represented correctly;
- model switching preserves resource context.

### Workspace

Tests must cover:

- workspace AI uses same runtime contract;
- active workspace context is included;
- artifact projects into workspace;
- projection failure visible;
- workspace file attachment works if implemented.

### Artifacts

Tests must cover:

- artifact AI uses same runtime contract;
- artifact creation is structured;
- artifact update versions correctly;
- artifact events render;
- workspace projection works/fails visibly.

### Cross-surface

Tests must cover:

- chat/workspace/artifact share model anchoring;
- shared event schema works across surfaces;
- shared clarification behaviour or explicit unsupported state;
- shared resource handling.

---

## Implementation direction

Do not produce another long report before coding.

Use `@AI_INTEGRATION_FULL_SYSTEM_AUDIT.md` to identify existing files and current architecture. Verify against the repo, then implement.

A sensible implementation shape is:

1. Establish/repair the runtime event contract.
2. Add durable or rehydratable `AiRun` state.
3. Implement model anchors and route reasons.
4. Repair streaming so model selection, events, and text deltas arrive correctly.
5. Replace fake thinking UI with event-based timeline components.
6. Convert clarification into a resumable inline interaction.
7. Repair resource state and cleanup.
8. Make tools first-class event-producing operations.
9. Connect artifact operations to the runtime.
10. Connect workspace operations to the runtime.
11. Add tests throughout.

This order is not mandatory. If the repo structure makes another order better, choose it. But do not skip the runtime foundation and only restyle the UI.

---

## What not to do

Do not:

- create another audit instead of implementing;
- make purely cosmetic UI changes;
- keep fake “analysis/authoring” labels;
- hide backend bugs with frontend conditions;
- hard-code one exact DeepSeek model and call routing done;
- make every message re-route by default;
- let clarification create a visible user prompt bubble;
- let failed files remain undeletable;
- let failed files count as usable files;
- make workers spam the run;
- create separate incompatible systems for chat/workspace/artifacts;
- silently swallow tool/resource/projection errors;
- use unsafe arbitrary browser command execution;
- expose hidden chain-of-thought;
- stop after an easy patch if the AI system is still incoherent.

---

## Definition of exceptional

The result is exceptional when a user can run a complex request in `/chat`, see a stable model, attach files, watch real tools/resources/artifacts/workspace events, answer clarification inline if needed, receive streamed text, and then continue the conversation without losing model identity or context.

It is exceptional when the same runtime also works in workspace and artifact surfaces, even if rendered more compactly.

It is exceptional when the UI makes the system feel more capable because the system actually is more coherent, not because the UI pretends.

It is exceptional when future agents can understand and extend the AI system without reverse-engineering scattered side effects.

---

## Concrete acceptance checklist

The implementation is not done until these behaviours are true:

1. Normal follow-ups reuse the conversation model anchor.
2. Re-routes happen only with explicit persisted reasons.
3. The default automatic router prefers current strong DeepSeek-family models when compatible, then GLM/Kimi/MiniMax/Qwen/MiMo families using live/cached metadata.
4. Exact model IDs are not the main long-term routing strategy.
5. The model badge appears at run start.
6. “Why this model” is visible and grounded in actual route data.
7. Assistant text streams live.
8. Runtime events stream separately from text.
9. Fake hard-coded thinking labels are removed.
10. Timeline UI renders real events only.
11. Clarification is inline and resumable inside the same run.
12. Clarification answers do not appear as normal user messages.
13. Tool calls render as structured cards with status/results/errors.
14. Worker calls are limited, useful, and journal-backed.
15. Failed files can be removed.
16. Missing storage does not block resource cleanup.
17. Failed files do not count as usable files.
18. Attached files correctly save/link to My Files according to product policy.
19. Model fallback/switch does not lose resource context.
20. Workspace AI uses the shared runtime.
21. Artifact AI uses the shared runtime.
22. Artifact operations are structured and versioned.
23. Workspace projection is explicit and visible.
24. Errors explain what failed, what succeeded, and what can happen next.
25. Tests cover the new runtime behaviours.

---

## Final directive

Treat the current AI layer as a system that needs architectural repair, not polish.

The product goal is not “make the chat look nicer”.

The product goal is: make Spectra’s AI feel like a coherent environment where models, context, files, tools, artifacts, workspace objects, and user clarification operate through one honest runtime.

Implement that.
