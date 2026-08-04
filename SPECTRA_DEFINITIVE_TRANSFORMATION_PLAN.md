# Spectra Definitive Transformation Plan

**Status:** Canonical transformation plan  
**Purpose:** Guide the complete functional, architectural and later visual transformation of Spectra into an exceptional collaborative work platform  
**Implementation model:** One continuous repository-wide programme, divided into gated phases  
**Verification model:** Code-only verification. Do not open Chrome, run Playwright, record video, inspect screenshots or claim visual proof from a browser.

---

## 0. Authority, intent and how to use this plan

This document is the canonical plan for the next major Spectra transformation. It supersedes earlier planning documents wherever they conflict with it, especially any previous assumptions that:

- collaboration should remain online-only;
- the current atomic JSON-on-Yjs representation is sufficient;
- a normal virtual machine is the final realtime host;
- timetable/calendar should remain a creatable work type;
- Memory should remain a normal user-facing page;
- the current Agent Studio form is the intended long-term creation experience;
- the existing `/artifacts` terminology and route structure should remain user-facing;
- every AI request should open a side conversation automatically;
- local browser compute should become the default place for most work;
- visual polish should be mixed into foundational migrations before the system is stable.

The implementation must follow the phases in order. Later phases may begin only when the explicit exit criteria of their dependencies pass. Within each phase, preserve working behaviour behind compatibility adapters until the replacement is proven through code-level tests. Avoid large destructive rewrites that remove the only working path before the replacement exists.

This is a **plan**, not a one-shot list of instructions. Each phase defines:

1. the product outcome;
2. the architecture to establish;
3. the systems to build or migrate;
4. the experience that must result;
5. the code-only verification required;
6. the conditions for moving forward.

Before changing implementation, create and maintain these repository documents under a new canonical planning directory such as `docs/spectra-definitive/`:

- `00_CANONICAL_PLAN.md` — a copy or reference to this plan;
- `01_DECISIONS.md` — architectural decisions and rationale;
- `02_IMPLEMENTATION_LEDGER.md` — completed/current/blocked phase tasks;
- `03_MIGRATION_LEDGER.md` — old-to-new data, route and API compatibility status;
- `04_DEFECT_LEDGER.md` — discovered defects, affected surfaces and resolution status;
- `05_REQUIREMENT_TRACEABILITY.md` — requirement IDs from this plan mapped to implementation and tests;
- `06_ENGINE_ADOPTION_SCORECARD.md` — assessment of open-source engines considered for reuse.

Keep these concise and operational. Do not create narrative progress reports or duplicate documentation after every small change.

---

## 1. Product outcome

At the end of this programme, Spectra must feel like one coherent work environment rather than a collection of editors with an AI chat attached.

A user should be able to:

- move between Library and Workspace without losing open work, tiled layouts, threads or AI runs;
- edit rich text, code, sheets, slides, boards, quizzes, decks, plans and agents with professional-grade interfaces;
- collaborate with humans and AI in the same work, with smooth cursors, selections and interaction ownership;
- type continuously without autosave, synchronization or remote updates interrupting input;
- watch an AI perform understandable, human-like actions while the underlying system verifies, waits, retries and resumes intelligently;
- keep an AI run compact while working, hover for only the most important extra information, or click once to open its full right-panel conversation;
- receive inline, verified citations in chat and add proper sources throughout every work type;
- insert references to other work in a simple collapsed form and expand those same references into live previews;
- use one canonical Calendar that integrates classes, deadlines, tasks and scheduled work;
- create a specialist agent through an adaptive, guided Foundry that learns from evidence and improves safely over time;
- use school data that is demonstrably current, complete where supported and honest about unavailable capabilities;
- configure sensible defaults from a real Settings application without being confronted by internal complexity;
- use Spectra comfortably on desktop, constrained laptops and mobile devices, with browser compute remaining lightweight and capability-aware;
- trust that recoverable AI and integration problems are handled intelligently without false success, unnecessary red errors or abandoned work.

The product should expose **simple choices** while implementing sophisticated policies internally. Advanced functionality should generally be available but collapsed, contextual or inferred. Do not make the user understand infrastructure, CRDTs, capability matrices, retry policies, model routes or internal artifact abstractions.

---

## 2. Non-negotiable product decisions

### 2.1 User-facing simplicity

- Do not use **artifact** as the normal user-facing generic noun. Use the exact type (`Document`, `Quiz`, `Sheet`, `Presentation`, `Board`, `Plan`, `Agent`) or neutral terms such as **work**, **item** or **content**.
- Keep primary sharing language simple: **Read-only** and **Edit**. More precise internal permissions may exist, but surface them only when a concrete workflow requires a specific choice.
- Keep advanced settings and specialist controls collapsed by default.
- Avoid adding permanent navigation bars, rails, mode rows or panels when a contextual control or overflow menu is sufficient.
- Do not expose technical failures when Spectra can safely recover, but never turn an unavailable capability into a false empty result or false success.

### 2.2 Realtime collaboration

- Keep Yjs and upgrade its use to native fine-grained shared structures.
- Host the realtime plane on Cloudflare Workers and Durable Objects.
- Keep Convex as the durable product-state, metadata, audit and projection layer—not the cursor or keystroke transport.
- Preserve and improve human-like AI interactions.
- Use three internal concurrency policies:
  1. mergeable CRDT state;
  2. interaction leases;
  3. structural claims.
- Ordinary typing must never wait for Convex persistence or a full semantic projection.
- Saving, durable projection and collaboration are separate states; none may disable normal editing.
- Offline/reconnecting edits should remain safe locally and merge when connectivity returns, within mobile-safe storage limits.

### 2.3 AI and model routing

- Use the configured GPT-5.6 Luna OpenRouter route with the highest intended reasoning profile. Keep model identity and reasoning profile separate in configuration so a route rename does not require an application rewrite.
- Use native image and PDF support by default.
- Temporarily disable the extra visual-image prepass, but preserve it as a dormant fallback strategy for future model changes or modality failures.
- Add Parallel search through OpenRouter server tools behind a provider adapter.
- Request the full included result set for each Parallel search call. Use adaptive search depth and stop early when evidence is sufficient; allow up to five purposeful calls for deep research rather than blindly issuing the maximum.
- Use full-source fetching and evidence extraction for serious research. Search-result snippets alone are not sufficient for Extended Essay, academic or professional research.
- Give every citation a verified source record and, when possible, an exact evidence span.

### 2.4 Live Dock and conversation behaviour

- Sending from Quick Chat does **not** automatically open the right panel.
- Continuing the current conversation remains the default send behaviour.
- The right panel behaves like `/chat` at a narrower width.
- A compact run tab shows the title, status and current semantic step.
- Hover reveals only the most important extra information. It must not become a large secondary interface.
- Clicking a tab opens the full conversation immediately.
- Required user input—choice, confirmation, approval, missing file or similar—may expand the tab automatically and temporarily.
- There is no separate multi-level “shelf” hierarchy for ordinary inspection.
- Multiple threads and runs can continue independently while the user switches between them.

### 2.5 Local compute

- Browser-local compute is not the default for everything.
- Use it only where it is lightweight, private, latency-sensitive and capability-safe: autocomplete, lightweight code execution/building, local PDF inspection and selected parsing/indexing tasks.
- Always account for weak laptops, mobile devices, battery saver, memory pressure and unsupported WebGPU/WASM features.
- Do not generate provisional local AI titles or duplicate server/model work merely to save a small delay.
- Do not silently send partial text-field contents to a cloud model when local autocomplete is unavailable.

### 2.6 Calendar and plans

- Calendar/timetable is one canonical application surface, not a creatable work type.
- Plans remain creatable from Library and Workspace.
- Calendar projects official events, classes, source deadlines, tasks, scheduled work blocks and personal events.
- AI may work directly in Calendar through the same human-like interaction architecture, including dragging and resizing blocks.

### 2.7 Memory

- Remove Memory from normal navigation.
- Do not add an accept/edit/reject workflow for ordinary memory capture.
- Memory should work conservatively behind the scenes through scoped evidence, corrections, retrieval and deletion.
- Keep internal testing and diagnostic tools for development, but do not make them a normal product page.

### 2.8 Verification and polish sequencing

- Do not use Chrome, Playwright, browser screenshots or video as implementation verification.
- Use type checks, linting, builds, unit tests, integration tests, mocked provider transcripts, Miniflare/Durable Object tests, Yjs multi-client simulations, jsdom/component tests, schema fixtures and static contract tests.
- Complete the functional architecture and all work-type capability passes before the dedicated visual-elevation phases.
- Do not spend early phases polishing animation while core flows remain incomplete.

---

## 3. Current repository baseline and principal risks

The supplied repository is substantial and already includes serious foundations. The transformation should reuse them rather than treating the product as a blank slate.

### 3.1 Existing strengths to preserve

- typed work schemas and normalization;
- ten current work-type definitions;
- semantic regions and operation targeting;
- human-like AI cursor/action choreography;
- held-control detection and remote ownership concepts;
- durable AI runs and progress events;
- staged semantic operations and approval policies;
- Yjs/Hocuspocus transport abstractions;
- comments with anchors, replies, mentions and re-anchoring;
- reference/embed persistence and cycle detection;
- agent releases, resources, skills, evaluations and routing metadata;
- memory evidence, scope, correction and retrieval telemetry;
- ManageBac capability manifests, normalization, quarantine and projections;
- Pyodide worker isolation;
- PDF.js, Mammoth and Office export infrastructure;
- strong TypeScript discipline;
- Clerk, Convex and existing route-level product state;
- persisted Quick Chat continuation/context/tile state.

### 3.2 Architectural hotspots

The following large modules must be decomposed gradually, not rewritten blindly:

- `src/features/spectra/components/artifact-studio.tsx`;
- `src/app/api/spectra/run/route.ts`;
- `src/features/spectra/pages/workspace-shell.tsx`;
- `src/features/spectra/components/code-studio.tsx`;
- `src/features/spectra/components/presentation-studio.tsx`;
- `src/features/spectra/components/sheets-studio.tsx`;
- `src/app/globals.css`;
- `convex/administration.ts`;
- `convex/managebac.ts`;
- `convex/spectraArtifacts.ts`;
- `src/features/spectra/pages/artifacts-shell.tsx`;
- administration and analytics pages;
- agent, timetable and school-data studios.

Do not split files merely to reduce line counts. Split around domain ownership, state boundaries, contracts and testability.

### 3.3 Existing collaboration limitations

- semantic region values are encoded as atomic JSON strings inside Yjs maps;
- normal document input is converted through editor JSON, React state, semantic snapshots and transport synchronization;
- acknowledged snapshots can be reapplied to the focused editor;
- autosync and persistence are coupled to user input;
- the transport rejects edits while reconnecting and does not queue offline changes;
- a universal flush timeout exists;
- claims are broader than necessary for mergeable content;
- durable persistence occurs before peer broadcast in the current gateway path;
- native Yjs shared text/XML, relative positions and native undo are underused.

### 3.4 Existing AI/tool limitations

- the central run route contains tool schemas, execution, progress and model orchestration in one large module;
- adding a tool requires edits across several disconnected structures;
- application tools run sequentially even when independent;
- one timeout strategy is applied too broadly;
- output envelopes, retry semantics, cost policy and progressive tool output are not consistently typed;
- current summaries frequently duplicate titles rather than communicating meaningful progress;
- automatic agent routing is largely lexical;
- the agent runtime still reduces expertise to instructions, simple skills, resources and permissions;
- steering and safe-boundary interruption are not first-class runtime concepts.

### 3.5 Existing surface limitations

- expanded and collapsed desktop sidebars are separate implementations;
- Library/Artifacts and Workspace duplicate navigation and work-opening concepts;
- work + thread + route combinations can compress editors below useful widths;
- some editors have duplicate command rails or indistinct controls;
- references use a generic conditional preview adapter rather than work-specific views;
- rich Markdown/math/citation rendering is concentrated in chat;
- Calendar remains a work type;
- settings are a small drawer rather than a complete application;
- Memory remains visible despite being opaque to normal use;
- analytics and administration surfaces frequently show unavailable data without enough truth about why.

---

## 4. Architectural north star

The target architecture has seven coordinated layers. These are internal engineering boundaries, not user-facing product labels.

### 4.1 Work Kernel

The Work Kernel defines every work type through one registry and common contracts while allowing deep type-specific implementation.

```ts
interface WorkDefinition<TModel = unknown> {
  key: WorkType;
  internalName: string;
  userFacingName: string;

  model: WorkModelAdapter<TModel>;
  modes: WorkModeDefinition[];
  surfaces: WorkSurfaceRenderers;
  collaboration: WorkCollaborationDefinition;
  permissions: WorkPermissionAdapter;
  anchors: WorkAnchorAdapter;
  references: WorkReferenceDefinition;
  sources: WorkSourceDefinition;
  actions: WorkActionDefinition[];
  commands: WorkCommandDefinition[];
  responsive: WorkResponsiveContract;
}
```

It must generate or coordinate:

- full editor renderer;
- side-panel renderer;
- tiled renderer;
- read-only renderer;
- collapsed/expanded reference preview;
- public/share renderer;
- print/export renderer where applicable;
- semantic anchors;
- collaboration policies;
- AI actions and postconditions;
- citation/source affordances;
- responsive minimum sizes;
- mode availability;
- internal permissions.

User-facing modes remain intuitive and type-specific. Do not expose vague framework labels such as “experience capability” or “interaction mode”.

### 4.2 Surface and Session Kernel

This owns:

- Library browser;
- Workspace browser;
- shared Library/Workspace workbench session;
- route-specific side-panel sessions;
- tab rail;
- split/tile tree;
- inspector;
- right-panel conversation;
- Quick Chat;
- Live Dock;
- side-panel-to-fullscreen ownership transfer;
- responsive layout contracts;
- one sidebar structure.

### 4.3 Realtime Kernel

This owns:

- browser Y.Doc lifecycle;
- Cloudflare room/provider protocol;
- awareness and rich presence;
- mergeable structures;
- interaction leases;
- structural claims;
- offline/reconnect durability;
- semantic region derivation;
- transaction origins and undo;
- asynchronous Convex projection;
- AI and human actor identity.

### 4.4 AI Action and Tool Kernel

This owns:

- run state machine;
- model adapters;
- structured progress summaries;
- title generation;
- application tools;
- OpenRouter server tools;
- semantic work actions;
- human-like choreography;
- postcondition checks;
- waits, retries and fallbacks;
- user questions and approvals;
- steering;
- checkpoints and resumability;
- background internal-agent jobs;
- telemetry and cost policy.

### 4.5 Context, Evidence and Source Kernel

This owns:

- semantic index entries;
- K-bar retrieval;
- context search and viewport picking;
- references/backlinks;
- source records and evidence spans;
- citations and bibliographies;
- uploaded-file provenance;
- school-source records;
- agent evidence;
- permission-aware retrieval;
- memory retrieval adapters.

### 4.6 Compute and File Kernel

This owns:

- model attachment bundles;
- lightweight client workers;
- PDF inspection/parsing;
- Office conversion orchestration;
- Pyodide execution;
- lightweight JavaScript/TypeScript building;
- autocomplete;
- server/cloud fallbacks;
- device capability detection;
- cancellation and resource limits.

### 4.7 Integration and Capability-Truth Kernel

This owns:

- school-source adapters;
- ManageBac capability status;
- future Teams/other adapters;
- integration freshness;
- normalization and quarantine;
- administration metrics;
- user analytics data availability;
- explicit status states such as available, stale, unsupported, denied or failed.

---

## 5. Cross-cutting design principles

### 5.1 Sophisticated internals, simple surfaces

The internal model may distinguish:

- view, edit, interact, attempt, submit, grade, execute and AI-mutate;
- mergeable, leased and structurally claimed state;
- live, durable and projected synchronization;
- primary, secondary and unverified sources.

The normal interface should still show familiar choices such as:

- Read-only / Edit;
- Build / Study;
- Edit / Present;
- Source / Preview;
- Open / Expand;
- Continue / New thread.

### 5.2 Contextual disclosure

Show a control only when it is relevant to the current selection, mode or permission. Keep advanced sections collapsed. Avoid permanent toolbars that repeat global actions.

### 5.3 Semantic identity before geometry

Everything meaningful should have a semantic anchor. Geometry is resolved at the moment it is needed. This applies to:

- comments;
- AI cursor travel;
- human follow mode;
- presenter mode;
- references;
- context picking;
- history/activity navigation;
- source navigation;
- responsive layouts.

### 5.4 No false emptiness

A surface must distinguish:

- no records exist;
- not yet synchronized;
- refreshing;
- stale;
- permission denied;
- capability unsupported;
- provider unavailable;
- schema incompatible;
- partial result;
- failed.

### 5.5 AI operations are semantic, not animated macros

A human-like action is a rendering of a semantic intent. It must:

1. resolve the current target;
2. verify prerequisites;
3. acquire the correct lease/claim;
4. perform the interaction;
5. verify the postcondition;
6. retry, wait or replan if necessary;
7. release ownership;
8. record meaningful history.

### 5.6 Functionality before visual elevation

Early phases may implement only the minimum motion needed to avoid jarring state changes. Dedicated animation, material, shimmer, transition and landing work comes after functional gates pass.

---

# Phase programme

---

## Phase 0 — Establish the canonical programme and migration safety

### Outcome

The repository has one authoritative transformation programme, explicit compatibility boundaries and a testable migration strategy. No major feature behaviour changes yet.

### Build

#### 0.1 Canonical planning directory

Create the ledgers described in Section 0. Mark older conflicting plans as historical rather than deleting them. Add a short header to superseded plans that points to this canonical plan.

#### 0.2 Requirement identifiers

Assign stable IDs to the requirements in this plan, using categories such as:

- `COLLAB-*`;
- `AI-*`;
- `RUN-*`;
- `WORK-*`;
- `SURFACE-*`;
- `REF-*`;
- `SOURCE-*`;
- `SETTINGS-*`;
- `SCHOOL-*`;
- `AGENT-*`;
- `ADMIN-*`;
- `POLISH-*`;
- `LANDING-*`.

