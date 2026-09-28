# AI runtime and operations

The obsolete study-mode taxonomy and selector do not survive deletion. The runtime receives an ordinary user request plus authority/context, then adaptively answers, retrieves, routes an Agent artifact, or invokes typed artifact/media operations. Research and image creation are operation kinds; Quiz and Flashcard Deck are artifacts. No `StudyMode`, mode-specific system prompt, mode badge, mode URL parameter, or mode-specific renderer controls behavior.

## Current foundation and required replacement

Preserve conceptually: begin-run acknowledgement, durable run/thread records, typed tools, pending artifact shells, progressive region updates, approval, result cards, and context priority. Replace: process-local activeRunControllers/background tasks, one giant route, hard-coded four-type schemas, owner-only tools, broad any content, and polling-based projection.

## Durable run model

Durable lifecycle status is queued, leasing/running, awaiting user, completed, partial, failed, or stopped. Planning, retrieval, inspection, editing, verification, approval, and other work are optional typed activities—not a rigid checklist every run must follow. A run has attempts; workers acquire renewable leases and heartbeat. Checkpoints store last durable event, completed operation IDs, external call idempotency, model response references, artifact state vectors, region claims, and change-group IDs. A replacement worker resumes without replaying committed operations.

Streaming is a projection of durable events over reconnectable SSE or reactive subscription. Closing a viewer never cancels a run. Stop is a durable command checked by workers and tools. Event sequence IDs support resume and deduplication.

## Context and retrieval

Build a durable context manifest from continuation, selected agent/version, explicit focus, visible regions, workspace map, permitted school data, memory capsule, retrieval evidence, and exclusions. Each entry records source version, permission decision, purpose, token estimate, and sensitivity. Initial context should be task-shaped rather than a fixed 28,000-character packet; type serializers and budgets decide detail.

Agent selection runs before specialized context assembly. Retrieve compact available-agent descriptors on demand. Medium/high confidence automatically selects a substantially better agent, visibly and reversibly, then loads only its relevant instructions, skills, allowed tools, resource bindings, and specialized context. Low confidence uses ordinary Spectra. A continued thread retains its agent unless explicit choice or a strong logged routing reason changes it.

Retrieval tools perform permission filtering before ranking and current-access recheck before assembly. Model text never directly selects a tenant/user ID. School-data and memory retrieval use semantic purpose tools. Memory starts near the approximately 1,000-token relevance target but may expand when testing/task need justifies it. Capture/consolidation jobs run separately in the background and never produce user-facing run progress. The runtime keeps only a compact artifact-selection/composition guide and loads a type’s complete AI skill only when inspecting/creating/editing that artifact.

## Operation protocol

Operation envelope: operationId, run/attempt, actor and agent version, artifact/type and loaded skill version, command, typed input, live base stateVector, stable target region IDs/overlap domain, region claim, preconditions, risk, approval policy, idempotency key, expected result/effect. The registry resolves validator/executor/preview/compensator/history summary/effect adapter.

Risk classes: read; local reversible edit; shared/broad edit; publish/share/assess/schedule; destructive; external side effect. Approval considers risk, object count, affected audience, assessed/published state, ambiguity, and user preference—not only raw operation count. Claiming approval is transactional.

Progressive output creates a valid shell, streams schema-valid regions, checkpoints coherent increments, and marks incomplete requirements. Before the first AI mutation, create a user-attributed checkpoint when live human state lacks a version. Every coherent AI operation batch creates an AI-attributed version. Verification includes schema invariants, user constraints, citation/source integrity, accessibility checks where possible, and preservation checks for focused edits.

## Native progress-event protocol

