# S9-EDGE — reviewed source findings and implementation boundary

Date: 2026-09-24. Primary baseline: `eac1567b`, plus newer S9-AI edits on `main` as they arrive. This is a **reviewed implementation plan**, not acceptance evidence. The original source-only census is in `reports/S10-EDGE-COVERAGE.md`, the short leads in `reports/S10-EDGE-LEDGER.md`, and detailed proposals in `reports/S10-EDGE-IMPLEMENTATION-HANDOFF.md`. Those files came from the separate Cursor checkout and are preserved as evidence; this document governs implementation on primary. Their instructions to use an isolated checkout or avoid implementation applied to that earlier audit, not this user-authorized S9 task.

## Assessment of the audit

The E01–E80 explorer assignments were reported done, with concrete source paths and many plausible defects. That is broad **source coverage**, not proof of every failure or of live behavior. In the copied coverage snapshot E81–E97 were still marked running and E98–E130 queued. Their findings must be incorporated only when returned and independently checked; do not describe that second wave as complete. The ledger's `proven-defect` label means source-traced in the audit, not independently reproduced against the latest primary checkout. The new owner must verify each claim against current source before changing it.

Most high-priority findings concern real correctness boundaries: false completed/saved/readiness messages; capped lists mistaken for absence; stale authority; partial edits that drop unrelated content; retention/replay; and state changing after revocation. Implement the smallest coherent repair, document the failure scenario and its direct neighbor, and identify the regression that should later be run. This S9-EDGE request authorizes implementation and source review; it does not request adding or running tests. Do not sweep all tickets into one patch or treat historical source tests as live acceptance.

## Ownership and decisions

### Implement in S9-EDGE after confirming current source

These non-AI P1 tickets have concrete failure paths and a defensible outcome. Work by flow, not numerical order:

- **Authority and identity:** P1-01, P1-02, P1-04, P1-09, P1-29. Repair stale or cross-school authority at the authoritative mutation/read boundary. P1-01 must not remap an email to another account. P1-02 must revoke school-scoped grants without touching another school.
- **Human commands and truthful UI outcomes:** P1-05 (human dispatcher and document/comment handlers only), P1-06 (human K-bar targeting, with current context re-read at execute), P1-22, P1-24, P1-34, P1-37, P1-43, P1-48, P1-49, P1-50, P1-51, P1-53. Never infer an effect from a listener count or `undefined`; preserve the user's draft or dialog on failure.
- **School, planner and Library integrity:** P1-10, P1-11, P1-12, P1-14, P1-15, P1-16, P1-19, P1-20, P1-21, P1-41. Make missing data, source-owned fields and time zones explicit. An empty class selection after a failed load must never become a destructive save.
- **Editor, Office and native correctness:** P1-18, P1-23, P1-30, P1-31, P1-33, P1-38, P1-42. Preserve neighboring deck/document content and native package parts. A user-triggered export must include the intended saved or explicitly dirty snapshot; if save fails, show failure before download.
- **Durability and collaboration:** P1-25, P1-26, P1-28, P1-36. The permission check at append/persist must be fresh, and a failed local restore must not silently become an empty durable room. If these paths are being changed by a resumed S10 lane, coordinate ownership before editing.

These are authorizations to investigate and implement, not an instruction to assume every suggested patch is correct. Record the exact code revision and source-level failure path. Prefer a bounded repair over a general refactor.

### Reframe or decide a product rule first

- **P1-03, existing-member invitation:** Do **not** silently upgrade a role merely because a token is accepted. Prefer a typed refusal leaving the invitation pending, with an explicit administrator role-change path. Implement a role update only if the existing product contract clearly defines a new invite as that authority.
- **P1-07/P1-47, AI capability matrix:** S9-AI owns the AI/tool-policy decision. The human setup command can be reconciled independently, but keep Bridge pairing/grant consent human-only and ManageBac resource import human-only. Do not widen AI authority to make a matrix green.
- **P1-08, workspace forever-delete:** The ignored `remaining` result is a genuine lead. Do **not** loop over every child inside one Convex mutation. Design a bounded, resumable continuation/job that deletes the workspace row only when the remaining count reaches zero; cover 0, 20, 21 and retry cases.
- **P1-13, academic-period identity:** Prove the intended source key and migration behavior before changing it. Never rewrite existing projection identities or duplicate a period because a string key changed.
- **P1-17, import status:** Trace the actual route/job transition and callers first. Return `awaiting_commit` or deferred when true; do not rename a terminal status without updating consumers.
- **P1-27, public share revocation:** The server must deny immediately. A mounted client can show an already-loaded projection until its next refresh; treat this as a cache/UX window, not proof that a revoked link still authorizes new reads. Clear on the first 404 and decide whether a shorter poll is justified.
- **P1-32, Library move versus Bridge `relativePath`: REJECT the proposed automatic local rename.** A Bridge path is an explicitly selected filesystem target and Library organization can intentionally differ. Moving an org node must not silently move an original or working copy. Only repair if a specific policy explicitly mirrors paths, with consent, conflict checks and a new native receipt.
- **P1-35, duplicate folder semantics: REJECT silent reuse as a universal human rule.** A deliberate new folder may share a title. The AI's current reuse heuristic may itself be wrong. Align action wording and explicit create/reuse intent after the S9-AI owner chooses the AI rule; do not make the human path silently select an existing folder.
- **P1-52, actor cache:** A cached school id is suspicious, but clearing only after a `fresh` read does not solve a cache hit. Check whether each sensitive route has an independent fresh Convex authority check. Require fresh identity at school-scoped route boundaries that otherwise trust the cached role; preserve caching where it cannot authorize a write.
- **P1-54, membership cleanup:** Immediate revocation of authority and pending invitations is high priority. Do not scan/purge all pins, notifications and class selections in one unbounded membership mutation. Define retained user preference behavior on rejoin, and use bounded cleanup only for state that must not survive. Keep other-school data intact.