Every implementation pull or commit grouping should reference relevant IDs in the implementation ledger.

#### 0.3 Compatibility strategy

Define compatibility adapters before migrations:

- `LegacyArtifactTransportAdapter` around the current Hocuspocus/Yjs transport;
- `LegacyArtifactModelAdapter` around existing JSON-region snapshots;
- legacy route redirects for `/artifacts`, `/timetable` and `/memory`;
- old/new run-event adapter;
- old/new tool-definition adapter;
- old/new reference-preview adapter;
- old/new preference schema adapter;
- old/new school-source normalization adapter.

Do not make compatibility adapters permanent abstractions. Give each one a planned removal phase in the migration ledger.

#### 0.4 Feature flags and protocol versions

Add typed flags for migrations that require dual paths:

```ts
interface SpectraMigrationFlags {
  cloudflareRealtime: boolean;
  nativeYjsDocument: boolean;
  nativeYjsCode: boolean;
  nativeYjsStructuredWork: boolean;
  actionProtocolV2: boolean;
  toolRegistryV2: boolean;
  workbenchV2: boolean;
  referencesV2: boolean;
  richContentV2: boolean;
  agentFoundryV2: boolean;
  schoolSourceV2: boolean;
}
```

Flags should be environment/account/workspace-scoped only where genuinely useful. Avoid creating dozens of permanent combinations. Add protocol version fields to collaboration tokens, run items and reference nodes.

#### 0.5 Baseline inventories

Generate code-derived inventories, not prose guesses:

- all routes;
- all API actions;
- all Convex tables and indexes;
- all work types;
- all tools and permissions;
- all custom window events;
- all preference sources;
- all user-facing uses of “artifact” and “timetable”;
- all places that render Markdown or rich text;
- all places that call `setContent`, serialize whole work or await collaboration flushes;
- all silent catch/fallback patterns;
- all admin metrics and their actual data sources;
- all ManageBac capabilities and routes.

Store generated inventories in a machine-readable format used by tests or migration scripts. Do not maintain them manually if they can be derived.

### Code-only verification

- Existing lint, type check, build and tests pass before feature changes.
- Inventory scripts run deterministically.
- Feature flags are typed and tested.
- Legacy routes and data still work with all migration flags off.
- No production behaviour changes beyond documentation and compatibility scaffolding.

### Exit criteria

- One canonical plan exists.
- Every major migration has an old/new compatibility strategy and removal target.
- Baseline tests are green or existing failures are explicitly recorded in the defect ledger.

---

## Phase 1 — Create the architectural kernels without changing the product surface

### Outcome

The large existing modules begin delegating to typed domain registries and state machines. New work can be added without editing unrelated monoliths, while the current UI continues to function.

### 1.1 Target module boundaries

Create or evolve domain directories along these lines:

```text
src/features/spectra/
  work/
    registry/
    models/
    permissions/
    modes/
    responsive/
  realtime/
    protocol/
    providers/
    policies/
    awareness/
    persistence/
  actions/
    protocol/
    runtime/
    choreography/
    recovery/
  tools/
    registry/
    execution/
    permissions/
    telemetry/
  runs/
    state/
    streaming/
    steering/
    summaries/
  context/
    index/
    picker/
    retrieval/
  sources/
    records/
    citations/
    evidence/
  references/
    model/
    renderers/
    insertion/
  workbench/
    session/
    layout/
    tabs/
    inspector/
  settings/
    schema/
    scopes/
    ui/
  integrations/
    school/
    status/
  compute/
    broker/
    workers/
    files/
```

The exact paths may be adapted to the repository’s conventions, but domain ownership must be clear.

### 1.2 Work registry V2

Extend the current registry into a typed Work Kernel. Initially register the existing renderers and actions through adapters. Do not immediately rewrite every studio.

The registry must support:

- user-facing terminology;
- supported surfaces;
- supported modes;
- responsive minimums;
- read-only/edit mapping;
- internal capability resolution;
- semantic anchor adapter;
- reference preview adapter;
- collaboration-policy adapter;
- source/citation support;
- AI action definitions;
- command priority.

Add compile-time exhaustiveness so adding a work type fails until required contracts are declared.

### 1.3 Typed internal command/event bus

Replace incremental use of ad hoc `window.dispatchEvent` and string event names with a typed internal command/event system.

It should distinguish:

- commands — a request to do something;
- domain events — something happened;
- query/subscription state — current data.

Examples:

```ts
interface SpectraCommands {
  "work.open": OpenWorkCommand;
  "work.revealAnchor": RevealAnchorCommand;
  "run.openConversation": OpenRunConversationCommand;
  "reference.insert": InsertReferenceCommand;
  "context.beginPicking": BeginContextPickingCommand;
}

interface SpectraEvents {
  "work.updated": WorkUpdatedEvent;
  "run.requiredInput": RunRequiredInputEvent;
  "integration.statusChanged": IntegrationStatusEvent;
}
```

Provide a temporary bridge that emits/listens to existing custom events until callers migrate.

### 1.4 Capability-truth result type

Create a common result/status vocabulary:

```ts
type CapabilityState =
  | { kind: "available"; updatedAt?: number }
  | { kind: "refreshing"; previous?: unknown }
  | { kind: "stale"; updatedAt: number; reason?: string }
  | { kind: "partial"; details: string }
  | { kind: "not_connected" }
  | { kind: "permission_denied" }
  | { kind: "unsupported" }
  | { kind: "schema_incompatible"; issueId?: string }
  | { kind: "unavailable"; retryable: boolean; message: string };
```

Use it first in new integration/tool/admin code. Do not mechanically wrap every local variable.

### 1.5 Decompose the run route by responsibility

Without changing behaviour yet, extract:

- provider/model adapter;
- prompt/context assembly;
- tool schema assembly;
- tool execution dispatcher;
- progress/title logic;
- run persistence;
- artifact/work operation application;
- source/search handling;
- agent package loading;
- attachment preprocessing.

Keep the existing route as an orchestration shell. Preserve current tests and add contract tests around each extracted boundary.

### 1.6 Decompose the central work studio by controllers

Create controllers/hooks/services for:

- work session state;
- collaboration state;
- save/projection state;
- history;
- publishing/sharing;
- inspector state;
- AI activity;
- responsive surface state.

Do not perform the visual redesign yet. The objective is to make later Yjs and workbench migrations possible without another 17,000-line edit surface.

### 1.7 Preference schema foundation

Create a versioned preference schema with explicit scopes:

```ts
type PreferenceScope = "account" | "device" | "workspace" | "work_type";
```

Add migration support and default computation. The full Settings interface comes later.

### Code-only verification

- Registry exhaustiveness tests.
- Event/command schema tests.
- Existing route tests remain green.
- Existing UI behaviour is unchanged under compatibility adapters.
- Static test forbids adding new direct string-based global events outside the compatibility bridge.
- Static test forbids adding new embedded tool definitions directly to the run route.
- Type-level tests verify each work type declares required contracts.

### Exit criteria

- New tools, work actions and work surfaces have one defined registration path.
- Existing monoliths delegate meaningful responsibilities to testable modules.
- No user-facing regression is introduced.

---

## Phase 2 — Build the Cloudflare realtime platform

### Outcome

A production-grade Cloudflare Durable Object realtime provider exists behind the existing collaboration transport interface. It can synchronize Yjs documents, awareness, interaction leases and durable claims without putting Convex in the keystroke path.

### 2.1 Cloudflare project structure

Create a dedicated Worker/Durable Object package within the repository, for example:

```text
workers/collaboration/
  src/
    worker.ts
    room.ts
    auth.ts
    protocol.ts
    ydoc-store.ts
    awareness.ts
    leases.ts
    claims.ts
    compaction.ts
    projection-outbox.ts
  migrations/
  tests/
  wrangler.toml
```

Share protocol types through a package-safe source path, not copy/paste.

### 2.2 Room identity and partitioning

Use one logical room per work item initially:

```text
work:{workId}
```

Allow a future partition suffix for very large sheets/boards without requiring a protocol rewrite:

```text
work:{workId}:{partition}
```

Do not partition prematurely. Add size and update telemetry first.

### 2.3 Authentication and permission epoch

A room connection token should contain:

- user/account identity;
- workspace and work identity;
- actor kind (`human`, `ai`, `system`);
- simple user-facing access (`read_only`, `edit`);
- resolved internal capabilities;
- permission epoch/version;
- protocol version;
- expiry;
- optional run/operation identity.

The Durable Object validates the signature and periodically or eventfully checks permission epoch changes. Revoking access should invalidate future mutations without requiring every awareness frame to query Convex.

### 2.4 Y.Doc lifecycle

On cold start:

1. load the latest compacted snapshot from Durable Object SQLite;
2. replay newer update rows;
3. construct the active Y.Doc;
4. restore room metadata and durable claims;
5. accept and synchronize connections.

On update:

1. validate protocol and size bounds;
2. apply lightweight policy/invariant checks appropriate to the operation;
3. apply/broadcast the Yjs update immediately;
4. append it to SQLite;
5. update compaction counters;
6. enqueue semantic projection work asynchronously.

Do not wait for Convex before broadcasting ordinary accepted edits.

### 2.5 SQLite persistence

Use clear tables such as:

```text
yjs_updates
  sequence
  update_blob
  client_id
  actor_kind
  origin
  created_at

snapshots
  sequence
  state_blob
  state_vector
  schema_version
  created_at

room_metadata
  key
  value

structural_claims
  claim_id
  target
  owner
  operation_id
  expires_at
  state

projection_outbox
  id
  sequence_from
  sequence_to
  projection_kind
  attempts
  next_attempt_at
  status
```

Do not store ephemeral pointer motion as database rows.

### 2.6 Hibernation-safe sockets

Use WebSocket hibernation correctly. Serialize enough connection attachment state to recover:

- actor identity;
- client ID;
- permission epoch;
- protocol version;
- current work ID;
- active ephemeral lease IDs;
- last known awareness sequence.

On wake, reconstruct in-memory state from SQLite and socket attachments. Add explicit tests for eviction/wake behaviour.

### 2.7 Awareness and presence

Implement awareness separately from durable document updates.

Presence payloads may include:

- actor identity;
- active semantic target;
- cursor/selection relative positions;
- active interaction;
- viewport/follow metadata;
- AI run/operation identity;
- presentation state;
- compact preview/progress metadata where appropriate.

Enforce payload size and frequency limits. Presence is ephemeral and should disappear safely on disconnect or expiry.

### 2.8 Interaction leases

Model an interaction lease as:

```ts
interface InteractionLease {
  id: string;
  target: SemanticTarget;
  scope: "control" | "field" | "object" | "gesture";
  owner: ActorIdentity;
  operationId?: string;
  acquiredAt: number;
  expiresAt: number;
  releaseCondition: "blur" | "close" | "pointer_up" | "commit" | "explicit";
  sequence: number;
}
```

Properties:

- acquired before the visible gesture begins;
- renewed while the interaction is legitimately active;
- automatically released on completion, socket loss or expiry;
- restored safely after hibernation from socket attachment state where possible;
- broadcast through presence/room events;
- narrow enough not to block unrelated work;
- declined locally before a conflicting gesture changes UI state.

### 2.9 Structural claims

Structural claims are durable, operation-linked and queueable. Use them for:

- whole-region AI rewrites;
- deleting/moving/reordering structural nodes;
- bulk edits;
- schema changes;
- migrations;
- operations that may survive a transient disconnect.

Keep the existing region-claim concepts where useful, but move the authoritative live coordination to the room and keep Convex mirrored for durable run/history workflows.

### 2.10 Async Convex projection

Define an idempotent projection event:

```ts
interface WorkProjectionEvent {
  workId: string;
  roomSequence: number;
  schemaVersion: number;
  projectionHash: string;
  projection: unknown;
  changeGroups: SemanticChangeGroup[];
  sourceActors: ActorIdentity[];
}
```

The outbox retries with backoff and deduplication. Convex stores:

- canonical searchable projection;
- meaningful change groups;
- named versions/history;
- metadata for Library/Workspace;
- source/citation indexes;
- activity events.

A delayed projection should show a subtle durability state only when it materially matters. It must not stop collaboration.

### 2.11 Provider abstraction

Implement `CloudflareRealtimeProvider` behind the current transport interface. Retain `HocuspocusArtifactTransport` during migration. Add a conformance suite that runs against both.

### Code-only verification

Use Miniflare or the official Cloudflare Workers Vitest integration. Do not use a browser.

Required tests:

- two, five and many in-memory Yjs clients synchronize through the room;
- cold-room load and update replay;
- snapshot compaction and update deletion boundaries;
- hibernation wake with live sockets;
- read-only client cannot mutate;
- permission epoch revocation;
- awareness join/leave/expiry;
- interaction lease acquire/renew/release/expiry;
- conflicting drag/dropdown lease rejection;
- structural claim queue and resume;
- outbox idempotency and retry;
- update size/rate bounds;
- protocol version rejection and compatibility;
- no ordinary update path invokes Convex synchronously before peer broadcast.

### Exit criteria

- Cloudflare provider passes the same core transport conformance suite as the current provider.
- Durable update and projection failure simulations do not block local/peer editing.
- Lease and claim semantics are proven through deterministic tests.
- The provider is not yet the default for all users unless Phase 3 document migration is ready.

---

## Phase 3 — Fine-grained Yjs models and interruption-free editing

### Outcome

Every work type uses appropriate native Yjs shared structures, beginning with documents and code. Semantic regions remain as a derived policy/index layer. Typing and editing no longer wait for snapshot synchronization or trigger whole-editor resets.

### 3.1 Common collaboration model

Every collaborative work type should implement:

```ts
interface WorkYjsAdapter<TModel> {
  createDocument(initial: TModel): Y.Doc;
  bind(doc: Y.Doc, editor: unknown): WorkBinding;
  project(doc: Y.Doc): TModel;
  deriveSemanticRegions(doc: Y.Doc): SemanticRegionIndex;
  validate(doc: Y.Doc): ValidationResult;
  migrateLegacy(snapshot: LegacySnapshot): Y.Doc;
  createUndoManager(doc: Y.Doc, actor: ActorIdentity): Y.UndoManager;
}
```

Use transaction origins for:

- local human typing;
- remote human updates;
- AI semantic edits;
- imports;
- normalization;
- reference insertion;
- source updates;
- migration;
- undo/redo.

Do not let remote or AI transactions pollute the local user’s undo stack unless the work type explicitly needs collaborative group undo.

### 3.2 Document migration

Use Tiptap’s collaboration binding to a native `Y.XmlFragment`.

Requirements:

- character-, mark- and node-level merging;
- stable block identity;
- Yjs-relative cursor and selection positions;
- no complete `setContent` while focused;
- no remote normalization during IME composition;
- semantic regions derived from document structure and stable IDs;
- comments anchored to relative positions or semantic block targets;
- references represented as native Tiptap nodes;
- citations represented as native rich-content nodes;
- imports converted once into the collaborative model;
- normalization performed through explicit transactions, not continuous full replacement.

Migrate existing JSON-region documents through an idempotent conversion. Keep a rollback snapshot until the new projection validates.

### 3.3 Code migration

Represent:

- a Y.Map of files;
- `Y.Text` per editable file;
- file metadata in nested maps;
- file ordering in a shared array;
- runtime/preview state outside durable source content unless it is intentionally saved.

CodeMirror binds to the appropriate `Y.Text`. File rename/delete/reorder uses structural claims; ordinary text editing is mergeable.

### 3.4 Sheets migration

Use a sparse structure rather than one giant serialized workbook:

```text
workbook
  sheets: Y.Map<sheetId, Y.Map>
  sheetOrder: Y.Array<sheetId>
  cells: Y.Map<cellKey, Y.Map>
  charts: Y.Map<chartId, Y.Map>
  namedRanges: Y.Map
```

A cell separates:

- formula;
- computed/display value;
- formatting;
- validation;
- source/provenance;
- comments.

Editing one scalar/formula field uses an interaction lease. Selecting, viewing and editing different cells remain concurrent. Charts are native sheet objects placed in the sheet—not a separate bottom graph section.

### 3.5 Presentation migration

Represent:

- slide order as `Y.Array`;
- slides as maps;
- elements as maps keyed by stable IDs;
- text content as `Y.Text` or XML structures;
- position/size/style as independent fields;
- notes and citations separately.

Text editing is mergeable. Drag/resize/rotate uses object interaction leases. Slide reorder/delete uses structural claims.

### 3.6 Board/whiteboard migration

Represent:

- objects in a map by stable ID;
- z-order in a shared array;
- groups/frames as structured maps;
- text fields as shared text;
- geometry properties independently;
- board camera as personal state except explicit presentation/follow state.

Dragging/resizing/rotating an object holds an object lease for the complete gesture. Other actors can work elsewhere.

### 3.7 Quiz and flashcard migration

Use shared arrays/maps and native shared text for prompts, options, explanations and card content.

Separate authored source content from user experience state:

- quiz attempts are separate records/documents;
- flashcard study progress is personal state;
- read-only viewers may interact/attempt/study without modifying source content;
- result persistence follows the configured experience contract.

### 3.8 Plan migration

Use stable task/milestone IDs, maps for fields and arrays for ordering. Task text may be mergeable; scalar status/date/assignee fields use field leases; reorder and hierarchy changes use structural claims.

Calendar projections reference task IDs rather than duplicating entire Plan snapshots.

### 3.9 Agent work migration

Agent mission sections, dynamic questions, evidence bindings, skills and release drafts should use structured shared collections. Agent Foundry arrives later, but the collaboration model must support it.

### 3.10 Remove the current hot-path synchronization pattern

Refactor `artifact-studio.tsx` and child studios so:

- local editors bind directly to Yjs;
- React state does not continuously mirror and replace the full editor;
- semantic projection runs asynchronously;
- save indicators derive from local/live/durable state;
- serialization is incremental or checkpoint-based;
- focused editor content is not overwritten by acknowledged snapshots;
- `flush()` is used only for explicit boundaries such as export/publish/close where needed—not every normal edit;
- reconnect does not make editors read-only when safe local editing is possible.

