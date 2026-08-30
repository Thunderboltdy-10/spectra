# Spectra Reformation — the program that makes Spectra production-real

**This directory supersedes `docs/spectra-nova/` as the operational source of truth for all Spectra work.**

Nova built enormous capability in four days and left a product that cannot be trusted. A 41-agent audit (`SPECTRA-ISSUE-COMPENDIUM.md`, repo root) and a nine-explorer architecture review established why: verification was aimed at layers while defects live in seams; sync truth was stamped optimistically with no compensation; the capability "protocol" was real for the human workbar and fictional for AI and native writes; and the same agent implemented, tested, graded, and edited the ledger, with nothing mechanical in between. The Reformation exists to fix the *classes*, not the 200 findings one by one.

## Trust hierarchy (absolute)

1. `docs/spectra-reformation/**` — operational truth. Work takes orders from here only.
2. `SPECTRA-ISSUE-COMPENDIUM.md` — the finding record / risk register. Evidence, not remedies. Phases reference its finding IDs; a phase is not done while its assigned finding families remain open or unexplained.
3. `docs/spectra-nova/CANON.md` (D1–D44) — product decisions remain binding, incorporated by reference into `CANON.md` here with explicit amendments. Everything else in `docs/spectra-nova/**` is reference/history; **all Nova STATE completion claims are void** and require re-verification.
4. `docs/spectra-hq/**`, `docs/spectra-definitive/**`, `docs/spectra-rebuild/**`, `docs/spectra-landing/**` — archaeology only. `SPECTRA_LANDING_ULTIMATE_IMPLEMENTATION_PROMPT.md` remains design-intent input for P7.

If two documents disagree, the higher one wins. If a Reformation document seems wrong in the field, **stop and ask Pablo** — asking is cheap, silent deviation is what got us here.

## The files

| File | What it is | Read when |
|---|---|---|
| `CANON.md` | Binding decisions: Nova D1–D44 inherited + Reformation R1–R27 | Every session, first |
| `STATE.md` | The living ledger: unit statuses, verifier verdicts, field notes | Every session, second |
| `PROCESS.md` | Roles, unit lifecycle, launch prompt template, difficulty routing, sub-agent policy | Every session, third |
| `EXPANSION.md` | The expansion program (P9–P15): connector matrix, orchestration v2, the board, ownership matrix | Every orchestrator session; any P9–P15 unit |
| `ORCHESTRATION.md` | Retired campaign record; §8 still documents the real-corpus protocol; its §5–§6 caps are superseded by EXPANSION §3 | §8 for corpus gates; otherwise archive |
| `VERIFICATION.md` | The verification methodology: layers, journey protocol, contract tests, budgets | Every verifier session; implementers skim §1–§2 |
| `PRODUCT.md` | What Spectra is, who it is for, the experience laws (toggles, plain words, invisible Bridge) | Any unit touching UX |
| `ARCHITECTURE-TRUTH.md` | Truth hierarchy, replica machine, Bridge engine, status system | P0, P1, P2, P8 |
| `ARCHITECTURE-FIDELITY.md` | Lens pipeline, one-schema rule, 3-way merge, identity, corpus | P2, P8 |
| `ARCHITECTURE-CAPABILITIES.md` | The typed operation IR — the actual protocol | P3, P4, P5 |
| `ARCHITECTURE-AI.md` | Agent loop, targeting, context, quality machinery, choreography | P4 |
| `ARCHITECTURE-PLATFORM.md` | Collaboration/hosting, Convex rules and budgets, frontend baseline | P0, P5, P6 |
| `phases/P0…P8.md` | Phase briefs: units, scope, gates, difficulty tags | The assigned phase |

## The phases

Dependency order. Units now run serially in the primary checkout; verification units are executed by **different agents** than the implementation they verify (PROCESS §2).