OpenAI’s current API documentation demonstrates typed semantic streaming events, and Codex surfaces turn/item/tool progress rather than treating one text stream as the only state ([OpenAI streaming semantic events](https://developers.openai.com/api/docs/guides/streaming-responses#enable-streaming), [Codex manual](https://developers.openai.com/codex/codex-manual.md)). Spectra adopts the principle of typed synchronized events, not OpenAI implementation details.

The active response model may emit a hidden structured tag such as a validated progress event containing title, operation ID, artifact/region references, phase kind, sequence, and terminal/replacement semantics. The parser removes it from ordinary response text, validates length/content/IDs, binds it to real run/tool/operation state, persists it as a sequenced run event, and updates the tab, panel, thread, card, editor, and activity representation from one source. A secondary model is never called to name progress.

Titles are concise and specific to real work: “Finding your CAS experiences”, “Mapping deadlines into the timetable”, “Rewriting the wave-equation section”, “Building five relativity questions”, “Checking the new slides for overflow”. Avoid repetitive generic Planning/Writing response/Reading context/Checking result. A run emits only useful events for activities it actually performs. Memory maintenance is explicitly rejected by the progress validator.

## Real artifact working effects

The progress event identifies the operation, while the artifact effect adapter renders actual live region state. Text forms/replaces/morphs; quiz options/answer state transition; Sheet cells/ranges populate and charts assemble; slide objects form/move; task fields change; whiteboard nodes materialize/reorganize; card shells reflect aggregate activity. Independent region effects can animate concurrently and may deliberately lag commits slightly for perceived quality. Effects are ephemeral, authoritative-state driven, accessible, and fully removed on complete/partial/fail/reject/cancel/permission-loss/reconnect. No permanent blue state, red failure glow, stale run marker, or abandoned animation remains. Reduced motion preserves clear state without decorative movement.

## Human/AI concurrency

Every mutation reauthorizes, checks live base state, and acquires the smallest stable region claim. Non-overlapping updates merge and animate concurrently; overlapping human/AI or AI/AI work queues/pauses only affected operations. UI shows current, proposal, and base and lets the user apply, keep current, edit/merge, or cancel. Claim loss/expiry cancels the commit. Broad AI reorganizations may run in a proposal branch before merge.

## Agent and tool safety

System/policy instructions outrank agent/resource/user content. Tools expose minimal structured capability and return untrusted data fields separately from instructions. Network/file/code tools run in sandboxes with destination, data egress, secret, budget, and approval controls. Use allowlists, input/output validation, rate limits, and audit; never expose generic database query/mutation tools to the model.

## Evaluation and observability

Measure begin acknowledgement, context ready, first meaningful progress, first shell, first content, approval wait, complete; tokens/cost by stage; retries; conflicts; partial success; preserved-field accuracy; operation validity; source grounding; security/privacy violations. Evals cover small edits, mixed graph changes, simultaneous users, permission revocation, restart, duplicate delivery, malicious sources, and each artifact adapter. Traces retain structured safe metadata; prompt/content sampling is opt-in and access-controlled.

## AI runtime tasks

### AI-01 Split HTTP handlers, orchestration, workers, model adapters, tools, and artifact operations

- [ ] Implemented
- [ ] Verified

### AI-02 Implement leased durable attempts, heartbeats, checkpoints, resume, stop, and idempotency

- [ ] Implemented
- [ ] Verified

### AI-03 Implement reconnectable sequenced event projection independent of viewer lifetime and synchronized across every run representation

- [ ] Implemented
- [ ] Verified

### AI-04 Implement durable permission-checked context manifests, automatic agent routing/loading, adaptive memory budgets, and on-demand artifact skill loading

- [ ] Implemented
- [ ] Verified

### AI-05 Implement registry/skill-driven typed operations, region claims, risk policy, previews, approvals, compensators, and mandatory pre-AI checkpoints/AI versions

- [ ] Implemented
- [ ] Verified

### AI-06 Implement active-model hidden progress events, specific title validation, response stripping, no secondary namer, no memory traces, pending shells, region streaming, verification, and partial recovery

- [ ] Implemented
- [ ] Verified

### AI-07 Implement exclusive overlapping-region queue/pause, concurrent non-overlap, safe rebase, branch/proposal, conflict UI, claim cleanup, and reauthorization

- [ ] Implemented
- [ ] Verified

### AI-08 Implement tool sandboxing, injection defenses, budgets, and safe observability

- [ ] Implemented
- [ ] Verified

### AI-09 Build per-artifact and cross-system evaluation suites with latency/quality/security gates

- [ ] Implemented
- [ ] Verified

### AI-10 Migrate active runs/tools and remove the process-local controller path

- [ ] Implemented
- [ ] Verified

### AI-11 Implement every artifact’s real region-aware blue effects, deliberate concurrent animation, terminal cleanup, no stale failure state, and reduced motion

- [ ] Implemented
- [ ] Verified

### AI-12 Prove progress specificity/synchronization, adaptive paths, memory-trace exclusion, route recovery, pre-AI checkpoints, AI attribution, and working-effect cleanup live

- [ ] Implemented
- [ ] Verified