### 3.11 Local reconnect durability

Use IndexedDB or equivalent Yjs local persistence with strict bounds:

- enabled by default where supported;
- mobile-safe quotas;
- per-work eviction policy;
- clear cache controls in Settings later;
- encrypted/safe handling as appropriate to existing local data policy;
- no heavy compute requirement;
- clear distinction between local-only pending changes and durable sync.

### 3.12 Concurrency policy registry

Create a central registry mapping semantic actions/fields/controls to policies:

```ts
type CollaborationPolicy =
  | { mode: "mergeable"; sharedType: "text" | "xml" | "array" | "map" }
  | {
      mode: "interaction_lease";
      leaseScope: "control" | "field" | "object" | "gesture";
      release: "blur" | "close" | "pointer_up" | "commit" | "explicit";
    }
  | {
      mode: "structural_claim";
      targetScope: "region" | "collection" | "work";
      queueable: boolean;
    };
```

Every AI action and user control resolves its policy through this registry. Do not scatter hard-coded lock checks through studios.

### 3.13 Wait/resume semantics

When an AI encounters a human-held target:

1. record a `wait` run item with semantic reason;
2. subscribe to lease release rather than poll aggressively;
3. after release and a short idle threshold, re-resolve the target;
4. verify the operation is still relevant;
5. resume or replan;
6. never mark the run failed merely because it waited.

### Code-only verification

Required deterministic Yjs tests for every migrated work type:

- simultaneous edits in same/different text nodes;
- concurrent independent fields;
- scalar lease conflict;
- drag lease conflict;
- structural claim queue;
- offline edit/reconnect merge;
- undo isolation by origin;
- comment anchor survival;
- reference anchor survival;
- migration round trip from legacy snapshots;
- projection equivalence and validation;
- no `setContent` invocation caused by ordinary remote updates while focused;
- IME composition guard tests;
- autosave/persistence delay does not change editability state;
- large-work serialization budget tests.

### Exit criteria

- Documents and code run on native shared structures under the Cloudflare provider.
- Remaining work types either migrate in this phase or have passing adapter/migration tests before their dedicated work-type phase.
- Continuous typing is independent of save/projection latency by construction and tests.
- Legacy JSON-region transport remains only for unmigrated work and is scheduled for removal.

---

## Phase 4 — AI Action Protocol, tool registry and model/search migration

### Outcome

AI runs become typed, resumable workflows that can alternate between summaries, tool calls, visible work actions, waits, questions, steering and final output. Tools become easy to add through one protocol. Luna native multimodality and Parallel research are integrated behind provider adapters.

### 4.1 Structured run item protocol

Define a versioned event model such as:

```ts
type RunItem =
  | { type: "title"; text: string; final: boolean }
  | { type: "progress"; summary: string; detail?: string }
  | { type: "text_delta"; channel: "answer" | "narration"; text: string }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool_progress"; callId: string; progress: ToolProgress }
  | { type: "tool_result"; callId: string; result: ToolResult }
  | { type: "action_start"; action: SemanticAction }
  | { type: "action_progress"; actionId: string; step: ActionStep }
  | { type: "patch"; patch: SemanticPatch }
  | { type: "wait"; reason: WaitReason }
  | { type: "question"; request: UserInputRequest }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "steer_queued"; steer: SteerMessage }
  | { type: "checkpoint"; checkpoint: RunCheckpoint }
  | { type: "final"; result: RunResult }
  | { type: "degraded"; state: RecoverableDegradation }
  | { type: "error"; error: TerminalRunError };
```

Use visible progress summaries, not hidden chain-of-thought. Progress summaries should communicate what is happening and why it matters without exposing private reasoning traces.

### 4.2 Run state machine

Model explicit states:

```text
created
planning
running_model
running_tools
performing_action
waiting_for_resource
waiting_for_actor
waiting_for_user
paused
resuming
completed
completed_partial
cancelled
failed_terminal
```

A recoverable tool error, lease wait or stale target does not enter `failed_terminal`.

### 4.3 Tool registry V2

Create a typed definition:

```ts
interface SpectraToolDefinition<I, O> {
  id: string;
  version: number;
  title: string;
  description: string;

  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;

  capability: AgentCapability;
  category: "read" | "write" | "external" | "server" | "interaction";
  risk: "low" | "medium" | "high";
  approval: "never" | "policy" | "always";

  parallelSafe: boolean;
  idempotent: boolean;
  concurrencyDomain?: string;

  expectedDuration?: DurationClass;
  softStallAfter?: number;
  hardSafetyLimit?: number;
  retryPolicy: ToolRetryPolicy;
  cancellable: boolean;
  resumable: boolean;

  estimateCost?: (input: I) => ToolCostEstimate;
  summarizeProgress?: (event: unknown) => string;
  summarizeOutput: (output: O) => ToolContextSummary;
  redactTelemetry?: (value: unknown) => unknown;

  execute:
    | ((ctx: ToolContext, input: I) => Promise<O>)
    | ((ctx: ToolContext, input: I) => AsyncGenerator<ToolProgress, O>);
}
```

The registry generates:

- model-facing JSON schemas;
- execution dispatch;
- permissions and approval UI;
- agent capability selection;
- progress summaries;
- tool docs;
- telemetry;
- contract tests.

Adding a new tool should normally require one implementation module, registration and tests—not edits across the run route, agent UI and prompt logic.

### 4.4 Standard tool result envelope

```ts
type ToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
      summary: string;
      sources?: SourceHandle[];
      workHandles?: WorkHandle[];
      warnings?: string[];
      partial?: boolean;
      cursor?: string;
      telemetry?: ToolTelemetry;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      degradedAlternative?: ToolAlternative;
      suggestedAction?: string;
    };
```

Do not dump unrestricted raw JSON into model context. Tools may retain full results in durable storage while providing a bounded model summary and handles for selective follow-up.

### 4.5 Parallel-safe batching

When a model requests independent read operations in the same turn, execute them concurrently with bounded concurrency:

- multiple work reads;
- multiple source fetches;
- skills/resources;
- school records;
- memory/context lookups;
- metadata queries.

Mutations serialize according to `concurrencyDomain`. Preserve deterministic ordering of tool results sent back to the model.

### 4.6 No universal timeout

Replace the universal timeout with per-tool/action policy. A timeout is a safety boundary, not a progress indicator.

A long but healthy operation should emit progress. A stalled operation should:

1. surface a recoverable tool result to the AI;
2. retry if safe;
3. use a cached or partial alternative if useful;
4. ask the user only when necessary;
5. report degraded truth if the final answer depends on missing data.

### 4.7 User-input tools

Add protocol-native tools:

- `ask_user_choice`;
- `ask_user_multiple_choice`;
- `request_short_answer`;
- `request_file`;
- `request_context_target`;
- `request_confirmation`;
- `request_permission`;
- `present_comparison`.

Each request supports:

- concise prompt;
- options;
- recommended option where appropriate;
- “Other” plus extra context;
- multi-select when relevant;
- reason for asking;
- safe default/cancellation behaviour.

These requests integrate with the Live Dock’s temporary required-input expansion and the full conversation.

### 4.8 Semantic work actions and choreography

Define each action through intent, policy and postconditions:

```ts
interface RecoverableAction {
  id: string;
  intent: SemanticIntent;
  target: SemanticAnchor;
  preconditions: Condition[];
  collaborationPolicy: CollaborationPolicy;
  choreography: InteractionStep[];
  postconditions: Condition[];
  retryPolicy: ActionRetryPolicy;
  fallbackStrategies: ActionFallback[];
  checkpointPolicy: CheckpointPolicy;
}
```

Examples:

- set dropdown value;
- drag/resize calendar block;
- move board object;
- edit text range;
- insert reference;
- add citation;
- reorder slide;
- create Plan task;
- change sheet formula;
- attach source.

The visible choreography may be human-like, but postcondition verification operates on semantic state.

### 4.9 Steering

Add a queued steering model:

```ts
interface SteerMessage {
  id: string;
  runId: string;
  mode:
    | "refine_current_goal"
    | "redirect_next_step"
    | "replace_goal"
    | "cancel_current_action";
  text: string;
  createdAt: number;
  applyAt: "next_safe_boundary";
}
```

Safe boundaries include:

- after a tool result;
- after a complete dropdown/drag gesture;
- after a semantic patch checkpoint;
- before the next model continuation;
- after a cancellable action has been safely aborted.

Steering should not leave a pointer-down gesture, partial destructive action or unknown transaction state.

### 4.10 Model profile and attachments

Create a capability-based model profile:

```ts
interface ModelProfile {
  route: string;
  reasoningProfile: string;
  input: { text: boolean; image: boolean; pdf: boolean };
  tools: boolean;
  structuredOutput: boolean;
  serverTools: boolean;
}
```

Configure the intended Luna route and maximum reasoning profile separately.

Create a model attachment bundle:

```ts
interface ModelAttachmentBundle {
  originalFile: FileHandle;
  visualRepresentation?: PdfHandle;
  structuredRepresentation?: StructuredFileSnapshot;
  searchableText?: string;
  sourceMap?: SourceLocationMap;
  warnings?: ConversionWarning[];
}
```

Rules:

- images pass natively;
- PDFs pass natively and may also include local text/page maps;
- DOCX converts to PDF and retains headings, paragraphs, tables, comments and structure;
- PPTX converts to slide PDF and retains slides/elements/notes;
- XLSX converts relevant views to PDF and retains sheets, values, formulas and named ranges;
- legacy visual prepass remains behind `native | legacy_visual_prepass | automatic`, with `native` default.

### 4.11 Parallel research policy

Integrate OpenRouter server search behind a provider adapter so beta/API changes remain isolated.

Research modes:

```text
Quick
- one purposeful search request
- full included results
- fetch only the strongest sources when needed

Verified
- up to two purposeful searches
- fetch and read multiple authoritative sources
- contradiction/freshness check

Deep
- up to five purposeful searches
- stop early when coverage is sufficient
- fetch primary sources, papers, official documents and datasets
- track subquestions and evidence gaps
```

Do not issue five paraphrased queries. Every search should have a distinct purpose. The model must be able to conduct simple current lookup and serious sourced research.

### 4.12 Full-source reading and evidence

After search:

1. canonicalize and deduplicate results;
2. classify authority/source type;
3. select primary and high-quality sources;
4. fetch full pages/PDFs where needed;
5. parse and segment content;
6. store source records and exact evidence spans;
7. synthesize with inline citations;
8. verify every citation points to supporting evidence;
9. preserve source records when content is inserted into work.

### 4.13 Background internal jobs

Support internal agent/compiler jobs that do not appear as normal Live Dock tabs, such as future Agent Foundry compilation. They should expose status inside the relevant work surface and use the same durable run infrastructure with a hidden/internal presentation policy.

### Code-only verification

- Registry generates schemas and rejects invalid input/output.
- Mocked model transcripts cover interleaved progress, tools, actions, waits, questions, steering and final output.
- Parallel-safe tools execute concurrently; mutations remain serialized.
- Per-tool timeout/retry/cancel semantics.
- Steering applies at safe boundaries and preserves run continuity.
- Required-input tools persist and resume.
- Semantic action postcondition failure triggers retry/replan rather than false completion.
- Luna native modality request construction tests.
- Legacy visual fallback remains callable under explicit strategy.
- Search depth, early stop and max-call enforcement tests.
- Citation records cannot be created without a verified source handle.
- Existing run history migrates or renders through the compatibility adapter.

### Exit criteria

- All current application tools are registered through Tool Registry V2.
- New protocol items drive the existing UI through an adapter.
- Luna and Parallel adapters are the default configured path.
- The old embedded tool/run implementation is no longer the source of truth.

---

## Phase 5 — Quick Chat, Live Dock, right-panel conversation and multi-run continuity

### Outcome

AI runs remain visible and understandable without forcing the user into a conversation panel. The compact interface stays simple; hover provides only useful extra context; one click opens the complete right-panel conversation; required input expands only when necessary.

### 5.1 Conversation model

Unify `/chat` and the right-panel conversation around the same conversation renderer, composer, streaming, citations, steering and run state. The right panel differs only in available width and responsive layout.

Do not maintain separate behaviour for:

- message rendering;
- attachments;
- citations;
- steering;
- tool/question responses;
- thread continuation;
- retry;
- stop;
- source views.

### 5.2 Send defaults

Settings defaults:

- continue current conversation: on;
- automatically open right panel after send: off;
- show Live Dock progress: on;
- route to a specialist agent automatically when confidence is high: on;
- retain completed run tabs: on for a sensible period or until dismissed.

The existing blue continuation control remains visible and on by default. Offer “New thread” through a clear secondary send action or shortcut.

Remove the current automatic Workspace effect that opens the live thread merely because a durable tab exists.

### 5.3 Live Dock states

Keep exactly three user-understandable states.

#### Compact

Always shows:

- generated title;
- run status;
- current semantic step or final semantic summary;
- minimal actor/continuation state where needed.

The current semantic step must come from structured progress, not repeat the title. Examples:

- “Reading the current rubric”;
- “Comparing three primary sources”;
- “Waiting for Pablo to finish editing”;
- “Updating the selected questions”;
- “Checking the final formula”;
- “Ready for your choice”.

Avoid exposing internal implementation language such as “executing tool 3” or “awaiting mutation”.

#### Hover/focus

Reveal only important extra information, bounded to a small footprint:

- two-to-four-line latest answer or running-summary preview;
- one or two recent meaningful completed steps;
- source count or attachment count when relevant;
- current target/work name;
- degraded/partial state if it materially affects the outcome.

Do not create a large shelf, detailed activity log, source browser or full answer on hover. The full conversation is one click away.

#### Required-input expansion

Automatically and temporarily expand the tab when the run requires:

- accept/reject/confirm;
- single or multiple choice;
- short answer;
- file attachment;
- permission;
- context target.

This expansion contains only the necessary interaction. It can take additional horizontal width and a small vertical extension. It is collapsible, but the tab retains an input-required badge.

### 5.4 Multiple runs

- Tabs remain horizontally scrollable when necessary.
- A required-input or selected run may temporarily take more width; others compress to their minimum.
- Only one run may display expanded required-input content at a time.
- Other runs continue and update compact semantic steps without stealing focus.
- Switching threads or routes does not cancel work.
- Closing a tab does not necessarily cancel a running job; prompt clearly if closure would terminate it.

### 5.5 Titles and summaries

Do not generate a provisional local title.

The first structured model output should establish a concise run title. Reveal it once with the later streaming animation system, but store the full title immediately for accessibility and state.

Improve summaries through structured generation:

- title answers “what is this run?”;
- compact semantic step answers “what is happening now?”;
- expandable summary answers “what has been accomplished, what remains, and what is blocked?”;
- final summary answers “what changed or what was concluded?”.

The expanded summary should no longer be a copy of the title. It should derive from checkpoints and completed actions, not from an arbitrary truncation of internal traces.

### 5.6 Steering controls

Allow steering from Quick Chat, the right-panel composer and the full `/chat` route while a run is active.

When submitted:

- show “Will apply after the current step” or equivalent;
- queue it for the next safe boundary;
- allow changing the mode between refine, redirect, replace goal and cancel current action where appropriate;
- preserve the current thread by default;
- show the steer in the conversation timeline once accepted into the run.

### 5.7 Attachments

Attachments should appear:

- in the conversation composer;
- as compact indicators in the run tab;
- in the required-input expansion only when the run is waiting for a file;
- in the full right-panel conversation when opened.

Do not permanently increase every tab’s height because files exist.

### 5.8 Run completion and recovery states

Use semantic states:

- working;
- waiting;
- needs input;
- completing;
- completed;
- completed with limitations;
- paused;
- reconnecting;
- cancelled;
- failed terminally.

A recoverable tool error stays in working/waiting/degraded state while the AI continues. A terminal error appears only when the requested outcome cannot be completed safely or truthfully.

### 5.9 Live Dock responsiveness

- Desktop: horizontal run tabs near the Quick Chat/workbench context.
- Narrow desktop/tablet: smaller titles and one-line semantic step, horizontally scrollable.
- Mobile: compact stack or bottom run strip with selected run prominence; required input opens a focused compact sheet, not a squeezed horizontal form.
- Hover-only information must also be keyboard- and touch-accessible through focus/long press or a small disclosure action.

### Code-only verification

- State-machine tests for compact, hover, required-input and open-conversation behaviour.
- Test that send does not auto-open the right panel by default.
- Test click opens the corresponding conversation.
- Test required input expands automatically and resumes the run after response.
- Test multiple independent runs and steering queues.
- Test semantic summary fallback does not duplicate title when richer progress exists.
- Test mobile/touch access paths through component logic, not browser screenshots.
- Test right panel and `/chat` share message and citation components.
- Test route changes preserve active run state.

### Exit criteria

- The current DurableRunTabs implementation is replaced or fully delegated to Live Dock V2.
- Compact UI remains simple.
- Full information is one click away.
- Required-input workflows no longer depend on a separately opened panel.

---

## Phase 6 — Shared Workbench, Library, Workspace, routes, sidebar and inspector

### Outcome

Library and Workspace become distinct but connected entry surfaces over one shared workbench session. Open work, tabs, tiles and threads survive transitions. Other application pages can preview work in a side panel and transfer it smoothly into Library fullscreen later.

### 6.1 User-facing information architecture

Target routes:

```text
/workspace/:workspaceId
/library
/library/:workId
/calendar
/agents
/agents/:agentId
/school
/settings
/chat
```

Preserve legacy redirects during migration:

- `/artifacts` → `/library`;
- `/artifacts/:id` → `/library/:id`;
- `/timetable` → `/calendar`;
- `/memory` → the relevant Privacy/Data settings or home, without exposing a replacement Memory page.

Do not perform internal variable/table renames merely for aesthetics if they create risk. User-facing copy, navigation and URLs matter first.

### 6.2 Library purpose

Library is the cross-workspace index of accessible work. Its default organisation should emphasise:

- All work;
- Unplaced;
- Shared with me;
- Recent;
- Favourites;
- Collections;
- ownership/sharing/source filters;
- import and received work.

