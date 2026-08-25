# VERIFICATION — how truth is established

Nova's verification failed in a specific way: honest agents verified the layer they built, with perfect knowledge, at single checkpoints, and graded themselves. All four properties are reversed here. Verification has **layers** (L0–L5); every phase brief states which layers gate which units. "The feature can be demonstrated" and "a human can use this reliably" are different claims and are verified by different layers.

## L0 — The per-unit machine floor

Each owning unit runs the relevant checks; failing evidence is blocking for that unit. The full repository sweep is phase-gated after paired verification (CANON R9):

- typecheck, lint (`--max-warnings=0`), unit suite
- **fidelity harnesses** (`fidelity:docx`, `fidelity:office`) — run by the owning fidelity unit; their semantic digests are *asserted against expectations*, not merely recorded (TEST-1's circular readBack is retired)
- **seam contract tests** (L1, below) once they exist
- secret scan; schema-drift checks (Convex validators ↔ TS types via `z.infer` where introduced)
- design-token rule (warn → error per P6 schedule); bounded-read lint where mechanically checkable

## L1 — Composition seam contracts

The single highest-leverage addition. One canonical shape, per format and per seam:

```
fixture bytes → lens.open → artifact content (real office-content adapter)
  → Yjs adapter createDocument → project        (the REAL adapter, not a stub)
  → simulated editor mutation
  → route merge (the REAL contentProjection / contentToXlsx / contentToPptx)
  → lens.materialize → comparePackages(input, output)
     assert: only modeled parts changed; preservation entries byte-identical
  → lens.open(output)
     assert: region ids stable; semantic digest matches expectation
```

Rules: contract tests import **production modules** (routes export their logic; keep it that way), never hand-built projections. Every CRITICAL corruption family in the compendium gets a named contract test that fails on the old code (DOC-1 table round-trip, DOC-2 formatting round-trip, XLS-1 save path, XLS-3 deletion propagation, PPT-2 new-object survival). New capabilities (P2/P3) land *with* their seam test or they don't land (R7).

## L2 — Invariants, properties, chaos

For the truth engine and Bridge (Tier-R work):

- **Model-based state machine tests**: generate interleavings of {enqueue, claim, write, complete, external save, crash, restart, network loss, lock, revoke} and assert the invariants from ARCHITECTURE-TRUTH §4: no lying `current`, no state without an exit (R2), convergence after quiescence, idempotent replay.
- **Chaos runs**: kill mid-write and replay the journal; slow-writer ingestion (a file that takes 10s to copy must not yield a partial-bytes revision); lock storms; rename cascades; OneDrive placeholder mounts; clock skew. Dated reports belong to their verification unit.
- **3-way merge property tests** (P2): random edit pairs (Spectra-side, Word-side) over fixtures; assert merge correctness or precise conflict — never silent loss, never invented changes.

## L3 — Journey verification (the human-shaped layer)

Executed by verifier agents who receive **only**: the Reformation docs, a goal card, and a browser. No implementation knowledge, no file paths, no "click the third button". This is deliberate: the agent must experience the product the way a person does — not knowing where features live, what the app expects, or which state it is in.

**Goal cards** are written per phase (examples): *"You have a folder of last year's schoolwork on this PC. Get it into Spectra without changing anything. Then improve the conclusion of one essay and make sure the change is really in the Word file."* — *"Your teacher shared a deck with you. Study it, then make your own copy with three extra cards."* — *"Ask the AI to reorganize your Biology workspace. Confirm you can tell exactly what it did and undo one thing it did."*

**Protocol:** fresh profile or clean state where the card demands it; the agent narrates intent before each action; captures a numbered screenshot **sequence** at every meaningful step (including intermediate/streaming states); records console/network anomalies; and files findings with severity + a one-line "what a real user would feel here". The rubric grades four axes: task success, state honesty (did labels ever disagree with reality?), recoverability (when stuck, was there a door?), and feel (jank, confusion, dead ends).

**Adversarial variants:** each phase gate includes at least one card executed adversarially — mid-task network kill, external Word edit during the flow, double-clicking everything, closing at the worst moment, a second tab, wrong-target AI prompts with similar filenames.

## L4 — Budgets (CANON R10)

Numeric, checked by the owning unit and at phase gates (ARCHITECTURE-PLATFORM §4 holds the table): Convex bytes read per user action and per idle minute; requests + largest payload at first paint per surface; keystroke main-thread time at fixture densities (40-page doc, 200k-cell workbook, 120-slide deck); presence cost per remote cursor; Bridge steady-state churn (zero mutations on a quiet 10k-file mount).

## L5 — Pablo's pass

Ten minutes per phase, unscripted, on the real product. Historically the only control that caught what everything else missed; the layers below exist to make this pass boring. Findings land in STATE Field Notes and are triaged (R12) like any verifier finding.

## Finding format (all layers)

`[UNIT/PHASE] severity · surface · what happened · what a user would conclude · suspected class (LOCAL | SYSTEMIC: <class name>) · evidence path`. Findings are never closed by the person who triages them as LOCAL without a linked fix commit; SYSTEMIC findings open a class entry in the phase brief.

## Anti-theater rules (learned the hard way)

1. A test that cannot fail is not a test: every new contract/property test must be shown failing against the pre-fix code (or a mutated implementation) once, in its introduction commit message.
2. Product constants are never bent to satisfy test expectations; expectations are never widened to accept regressions (PPT-4's codified regression is the canonical counterexample). Test diffs in an implementation unit get read by the verifier **first**.
3. Digests, counts, and reports that are recorded must be *asserted*; write-only evidence is deleted.
4. Evidence directories are created by the run that cites them; an empty cited directory fails the unit (GOV-1).
5. Verifiers do not negotiate: findings are filed, not discussed away in-session.