```
P0  Stop the Bleed & Build the Rails   contained critical fixes, Convex I/O P0,
                                       security quick wins, repo hygiene, design
                                       baseline, falsification experiments,
                                       honest baseline
P1  The Truth Engine                   bytes-canonical replica machine, journal-first
                                       Bridge, one status presenter, sync-as-toggles
P2  Fidelity at Full Surface           one schema per format, 3-way merge, stable
                                       identity, full-surface native writes, corpus
P3  The Capability Protocol            typed operation IR; UI/AI/lens/choreography derive
P4  The AI Plane                       agent loop, targeting, workspace context, honest
                                       execution, quality machinery, choreography
P5  Collaboration & Embeds             render architecture, gateway productionization,
                                       embeds convergence (N9 absorbed)
P6  Coherence                          UX debt closure, design-system adoption sweep,
                                       whole-product convergence audit (N10 absorbed)
P7  Identity & Landing                 field, motion grammar, landing reveal (N11 absorbed)

—— Expansion (CANON R21; briefs + board in EXPANSION.md) ——
P9  Local Foundation & Convex Efficiency  local-first deployments, bandwidth classes
                                          fixed, seeded superadmin + TGC admin
P10 The Connector Protocol                connections model, three families, replica
                                          generalization, lens registry, refit gate
P11 The Connector Fleet                   Google Workspace, calendars, Notion,
                                          Quizlet/Anki, Markdown/CSV/PDF
P12 Artifact Depth                        every type to Office-trio depth, by
                                          named-leader inventory
P13 School Intelligence                   ManageBac API capture, class selection,
                                          homework→plan pipeline, CAS
P14 Memory & Soul                         soul capsule, self-authored skills, capture
P15 Experience                            onboarding journey, Connections hub, UX sweep

P8  The Release Gate                   runs LAST for the expanded program: chaos +
                                       multiplayer finale, RC.V2 corpus, release
                                       verdict (N12 absorbed; see brief addendum)
```

**Why this order.** Truth before fidelity (a correct merge over a lying replica machine is still a lie). Fidelity before protocol (the IR maps to lens deltas; those must be real first). Protocol before AI (AI tools derive from the IR). AI before embeds (embeds consume the unified model). Coherence and identity after correctness. For the expansion: foundation before fan-out (testing must be free and parallel before agents multiply), connector protocol before connectors (an adapter on ungeneralized seams is a fork), and depth/school/memory as independent parallel tracks (EXPANSION §4 is the dependency truth). The finale is a gate, not a hope — and this time it cannot be postponed, because P8 *is* the release.

## Explicitly out of scope (deferred, not forgotten)

- **School assessment slice** — class-scoped quiz assignment and teacher grading queues remain deferred (Pablo 2026-08-25). **P13 explicitly absorbs** the ManageBac onboarding UX and the timetable→calendar unification pieces (CANON R21); the rest stays a future program's and must not rot.
- **Mobile** — sub-`md` layouts remain unsupported. Do not spend effort there; do not break desktop to pretend otherwise.
- **Tier-2 connectors** — OneDrive/SharePoint Graph, Todoist, Google Tasks, GitHub, Google Classroom, Canvas/Moodle/PowerSchool, Kahoot, Excalidraw/Miro (EXPANSION §2). Tier-1 connectors are **in scope** via P10/P11 (CANON R21 lifted the old clause).
- **Local-model autocomplete** — cut from launch scope. The UX shell stays; the settings copy must stop implying a local model exists (finding AI-14).

## How this runs now (orchestrated v2 — CANON R22)

A standing orchestrator routes, launches, merges, and records delegated acceptances; Pablo answers only QUESTIONS.md items and signs the release. The operating manual for concurrency, leases, the merge queue, verifier cadence, and the dependency board is **EXPANSION §3–§4**. The essentials:

1. The current track (RC.V1 → P5.V1 → P6.V1 → P7) continues under its existing briefs and remains the most senior work.
2. Implementation units run as **parallel fire-and-forget worktree agents** — no numeric cap; bounded by the ownership matrix (EXPANSION §5), leases (EXPANSION §3.3), and the serial merge queue with its standing merge gate (EXPANSION §3.2).
3. Verification is phase-scoped per the briefs. Every VU is a fresh agent with no implementer context (R8). From P9.V1 onward, VUs run on isolated **local deployments** (R23) and may run concurrently on separate instances — and in parallel with builds in other worktrees.
4. Acceptance: VU PASS + recorded evidence → `ACCEPTED (orchestrator, delegated)` (R18/R22). Pablo's L5 passes are requested per phase gate, non-blocking.
5. Stop-and-ask goes to `orchestration/QUESTIONS.md` under the R18 carve-outs; a queued question never blocks other tracks.

Between merges: `main` stays clean and green on the merge gate. Keys rotation (STATE §5) is Pablo's and blocks nothing except public exposure risk.