It must not look like Workspace with a different title. Use an index/search-oriented layout with richer metadata, grouping, receiving and organisation controls.

An item received through sharing can remain unplaced in Library or be added to one or more workspaces.

### 6.3 Workspace purpose

A Workspace shows only work placed in that workspace plus workspace-specific:

- members;
- description/context;
- sources;
- pinned work;
- activity;
- arrangements/layouts;
- workspace-level AI context;
- workspace settings.

Do not display unrelated Library content merely because the user can access it.

Plan creation must remain available from both Library and Workspace.

### 6.4 Shared Workbench session

Library and Workspace share one persisted workbench session:

```ts
interface SharedWorkbenchSession {
  openPanes: WorkbenchNode;
  activePaneId: string;
  tabRail: WorkTab[];
  auxiliaryThread?: ThreadTab;
  inspector: InspectorState;
  selectedBrowserSurface: "library" | { workspaceId: string };
}
```

Switching Library ↔ Workspace changes the browser/index surface while preserving:

- open work;
- selected tab;
- tiled layout;
- active thread;
- inspector width/tab;
- Live Dock;
- unsaved local state.

Other major routes maintain their own local side-panel work/thread session. Returning restores it. Fullscreening work from those routes transfers/open it in the shared Library/Workspace workbench, usually through Library.

### 6.5 Workbench split tree

Use a split tree, not a generic card grid, for multi-select/open work:

```ts
type WorkbenchNode =
  | { type: "pane"; paneId: string; tabs: WorkTab[]; activeTabId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      first: WorkbenchNode;
      second: WorkbenchNode;
    };
```

Requirements:

- useful automatic layouts for two, three and four selected items;
- drag-resizable boundaries;
- each renderer declares minimum and preferred dimensions;
- if a renderer cannot fit, stack it as a tab rather than crushing it;
- adding/removing rebalances without losing user-resized ratios unnecessarily;
- expand/focus a pane without destroying the underlying layout;
- one optional auxiliary thread may coexist with work;
- no text or card border overflow caused by invalid dimensions;
- layout persists locally per shared workbench session;
- keyboard operations for split, move, focus and close.

### 6.6 Responsive renderer contract

Every work type declares:

```ts
interface WorkResponsiveContract {
  minInlineSize: number;
  preferredInlineSize: number;
  supportsPanel: boolean;
  supportsTile: boolean;
  supportsCompact: boolean;
  toolbarPriorities: WorkCommandPriority[];
}
```

Use container queries and structural adaptation. Do not reduce body text to unreadable sizes to fit a layout.

### 6.7 Side-panel session on other routes

Calendar, Agents, School, analytics and other relevant pages may open:

- one work item in a side panel;
- optionally one thread/conversation;
- responsive read/edit renderer based on access and width.

Fullscreen moves the work into the shared Library workbench. Preserve the same underlying editor/session when feasible so the later visual morph does not require a reload.

### 6.8 One sidebar implementation

Replace the two desktop `<aside>` trees with one stable DOM structure:

```tsx
<Sidebar data-collapsed={collapsed}>
  <Brand />
  <GlobalCommand />
  <PrimaryNavigation />
  <WorkspaceNavigation />
  <RecentThreads />
  <AccountActions />
</Sidebar>
```

Collapsed behaviour:

- same icons;
- same order;
- same active marker;
- same workspace hierarchy;
- same account/notifications/settings position;
- labels and secondary metadata collapse;
- tooltips appear;
- keyboard focus is preserved.

Remove the duplicate Search/Search chats surfaces. Use one global command/search action.

### 6.9 Shared selection and organisation patterns

Library and Workspace should share consistent:

- multi-select affordance;
- selection toolbar styling;
- move/add-to-workspace actions;
- share actions;
- bulk delete confirmation;
- view controls;
- sort/filter component grammar;
- card/list selection state.

They should not share identical page layouts merely to reuse components.

### 6.10 Inspector V2

Use three primary tabs:

```text
Overview | Comments | History
```

#### Overview

Make it genuinely useful:

- description;
- type/status;
- owner and collaborators;
- simple access state;
- workspace placement;
- sharing/public state;
- references and backlinks;
- embedded/embedding relationships;
- sources and provenance;
- source freshness;
- recent meaningful activity;
- relevant work settings;
- natural hints such as adding unplaced work to a likely workspace.

Do not turn Overview into an unfiltered metadata dump.

#### Comments

- general work comments;
- anchored comments;
- replies and mentions;
- open/resolved filter;
- orphaned anchor state;
- selection-based composer;
- click navigates to the exact semantic target.

No floating comment balloons are required.

#### History

Combine meaningful history categories:

- content changes;
- AI actions/runs;
- imports;
- sharing/access changes;
- source updates;
- restore/version events.

Allow filters such as Changes, AI and Access without adding permanent top-level tabs.

### 6.11 User-facing terminology migration

Create a copy dictionary and lint/static checks for user-facing strings. Replace:

- Artifacts → Library/Work/items depending on context;
- Artifact details → Overview;
- Timetable → Calendar;
- linked artifact → reference/linked work;
- artifact type → work type only in advanced/admin contexts.

Do not rename every internal file/table in the same phase.

### Code-only verification

- Split-tree invariant tests: no orphan tabs, valid ratios, min-size fallback, add/remove/rebalance.
- Persist/restore shared Library/Workspace session tests.
- Route redirect tests.
- Test other routes preserve their own side-panel session.
- Test fullscreen transfer to Library keeps work identity and thread state.
- Sidebar single-DOM structural test.
- Inspector tab/state/navigation tests.
- Static test forbids new user-facing “artifact” copy outside approved internal/admin contexts.
- Responsive contract tests through layout calculations and component props.

### Exit criteria

- `/library` and `/workspace/:id` have distinct purposes and one shared workbench.
- `/artifacts` and `/timetable` are compatibility redirects.
- Collapsed sidebar is no longer a separate interface.
- Work is never rendered below declared functional minimums.

---

## Phase 7 — References, semantic anchors, context selection, rich content, sources and comments

### Outcome

Every meaningful piece of work can be referenced, embedded, cited, searched, selected as context and navigated through a shared semantic identity system. The user-facing reference concept remains simple: one collapsed line that expands into a preview.

### 7.1 Semantic anchor protocol

Define a versioned anchor:

```ts
interface SemanticAnchor {
  workId: string;
  workType: WorkType;
  kind: string;
  path: string[];
  stableIds?: Record<string, string>;
  relativePosition?: Uint8Array;
  fallbackExcerpt?: string;
  schemaVersion: number;
}
```

Every work type provides:

```ts
interface WorkAnchorAdapter {
  exists(anchor: SemanticAnchor): boolean;
  describe(anchor: SemanticAnchor): string;
  reveal(anchor: SemanticAnchor, options?: RevealOptions): Promise<void>;
  resolveGeometry(anchor: SemanticAnchor): Geometry | null;
  createFromSelection(selection: unknown): SemanticAnchor | null;
  migrate(anchor: SemanticAnchor): SemanticAnchor;
}
```

Use this protocol for:

- comments;
- references;
- AI targets;
- follow/presentation;
- history;
- activity;
- source evidence;
- context selection;
- K-bar/search results.

### 7.2 One user-facing Reference model

A reference has the same identity in both visual states:

```ts
interface ReferenceNode {
  id: string;
  target: {
    workId: string;
    anchor?: SemanticAnchor;
    view?: string;
  };
  state: "collapsed" | "expanded";
  versionPolicy: "live" | { pinnedVersionId: string };
  width?: number;
  height?: number;
  displayPreferences?: Record<string, unknown>;
}
```

#### Collapsed

- single-line bordered element;
- icon, title and optional target label;
- status for unavailable/update/pinned where needed;
- click expands;
- keyboard accessible.

#### Expanded

- the same node reveals a work-specific preview;
- resizable within host constraints;
- optional view selector for work types with multiple representations;
- click/open action reveals the source work;
- permissions respected;
- live/pinned status visible only when relevant.

Do not expose separate “link” and “embed” product systems.

### 7.3 Work-specific reference views

Each work type declares useful target/view options.

#### Document

- whole document;
- heading/section;
- block;
- text selection;
- read-only excerpt or richer section preview.

#### Sheets

- workbook/sheet;
- range;
- chart;
- metric;
- table view.

#### Presentation

- whole deck;
- slide;
- selected element;
- slide strip where appropriate.

#### Board

- frame;
- selected object set;
- captured viewport with semantic object IDs and camera bounds.

#### Code

- project;
- file;
- line/range;
- preview/output.

#### Quiz

- whole quiz;
- question;
- preview/attempt-compatible view;
- results summary where permission allows.

#### Flashcards

- deck;
- section;
- card;
- browse/study-safe preview.

#### Plan

- whole plan;
- task;
- milestone;
- filtered task set.

#### Agent

- agent release;
- skill;
- evidence/capability summary;
- safe invocation/use card.

### 7.4 Host-native insertion

References must be native to the host work:

- Tiptap node in documents;
- slide element in presentations;
- board object/frame;
- floating/native object in sheets;
- structured detail block in Plans;
- source/reference element in quizzes/cards/agents.

Provide insertion via:

- slash/command menu;
- paste of Spectra URL;
- drag from Library/Workspace;
- context picker;
- AI semantic action;
- Overview/backlink suggestion.

### 7.5 Board capture flow

For board references:

1. open a focused capture mode;
2. allow frame selection, object selection or viewport positioning;
3. show exact target bounds;
4. confirm;
5. store semantic object IDs plus camera bounds;
6. update live preview if objects move;
7. report missing objects honestly if deleted.

### 7.6 Reference suggestions

Provide restrained suggestions where confidence is high:

- add unplaced referenced work to the current workspace;
- replace pasted raw URL with a reference;
- reference the source work used in a generated section;
- attach a relevant source or work from context;
- show a backlink in Overview.

Suggestions must be dismissible and not appear constantly.

### 7.7 Context picker from viewport

Add `Context → Pick from page` to Quick Chat and relevant composers.

When active:

- registered semantic components become eligible;
- hover outlines the complete valid target;
- a concise label identifies it;
- click adds it to context;
- selected targets remain marked;
- nested targets resolve predictably;
- Escape cancels;
- touch receives an equivalent selection mode;
- permission filtering occurs before selection;
- do not scrape arbitrary DOM text.

Components register through:

```ts
interface ContextSourceRegistration {
  anchor: SemanticAnchor;
  label: string;
  type: string;
  contextSummary: () => Promise<ContextSummary>;
  permissions: ContextPermission;
}
```

### 7.8 Semantic index

Create permission-aware entries for:

- work metadata;
- document blocks;
- slide elements;
- sheet ranges/charts;
- board frames/objects;
- code files/symbols;
- quiz questions;
- cards;
- agent skills/evidence;
- Plan tasks;
- school records;
- threads/messages;
- sources/references.

```ts
interface SemanticIndexEntry {
  semanticId: string;
  workId?: string;
  anchor?: SemanticAnchor;
  workspaceIds: string[];
  permissionScope: PermissionScope;
  text: string;
  embeddingRef?: string;
  updatedAt: number;
  provenance: ProvenanceHandle;
}
```

Use it for K-bar, Library search, context search, agent retrieval/routing, reference suggestions, memory retrieval and school data. Permission filtering occurs before model exposure.

### 7.9 Source records and evidence spans

```ts
interface SourceRecord {
  id: string;
  canonicalUrl?: string;
  title: string;
  authors?: string[];
  publishedAt?: string;
  accessedAt: string;
  sourceType:
    | "paper"
    | "book"
    | "web"
    | "dataset"
    | "school"
    | "uploaded_file"
    | "linked_work";
  authority: "primary" | "secondary" | "unknown";
  contentHash?: string;
  snapshotRef?: string;
  provenance: ProvenanceHandle;
}

interface EvidenceSpan {
  id: string;
  sourceId: string;
  page?: number;
  startOffset?: number;
  endOffset?: number;
  excerptHash: string;
  excerpt: string;
}
```

Citations refer to these records, never unverified model-generated URLs.

### 7.10 Unified rich content

Create `SpectraRichContent` with a canonical AST supporting:

- paragraphs/headings/lists;
- tables;
- code blocks and inline code;
- inline/display math;
- citations;
- references;
- footnotes;
- callouts;
- media;
- source notes.

Adapters/renderers for:

- chat and right panel;
- streamed content;
- Tiptap documents;
- comments;
- run summaries;
- quiz explanations;
- flashcards;
- presentation text;
- board/source cards;
- agent skills/evidence;
- public sharing and export.

Handle incomplete streaming syntax without flicker. Do not rebuild an entire document/table for each token.

### 7.11 Citation experience by work type

#### Chat/right panel

- inline citations;
- hover/focus source cards;
- sources list;
- exact source open;
- preserve citations when converting response to work.

#### Documents

- citation nodes;
- footnotes/endnotes;
- bibliography block;
- configurable citation styles;
- source insertion from command menu;
- page-aware PDF citations.

#### Presentations

- source on slide or element;
- compact footer citation;
- speaker/source notes;
- bibliography slide generation.

#### Sheets

- source metadata on cells/ranges;
- chart provenance;
- imported-data lineage;
- visible source labels in presentation/dashboard view.

#### Boards

- source attached to object/frame/reference;
- compact source card;
- source panel for selection.

#### Quizzes/cards

- source per question/card/explanation;
- optional learner reveal;
- author source-coverage view.

#### Code

- documentation/data/source references attached to file/range/output;
- no fabricated citations in code comments.

#### Plans/Calendar

- provider/source and timestamp;
- official deadline source link;
- clear distinction from user-created work blocks.

#### Agents

- evidence pack;
- skill-to-source mapping;
- evidence version;
- separation of evidence from untrusted content being evaluated.

### 7.12 Comments V2

Migrate existing comments to the shared anchor protocol.

Requirements:

- general root comment via `work:root`;
- anchored comment per work adapter;
- click reveals target and applies one restrained focus state;
- comments remain selected in inspector after navigation;
- deleted targets become orphaned with re-anchor action;
- relative positions for rich text;
- source/citation links render properly inside comments;
- permission-aware mention and resolve behaviour;
- no floating comment bubbles.

### Code-only verification

- Anchor creation/reveal/geometry contracts for every work type.
- Anchor migration and orphan behaviour.
- Reference collapsed/expanded state round trip.
- Host-native reference insertion tests.
- Board capture model tests.
- Context picker registration, nesting and permission tests.
- Semantic index permission-filter tests.
- Citation-source integrity tests.
- Rich-content parser/renderer snapshot tests, including incomplete Markdown/math streams.
- Export/import citation preservation tests.
- Comment target navigation tests through adapters.

### Exit criteria

- Generic reference preview conditional logic is replaced by work-specific contracts.
- All work types support semantic anchors and at least one useful reference view.
- Chat and work surfaces share one source/citation model.
- Comments navigate through the same anchor system used by AI and follow mode.

---

## Phase 8 — Settings, lightweight browser compute, files and autocomplete

### Outcome

Spectra has a complete Settings application with sensible defaults and progressive disclosure. Browser-local compute is used selectively and safely, especially for autocomplete and lightweight execution/parsing, without making weak devices carry the product’s main intelligence.

### 8.1 Settings application

Create `/settings` with a stable section navigation and responsive layout. Retain a small quick-settings drawer for common changes and a link to full settings.

Preference resolution order should be explicit and tested:

```text
system/product default
→ account preference
→ workspace override
→ work-type override
→ device override where appropriate
```

Do not expose every internal setting. Organize normal settings around outcomes.

### 8.2 Settings sections

#### General

- language/locale;
- date/time formats;
- default start page;
- spellcheck;
- keyboard shortcuts;
- global command behaviour;
- account controls.

#### AI and runs

Defaults:

- continue current conversation: on;
- open side conversation after send: off;
- show Live Dock summaries: on;
- auto-route specialist agents when confident: on;
- parallel safe reads: on;
- research depth: automatic;
- reasoning profile: configured maximum;
- reversible low-risk action autonomy: on;
- notify on required input/completion: on.

Advanced collapsed options may include:

- completed-run retention;
- automatic required-input expansion;
- new-thread shortcut behaviour;
- research-depth default;
- explicit provider/model diagnostics for advanced/development use.

Do not expose raw temperatures, retry counts or infrastructure timeouts as ordinary settings.

#### Writing and autocomplete

- smart completion: on by default where supported;
- Quick Chat suggestions;
- long-form writing suggestions;
- comments/descriptions;
- acceptance keys;
- delay/sensitivity;
- local-only explanation;
- local model/download/cache status where relevant;
- separate links to code/formula completion settings.

#### Collaboration

- collaborator cursors;
- remote selections;
- compact labels;
- follow/presenter behaviour;
- AI activity visibility;
- optional collaboration sounds/haptics;
- reduced clutter with many collaborators;
- reconnect/offline indicators.

Most should be enabled with sensible automatic clutter reduction.

#### Appearance

- theme;
- interface density;
- editor text scale;
- interface text scale;
- contrast;
- reduced motion/motion level;
- streaming reveal;
- active-tail shimmer;
- sidebar default/collapse behaviour.

#### Local compute and files

- local compute: Auto / Prefer local / Never;
- battery/data saver respect;
- local cache size/clear;
- local PDF inspection;
- local code execution/build;
- automatic file conversion;
- preserve originals;
- upload behaviour;
- capability status for the current device.

Default should be **Auto**, not “always local”.

#### Notifications

- mentions/comments;
- sharing;
- run completion;
- required input;
- school-source changes;
- deadlines;
- browser/device permission status.

#### Privacy and data

- use personal context;
- use workspace context;
- clear personal context;
- export/delete data;
- local processing preference;
- diagnostics preference.

Do not link to a normal Memory page.

#### Integrations

- school data connection/status;
- future providers;
- permissions;
- disconnect;
- link to the full School/ManageBac user page.

#### Accessibility

- reduced motion;
- high contrast;
- always-visible focus;
- keyboard-only preferences;
- collaboration announcements;
- autocomplete announcements;
- screen-reader run-status behaviour.

### 8.3 Lightweight Compute Broker

