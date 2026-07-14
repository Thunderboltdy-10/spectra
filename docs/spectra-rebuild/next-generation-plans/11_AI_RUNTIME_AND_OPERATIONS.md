# AI runtime and operations

## Current foundation and required replacement

Preserve conceptually: begin-run acknowledgement, durable run/thread records, typed tools, pending artifact shells, progressive region updates, approval, result cards, and context priority. Replace: process-local activeRunControllers/background tasks, one giant route, hard-coded four-type schemas, owner-only tools, broad any content, and polling-based projection.

## Durable run model

Run lifecycle: queued, leasing, preparing context, planning, awaiting approval, executing, verifying, completed/partial/failed/stopped. A run has attempts; workers acquire renewable leases and heartbeat. Checkpoints store last durable event, completed operation IDs, external call idempotency, model response references, and artifact state vectors. A replacement worker resumes from checkpoint; it never replays committed operations.

Streaming is a projection of durable events over reconnectable SSE or reactive subscription. Closing a viewer never cancels a run. Stop is a durable command checked by workers and tools. Event sequence IDs support resume and deduplication.

## Context and retrieval

Build a durable context manifest from continuation, selected agent/version, explicit focus, visible regions, workspace map, permitted school data, memory capsule, retrieval evidence, and exclusions. Each entry records source version, permission decision, purpose, token estimate, and sensitivity. Initial context should be task-shaped rather than a fixed 28,000-character packet; type serializers and budgets decide detail.

Retrieval tools perform permission filtering before ranking and current-access recheck before assembly. Model text never directly selects a tenant/user ID. School-data and memory retrieval use semantic purpose tools. The planner can request deeper regions/evidence within an explicit token/time budget.

## Operation protocol

Operation envelope: operationId, run/attempt, actor and agent version, artifact/type, command, typed input, baseVersion/stateVector, target region IDs, preconditions, risk, approval policy, idempotency key, expected result. The registry resolves validator/executor/preview/compensator/history summary.

Risk classes: read; local reversible edit; shared/broad edit; publish/share/assess/schedule; destructive; external side effect. Approval considers risk, object count, affected audience, assessed/published state, ambiguity, and user preference—not only raw operation count. Claiming approval is transactional.

Progressive output creates a valid shell, streams schema-valid regions, checkpoints coherent increments, and marks incomplete requirements. A blue trace corresponds to preparing/reading/creating/editing/checking and actual regions. Verification includes schema invariants, user constraints, citation/source integrity, accessibility checks where possible, and preservation checks for focused edits.

## Human/AI concurrency

Every mutation reauthorizes and checks base state. Non-overlapping updates merge; stable region addressing allows retargeting; conflicts pause only affected operations. UI shows current, AI proposal, and base when useful. The user can apply AI, keep current, edit proposal, or cancel. Broad AI reorganizations can run in a branch/proposal version before merge.

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

### AI-03 Implement reconnectable sequenced event projection independent of viewer lifetime

- [ ] Implemented
- [ ] Verified

### AI-04 Implement durable permission-checked context manifests and adaptive token budgets

- [ ] Implemented
- [ ] Verified

### AI-05 Implement registry-driven typed operations, risk policy, previews, approvals, and compensators

- [ ] Implemented
- [ ] Verified

### AI-06 Implement pending shells, region streaming, checkpoints, traces, verification, and partial recovery

- [ ] Implemented
- [ ] Verified

### AI-07 Implement concurrent-edit rebase, branch/proposal, conflict UI, and reauthorization

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
