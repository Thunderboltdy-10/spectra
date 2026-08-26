# SPECTRA CANON — Reformation edition

**Binding. Short on purpose. If any instruction anywhere conflicts with this document, this document wins. If the canon itself seems wrong in the field, stop and ask Pablo — never silently deviate.**

## 0. Relationship to prior canons

Decisions **D1–D44** (`docs/spectra-nova/CANON.md`, incorporating HQ D1–D23) remain fully binding, with these amendments:

- **D33 (superseded by R6).** The command registry is no longer the protocol itself; it becomes the human-UI projection of the operation IR. The *intent* of D33 — one shared language for humans and AI — is preserved and finally made real.
- **D37 (amended).** The "permissive mode" opt-in is **excised for launch**. It was never wired (finding AI-6) and its semantics were degenerate. Authority policy ships with one mode; permissive returns, if ever, as a designed feature.
- **D26 (extended by R2).** Truthful states are now a mechanical property, not a discipline: no state may exist without a compensating exit.
- **D42 (extended by R10).** Bounded reads now carry numeric budgets checked by the owning unit and at phase gates.

## 1. New binding decisions (R1–R17)

### Truth

- **R1. Bytes are canonical for linked work.** For any artifact backed by a native file, the byte payload at a known revision (SHA-256) is the single synchronization truth. The semantic projection (Yjs/`artifact.content`) is a **derived view** with explicit promotion gates: a semantic edit becomes truth only when materialized into bytes and verified; external bytes become the semantic view only through reconciliation against a **stored base**. No component may treat the semantic view and the bytes as interchangeably authoritative. For Spectra-native artifacts (no linked file), the Yjs document is truth and Convex holds its durable projection.
- **R2. Every state has a mechanical exit.** Any state a replica, write request, transition, run, or conflict can enter must have a compensating path out that does not require luck, reinstallation, or manual database surgery: verified completion, explicit failure with a truthful label, or a sweeper that re-drives or expires it. Optimistic terminal stamps ("current" before the write happened) are forbidden. A state machine change is not reviewable without its compensation table.
- **R3. Identity or refusal.** Write operations target native regions only through stable identities (`w14:paraId`, `p:cNvPr`, cell addresses, part names). Positional/enumeration-order fallback is forbidden for writes: when a stable identity cannot be established, the operation is refused with a truthful reason, never guessed.
- **R4. Diff–write symmetry.** The system may only write what its diff can see. If materialize can emit formatting, `diffExternal` must detect formatting changes. Any write capability added without corresponding diff visibility is a corruption vector and fails review.

### Protocol

- **R5. One schema per format, end to end.** For each artifact format there is exactly one projection schema that flows editor → transport → route → lens. Hand-mirrored copies (adapter unions, route Zod twins, duplicate `blocksFromJson`) are defects. Where an editor needs a richer model, the projection is derived from it by one typed, tested transform — never a second hand-written parallel.
- **R6. The operation IR is the single capability source.** Every capability is defined once as a typed operation (params schema, availability, native-region touches, lens delta mapping, AI exposure, choreography primitive). The workbar renders it; AI tools derive from it; strict-native gating derives from it; ghost capabilities (an enabled operation with no real write path) **fail the build**, not a review.
- **R7. Full surface, honestly.** The product does not shrink its editing ambition (Pablo's decision 2026-08-25): every capability currently offered on mounted files must become provably safe (R3, R4, seam contract test) — or visibly refuse with a plain-language reason until it is. Silent no-ops and ghost controls are the forbidden third option.

### Process

- **R8. The implementer never accepts its own work.** Acceptance requires a verification unit executed by a different agent in a different session with no shared context beyond the Reformation docs. STATE rows carry both signatures. The verifier may repair product code during that VU (R17); they still do not mark ACCEPTED. Tests altered by an implementer to pass (constants bent, assertions weakened, gates deleted) are treated as data corruption of the evidence system.
- **R9. Per-unit evidence is canon.** A rule that is not exercised by the owning unit or a phase gate is advisory. Relevant tests, fidelity harnesses, seam contract tests, secret scans, token rules, and budgets are run and recorded with the unit that owns them. This program has no automated test lane; the entire repository sweep happens only after paired verification. Bridge compilation may be added later as a separate gate.
- **R10. Budgets are gates.** Convex I/O per user action, first-paint request count and largest payload per surface, keystroke main-thread cost, and presence render cost carry numeric budgets (ARCHITECTURE-PLATFORM §4). Exceeding a budget is a defect now, not at scale.
- **R11. Sequences are the unit of verification for sync and fidelity.** Edit → external save → reopen; offline → edit → reconnect; queue → crash → replay; concurrent edits both sides. Single-checkpoint evidence (one screenshot of one state) cannot verify any Tier-R claim.
- **R12. Findings are triaged before they are fixed.** Every verifier finding is classified **local** (isolated defect) or **systemic** (evidence of a class) before anyone patches it. Systemic findings escalate to the phase brief owner and close only with the class. The agent who patches — implementer or verifier — must close the class, not the symptom screenshot. Making the symptom's screenshot pass is not a fix.

### Experience

- **R13. Plain words.** No machine token, enum value, or internal vocabulary ever reaches a user surface (`LOCAL_REPLICA_UNAVAILABLE`, `mirror-from-disk`, "replica"). Every user-facing state and error is a short human sentence that says what is true and what the user can do. One shared humanizer; per-surface bespoke error text is a defect.
- **R14. Sync is a toggle, not a configuration.** Users see simple switches ("Keep on this computer", "Keep in Spectra", "Both — recommended") with one-line consequences. The four-strategy engine remains underneath, mapped and truthful, but never exposed as jargon. Defaults must be safe enough that a user who never opens settings is never punished.
- **R15. The Bridge is invisible when healthy and optional always.** A user with the Bridge running should never think about it: no churn, no storms, no mystery states. A user without it gets the full non-local product with honest "this file lives on your PC — connect this device to open it" messaging. The Bridge never requires reinstallation to recover; recovery is a product behavior, not a support procedure.
- **R16. Show state, don't narrate it.** Prefer visual, in-place feedback (state on the thing itself: a chip on the file row, a fill on the save indicator, motion on the change) over stacked toasts, modal chains, and paragraphs. Text explains; it does not substitute for the surface telling the truth at a glance.

### Process (amended 2026-08-26)

- **R17. A verifier may repair product code during a VU, class-wide.** After triage (R12), the verifier inspects blast radius and applies the class everywhere it lives, then retests the remaining journey or contract. They do **not** apply the smallest local patch that greens the current card. They **do** stop and leave a paste-ready prompt for another agent when the finding is genuinely too complex to hold in this session — spanning multiple independent architectural seams they cannot close together, or a class they do not yet understand well enough to patch safely. Touching more than one file is not, by itself, a handoff. A later unit's owned class is a Field Note, not a start of that unit. Pablo 2026-08-26.

## 2. How Spectra must feel (unchanged, plus one line)

Immediate. Calm. Honest. Alive, not busy. One product. Trustworthy with other people's file formats. **And now: boring in the best way — nothing surprising ever happens to a user's data or their understanding of what the app is doing.**
