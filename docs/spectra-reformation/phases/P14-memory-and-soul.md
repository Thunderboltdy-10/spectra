# P14 — Memory & Soul

**Goal:** the memory system gains a **soul** — a small, always-present, user-visible core — and the AI gains the ability to **author its own skills** under hard caps, with everything else fetched on demand. Explicitly *not* the goal: anything huge. The existing claims/capsules substrate (`convex/memory.ts`) is sound and stays; this phase adds the missing product shape on top of it and finally wires or deletes the dormant `public/skills/` library. The context packet budget (28k chars) is a ceiling this phase must live under, not renegotiate (CANON R27).

**Prerequisites:** none — Wave 0, fully parallel with other tracks. **Architecture:** ARCHITECTURE-AI (context assembly), EXPANSION §7.6 (migrate-and-delete). **Findings absorbed:** memory/skills exploration 2026-08-30 — `memoryClaims`/`memoryCapsules`/`memoryJobs` fully implemented; `retrieve_memory`/`write_memory` tools exist; `createdBy: "model"` exists in schema with no writer; `public/skills/*.md` (10 files + manifest) has **zero runtime references**; artifact skills load lazily via `loadArtifactSkill`; Foundry `SpectraSkill` activation caps at 6.

**Difficulty (PROCESS §4):** I1, I3 = MT / xhigh. I2 = Hard / xhigh. V1 = MT / xhigh.

## P14.I1 — The soul capsule (MT)

- New `memoryCapsules` kind **`soul`**: one per account, hard token cap (~350 tokens, constant in code, asserted in tests), **always injected first** into every run's context — before workspace index, before other capsules — including the lightweight-conversation fast path (a greeting should still know who it is talking to).
- Dual authorship: assembled from high-signal claims by the existing `rebuildCapsulesForAccount` machinery **and directly editable by the user** — a plain textarea in Settings ("How Spectra knows you"), user text winning over generated text within the cap. Edits journal through the normal memory audit.
- Plain-words surface (R13): never "capsule", "claims", "retrieval" in UI copy.
- Owns: `convex/memory.ts` (soul kind + injection), `loop/gather.ts` + `context-builder.ts` (injection order, packet accounting), the Settings section.

### P14.I1 implementation log — 2026-08-30

- Added one account-scoped `soul` capsule row with a shared 350-token/1,400-character policy enforced at writes and re-applied at injection.
- Capsule rebuilds now assemble strong permitted claims into generated soul text; a bounded user edit takes priority without destroying the generated fallback.
- Every user revision journals a normal claim, evidence row, and correction relation; resetting the edit supersedes its audit claim and restores the learned version.
- Soul audit claims are omitted from ordinary retrieval and context-capsule rebuilds so the always-present text is never duplicated against the packet budget.
- The soul is the first packet and orientation property, survives compact/hard packet shapes, and keeps the existing 28,000-character ceiling.
- Lightweight deterministic runs fetch the soul without loading workspace context; greetings use only a strict self-declared name phrase when one exists.
- Settings → Privacy now exposes “How Spectra knows you” through plain copy, an inline character budget, learned-version reset, and in-place refusal/save states.
- Evidence: focused Vitest 7 files / 54 tests; root `tsc --noEmit`; capability IR gate; secret scan; scoped ESLint with zero new warnings.
- No live deployment, browser profile, Bridge, Office, or visual lease was used; protected fidelity paths were untouched.
- Status: IMPLEMENTED; P14.V1 remains the independent phase verifier after P14.I1–I3. No acceptance claimed.

## P14.I2 — Self-authored skills (H)

The AI can create durable procedures for itself — below a level, always:

- New `userSkills` table: account-scoped; name, one-line purpose, trigger terms, markdown body; **hard caps enforced at the mutation** — body ≤ 4,000 chars, ≤ 40 skills per account, trigger metadata bounded. Versioned (edit = new version, previous retained for the audit trail); user-visible and deletable in Settings alongside the soul.
- Tools: `write_skill` (create/update, `always-confirm` authority the first time, `confirm` after), `list_skills` (metadata only — this is what plans see), `read_skill` (fetch one body). **Loading is lazy** (R27): metadata lines may join the orientation packet only within a small fixed budget; bodies enter context only on trigger match or explicit `read_skill` — mirroring `loadArtifactSkill` discipline.
- Capture rails: the forbidden-content rules (`captureRejectionReason` classes — secrets, credentials, sensitive personal data) apply to skill bodies verbatim; a skill that fails the rails is refused with the reason.
- **`public/skills/` migrate-or-delete (PROCESS §7):** the pedagogically real content (socratic-dialogue, spaced-repetition-optimizer, mermaid/diagram guidance, latex formatting) is converted to seeded system-scope skills loaded through the same lazy path; everything else — including `online/manifest.json` and its unwired trigger scheme — is deleted. No dormant parallel library survives this unit.
- Owns: `convex/userSkills.ts` (new), tool registrations, `loop/plan.ts` skill-injection seam, `public/skills/` disposition, Settings skills list.

### P14.I2 implementation log — 2026-08-31

