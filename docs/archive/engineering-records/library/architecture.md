# Spectra Workspace Mission Architecture

## 1) Title + Purpose
This document defines the high-level architecture for the Spectra workspace redesign mission. Its purpose is to align all workers on system boundaries, runtime ordering, data invariants, dependency constraints, and operational guardrails so implementation remains backend-first, classifier-led, projection-correct, and migration-safe.

## 2) System Boundaries

### Workspace Surface
The workspace canvas is the primary working surface (not a shortcut layer), with progressive Glance → Touch → Deep Edit interaction tiers, global view modes (`byType`, `byTopic`, `timeline`), persistent edge hub primitives, and focus-aware rendering.

### Backend Projection Layer
Backend truth lives in canonical entities (artifacts, chats/threads, planner items). Workspace projection (`workspaceItems`) is a derived but immediate representation used for spatial rendering, grouping, navigation, and lifecycle consistency (create/update/archive/move).

### Intelligence Pipeline
AI behavior is governed by a narrow T0 short-circuit and a structured cheap-model classifier for all substantive requests. Classifier output determines skill loading, routing intent, context budgets, and downstream generation behavior; heuristics are compatibility-only.

### Integrations Boundary
External and preserved systems (OpenRouter/model catalog, embeddings, ManageBac sync, memory, packs/agents, gamification, notifications, exports/storage) are integrated through stable contracts and must not bypass canonical projection or classifier-led orchestration.

## 3) Core Runtime Flows

### A. Projection / Mutation / Invalidation Ordering
1. User/AI action mutates canonical entity truth first.
2. Undo-relevant workspace mutation is recorded.
3. Projection layer (`workspaceItems`) is upserted/archived immediately.
4. `workspace-content-mutated` event is emitted after projection is safe.
5. Clients invalidate visible data and refetch/warm nearby content.
6. Canvas rerenders with tier-appropriate detail.

### B. Classifier / Skills / Routing Ordering
1. T0 gate handles trivial filler only.
2. Non-T0 input goes to structured classifier (cheap model).
3. Classifier outputs tier, skills, needs flags, targeting, confidence, thinking level.
4. Skill set is loaded and injected into prompt policy.
5. Prompt enhancement runs after classification.
6. Router chooses model lane from classifier intent and budget constraints.
7. Generation runs; post-process handles projection/memory/planner/ghost triggers.

### C. Workspace Content Loading / Cache Behavior
1. Viewport content loads fully (interactive where applicable).
2. Adjacent zones load metadata/skeletons.
3. Distant zones are unloaded.
4. Zooming out dehydrates heavy renderers/editors to Glance state.
5. LRU workspace cache (bounded) replaces unbounded content retention.
6. Event-driven invalidation keeps cache coherent with backend mutations.

## 4) Data Contracts / Invariants

### Canonical Types
- Workspace-facing canonical artifact taxonomy is authoritative (Note, Visual, Code, Export, Board, Flashcard Deck, Quiz; plus Thread and Planner as non-artifact entities).
- Legacy type values remain readable through compatibility mapping until migration completion.

### Provenance and Lifecycle
- AI-created or AI-mutated items carry provenance (`provenanceSource: ai`-equivalent semantics).
- Projection must preserve provenance/status markers across create/update/archive.
- Discard/reapply flows must restore persisted truth, not UI-local state.

### View Modes
- Persisted workspace view modes are strictly `byType | byTopic | timeline`.
- Legacy view modes are migration-tolerated reads only.

### Topic Clustering + User Overrides
- `topicCluster` assignment may be AI-generated.
- User drag/rename corrections are first-class overrides and persist through reclustering.
- Reclustering must respect prior user override anchors.

### Workspace Mutation Undo
- Undoable actions record workspace mutation contracts consistently.
- Undo must be truth-restoring and projection-consistent.

## 5) Wave Dependency Constraints (W1 → W5)
- **W1 (Foundation)** is a hard prerequisite for all downstream waves: canonical types, immediate projection, store semantics, bounded cache, and migration scaffolding.
- **W2 (Interaction)** depends on W1 projection correctness and canonical renderer contracts.
- **W3 (Intelligence)** depends on W1+W2 stable projection/interaction surfaces; classifier and skills become primary orchestration truth.
- **W4 (Views + Focus)** depends on W3 embeddings/classifier-era substrate and W1 projection fields for clustering/timeline behavior.
- **W5 (Integration + Polish)** depends on prior waves for coherent agent/planner/gamification/template integration.
- No wave advances without passing its validation gate.

## 6) Operational Constraints
- **Cheap models by default:** classification, background jobs, clustering support calls, ghost generation, and maintenance tasks use budget-safe model lanes.
- **Backend-first sequencing:** schema/contracts/mutations/events before frontend behavior per wave.
- **Compatibility migration safety:** dual-read compatibility and staged cleanup; old reads outlive old writes; no premature removal of legacy paths.
- **Projection immediacy requirement:** generated or user-created content must appear in workspace lifecycle immediately.
- **Scope-as-hint policy:** workspace/artifact context guides AI behavior but does not hard-limit user intent handling.

## 7) Known Risk Hotspots + Mitigation Principles

- **Risk: Delayed/fragile projection**  
  **Mitigation:** enforce mutation→projection→event ordering and test create/update/archive parity.

- **Risk: Heuristic routing persistence**  
  **Mitigation:** classifier as non-T0 source of truth with strict schema validation and fallback discipline.

- **Risk: Legacy type/mode leakage**  
  **Mitigation:** canonical mapping at boundaries, compatibility reads only, gated cleanup.

- **Risk: Cache staleness/memory bloat**  
  **Mitigation:** bounded LRU, zone loading, event-driven invalidation, zoom-triggered dehydration.

- **Risk: User trust loss from opaque AI actions**  
  **Mitigation:** provenance indicators, confidence-tier action policy, undoability for auto-creation/mutations.

- **Risk: Topic clustering instability**  
  **Mitigation:** batch reclustering cadence, persistent override anchors, deterministic fallback to `byType`.

- **Risk: Integration drift (ManageBac/agents/planner/gamification)**  
  **Mitigation:** contract-first integration through canonical projection and shared orchestration, no side-channel state.