Create a broker that chooses among:

- local worker;
- server/Cloudflare function;
- model/provider;
- unsupported/degraded path.

Decision inputs:

- task kind;
- device capability;
- memory pressure;
- browser support;
- mobile/desktop;
- battery/data saver;
- privacy requirement;
- expected input size;
- user setting;
- cancellation requirements.

Local tasks must never run on the main thread.

### 8.4 Firecrawl PDF Inspector adapter

Evaluate and integrate the open-source PDF Inspector only if its browser/WASM path is stable and lightweight enough under the engine adoption scorecard.

Target behaviour:

1. inspect/classify PDF locally in a worker;
2. extract positioned text/Markdown for text pages;
3. identify scanned/image pages;
4. retain original PDF;
5. pass original natively to Luna where visual understanding is needed;
6. do not imply that the inspector performs OCR;
7. fall back to current PDF.js or server path if unsupported.

The adapter must be replaceable and must not make PDF opening depend on a large local model.

### 8.5 File attachment bundle pipeline

Centralize conversion/extraction:

- original retained;
- visual PDF where useful;
- structured snapshot;
- searchable text;
- page/slide/cell source map;
- warnings;
- provenance.

Use it consistently for chat, agent evidence, references, imports and research.

### 8.6 Autocomplete

Autocomplete should be enabled by default where supported and remain lightweight.

Appropriate surfaces:

- Quick Chat;
- document text;
- comments;
- descriptions;
- Plan notes;
- quiz/card text;
- slide text;
- Agent Foundry text fields;
- ordinary prose fields.

Not handled by this system:

- code completion;
- sheet formulas;
- constrained dropdowns;
- dates/numbers/URLs/identifiers where deterministic controls are better.

Interaction:

```text
brief adaptive idle
→ local suggestion request
→ ghost text only
→ Tab accepts all
→ Right Arrow accepts next word
→ Escape dismisses
→ accepted text becomes one normal local Yjs edit
```

Rules:

- no Yjs update before acceptance;
- no region claim for ghost text;
- no completion during IME composition;
- no completion while remote/AI text is being applied;
- short context window;
- suppress after repeated dismissal;
- mobile may disable or use deterministic completion;
- never silently use cloud completion as fallback.

Use a tiered strategy:

```text
Tier 1: deterministic recent phrases, workspace terms and field patterns
Tier 2: compact local model on capable devices
Tier 3: disabled/degraded on constrained devices
```

### 8.7 Lightweight code execution/building

#### Python

Keep Pyodide’s network-disabled worker model. Improve:

- worker reuse when safe;
- cancellation through termination;
- task-specific limits;
- approved package loading;
- structured stdout/stderr/result/chart protocol;
- local project files;
- resource telemetry;
- graceful fallback when device constraints are insufficient.

#### JavaScript/TypeScript/React

Evaluate `esbuild-wasm` in a worker for lightweight builds:

- dependency-free JS/TS;
- React with an approved cached dependency set;
- immutable package versions;
- source maps;
- structured diagnostics;
- build cancellation;
- output size and iframe policy.

Retain a cloud/server fallback for unsupported or large builds. Do not force mobile devices to build heavy projects locally.

### 8.8 Optional local data analysis

Assess lightweight local analytical engines only where they materially improve Sheets/import workflows. Do not add DuckDB-WASM or similar merely because it is available. It must pass the engine scorecard, bundle/capability checks and have a clear UI use case.

### 8.9 Open-source engine adoption scorecard

For each candidate engine, score:

- license and production terms;
- bundle/runtime cost;
- mobile viability;
- transparent data model;
- semantic action support;
- Yjs compatibility or adaptability;
- stable anchor/selection APIs;
- ability to suppress conflicting UI/navigation;
- import/export quality;
- testability without Chrome;
- long-term maintenance;
- migration cost;
- benefit over current/native implementation.

Adopt headless engines, parsers, geometry/calculation libraries and runtimes where useful. Do not transplant whole foreign applications that would replace Spectra’s collaboration, AI action, permission and surface systems.

### Code-only verification

- Preference schema migrations and scope resolution.
- Defaults tests for all sections.
- Settings accessibility/component tests.
- Compute broker capability/fallback matrices, including mobile/constrained profiles.
- Worker cancellation and main-thread isolation tests.
- PDF inspection adapter fixtures for text/mixed/scanned PDFs.
- Attachment bundle fixtures for PDF/DOCX/PPTX/XLSX.
- Autocomplete ghost/accept/dismiss/composition tests.
- Pyodide task-specific limit tests.
- Local build adapter tests and cloud fallback tests.
- Static check that local compute additions register through the broker.

### Exit criteria

- A real Settings page replaces the theme-only settings experience.
- Helpful defaults are active without overwhelming the user.
- Memory is removed from normal navigation.
- Autocomplete works locally on capable devices and degrades cleanly.
- No major product intelligence has been shifted indiscriminately to the browser.

---

## Phase 9 — Calendar, Plans, school-source platform, ManageBac, administration and analytics

### Outcome

Calendar becomes one canonical application surface; Plans integrate naturally with it; ManageBac becomes a demonstrably useful living school-data source; future school systems can plug into a provider-neutral contract; administration and analytics stop presenting widespread unavailable data without explanation.

### 9.1 Remove Calendar/timetable from Work Registry

Migration steps:

1. prevent creation of new timetable work items;
2. migrate existing timetable items into account/workspace Calendar data where possible;
3. preserve legacy links through redirects or import notices;
4. remove timetable from creation menus, references as a normal work type and user-facing type lists;
5. retain Calendar semantic anchors and AI actions even though it is an application surface;
6. update routes and navigation to `/calendar`.

### 9.2 Temporal domain model

Distinguish internally:

```text
Official event/class
Official deadline
Task
Scheduled work block
Personal event
Milestone
Reminder
```

A source assignment can produce:

- one immutable/source-locked official deadline;
- one task record;
- zero or more user-controlled work blocks;
- references to relevant work;
- source/provenance metadata.

Changing a work block must not change the official deadline.

### 9.3 Plan model

A Plan remains a work item and may contain:

- tasks;
- milestones;
- sections;
- dependencies;
- estimates;
- study/work blocks;
- statuses;
- assignees;
- references;
- multiple views such as list, board and timeline.

Do not hard-code education-only concepts into the Plan. School workflows are projections/configurations over the flexible model.

### 9.4 Calendar experience

Calendar layers:

- classes;
- official deadlines;
- tasks;
- scheduled work;
- personal events;
- workspace/shared events.

Add an unscheduled task lane. Dragging a task into Calendar creates a work block. Resizing changes duration. Moving changes scheduled time. AI uses the same semantic drag/resize action adapters and interaction leases as a human.

Calendar can:

- open linked work in a side panel;
- open one auxiliary thread;
- fullscreen work into Library;
- show source/provenance;
- create/edit Plan tasks;
- reveal official deadline versus scheduled work clearly;
- display availability without duplicating Plan content.

### 9.5 School Source Adapter

Define a provider-neutral contract:

```ts
interface SchoolSourceAdapter {
  provider: string;

  discoverCapabilities(
    identity: ConnectedIdentity,
  ): Promise<CapabilityManifest>;

  sync(
    capability: SchoolCapability,
    cursor?: SyncCursor,
  ): AsyncGenerator<SyncBatch>;

  normalize(record: ProviderRecord): NormalizedSchoolRecord;
  resolveSourceLink(record: ProviderRecord): string | null;
  getFreshnessPolicy(capability: SchoolCapability): FreshnessPolicy;
}
```

Normalized entities should be able to represent:

- course;
- membership;
- assignment;
- assessment;
- grade;
- feedback;
- discussion;
- announcement;
- resource;
- timetable event;
- CAS experience;
- attendance;
- message.

ManageBac becomes the first adapter. Future Teams/other systems map into the same domain without changing Calendar, Plans, context retrieval or workspaces.

### 9.6 ManageBac capability audit and expansion

Audit every currently available route/capability and prove its normalization path. Existing likely capabilities include memberships, class detail, tasks, timetable, resources and CAS; extend to discussions, announcements, feedback, assessment results and other permitted data only through authorised contracts.

Do not blindly crawl unknown endpoints. Use capability discovery, read-only contracts, pagination, rate controls and quarantine.

### 9.7 Accurate timetable mapping

Remove inferred/default school period timing unless the school explicitly configures it. Require:

- real start/end timestamps from source; or
- a verified school period map;
- location/teacher/class identity where available;
- source freshness and timezone.

If exact timing is unavailable, show an honest partial state rather than inventing one.

### 9.8 User School/ManageBac page

Build a useful school-data application with sections such as:

- Overview/upcoming;
- Classes;
- Tasks/deadlines;
- Calendar;
- Resources;
- Discussions/announcements;
- Feedback/results;
- CAS;
- Sync status.

Show real data and capability truth. Provide manual refresh. Each section distinguishes no records from sync failure/unsupported/permission denial.

Per-capability status includes:

- last attempt;
- last success;
- freshness;
- records received/normalized/projected;
- quarantined count;
- partial class coverage;
- latest error;
- retry action;
- source link where available.

### 9.9 Administrator integration page

Keep separate from the user school page.

Provide:

- credentials/API key;
- identity mapping;
- enabled capabilities;
- school-wide sync policy;
- access rules;
- schema health;
- quarantine diagnostics;
- provider status;
- audit history.

Remove a user-editable base URL when the provider has one canonical endpoint. Advanced tenant/provider route manifests remain administrative and read-only where appropriate.

### 9.10 Workspace materialization

Class workspace creation/detection should:

- map source course IDs stably;
- avoid duplicate workspaces;
- attach live source context;
- project current tasks/deadlines/resources/discussions;
- retain user-created work independently;
- survive course renames;
- expose source freshness;
- not claim completeness if some capabilities fail.

### 9.11 Administration and analytics truth

Audit user analytics, school admin and superadmin metrics. For every displayed metric:

- identify the exact data source/query;
- remove placeholders that masquerade as unavailable data;
- use capability truth states;
- aggregate safely and efficiently;
- define privacy scope;
- add date filters and empty-state meaning;
- avoid N+1 queries and broad full-table scans;
- show last computed/update time;
- distinguish disabled collection from zero values.

Examples of expected domains:

- active users/workspaces;
- work creation/use;
- collaboration activity;
- AI run health and cost;
- tool/search usage;
- integration sync health;
- agent adoption/evaluation;
- storage/retention;
- school-specific engagement where authorised.

Do not invent metrics that the product does not currently collect. Add instrumentation first where necessary.

### 9.12 Capability truth UI system

Use the shared capability states throughout Calendar, School, admin and analytics. No section should catch an error and render “nothing available” without reason.

### Code-only verification

- Timetable-work migration fixtures.
- Temporal-domain invariants: deadline vs task vs block.
- Drag/resize semantic action and lease tests.
- Calendar/Plan projection tests.
- School adapter contract tests with provider fixtures.
- Pagination, cursor, retry, quarantine and schema-drift tests.
- Accurate period-map/timezone tests.
- No-false-empty component tests.
- Workspace materialization idempotency.
- Admin metric query fixtures and permission tests.
- Static inventory verifies every displayed metric has a data source and capability state.

### Exit criteria

- Calendar is no longer a creatable work type.
- Plan and Calendar integrate without duplicating data.
- ManageBac provides visibly current useful data where the provider supports it.
- User and admin ManageBac interfaces are clearly separate.
- Future school-source adapters can be added without redesigning Calendar or Workspace.
- Administration/analytics no longer rely on unexplained unavailable placeholders.

---

## Phase 10 — Agent Foundry, first-class skills, routing and safe improvement

### Outcome

Agents become compiled specialist packages rather than decorated system prompts. Creation starts simply inside the Agent work view, adapts dynamically to the mission, collects evidence only when useful and improves safely through versioned skills and evaluations.

### 10.1 Agent work surface

The Agent remains a work type with its own page and Library/Workspace presence. Replace the fixed six-step form with Agent Foundry inside the Agent view.

Persistent elements:

- agent identity/status;
- creator search/composer;
- generated foundation sections;
- optional evidence;
- skills;
- evaluations;
- releases/history;
- sharing/publication;
- background compilation status.

### 10.2 Initial creation

The first two questions should be approximately:

1. **What should this agent do?** — encourage a detailed real outcome.
2. **How should it feel to talk to or work with?** — capture interaction expectations without reducing the agent to tone.

After these, Spectra creates an initial foundation and dynamically chooses what else is needed.

Do not hard-code a universal sequence such as rubric → examples → calibration. Different missions require different sections.

### 10.3 Dynamic Foundry sections

Spectra may create sections containing:

- text input;
- long-form input;
- dropdown/single choice;
- multi-choice;
- file attachment;
- work/reference attachment;
- example input/output pair;
- permission/tool selection;
- evidence confirmation;
- evaluation response;
- generated skill review.

Each question/response is its own removable section. The user may dismiss irrelevant sections. History records section creation, removal and edits so earlier versions can be restored.

The AI writes context-specific prompts and transitions. Do not hard-code conversational filler such as “Great, now let’s configure…”.

### 10.4 Continue/improve interaction

A persistent Agent Creator composer allows requests such as:

- “Ask me anything else you need”;
- “Learn how I mark this rubric”;
- “Make it better at using these files”;
- “It is too verbose”;
- “Add a skill for analysing datasets”.

A **Continue building** action asks the creator system to add the next highest-value section. It stops automatically when the current competence/evidence/evaluation state is sufficiently complete; the user may still request more.

### 10.5 Mission foundation

Compile a structured mission:

```ts
interface AgentMission {
  objective: string;
  domains: string[];
  intendedUsers: string[];
  expectedInputs: InputContract[];
  expectedOutputs: OutputContract[];
  decisionsAllowed: DecisionPolicy[];
  approvalBoundaries: ApprovalBoundary[];
  evidenceRequirements: EvidenceRequirement[];
  exclusions: string[];
  interactionStyle: InteractionStyle;
}
```

Mission is mandatory. Calibration and extensive evidence are optional.

### 10.6 Evidence analysis

When evidence would materially improve competence, prompt for:

- rubrics;
- policies;
- examples;
- annotated work;
- manuals;
- source documents;
- datasets;
- previous outputs;
- accepted/rejected examples.

Analyse each source into inspectable extracted structures:

- criteria/rules;
- vocabulary;
- procedures;
- examples;
- edge cases;
- contradictions;
- unresolved questions;
- security/injection concerns.

Untrusted content being assessed must never become agent policy merely because it contains instructions.

### 10.7 First-class Skill model

```ts
interface SpectraSkill {
  id: string;
  version: number;
  name: string;
  purpose: string;
  triggers: SkillTrigger[];
  inputContract: SkillInputContract;
  outputContract: SkillOutputContract;
  procedure: SkillStep[];
  evidenceBindings: EvidenceReference[];
  examples: SkillExample[];
  failureModes: SkillFailureMode[];
  evaluationCases: SkillEvaluationCase[];
  status: "draft" | "verified" | "deprecated";
}
```

Skills are retrieved/activated based on mission and context. They are not concatenated blindly into every system prompt.

### 10.8 Background compiler agents

Use internal durable jobs to:

- interpret mission;
- extract evidence;
- propose skills;
- create evaluation cases;
- produce routing signature;
- identify failure modes;
- detect overlap/contradiction;
- compile a candidate release.

These jobs do not appear as ordinary Live Dock tabs. Show status inside Agent Foundry:

- “Analysing 3 sources”;
- “Compiling 6 skills”;
- “Running 12 checks”;
- “Ready to publish”.

### 10.9 Adaptive creation paths

The creator should recognize broad mission needs without hard-coding one product category:

- marker/tutor: evidence, criteria and calibration;
- research specialist: source quality and retrieval;
- company process agent: procedures, permissions and tools;
- personal assistant: preferences, routines and boundaries;
- creative agent: examples, constraints and output style;
- technical agent: tools, environments, verification and failure recovery.

Only relevant sections appear.

### 10.10 Evaluation

Use layered evaluation:

1. deterministic contract tests;
2. held-out examples;
3. mission-specific truth/expected outcomes;
4. tool/resource sandbox tests;
5. adversarial and prompt-injection tests;
6. regression suite across skills;
7. independent judge or explicit human truth where appropriate.

Do not rely solely on the same model generating and judging its own answer. When no external truth exists, report uncertainty and evaluation limitations.

### 10.11 Routing

Create a structured competence signature:

```ts
interface AgentRoutingSignature {
  domains: string[];
  contexts: string[];
  inputTypes: string[];
  outputTypes: string[];
  workTypes: WorkType[];
  requiredEvidence: string[];
  requiredTools: string[];
  exclusions: string[];
  semanticProfileRef: string;
}
```

Routing combines:

- structured compatibility;
- semantic similarity;
- current workspace/class/company context;
- focused work and selected context;
- available evidence/resources;
- required tools;
- routing history and feedback.

Behaviour:

- high confidence: route automatically and show concise reason;
- medium confidence: offer two candidates;
- low confidence: use ordinary Spectra;
- never silently route to an agent missing required evidence/tools.

### 10.12 Safe self-improvement

Eligible learning signals:

- explicit feedback;
- accepted revisions;
- comparison with known outcomes;
- teacher/manager-confirmed decisions;
- repeated corrected mistakes;
- evaluation failures;
- successful/failed tool traces;
- accepted Foundry edits.

Process:

```text
collect verified events
→ wait for meaningful evidence/token threshold
→ propose skill/routing/evidence change
→ run regression and held-out tests
→ shadow candidate release
→ compare
→ publish new immutable release only if safe
```

Rules:

- no direct self-modification of the active release;
- no untrusted content becoming policy;
- no per-message expensive retraining pass;
- every change has provenance and rollback;
- injection and misuse resistance are evaluation requirements;
- optional user/owner notification for meaningful release changes.

### 10.13 Agents page and sharing

Create:

```text
Discover | Installed | Yours | Shared
```

- public agents expose immutable published releases;
- adding an agent installs/references that release in Library;
- private sharing uses simple Read-only/Edit;
- avoid an additional complex agent-specific role system;
- agent releases and skills remain visible in Agent Foundry, not in generic Library cards.

