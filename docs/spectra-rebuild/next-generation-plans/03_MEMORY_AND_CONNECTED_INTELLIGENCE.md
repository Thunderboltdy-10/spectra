# Memory and connected intelligence

## Product principle

Spectra should feel familiar because it remembers high-value, correct, scoped information—not because it stores everything. Memory is a derived, permission-bound intelligence layer. Source artifacts, threads, external records, and audit events remain the evidence. A memory claim never grants access and never outranks its source.

## Research-informed alternatives

| Approach                      | Strength                                        | Failure mode                                                          | Decision                                                               |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One growing profile/SOUL file | simple and cheap to inject                      | duplication, stale claims, weak provenance, unbounded editorial power | use only as a generated capped capsule                                 |
| Structured claims             | correction, scope, provenance, expiry, querying | more schema and consolidation work                                    | canonical memory truth                                                 |
| Event-derived memory          | reconstructable and auditable                   | noisy and expensive without consolidation                             | evidence layer, not prompt payload                                     |
| Embedding store               | semantic recall                                 | opaque ranking and stale/unauthorized chunks                          | secondary candidate retrieval                                          |
| Knowledge graph               | relationships and multi-hop discovery           | complexity and false edges                                            | typed relations over high-confidence claims, not universal graph first |
| Model-written summaries       | compact and fluent                              | can invent or erase nuance                                            | generated projection with citations and hard caps                      |

