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
| `CANON.md` | Binding decisions: Nova D1–D44 inherited + Reformation R1–R16 | Every session, first |
| `STATE.md` | The living ledger: unit statuses, verifier verdicts, field notes | Every session, second |
| `PROCESS.md` | Roles, unit lifecycle, launch prompt template, difficulty routing, sub-agent policy | Every session, third |
| `VERIFICATION.md` | The verification methodology: layers, journey protocol, contract tests, budgets | Every verifier session; implementers skim §1–§2 |
| `PRODUCT.md` | What Spectra is, who it is for, the experience laws (toggles, plain words, invisible Bridge) | Any unit touching UX |
| `ARCHITECTURE-TRUTH.md` | Truth hierarchy, replica machine, Bridge engine, status system | P0, P1, P2, P8 |
| `ARCHITECTURE-FIDELITY.md` | Lens pipeline, one-schema rule, 3-way merge, identity, corpus | P2, P8 |
| `ARCHITECTURE-CAPABILITIES.md` | The typed operation IR — the actual protocol | P3, P4, P5 |
| `ARCHITECTURE-AI.md` | Agent loop, targeting, context, quality machinery, choreography | P4 |
| `ARCHITECTURE-PLATFORM.md` | Collaboration/hosting, Convex rules and budgets, frontend baseline | P0, P5, P6 |
| `phases/P0…P8.md` | Phase briefs: units, scope, gates, difficulty tags | The assigned phase |

## The phases

Dependency order. Within a phase, units marked parallel-safe may run concurrently; verification units are executed by **different agents** than the implementation they verify (PROCESS §2).

```
P0  Stop the Bleed & Build the Rails   contained critical fixes, Convex I/O P0, CI,
                                       design-system baseline, security quick wins,
                                       falsification experiments, honest baseline
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
P8  The Release Gate                   chaos + multiplayer finale, release verdict
                                       (N12 absorbed)
```

**Why this order.** Truth before fidelity (a correct merge over a lying replica state is still a lie). Fidelity before protocol (the IR maps to lens deltas; those must be real first). Protocol before AI (AI tools derive from the IR). AI before embeds (embeds consume the unified model). Coherence and identity after correctness. The finale is a gate, not a hope — and this time it cannot be postponed, because P8 *is* the release.

## Explicitly out of scope (deferred, not forgotten)

- **School assessment slice** — class-scoped quiz assignment, teacher grading queues, timetable→calendar retirement, ManageBac onboarding UX. Pablo's decision 2026-08-25. A future program owns it; do not let its absence rot (the calendar/planner/sharing surfaces this program *does* touch must not regress it).
- **Mobile** — sub-`md` layouts remain unsupported. Do not spend effort there; do not break desktop to pretend otherwise.
- **Additional connectors** (Google, Notion, Quizlet) — the IR and lens architecture must be built so a connector is an adapter, but no connector beyond Office/ManageBac is implemented in this program.
- **Local-model autocomplete** — cut from launch scope. The UX shell stays; the settings copy must stop implying a local model exists (finding AI-14).

## How Pablo runs this

1. Open `STATE.md` §0, find the lowest OPEN unit whose prerequisites are ACCEPTED.
2. Check its **difficulty tag** (Simple / Medium / Hard) and route it to the tool/model of your choice (PROCESS §4 explains what each tag demands).
3. Paste the launch prompt template (PROCESS §5) filled in with the unit ID.
4. When the implementer reports done, launch the paired **verification unit with a different agent** — never the same session, never the same context.
5. Accept only when the verifier's verdict is recorded in STATE. Your own ten-minute pass remains the final control; it caught what every automated layer missed last time.
6. Answer stop-and-ask items before relaunching. A pending question blocks the next unit.

Between units: commit. Never change branch. Keys rotation (STATE §5) is yours and blocks nothing except public exposure risk.