### 10.14 Runtime package

A compiled agent release should contain references to:

- mission;
- activated skill index;
- evidence policy;
- tools/capabilities;
- output contracts;
- verification steps;
- routing signature;
- safety/approval boundaries;
- model policy;
- evaluation status.

The runtime loads only relevant skills/evidence per request.

### Code-only verification

- Dynamic section generation and schema tests.
- Remove/restore/history tests per section.
- Mission compilation fixtures across different agent categories.
- Evidence extraction fixtures and injection resistance.
- Skill versioning and retrieval tests.
- Background compiler run tests without Live Dock presentation.
- Evaluation layering and regression tests.
- Structured routing tests with high/medium/low confidence.
- Safe self-improvement candidate/shadow/release tests.
- Immutable release and rollback tests.
- Sharing/install/public release tests.

### Exit criteria

- New agent creation no longer depends on the fixed form wizard.
- Agents contain first-class structured skills and evidence.
- Routing is competence-aware rather than mostly lexical.
- Improvement creates evaluated releases rather than silently editing prompts.

---

## Phase 11 — Dedicated functional pass for every work type

### Outcome

Every work type reaches a professional functional baseline comparable in seriousness to leading dedicated products, while sharing the Work, Realtime, Action, Source, Reference and Surface kernels. No work type remains a generic schema editor with superficial type-specific controls.

This phase is functional first. Implement only the motion required for clarity. Dedicated visual elevation comes later.

### 11.0 Common requirements for every work type

Before type-specific work, verify each definition supports:

- full editor surface;
- side-panel renderer;
- tiled renderer;
- read-only renderer;
- simple user-facing modes;
- Read-only/Edit sharing mapping;
- internal capabilities for interact/attempt/run/present where needed;
- native Yjs model and transaction origins;
- semantic anchors and reveal;
- collapsed/expanded references;
- citations/sources where text/data can be sourced;
- comments and history;
- responsive minimums and toolbar priorities;
- AI semantic actions, leases/claims and postconditions;
- import/export;
- error/capability truth;
- keyboard and accessibility contracts;
- user-facing terminology and empty states.

Add one conformance suite that every work type runs through. It should not force identical UI; it verifies shared product obligations.

---

### Phase 11A — Documents

#### Product outcome

A document is a top-tier collaborative writing, research and review environment rather than a generic Tiptap canvas.

#### Modes

User-facing modes may include:

- Write;
- Read;
- Review;
- Focus.

Show only useful modes for the current access and width. Read-only viewers get Read and source/comment capabilities permitted by sharing.

#### Functional requirements

- native Tiptap/Y.XmlFragment collaboration;
- headings, lists, tables, callouts, code, equations, media, citations and references;
- robust copy/paste and Office import;
- selection-aware formatting toolbar that does not duplicate global command bars;
- sticky contextual formatting only when relevant;
- outline/navigation by heading;
- find/replace;
- review comments and suggestion semantics where already feasible through history/comments, without adding a separate floating-comment UI;
- source navigator and bibliography;
- stable block IDs and semantic sections;
- references as native nodes with collapsed/expanded state;
- AI actions for selection/block/section/document with claims only where structural or whole-region replacement is required;
- human and AI typing merge naturally;
- no full-content reset during remote updates;
- side panel uses a compact reading/editing layout rather than shrinking the full desktop editor.

#### AI behaviour

- edits targeted at selections/blocks/sections;
- preserve styles/citations/references unless explicitly changing them;
- whole-section rewrite uses a structural claim or staged replacement;
- ordinary inline writing may merge;
- postcondition validates content and structure;
- AI cursor/focus follows semantic positions.

#### Verification

- complex rich-content round trips;
- collaborative same-paragraph edits;
- citations/references preserved under edits;
- outline and anchor navigation;
- import/export fixtures;
- side-panel command-priority tests;
- undo isolation.

---

### Phase 11B — Flashcards

#### Product outcome

A deck separates authoring from studying and personal progress while remaining collaborative for creators.

#### Modes

- Build;
- Browse;
- Study;
- Progress.

Read-only users can Browse/Study. They cannot modify source cards unless granted Edit.

#### Data separation

```text
Deck source content
Personal study state
Optional shared assignment/session metadata
```

Personal study state includes:

- card history;
- confidence/difficulty;
- spaced-repetition scheduling where implemented;
- personal notes;
- temporary session state.

#### Functional requirements

- fast bulk card editing;
- card ordering/sections/tags;
- front/back rich content, equations, media and citations;
- keyboard-first study mode;
- configurable reveal and grading controls;
- browse/search/filter;
- source per card/explanation;
- reference to card/deck/section;
- import/export common formats where practical;
- AI generation from selected sources with source coverage;
- side panel shows useful browse/study preview, not a compressed builder;
- personal progress not overwritten when source deck changes;
- clear update handling when edited cards have existing study history.

#### AI behaviour

- add/edit/reorder cards through semantic actions;
- claim a card during structural replacement, not entire deck;
- preserve source links;
- generate cards in meaningful batches;
- verify duplicates and answer completeness;
- do not edit personal study state as if it were source content.

#### Verification

- source/progress separation;
- read-only study capability;
- card collaboration/claims;
- deck updates with existing progress;
- reference and source preservation;
- study session state tests.

---

### Phase 11C — Quizzes

#### Product outcome

A quiz supports authoring, previewing, personal practice, assigned attempts, timing and results without confusing source content with learner responses.

#### Modes

- Build;
- Preview;
- Attempt/Practice;
- Responses;
- Results.

Expose only modes permitted by role/access and quiz configuration.

#### Experience contract

```ts
interface QuizExperience {
  persistence: "ephemeral" | "personal" | "submitted";
  identity: "anonymous" | "signed_in" | "assigned";
  timing: "untimed" | "countdown" | "deadline";
  attempts: number | "unlimited";
  revealAnswers: "immediate" | "after_submit" | "after_deadline" | "never";
  resultsVisibility: "learner" | "teacher" | "both";
}
```

Keep this advanced configuration collapsed. Provide sensible presets such as Practice, Assigned quiz and Timed assessment.

#### Functional requirements

- multiple question types with accessible controls;
- rich prompts/explanations/equations/sources;
- question sections and randomization where configured;
- author preview;
- timer resilience across refresh;
- separate attempt records;
- draft answers and submission;
- results and response review;
- teacher/owner response aggregation where authorised;
- source coverage per question;
- references to quiz/question/results summary;
- read-only source can still be attempted under experience policy;
- AI explanation may be allowed while source mutation remains blocked;
- side panel uses Preview/Attempt appropriately, not the full builder.

#### AI behaviour

- create/edit questions, options, scoring and explanations;
- field leases for scalar type/score/dropdowns;
- structural claims for question reorder/delete;
- generate answer keys with verification;
- inspect attempt data only when permission permits;
- never leak hidden answers before configured reveal.

#### Verification

- source/attempt separation;
- timing and refresh;
- read-only attempt;
- submission idempotency;
- answer reveal policies;
- teacher results permissions;
- AI hidden-answer boundaries;
- question-source integrity.

---

### Phase 11D — Code

#### Product outcome

Code becomes a polished source + execution + preview environment with responsive mode switching and safe browser-first lightweight execution.

#### Modes

- Source;
- Preview;
- Split;
- Run;
- Settings.

Preview/Split appear only when relevant. Read-only viewers may Run if the work’s runtime policy allows it.

#### Functional requirements

- CodeMirror/Y.Text collaboration per file;
- project/file tree;
- rename/move/delete claims;
- syntax/language support;
- diagnostics;
- find/replace;
- terminal/output panel appropriate to runtime;
- preview for HTML/JS/React where supported;
- Split mode with resizable panes;
- local Pyodide and lightweight JS/TS build adapters;
- server/cloud fallback for unsupported builds;
- runtime permissions separated from source editing;
- safe secrets/environment handling;
- output/source citations and data provenance;
- references to project/file/range/preview/output;
- side panel chooses Source or Preview based on context and width;
- no duplicate global/editor/runtime command rails.

#### AI behaviour

- edit files through semantic patches and native text transactions;
- batch reads across files;
- verify build/diagnostics/tests;
- use structural claims for file operations;
- use field/interaction leases for environment controls;
- recover from tool/build errors and continue where possible;
- do not claim success without postcondition/build result when requested.

#### Verification

- concurrent file edits;
- project operations;
- local build/execution fixtures;
- cloud fallback;
- runtime permission tests;
- diagnostics/postcondition recovery;
- read-only run policy;
- preview CSP/sandbox tests.

---

### Phase 11E — Presentations

#### Product outcome

Presentations become a serious collaborative slide editor and presentation surface with source-aware content, spatial AI actions and clean command hierarchy.

#### Modes

- Edit;
- Present;
- Notes;
- Audience/follow where appropriate.

Do not show every mode as a permanent wide row on narrow surfaces.

#### Functional requirements

- native Yjs slide/element model;
- slide navigator;
- selection, multi-select and alignment;
- text/media/shape/chart/reference elements;
- responsive layout and snapping;
- speaker notes;
- citations attached to elements/slides;
- bibliography slide support;
- slide/object comments;
- references to deck/slide/element;
- presenter/follow integration;
- late-join presentation state;
- accessible keyboard operations;
- import/export fidelity where feasible;
- side panel shows selected slide/presentation preview rather than squeezing all edit chrome;
- eliminate duplicate menu/tool rows by command priority and contextual controls.

#### AI behaviour

- leases for drag/resize/rotate/text-control interactions;
- structural claims for slide reorder/delete;
- human-like object movement with semantic geometry re-resolution;
- source/citation preservation;
- verify final element properties/position;
- wait if a human holds the object;
- adapt if responsive layout changes control positions.

#### Verification

- object gesture lease conflicts;
- slide collaboration;
- presentation/follow state;
- source/citation export;
- reference previews;
- responsive command-priority tests;
- import/export fixtures.

---

### Phase 11F — Sheets

#### Product outcome

Sheets become a professional collaborative spreadsheet and analysis surface with native charts placed in the sheet, clear formula/value semantics and strong source provenance.

#### Modes

Keep user-facing mode choices minimal. Depending on implementation:

- Edit;
- Analyse;
- Read/Dashboard.

Avoid a proliferation of vague modes.

#### Functional requirements

- native sparse Yjs cell model;
- efficient range selection, copy/paste and fill;
- formulas, values, formatting and validation as distinct fields;
- field lease while editing one cell/formula;
- independent collaboration across cells;
- frozen rows/columns;
- sorting/filtering;
- charts/graphs embedded directly in the sheet as objects;
- remove the separate bottom graph section;
- range/chart source provenance;
- comments on cells/ranges/charts;
- references to sheet/range/chart/metric;
- local data profiling/analysis only where lightweight and useful;
- import/export XLSX/CSV fidelity;
- side panel uses selected range/chart/dashboard view rather than the full workbook chrome;
- command hierarchy without duplicate rails.

#### AI behaviour

- targeted range/formula/chart actions;
- interaction leases for active scalar edit and chart gestures;
- structural claims for row/column/sheet moves/deletes;
- verify formulas and resulting values;
- operate through visible actions where meaningful;
- preserve source lineage;
- batch large edits into bounded semantic transactions with progress.

#### Verification

- concurrent cells/same-cell lease;
- formula/value separation;
- chart placement and references;
- source lineage;
- large-range performance budgets;
- import/export fixtures;
- read-only and run/analysis permissions.

---

### Phase 11G — Boards/whiteboards

#### Product outcome

Boards become a polished spatial thinking/collaboration surface with reliable object manipulation, frames, references, comments, following and AI interaction ownership.

#### Modes

- Edit;
- Follow/Present as contextual actions or modes;
- Read.

#### Functional requirements

- native object Yjs model;
- shapes, text, connectors, frames, groups, media and references;
- pan/zoom and selection;
- multi-select, alignment, grouping and z-order;
- object/frame comments;
- captured-reference flow;
- presenter/follow integration;
- viewport state personal by default;
- side-panel preview focused on a frame/viewport/selection;
- accessible keyboard alternatives for core operations;
- import/export where supported;
- one contextual toolbar, not duplicate rails.

#### AI behaviour

- object lease across complete drag/resize/rotate gesture;
- re-resolve geometry after layout/zoom changes;
- verify final geometry;
- wait/retry when human owns object;
- structural claims for delete/group/reorder where necessary;
- move cursor/objects with human-like visible choreography;
- do not block unrelated board areas.

#### Verification

- opposing drag conflict;
- object deletion during wait;
- frame/reference stability;
- follow/present state;
- zoom/geometry re-resolution;
- multi-object operations;
- responsive preview contracts.

---

### Phase 11H — Plans

#### Product outcome

Plans become flexible collaborative planning work suitable for education, companies and personal use, while integrating directly with Calendar.

#### Modes/views

- List;
- Board;
- Timeline;
- Review where useful.

Keep advanced configuration collapsed.

#### Functional requirements

- tasks, milestones, sections, dependencies, estimates, status and assignees;
- subtasks/checklists;
- references and sources;
- task comments/history;
- Calendar work-block scheduling;
- official source deadline links;
- filtered references/embeds;
- bulk selection and safe destructive confirmation;
- personal and shared task visibility;
- import/export;
- side-panel task/Plan view;
- AI creation from Workspace, Library and Calendar.

#### AI behaviour

- create/update tasks;
- schedule/resize work blocks through Calendar semantic actions;
- field leases for scalar edits;
- structural claims for hierarchy/reorder/delete;
- ask confirmation for destructive bulk edits;
- retry after human editing lease releases;
- keep source deadlines distinct from planned work.

#### Verification

- List/Board/Timeline projection equivalence;
- Calendar linkage;
- deadline/work-block distinction;
- task collaboration;
- destructive confirmation;
- reference/source preservation;
- non-education plan fixtures.

---

### Phase 11I — Agent work integration

Agent Foundry was built in Phase 10; this pass ensures it meets every common Work Kernel obligation:

- read-only/edit collaboration;
- side-panel useful view;
- references to agent/release/skill;
- comments/history;
- sources/evidence;
- Library/Workspace placement;
- public/shared state;
- semantic anchors;
- responsive minimums;
- AI creator actions and postconditions;
- background compiler status;
- no fixed form remnants.

### 11.10 Cross-work-type consistency review

After dedicated passes:

- compare terminology;
- remove duplicate control patterns;
- standardize selection, mode switching, contextual toolbars and empty states;
- verify each side-panel renderer is intentionally designed;
- verify each read-only experience remains useful;
- verify citations/references/comments in every type;
- verify AI can target and navigate through semantic anchors;
- ensure advanced options are collapsed.

### Code-only verification

- Work Kernel conformance suite passes for every type.
- Type-specific test suites pass.
- Static inventory verifies every type has renderers, anchors, references, sources, actions and responsive contracts.
- Permission fixtures cover Read-only/Edit plus internal interact/attempt/run/present semantics.
- Import/export and migration fixtures.
- No Calendar/timetable work type remains creatable.

### Exit criteria

- Every work type has received a dedicated functional implementation pass.
- No work type relies on the generic preview/editor as its primary serious interface.
- Shared protocols are reused without erasing type-specific capability.

---

## Phase 12 — Functional hardening and code-only acceptance

### Outcome

All functional architecture is complete and proven through deterministic code-level verification before visual elevation begins.

### 12.1 Test layers

#### Static and type contracts

- TypeScript strict checks;
- lint;
- Next build;
- Convex code generation/schema validation;
- Cloudflare Worker build;
- generated registry exhaustiveness;
- forbidden legacy API/event/user-facing terminology checks;
- dependency-cycle checks where appropriate.

#### Unit tests

- models, reducers and state machines;
- policies/permissions;
- semantic anchors;
- references;
- citations;
- tool/action runtime;
- preferences;
- migration utilities;
- source normalization.

#### Integration tests without a browser

- Miniflare Durable Objects;
- Yjs multi-client simulations;
- jsdom/component tests;
- mocked OpenRouter server/application tool transcripts;
- mocked ManageBac/provider fixtures;
- Convex function tests;
- file parser/converter fixtures;
- workbench split-tree behaviour;
- run persistence/resume/steering;
- agent compiler/evaluation/routing.

#### Performance budgets

Measure through code benchmarks where stable:

- Yjs update sizes;
- projection cost;
- large document/range/board operations;
- semantic index update cost;
- rich-content incremental parsing;
- worker startup and memory bounds;
- route bundle sizes;
- large module imports;
- tool context payload sizes;
- admin query count/shape.

Do not claim browser frame-rate or visual quality from these benchmarks.

### 12.2 Collaboration acceptance matrix

Required scenarios:

- two humans type in same paragraph;
- humans edit different sections/cells/objects;
- human and AI edit mergeable text;
- AI dropdown lease blocks conflicting click without closing dropdown;
- AI drag lease blocks counter-drag;
- unrelated work remains interactive;
- AI waits for human and resumes after idle release;
- target changes while waiting and AI replans;
- offline edit/reconnect merge;
- permission revoked during session;
- hibernation wake;
- local undo excludes remote/AI edits;
- comment/reference anchors survive edits;
- projection outage does not block live editing;
- compaction does not lose updates.

### 12.3 AI/run acceptance matrix

- Quick Chat send without panel opening;
- Continue default and New thread alternative;
- compact semantic progress;
- useful hover preview;
- required-input expansion;
- click opens full right panel;
- multiple simultaneous runs;
- safe-boundary steering;
- tool batching;
- long tool progress;
- recoverable tool failure;
- terminal limitation truth;
- postcondition retry;
- native PDF/image path;
- legacy visual fallback explicitly activated;
- research with verified citations;
- content inserted into work retains sources.

### 12.4 Workbench acceptance matrix

- Library ↔ Workspace preserves open work;
- workspace filters only workspace work;
- Library handles unplaced/shared/received/global content;
- multi-select creates valid layouts;
- resizing/rebalancing;
- thread plus work at valid minimum sizes;
- side panel to Library transfer preserves session identity;
- sidebar collapse preserves structure/focus;
- route-specific sessions restore.