### S9-AI owns these findings

Send the AI owner P1-39, P1-40, P1-44–P1-47, P1-55–P1-57, P2-09–P2-11, P2-26, P2-37, P2-48 and P2-57, plus the AI halves of P1-05–P1-07, P1-35–P1-36, and P2-46. This includes run/attempt truth, approval/partial cards, capability policy, ManageBac AI readback, whiteboard/document patch fidelity, Stop/steer and Follow. The new S9-EDGE agent must not edit `src/app/api/spectra/run/loop/**`, AI application writes, AI patch/verify helpers, AI policy/tool registry, run/dock status logic, or files currently changed by S9-AI. Read them to understand contracts and document a proposal for its owner. A non-AI caller may be fixed without editing its AI implementation.

### P2 triage

P2 entries are secondary to a connected P1 and require current-source reproduction. Strong direct-neighbor candidates for S9-EDGE: P2-01–P2-08, P2-12–P2-22, P2-28–P2-33, P2-35–P2-36, P2-38, P2-40–P2-45, P2-47, P2-49–P2-56, excluding AI-owned parts above. Keep them in the ledger until addressed or explicitly deferred. P2-43 school-purge ownership and P2-45 deployed permission epoch deserve security priority. P2-44 duplicate asset ownership requires a retention model, not a blind asset deep-copy.

Conditional or lower-value proposals:

- **P2-23/24:** Reader URL lifetime and snapshot refcount need the actual storage/grace semantics; do not promise a long-lived lease or purge by an unproven counter.
- **P2-25:** Preference revisions/account switch are valid leads; coordinate with P1-36 before adding another store.
- **P2-27:** `prebuild` need not run the entire product suite. Fix a false-ready probe if reproduced, but do not turn a fast gate into an unbounded test command.
- **P2-34:** Failed and retried model tokens are real spend. Do not remove them from a “tokens used” metric; label completed-work and spend metrics separately if needed.
- **P2-39:** The ManageBac credential *use* role is a product policy question. Prove its intended member/admin boundary before tightening it; status/read of raw secret material remains protected.
- **P2-49:** HTTP 200 with a JSON `not_ready` body may be a deliberate health contract. Fix consumers that ignore the body first; change the status code only after checking callers.
- **P2-54/55:** Font substitution notice and unused study timer are lower priority cleanup; delete only after checking imports and intended launch scope.

## Implementation order and handoff

1. Ship coherent truth/authority repairs that make unsafe or misleading outcomes impossible: school grants/member end, failed class load, K-bar no-op, capped deep link, failed search, editor hydration/dirty export, collaboration restore and fresh persist authorization. Do not combine all areas in one commit.
2. Repair source-owned/academic/native content loss: planner resync, bibliography and slide add/remove, Word/sheet neighbors, reminder updates, embed removal and readable saved status.
3. Work through remaining confirmed P1 and connected P2, document unresolved product choices and live validation needs. Avoid performance sweeps, provider changes, broad Office parity, or a second action/sync engine.

The implementation task uses the current shared `main` checkout, no worktree or branch, with S9-AI active. Coordinate touched files before edits and never stage/commit the other task's work. S9-EDGE owns non-AI fixes only. Update `reports/S9-EDGE.md` with ticket disposition, exact files, source-level failure path, proposed deterministic regressions, direct neighbors, any runtime effect that still needs live acceptance, and changes to tell the paused S10 owners when they resume. The latest report must distinguish fixed, rejected/reframed, AI-owned, and still open. A large ledger is not itself completion.
