# Prompt 2 Implementation Review

## What changed

The backend was tightened around a deterministic route plan, selective SOUL usage, scoped retrieval, safer invite/access behavior, real artifact persistence, traceable per-message feedback, and guarded member deletion. The chat pipeline now compiles school identity, mode contract, agent contract, and user memory more deliberately instead of injecting everything eagerly. Resource retrieval now includes pack scope, document outputs can become stored DOCX/PDF/PPTX artifacts, invalid timezones fall back safely, invite resend/acceptance flows were hardened, and admin member removal now purges user-scoped data instead of deleting the user row blindly.

## Architectural decisions

The main decision was to avoid schema-heavy rewrites where the existing platform could be reused safely. Artifact generation was implemented on top of the existing `resources` table and storage pipeline rather than introducing a new artifact table mid-pass. Per-message thumbs were persisted through `auditLog` rather than blocking on schema expansion. School SOUL was implemented as a compact compiled capsule, while Your SOUL remains selective and route-gated.

Routing was kept product-owned. The route planner decides when search, retrieval, memory, or multi-agent work is warranted; provider-level execution remains downstream from that decision. That keeps the system inspectable and reduces accidental overthinking on simple prompts.

## Tradeoffs

Using existing `resources` for artifacts keeps the deployment surface smaller, but artifacts currently behave like stored personal resources rather than a fully separate artifact domain model.

Per-message feedback persistence is usable now, but analytics built on top of `auditLog` will need more dedicated reporting queries if moderation and QA workflows expand.

The route planner is deterministic and cheap by design. That makes it more debuggable, but also means some edge-case routing quality still depends on heuristics rather than learned policy.

Permanent user deletion now prioritizes integrity over convenience. If a user still owns shared packs or agents, deletion is blocked until those assets are reassigned or removed; this avoids breaking shared school content but adds an explicit admin cleanup step.

## Risks that remain

Repo-wide lint still depends on clearing unrelated warnings outside the touched slice if strict zero-warning enforcement is required for every file.

The full production build is sensitive to the current host environment because this workspace is running against WSL paths with Windows `node.exe`; Turbopack path handling should be validated again in the target deployment environment.

Artifact generation now works end-to-end, but large or unusually complex documents should be monitored for latency and storage pressure.

The guarded user purge deletes user-scoped records and storage-backed personal assets, but unusually large individual accounts may still need monitoring for Convex mutation runtime if schools accumulate very high per-user history.

## What to monitor after deployment

- Route trace distributions for unnecessary search, retrieval, and multi-agent activation.
- Artifact generation success rate, latency, and resource cleanup.
- Invitation resend/acceptance failures, especially around seat limits and duplicate pending invites.
- Member deletion failures caused by outstanding owned packs or agents that need reassignment.
- Message feedback volume and the usefulness of stored moderation signals.
- Retrieval diagnostics, especially zero-source cases after uploads.