### 12.5 Work-type acceptance matrix

Use the type-specific requirements from Phase 11 and common conformance suite. Record every omission explicitly rather than marking a type complete because it opens.

### 12.6 Integration/admin acceptance matrix

- no false empty state;
- manual sync;
- partial capability coverage;
- quarantine visibility;
- accurate Calendar projection;
- user/admin separation;
- metrics with real data sources;
- privacy/permission constraints;
- future adapter fixture.

### 12.7 Legacy removal gate

After all new paths pass:

- remove unused Hocuspocus production gateway code if no fallback is intended;
- remove JSON-region collaboration source of truth;
- remove old tool-definition arrays;
- remove old run-event path;
- remove duplicate sidebar;
- remove timetable creation/work type;
- remove normal Memory route/navigation;
- remove generic reference adapter where replaced;
- remove old Agent Studio wizard;
- remove compatibility redirects only if product policy allows; otherwise keep lightweight redirects;
- remove obsolete feature flags and migrations.

### Exit criteria

- All functional phase requirements have code-level evidence.
- No critical functionality depends on old compatibility paths.
- The defect ledger contains no unresolved blocker for core use.
- Visual polish phases may begin.

---

## Phase 13 — Visual system, typography, information hierarchy and responsive refinement

### Outcome

The now-functional application receives a coherent visual system. Interfaces become calmer, clearer and more premium without introducing decorative complexity or changing architecture.

### 13.1 Design-token consolidation

Create or rationalize tokens for:

- typography scale;
- line height;
- spacing;
- radii;
- borders;
- surfaces/materials;
- shadows;
- focus rings;
- collaborator identity;
- status colors;
- selection/ownership states;
- motion durations/easings later.

Reduce arbitrary one-off values in `globals.css` and studios. Do not rewrite all CSS at once without component ownership.

### 13.2 Typography

Target comfortable defaults:

- editor/body: approximately 15–17 px depending on context;
- general interface: approximately 14–15 px;
- secondary metadata: approximately 12–13 px;
- micro labels: 11–12 px only where truly necessary.

Review every work type, panel, card, toolbar, menu, run tab and administration surface. Fix text overflow through layout, not pervasive tiny fonts.

### 13.3 Control hierarchy

For each surface:

- identify primary action;
- separate navigation from editing actions;
- move secondary actions into contextual/overflow menus;
- remove duplicate rails;
- distinguish text inputs, selects, toggles and buttons clearly;
- standardize destructive actions;
- keep advanced settings collapsed;
- ensure mode switches are recognizably modes, not another toolbar.

### 13.4 Workbench and panel refinement

Fix:

- borders visible because cards are squeezed;
- unnatural narrow columns;
- overlapping toolbars;
- work + thread layouts;
- side-panel padding and reading width;
- inspector density;
- Library vs Workspace visual distinction;
- responsive compact renderers;
- empty/loading/degraded states;
- mobile navigation.

### 13.5 Work-type visual passes

Each Phase 11 work type receives a dedicated UI/UX review. Do not assume shared tokens alone make the editor exceptional.

For each type, refine:

- command hierarchy;
- mode switch;
- canvas/content spacing;
- selection states;
- creation flow;
- empty states;
- read-only/use experience;
- side-panel renderer;
- reference preview;
- comments/inspector;
- source/citation affordances;
- responsive breakpoints;
- accessibility.

### 13.6 Settings, School, Agents and administration

Give non-editor surfaces the same care:

- Settings progressive disclosure;
- Agent Foundry section hierarchy;
- School capability status without enterprise clutter;
- admin data tables/charts that remain readable;
- clear unavailable/stale states;
- consistent search/filter/selection patterns.

### Code-only verification

Since browser inspection is excluded:

- component structure tests;
- design-token linting/static checks;
- visual-state story data fixtures without opening a browser;
- class-name/variant snapshot tests where stable;
- accessibility tree/component tests;
- responsive contract/property tests;
- no text-size below approved token outside allowlist;
- no duplicate command row registrations per surface;
- no overflow-prone fixed dimensions without responsive contract.

Do not claim final visual quality from these tests. Record user visual review as a later external review, not an agent-run browser step.

### Exit criteria

- All surfaces use the shared token/hierarchy system.
- Tiny text, duplicate rails and confusing control equivalence are substantially removed by code structure.
- Every work type has an intentional side-panel and compact layout.

---

## Phase 14 — Premium motion, streaming effects and collaboration micro-interactions

### Outcome

Spectra’s functional state changes become fluid, legible and distinctive. Motion explains state, ownership, continuity and completion rather than decorating everything.

### 14.1 Motion grammar

Define shared primitives:

- **Reveal** — content/title/summary enters;
- **Morph** — side panel to fullscreen, reference collapsed to expanded, run input expansion;
- **Focus** — comment target, source, selection, AI target;
- **Ownership** — held control, active object, remote edit;
- **Completion** — save, sync, run completion, submit;
- **Recovery** — reconnect, wait, retry, resume;
- **Presence** — cursor arrival, selection, label collapse, follow.

Each primitive has consistent duration/easing and reduced-motion behaviour.

### 14.2 Streaming reveal system

Separate canonical content from visual reveal:

```text
provider/update stream
→ canonical parsed state
→ surface-specific reveal scheduler
→ rendered animation
```

Profiles:

- chat/right panel: near-provider speed;
- Live Dock title/summary: controlled left-to-right reveal;
- document/slide/card AI content: slower visible reveal with adaptive catch-up;
- tables/ranges: meaningful batch reveal;
- large generated content: accelerate when the queue grows;
- imported content: no artificial token streaming unless it communicates processing.

Apply shimmer only to the unresolved active tail. Do not shimmer complete paragraphs or all text. Reduced motion disables or simplifies reveal.

### 14.3 Live Dock motion

- compact geometry remains stable;
- hover adds only a small, smooth information reveal;
- required-input state expands geometry first, then reveals controls;
- title streams once;
- semantic step transitions through crossfade/controlled reveal, not sudden replacement;
- blue working state resolves gradually into restrained green completion;
- waiting/recovery states transition without flashing red;
- multiple tabs resize/scroll smoothly without chaotic movement.

### 14.4 Collaboration presence

- network updates are lower frequency than visual interpolation;
- remote cursor motion interpolates locally;
- labels appear briefly on arrival/activity then collapse;
- identity colors remain consistent across cursor, selection, comments and history;
- stale presence fades;
- reconnect does not duplicate/flash actors;
- remote selections settle smoothly;
- cross-surface travel fades/reappears rather than flying through impossible geometry.

### 14.5 Interaction ownership

When AI/human holds a control/object:

- subtle owner outline/material;
- cursor remains visually attached;
- concise action state such as Selecting, Dragging or Resizing;
- conflicting input is declined without closing/moving the control;
- unrelated surface remains active;
- stale ownership decays gracefully.

When AI waits:

- cursor stops near the target where appropriate;
- Live Dock says “Waiting for …”;
- resume has a subtle continuation transition;
- no failure flash.

### 14.6 Human-like AI choreography

Improve:

- path planning;
- cursor velocity/easing;
- same-surface vs cross-surface travel;
- menu/dropdown open/selection timing;
- drag/resize affordance;
- focus transitions;
- responsive target re-resolution;
- postcondition completion signal;
- cancellation/steering at safe boundaries.

The action must remain efficient. Do not add theatrical delays that slow routine work excessively.

### 14.7 Reference and panel morphs

- collapsed reference expands from its own geometry;
- source preview content appears after container settles;
- resize remains direct and responsive;
- side-panel fullscreen transfer preserves shared identity;
- inspector comment navigation uses one restrained target pulse;
- Library/Workspace browser transition preserves workbench continuity.

### 14.8 Follow and presentation

Enhance:

- follow collaborator/AI/presenter;
- follow focus vs follow view;
- peek once without following;
- immediate disengage on local interaction;
- return-to-presenter control;
- late-join catch-up;
- smooth cross-work transitions;
- no forced focus stealing.

### 14.9 Reduced motion and performance

- all motion respects user/system reduced-motion settings;
- no layout thrashing from token-by-token full rerender;
- animations use transform/opacity where appropriate;
- cancellation/reversal is safe;
- large rooms reduce labels/effects automatically;
- mobile uses simpler effects;
- animation does not delay canonical state or accessibility updates.

### Code-only verification

- motion state-machine tests;
- reduced-motion variants;
- animation scheduling/cancellation tests;
- streaming reveal queue/catch-up tests;
- cursor interpolation math tests;
- ownership state transition tests;
- morph identity/state preservation tests;
- no animation dependency in semantic completion tests;
- static performance guards where possible.

### Exit criteria

- Sudden color/shape/state changes have deliberate transitions.
- Motion communicates the product’s live state without obscuring or slowing it.
- Every work type and core surface uses the same motion grammar with type-specific application.

---

## Phase 15 — Landing page transformation around the WebGL prism

### Outcome

The landing page becomes a premium product narrative built around the liked WebGL prism asset and real Spectra capabilities, without relying on generic feature cards, fake model claims or constant rainbow/light effects.

This phase occurs after the product surfaces exist so demonstrations use real components and behaviour.

### 15.1 Narrative concept

The prism represents fragmented context becoming connected, editable work.

A recurring composition:

```text
Left: pain / fragmented surfaces / lost context
→ components are attracted into the prism
→ transformed through a physical, coherent transition
Right: connected Spectra outcome
```

The prism may remain central/sticky through several scenes, then move smoothly to create space. Not every section must use a strict before/after comparison.

### 15.2 Hero

- prism is the dominant high-quality WebGL asset;
- one concise request enters;
- surrounding fragments imply work, sources, people, deadlines and context;
- headline communicates connected work, not model routing;
- restrained typography and minimal chrome;
- no fake provider carousel or “hundreds of models” emphasis.

### 15.3 Scene system

Potential real scenes:

1. **Fragmentation** — disconnected assignment, source, conversation and deadline on the left.
2. **Transformation** — components curve/are attracted into the prism with physically coherent motion.
3. **Live work** — output forms a real document/slide/sheet/board state on the right.
4. **AI in the work** — AI opens a dropdown or drags an object while a collaborator remains present.
5. **Evidence** — sourced research appears with inline citations and source-linked work.
6. **References** — a collapsed reference expands inside another piece of work.
7. **School context** — assignment → task → Calendar work block → linked work.
8. **Specialist agent** — evidence produces a capable specialist result, not a form screenshot.
9. **Convergence** — the story resolves into one coherent Spectra workspace/outcome.

Use only the strongest subset needed for pacing. Do not display every feature.

### 15.4 Prism movement and optical behaviour

- central/sticky where it strengthens continuity;
- smooth positional transitions between scene roles;
- objects enter/exit with spatial logic;
- avoid cheap overlay alignment that fakes interaction;
- avoid persistent rays across all sections;
- use colour sparingly and purposefully;
- preserve readability and performance;
- mobile receives a simplified but intentional narrative.

### 15.5 Editorial sections

Between or after prism scenes, use calmer editorial composition:

- concise statements;
- real product details;
- trustworthy architecture/privacy/school context proof;
- pilot/CTA.

Avoid repeated glowing rounded-card grids and fake browser windows.

### 15.6 Real component reuse

Landing demonstrations should import or adapt real Spectra components/data contracts. Do not invent dashboards or interactions that the app does not implement.

Create landing-safe demo adapters that:

- use deterministic sample data;
- avoid production auth/state dependencies;
- preserve real visual/action behaviour;
- remain isolated from application persistence.

### 15.7 Performance and accessibility

- lazy-load WebGL and heavy scenes;
- static/low-motion fallback;
- reduced-motion narrative;
- semantic HTML for copy/CTA;
- text remains accessible independently of canvas;
- deterministic scene state;
- avoid blocking first meaningful content on WebGL.

### Code-only verification

- scene state-machine tests;
- deterministic timeline calculations;
- component/demo adapter tests;
- reduced-motion and no-WebGL fallback tests;
- bundle/lazy-load checks;
- accessibility structure tests;
- no stale provider/model marketing strings;
- no invented product component types outside demo fixtures.

### Exit criteria

- Landing communicates the actual differentiated product.
- The prism is central but not overused.
- Product demos are based on real Spectra systems.
- The page no longer depends on generic AI landing patterns.

---

## Phase 16 — Final migration cleanup and release readiness

### Outcome

The transformed architecture is the only active source of truth, compatibility debt is removed, and the repository is ready for user-led visual review and further product iteration without another foundational rewrite.

### 16.1 Remove temporary compatibility

Review and remove:

- obsolete feature flags;
- legacy collaboration adapters;
- old run/tool adapters;
- duplicate routes/components;
- stale user-facing terminology;
- old timetable work handling;
- Memory navigation/page;
- old Agent Studio;
- generic reference preview fallback;
- duplicate sidebar;
- dead CSS and event bridges;
- unused Convex tables/indexes after safe migration and retention review.

### 16.2 Data migrations

Every migration must be:

- idempotent;
- resumable;
- observable;
- reversible where practical;
- tested on representative fixtures;
- capable of reporting partial failures;
- safe under concurrent use or performed behind a controlled maintenance gate.

Do not delete legacy data until new projections validate and retention requirements are met.

### 16.3 Documentation

Update only necessary documentation:

- architecture overview;
- local development;
- Cloudflare collaboration deployment;
- tool registration;
- work-type registration;
- source/citation model;
- school-source adapter;
- Agent Foundry/skills;
- settings/preferences;
- migration operations.

Avoid generating redundant reports.

### 16.4 Final code-only gate

Run:

- lint;
- strict type check;
- Next production build;
- Convex validation/codegen;
- Cloudflare Worker build/tests;
- all Vitest/unit/integration suites;
- migration fixtures;
- static architecture checks;
- performance budgets;
- dependency/license checks;
- generated requirement traceability completeness.

Produce one concise completion ledger containing:

- requirement ID;
- implementation location;
- test evidence;
- remaining limitation, if any.

Do not claim visual perfection because no browser review was performed. Mark visual user review as the next external acceptance step.

### Exit criteria

- No core requirement relies on a temporary path.
- Every requirement in the traceability appendix is implemented, intentionally deferred with rationale, or explicitly rejected by product decision.
- The repository builds and all code-level gates pass.

---

# Implementation operating rules

## A. Phase dependency order

The intended dependency chain is:

```text
0 Canonical programme
→ 1 Architectural kernels
→ 2 Cloudflare realtime
→ 3 Native Yjs models
→ 4 AI Action/Tool protocol
→ 5 Live Dock/conversations
→ 6 Workbench/routes/sidebar/inspector
→ 7 References/context/sources/rich content
→ 8 Settings/local compute/files
→ 9 Calendar/school/admin
→ 10 Agent Foundry
→ 11 Dedicated work-type passes
→ 12 Functional hardening
→ 13 Visual system
→ 14 Premium motion
→ 15 Landing
→ 16 Cleanup/release readiness
```

Some implementation work may overlap where dependencies are already stable, but do not begin visual elevation before Phase 12. Do not migrate a work type to a final UI before its Work Kernel, collaboration and anchor contracts exist.

## B. Avoid overbuilding

### Live Dock

Do not add:

- a permanent expanded shelf;
- a hover source browser;
- detailed activity logs inside tabs;
- full response rendering on hover;
- multiple nested expansion levels for ordinary inspection.

Use compact, hover, required-input and click-to-open only.

### Permissions

Do not expose the internal capability matrix as a normal sharing form. Read-only/Edit remain primary. Derive attempt/run/present/AI behaviour from work policy and contextual advanced settings.

### Local compute

Do not download large models by default. Do not turn parsing/indexing/autocomplete into a battery-heavy background subsystem. Local compute must prove benefit and capability fit.

### Settings

Do not expose every internal feature flag. Use outcome-oriented defaults and collapsed advanced controls.

### References

Do not create separate public concepts for link, embed, portal, transclusion and card. Use one Reference that collapses or expands.

### Agents

Do not replace the old fixed wizard with another fixed wizard. Foundry sections are dynamically generated from mission requirements.

### Work-type abstraction

Do not force identical modes, toolbars or layouts. Share protocols and interaction grammar while giving each type a dedicated interface.

### Failure handling

Do not hide missing data behind false emptiness. Do not show red errors for recoverable internal retries. Expose only truthful, actionable degradation.

## C. Migration strategy

For every major migration:

1. define old and new schema/protocol;
2. write fixture-based converter;
3. support dual read where necessary;
4. write new data only after the converter passes;
5. compare projections/hashes;
6. retain rollback snapshot;
7. migrate incrementally/idempotently;
8. report partial failures;
9. remove dual path after exit criteria;
10. update traceability and migration ledger.

Do not perform broad table or route renames until user-facing behaviour is decoupled from internal names.

## D. State ownership rules

### Browser/Yjs

Owns:

- active editable shared content;
- awareness;
- local pending changes;
- personal cursor/selection;
- live interaction ownership;
- native undo state.

### Cloudflare Durable Object

Owns:

- active room coordination;
- Yjs update/snapshot persistence;
- awareness fan-out;
- ephemeral leases;
- durable structural claims;
- live permission enforcement;
- projection outbox.

### Convex

Owns:

- users/workspaces/sharing;
- Library/Workspace metadata;
- canonical searchable projections;
- history/change groups;
- comments/notifications;
- runs/tools/agents;
- sources/references metadata;
- Calendar/Plan/school records;
- administration/analytics;
- durable integration state.

### Local device preferences

Owns:

- device-only layout/cache/compute choices;
- restored route session where appropriate;
- temporary autocomplete state;
- no cross-user secrets outside existing secure policy.

## E. API and route strategy

The current generic action route may remain temporarily, but new domain work should prefer:

- direct typed Convex hooks for suitable authenticated durable data;
- focused Next routes for streaming AI, secret-bearing external calls, conversion, webhook and signed/public file operations;
- Cloudflare realtime endpoints for collaboration;
- typed domain services rather than one giant action switch.

Do not mechanically replace every existing API call in one phase. Migrate by domain with tests.

## F. Open-source reuse policy

Reuse is encouraged when it improves capability without surrendering Spectra’s core architecture.