- TRIAGE · SYSTEMIC: durable procedures existed only as an unwired public file tree; replaced it with one account-scoped, versioned `userSkills` path and deleted the parallel library.
- Enforced 40 active skills, 4,000 body characters, bounded names/purposes/triggers, retained superseded/deleted versions, and account ownership at the Convex boundary.
- Reused the memory capture rails so secrets, credentials, and sensitive personal data are refused with the shared plain-language reason.
- Added `list_skills`, `read_skill`, and confirmed `write_skill`; the first write is always-confirm and later writes remain confirm-only through the durable app-command authority path.
- Added a 1,200-character metadata view and trigger-only body activation capped at two skills / 4,800 characters; bodies remain available explicitly through `read_skill`.
- Migrated Socratic dialogue, spaced repetition, diagram guidance, and LaTeX formatting into lazy system skills; removed the entire dormant `public/skills/` tree.
- Added Settings loading, empty, error/retry, lazy inspection, and confirmed deletion states using incumbent Spectra components and tokens.
- Persisted bounded per-model skill context manifests in the existing run snapshot; unrelated runs record zero skill-body characters and zero estimated skill-body tokens without enlarging the context packet.
- Evidence: focused P14 Vitest 4 files / 11 tests plus full run-route 32/32; TypeScript, capability IR, scoped lint, diff, formatting, and secret gates pass.
- No live Convex, server, browser, Bridge, Office, secrets, soul injection, or P14.I3 capture/retrieval path was used or changed.
- Status: IMPLEMENTED; independent P14.V1 verification and Pablo acceptance remain required. No acceptance claimed.

## P14.I3 — Model-initiated capture + retrieval tiers (MT)

- Turn on the dormant `createdBy: "model"` path: during report/maintenance the model may propose memory claims (recurring workflows, corrections it observed, mistake-avoidance) — written through the same rails, marked model-authored in the audit, surfaced in the Settings memory view with one-tap forget. Silent-maintenance discipline holds: never a user-facing progress event (the existing validator already rejects memory titles).
- Retrieval tiers made real: initial packet keeps the current bounded shape; `retrieve_memory` `focused`/`deep` levels get distinct budgets and graph-hop depths instead of the current mostly-flat behavior; every deep retrieval logs a `memoryRetrievalEvents` row (already-existing audit) with token spend.
- Owns: `convex/memory.ts` capture/retrieval internals, report-stage hook in the run loop.

### P14.I3 implementation log — 2026-08-31

- Added a hidden model proposal channel capped at three entries, 600 proposition characters, and the three P14-owned durable categories.
- Report-stage capture queues through canonical `memoryJobs`; maintenance writes active inferred claims through `upsertClaim` with `createdBy: "model"` and normal evidence/capsule handling.
- Disabled, paused, category-blocked, oversize, transient, secret, sensitive, empty-reason, and tampered jobs are refused again at persistence; raw prompts are not copied into evidence previews.
- Settings → Privacy now lists server-filtered active model-authored items under “Things Spectra noticed” with loading, signed-out, empty, failure, and one-click Forget states.
- The final rebase keeps P10 Connections and P9 summary synchronization intact, groups soul, lazy skills, model-noticed items, and personal-context controls in Privacy, and routes skill-body screening through the same forbidden-content rail as memory capture.
- Initial retrieval keeps the existing broad bounded behavior; focused is capped at 1,500 tokens/one graph hop and deep at 4,000 tokens/three graph hops.
- Focused/deep exclude unrelated claims; prompt projections trim to their tier boundary. Every deep tool result requires a successful audit row with estimated and actual token spend.
- Audit-only candidate IDs stay out of the next model prompt, and over-budget retrieval audits are rejected.
- Evidence: composed P14 Vitest 15 files / 76 tests; root TypeScript; capability IR; secret scan; diff check; scoped ESLint with only five unchanged Settings warnings; static UI detector clean.
- No live deployment, browser/profile, Bridge, Office, real files, or protected fidelity path was used. Status: IMPLEMENTED; P14.V1 remains the independent verifier and no acceptance is claimed.

## P14.V1 — Memory verification (MT)

Fresh agent, local instance:

- **Budget proofs:** packet size ≤ 28k with soul + skills metadata present (asserted across representative surfaces); soul cap enforced at write and injection; skill caps refuse at the boundary with plain sentences.
- **Laziness proofs:** a skill body enters context only on trigger/read; unrelated runs show zero skill-body tokens (inspect context manifests).
- **Journeys (L3):** teach the AI a preference → visible in soul → honored in a later fresh run; ask it to "make a skill for how I like my flashcards" → skill exists, appears in Settings, activates on the next relevant run; forget/delete paths truly remove influence (adversarial re-ask).
- **Rails:** attempt to store a secret in soul/skill/claim → refused with the truthful reason; model-authored claims all carry provenance and are individually forgettable.

## Exit gate

Soul present in every run within its cap; self-authored skills working under enforced caps with lazy loading; `public/skills/` no longer exists as dormant content; capture rails hold under adversarial probes; V1 PASS; Pablo pass.