Hermes demonstrates the value of small startup files—its MEMORY.md and USER.md are tightly bounded—while OpenClaw combines curated memory, daily evidence, and hybrid retrieval. Anthropic’s context guidance emphasizes curation/compaction as context grows. OpenAI exposes conversation state and file search as separable state/retrieval primitives. Spectra should combine these ideas rather than choosing a single flat file: [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md), [OpenClaw memory](https://docs.openclaw.ai/concepts/memory), [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows), [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search).

## Canonical model

memoryClaims stores: claimId, subject user/workspace/artifact/workflow/relationship, claim type, normalized proposition, assertion or inference, confidence, sensitivity, scope, status proposed/active/disputed/superseded/expired/deleted, validFrom/expiry, createdBy policy/model/user, lastConfirmedAt, supersedesId.

memoryEvidence stores an immutable reference to source type/id/version/region/event, permitted excerpt hash, capture reason, observedAt, and current access status. memoryRelations stores typed edges only when useful: works_on, prefers, corrected, depends_on, related_to, collaborates_with, follows_workflow. memoryCapsules stores generated bounded summaries with source claim IDs, token count, generation version, and stale flag. memoryRetrievalEvents explains query, candidates, exclusions, selected claims, token spend, and consuming run.

Claim types initially: declared fact, inferred preference, correction, decision, recurring workflow, commitment/deadline, mistake/avoidance, expertise/learning signal, relationship, and workspace convention. Sensitive traits, diagnoses, protected characteristics, disciplinary conclusions, and speculative emotional states are never inferred into long-term memory.

## Capture policy

Candidate capture occurs only after explicit “remember” requests or strong product signals: a direct correction, repeated stable preference, accepted recurring workflow, explicit decision, or durable commitment. A lightweight classifier proposes type/scope/confidence/sensitivity and evidence. Deterministic rules reject secrets, credentials, transient task text, raw school records, other users’ private content, duplicate propositions, and low-confidence inference.

Candidates merge with semantically equivalent claims, supersede contradictions, or remain proposed until confirmation. Repetition increases evidence, not duplicate records. Model-generated reflection may suggest claims in a queue; it cannot activate sensitive or cross-scope claims autonomously. Consolidation is idempotent and measured for precision, not volume.

## Exact context budgets

Memory is separate from continued thread and focused artifact content.

| Layer                        |    Default | Hard maximum | Entry rule                                           |
| ---------------------------- | ---------: | -----------: | ---------------------------------------------------- |
| user capsule                 | 220 tokens |          300 | stable active claims useful across work              |
| active workspace capsule     |        300 |          400 | conventions, objectives, active decisions            |
| current workflow/corrections |        120 |          180 | directly relevant recent pattern or mistake          |
| relationship hints           |         60 |          100 | only actors/resources already in permitted context   |
| school-safe profile          |         60 |          100 | role/course/timezone facts allowed in this school    |
| total initial memory         |        760 |        1,080 | omit empty layers; never fill quota for its own sake |

First-pass deeper retrieval is capped at 1,500 tokens and eight claims/evidence snippets. A tool may request a second pass up to 4,000 tokens when the task demonstrably needs old context. Absolute memory/retrieval ceiling is 8,000 tokens and requires a logged reason. The context manifest records estimates and actual tokens. Artifact-level capsules are not injected globally; a focused artifact gets its normal artifact context serializer.

## Retrieval

Retrieval applies hard scope and current-access filters before ranking. Candidate sources are exact structured filters, lexical search, vector similarity, relation traversal up to two edges, recency, confidence, and correction priority. Ranking penalizes duplicated evidence and old unconfirmed inference. The assembler diversifies by claim, cites evidence, and returns “unknown” instead of filling gaps.

Memory can propose related artifacts, threads, and next steps in right-side intelligence surfaces. UI labels inferred suggestions and explains “Why this?” Most memory remains backend-only; no ambient personal dossier appears to teachers or administrators.

## Correction and control

Users get a private Memory & personalization surface with search, filters, why remembered, evidence, scope, confidence label, edit/correct, dispute, forget, export, pause capture, and clear-all. “Forget” immediately excludes claims/capsules/retrieval, invalidates derived embeddings, and schedules evidence deletion where the user owns it; it does not falsify immutable audit or delete independently owned source artifacts. Correction creates a superseding claim and tests that the old claim cannot be retrieved.

Workspace owners/managers may manage workspace conventions, not members’ private user memory. School admins can set retention and disabled categories but cannot inspect individual memory. Platform operators see service health and aggregate counts only.

## School and privacy boundaries

Every claim has one explicit scope: private user global, private user within school, workspace, shared artifact convention, or system product preference. School-derived facts cannot flow to another school. Other people’s identities appear only as relationship references already visible to the user. Agent runs write memory for the invoking user, never the agent creator. ManageBac records remain external evidence and are not copied into global user memory.

Deletion, offboarding, and school transfer invalidate scope. Retention defaults: rejected candidates 30 days, retrieval logs 30 days with minimized text, inactive inferred claims 180 days unless reconfirmed, declared facts until changed/deleted, capsules regenerated on any source change. Exact values require D-10 approval.

## Failure strategy and evaluation

If memory services fail, the run continues without memory and says so only when material. Stale capsules are excluded after scope or permission changes. Consolidation jobs use leases and deterministic hashes. Prompt-injection text in sources is data, never memory instruction; all captured propositions are schema constrained.

Evaluate precision of useful recall, harmful/incorrect recall, cross-scope leakage, correction effectiveness, duplicate rate, capsule token budget, retrieval latency, and user deletion completion. Red-team names shared across schools, revoked artifacts, malicious embedded instructions, disputed claims, and agent creator/student boundaries.

## Memory tasks

### MEM-01 Remove the obsolete memory, personal soul, and organization soul implementation

- [ ] Implemented
- [ ] Verified

### MEM-02 Implement claims, evidence, relations, capsules, retrieval events, indexes, and retention

- [ ] Implemented
- [ ] Verified

### MEM-03 Implement candidate policy, deduplication, contradiction, supersession, and consolidation

- [ ] Implemented
- [ ] Verified

### MEM-04 Enforce the exact initial and deeper-retrieval token budgets in context manifests

- [ ] Implemented
- [ ] Verified

### MEM-05 Implement permission-first hybrid retrieval with citations and exclusion reasons

- [ ] Implemented
- [ ] Verified

### MEM-06 Build private inspect, correct, dispute, forget, export, and pause controls

- [ ] Implemented
- [ ] Verified

### MEM-07 Implement workspace conventions without exposing member-private memory

- [ ] Implemented
- [ ] Verified

### MEM-08 Implement deletion propagation, capsule invalidation, expiry, and offboarding

- [ ] Implemented
- [ ] Verified

### MEM-09 Build precision, contamination, injection, correction, deletion, latency, and token-budget evals

- [ ] Implemented
- [ ] Verified

### MEM-10 Pilot opt-in capture and graduate categories only after measured precision thresholds

- [ ] Implemented
- [ ] Verified