Prefer:

- parsers;
- render/conversion engines;
- calculation engines;
- code runtimes;
- geometry/layout utilities;
- import/export libraries;
- headless models;
- protocol-compatible components.

Avoid wholesale product shells that impose:

- foreign navigation;
- foreign collaboration state;
- foreign permissions;
- inaccessible semantic actions;
- incompatible document models;
- duplicated UI chrome;
- licensing uncertainty.

Candidates must pass `06_ENGINE_ADOPTION_SCORECARD.md` before adoption.

## G. No browser verification

The implementation must not:

- launch Chrome;
- use Playwright;
- use screenshots as proof;
- record QA videos;
- perform manual click-through as an agent verification step.

When a visual/motion requirement cannot be proven through code, implement it according to the contracts and leave a clearly scoped user visual-review note. Do not substitute unverifiable claims.

---

# Code-only verification commands and suites

Use repository scripts and add focused scripts where missing.

Minimum global gate:

```bash
npm run lint
npm run test:run
npx tsc --noEmit
npm run build
```

Add scripts such as:

```json
{
  "test:realtime": "vitest run workers/collaboration",
  "test:contracts": "vitest run src/features/spectra/**/__contracts__",
  "test:migrations": "vitest run tests/migrations",
  "test:providers": "vitest run tests/providers",
  "check:architecture": "node scripts/check-spectra-architecture.mjs",
  "check:copy": "node scripts/check-user-facing-copy.mjs",
  "check:requirements": "node scripts/check-requirement-traceability.mjs"
}
```

Where Convex testing infrastructure is absent, add a deterministic function-test harness or isolate pure domain logic from database calls so it can be tested without a live deployment.

Provider/network tests should use recorded/synthetic fixtures by default. Never make the full test suite depend on paid live search/model calls.

---

# Architecture acceptance invariants

These invariants should be encoded in tests, static checks or architecture documentation.

1. No normal edit waits for Convex persistence.
2. No focused editor is reset from a full remote snapshot.
3. No ordinary text edit requires a structural claim.
4. No dropdown/drag/resize interaction can be disrupted by a second actor after a valid lease is acquired.
5. No AI action completes without semantic postcondition verification.
6. No recoverable wait is represented as a terminal failure.
7. No new tool requires edits across unrelated monoliths.
8. No application tool uses a universal timeout policy by default.
9. No user-facing citation exists without a verified source record.
10. No source integration turns failure into “no data”.
11. No work type omits side-panel, read-only, anchor, reference and responsive contracts.
12. No work renderer is compressed below its declared usable minimum.
13. No Calendar/timetable work item can be created.
14. No normal navigation exposes a Memory page.
15. No normal product copy uses “artifact” as the generic noun.
16. No local compute task runs on the main thread.
17. No large local model is downloaded without capability/user-policy approval.
18. No Agent release mutates itself directly from untrusted usage content.
19. No Library/Workspace transition destroys the shared workbench session.
20. No sidebar collapse swaps to a separate navigation tree.
21. No reference loses semantic target identity merely because its layout changes.
22. No visual animation controls semantic completion or data correctness.
23. No admin metric is displayed without an identified data source and status.
24. No open-source product shell is adopted without passing the engine scorecard.
25. No functional phase is marked complete solely because a component renders.

---

# Requirement traceability checklist

The implementation ledger should map every item below to code and tests.

## Collaboration and synchronization

- [ ] `COLLAB-001` Cloudflare Durable Object realtime provider.
- [ ] `COLLAB-002` WebSocket hibernation-safe room lifecycle.
- [ ] `COLLAB-003` DO SQLite Yjs update log and compacted snapshots.
- [ ] `COLLAB-004` Async idempotent Convex projection outbox.
- [ ] `COLLAB-005` Native fine-grained Yjs document model.
- [ ] `COLLAB-006` Native fine-grained Yjs code model.
- [ ] `COLLAB-007` Native fine-grained Yjs sheets model.
- [ ] `COLLAB-008` Native fine-grained Yjs presentation model.
- [ ] `COLLAB-009` Native fine-grained Yjs board model.
- [ ] `COLLAB-010` Native fine-grained Yjs quiz/deck/Plan/Agent models.
- [ ] `COLLAB-011` Semantic regions derived from native structures.
- [ ] `COLLAB-012` Mergeable/lease/claim policy registry.
- [ ] `COLLAB-013` Dropdown/control lease across complete sequence.
- [ ] `COLLAB-014` Canvas/object gesture lease.
- [ ] `COLLAB-015` Structural claim queue/resume.
- [ ] `COLLAB-016` AI waits for human and resumes after idle/re-resolution.
- [ ] `COLLAB-017` Local reconnect/offline durability.
- [ ] `COLLAB-018` Native relative cursor/comment positions.
- [ ] `COLLAB-019` Actor-aware undo origins.
- [ ] `COLLAB-020` Autosave/projection never blocks typing.
- [ ] `COLLAB-021` No full `setContent` reset during focused remote editing.
- [ ] `COLLAB-022` Composition/IME safety.
- [ ] `COLLAB-023` Rich presence payload and adaptive frequency.
- [ ] `COLLAB-024` Follow collaborator/AI/presenter.
- [ ] `COLLAB-025` Presentation late-join and return-to-presenter.
- [ ] `COLLAB-026` Premium ownership/wait/recovery micro-interactions.

## AI runtime, tools and runs

- [ ] `AI-001` Versioned Action Protocol.
- [ ] `AI-002` Typed run state machine.
- [ ] `AI-003` Central Tool Registry V2.
- [ ] `AI-004` Generated provider schemas and permission UI.
- [ ] `AI-005` Standard bounded tool result envelope.
- [ ] `AI-006` Parallel-safe read batching.
- [ ] `AI-007` Serialized mutation concurrency domains.
- [ ] `AI-008` Per-tool duration/retry/cancel/resume policies.
- [ ] `AI-009` Recoverable errors continue intelligently.
- [ ] `AI-010` User-input/choice/confirmation/file/context tools.
- [ ] `AI-011` Semantic action + choreography + postcondition model.
- [ ] `AI-012` Safe-boundary steering.
- [ ] `AI-013` Multiple active threads/runs.
- [ ] `AI-014` Luna native image/PDF model profile.
- [ ] `AI-015` Dormant legacy visual fallback.
- [ ] `AI-016` Office-to-PDF plus structured attachment bundle.
- [ ] `AI-017` Parallel search adapter with full included results.
- [ ] `AI-018` Adaptive Quick/Verified/Deep research.
- [ ] `AI-019` Full-source fetch/read and evidence extraction.
- [ ] `AI-020` Verified inline citations.
- [ ] `AI-021` No hidden chain-of-thought exposure; meaningful summaries only.
- [ ] `AI-022` Background internal runs with in-surface status.

## Live Dock and conversations

- [ ] `RUN-001` Send does not auto-open right panel.
- [ ] `RUN-002` Continue current thread is default.
- [ ] `RUN-003` Explicit New thread path.
- [ ] `RUN-004` Compact title/status/semantic step.
- [ ] `RUN-005` Hover shows bounded important extra information.
- [ ] `RUN-006` Click opens full right-panel conversation.
- [ ] `RUN-007` Required-input tab expansion.
- [ ] `RUN-008` Multiple-run width/overflow behaviour.
- [ ] `RUN-009` Better checkpoint-derived expanded summaries.
- [ ] `RUN-010` Title/summary reveal animation in polish phase.
- [ ] `RUN-011` Right panel and `/chat` share renderer.
- [ ] `RUN-012` Steering feedback and continuity.
- [ ] `RUN-013` Recoverable/degraded/terminal state truth.

## Workbench and navigation

- [ ] `SURFACE-001` `/library` replaces user-facing Artifacts.
- [ ] `SURFACE-002` Workspace shows only placed work.
- [ ] `SURFACE-003` Library handles global/unplaced/shared/received work.
- [ ] `SURFACE-004` Library and Workspace remain visually/functionally distinct.
- [ ] `SURFACE-005` Shared workbench session/rail between them.
- [ ] `SURFACE-006` Split-tree multi-select layout manager.
- [ ] `SURFACE-007` Minimum renderer sizes and tab fallback.
- [ ] `SURFACE-008` One auxiliary thread with work where supported.
- [ ] `SURFACE-009` Other routes keep local side-panel sessions.
- [ ] `SURFACE-010` Fullscreen transfer to Library.
- [ ] `SURFACE-011` One sidebar DOM for expanded/collapsed.
- [ ] `SURFACE-012` One global search/command surface.
- [ ] `SURFACE-013` Overview/Comments/History inspector.
- [ ] `SURFACE-014` Useful Overview content and hints.
- [ ] `SURFACE-015` User-facing artifact terminology removed.
- [ ] `SURFACE-016` Consistent Library/Workspace selection controls.
- [ ] `SURFACE-017` Comfortable typography and no crushed panels.

## References, context, sources and rich text

- [ ] `REF-001` Shared semantic anchor protocol.
- [ ] `REF-002` Work-specific anchor adapters.
- [ ] `REF-003` One collapsed/expanded Reference model.
- [ ] `REF-004` Work-specific reference targets/views.
- [ ] `REF-005` Host-native insertion.
- [ ] `REF-006` Board capture interface.
- [ ] `REF-007` Resizable expanded references.
- [ ] `REF-008` Backlinks and Overview integration.
- [ ] `REF-009` Restrained placement/reference suggestions.
- [ ] `CTX-001` Pick context from page.
- [ ] `CTX-002` Registered semantic targets with full-target hover outline.
- [ ] `CTX-003` Permission-aware semantic index.
- [ ] `CTX-004` K-bar/Library/context/agent/source reuse.
- [ ] `SOURCE-001` SourceRecord/EvidenceSpan model.
- [ ] `SOURCE-002` Unified rich-content AST/renderers.
- [ ] `SOURCE-003` Markdown/GFM/code/math everywhere relevant.
- [ ] `SOURCE-004` Incremental streaming parser without flicker.
- [ ] `SOURCE-005` Document citation/footnote/bibliography.
- [ ] `SOURCE-006` Presentation source/footer/bibliography.
- [ ] `SOURCE-007` Sheets range/chart provenance.
- [ ] `SOURCE-008` Board object/frame source.
- [ ] `SOURCE-009` Quiz/card source coverage.
- [ ] `SOURCE-010` Code/data/documentation provenance.
- [ ] `SOURCE-011` Calendar/Plan official-source distinction.
- [ ] `SOURCE-012` Agent evidence-to-skill mapping.
- [ ] `COMMENT-001` Comments tab between Overview and History conceptually.
- [ ] `COMMENT-002` General and anchored comments.
- [ ] `COMMENT-003` Click-to-reveal via anchors.
- [ ] `COMMENT-004` Orphan/re-anchor flow.
- [ ] `COMMENT-005` No floating comment UI.

## Settings, local compute and files

- [ ] `SETTINGS-001` Full `/settings` application.
- [ ] `SETTINGS-002` Versioned scoped preferences.
- [ ] `SETTINGS-003` Helpful defaults enabled.
- [ ] `SETTINGS-004` Advanced options collapsed.
- [ ] `SETTINGS-005` AI/run behaviour settings.
- [ ] `SETTINGS-006` Writing/autocomplete settings.
- [ ] `SETTINGS-007` Collaboration settings.
- [ ] `SETTINGS-008` Appearance/text/motion settings.
- [ ] `SETTINGS-009` Local compute/file settings.
- [ ] `SETTINGS-010` Notifications/privacy/integrations/accessibility.
- [ ] `SETTINGS-011` Quick-settings drawer remains small.
- [ ] `COMPUTE-001` Capability-aware Compute Broker.
- [ ] `COMPUTE-002` No main-thread heavy tasks.
- [ ] `COMPUTE-003` Lightweight local autocomplete.
- [ ] `COMPUTE-004` Mobile/constrained graceful disable.
- [ ] `COMPUTE-005` Pyodide improvements.
- [ ] `COMPUTE-006` Lightweight local JS/TS build adapter.
- [ ] `COMPUTE-007` Firecrawl PDF Inspector evaluation/adapter.
- [ ] `COMPUTE-008` Original + visual + structured file bundle.
- [ ] `COMPUTE-009` No provisional local run title.
- [ ] `COMPUTE-010` Open-source engine scorecard.

## Calendar, Plans, school and administration

- [ ] `CAL-001` Calendar removed from work registry.
- [ ] `CAL-002` `/calendar` canonical page.
- [ ] `CAL-003` Temporal domain separation.
- [ ] `CAL-004` Flexible Plan work type.
- [ ] `CAL-005` Unscheduled task lane.
- [ ] `CAL-006` Drag/resize work blocks.
- [ ] `CAL-007` AI Calendar actions.
- [ ] `CAL-008` Side-panel work and fullscreen transfer.
- [ ] `SCHOOL-001` Provider-neutral SchoolSourceAdapter.
- [ ] `SCHOOL-002` ManageBac capabilities audited.
- [ ] `SCHOOL-003` Tasks/deadlines/classes/timetable/resources/CAS usable.
- [ ] `SCHOOL-004` Discussions/announcements/feedback/results where supported.
- [ ] `SCHOOL-005` Accurate source time mapping.
- [ ] `SCHOOL-006` User School/ManageBac page.
- [ ] `SCHOOL-007` Separate admin integration panel.
- [ ] `SCHOOL-008` Manual sync and freshness.
- [ ] `SCHOOL-009` No false empty states.
- [ ] `SCHOOL-010` Workspace materialization idempotency.
- [ ] `SCHOOL-011` Future Teams/provider compatibility.
- [ ] `ADMIN-001` User analytics real data sources.
- [ ] `ADMIN-002` School admin real data/status.
- [ ] `ADMIN-003` Superadmin real data/status.
- [ ] `ADMIN-004` Metric privacy and freshness.

## Agents and memory

- [ ] `AGENT-001` Agent Foundry inside Agent work view.
- [ ] `AGENT-002` Initial mission and interaction questions.
- [ ] `AGENT-003` Dynamic generated input/file/choice sections.
- [ ] `AGENT-004` Removable/restorable question sections.
- [ ] `AGENT-005` Persistent creator composer.
- [ ] `AGENT-006` Continue building until sufficient.
- [ ] `AGENT-007` Structured mission model.
- [ ] `AGENT-008` Evidence analysis/extraction.
- [ ] `AGENT-009` First-class versioned skills.
- [ ] `AGENT-010` Background compiler agents.
- [ ] `AGENT-011` Adaptive creation paths.
- [ ] `AGENT-012` Layered evaluation with actual resources/tools.
- [ ] `AGENT-013` Competence-aware routing.
- [ ] `AGENT-014` Visible routing reason/confidence.
- [ ] `AGENT-015` Safe batched self-improvement.
- [ ] `AGENT-016` Injection-resistant learning.
- [ ] `AGENT-017` Immutable releases and rollback.
- [ ] `AGENT-018` Discover/Installed/Yours/Shared.
- [ ] `MEM-001` Memory removed from normal navigation.
- [ ] `MEM-002` Conservative behind-the-scenes capture.
- [ ] `MEM-003` Scoped retrieval/corrections/deletion.
- [ ] `MEM-004` Internal capture/retrieval tests.
- [ ] `MEM-005` No user accept/edit/reject workflow.

## Work types

- [ ] `WORK-DOC` Document professional pass.
- [ ] `WORK-DECK` Flashcard professional pass.
- [ ] `WORK-QUIZ` Quiz professional pass.
- [ ] `WORK-CODE` Code professional pass.
- [ ] `WORK-PRES` Presentation professional pass.
- [ ] `WORK-SHEET` Sheets professional pass with inline charts.
- [ ] `WORK-BOARD` Board professional pass.
- [ ] `WORK-PLAN` Plan professional pass.
- [ ] `WORK-AGENT` Agent work integration pass.
- [ ] `WORK-COMMON` Conformance suite and consistent simple modes.
- [ ] `WORK-PERM` Read-only/Edit user model with internal capabilities.

## Visual elevation and landing

- [ ] `POLISH-001` Shared visual tokens and typography.
- [ ] `POLISH-002` Control hierarchy and duplicate-rail cleanup.
- [ ] `POLISH-003` Dedicated UI pass per work type.
- [ ] `POLISH-004` Streaming reveal scheduler.
- [ ] `POLISH-005` Active-tail shimmer only.
- [ ] `POLISH-006` Smooth Live Dock transitions.
- [ ] `POLISH-007` Premium collaboration presence.
- [ ] `POLISH-008` Ownership/wait/resume effects.
- [ ] `POLISH-009` Reference/panel morphs.
- [ ] `POLISH-010` Reduced-motion/mobile simplification.
- [ ] `LANDING-001` WebGL prism central narrative.
- [ ] `LANDING-002` Left pain → prism → right Spectra outcome.
- [ ] `LANDING-003` Prism moves smoothly between scene roles.
- [ ] `LANDING-004` Real collaboration/action demonstration.
- [ ] `LANDING-005` Real citations/references/Calendar/Agent demonstration.
- [ ] `LANDING-006` Calm editorial sections and real CTA.
- [ ] `LANDING-007` No generic model carousel/feature-card overload.
- [ ] `LANDING-008` Reduced-motion/no-WebGL fallback.

---

# Completion standard

This programme is complete only when:

- the new architecture is the active source of truth;
- all major work types are functionally strong and share the common kernels;
- collaboration is fine-grained, smooth by construction and intelligently coordinated;
- AI action logic matches the quality of its human-like visual behaviour;
- Library, Workspace, Calendar, Agents, School and Settings have distinct useful roles;
- citations, references, rich text and semantic anchors work consistently throughout the product;
- school/admin/analytics surfaces show truthful real data states;
- advanced power is present without making normal interfaces confusing;
- functional code gates pass before motion and landing work;
- final motion is coherent, real-time and accessibility-aware;
- the landing page demonstrates actual product differentiation;
- no requirement is silently omitted.

The intended result is not a minimally complete education application. It is a coherent, extensible work platform whose education-specific capabilities are exceptional while its architecture remains useful for companies, personal work and shared projects.
