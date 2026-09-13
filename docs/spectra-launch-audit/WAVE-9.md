# W9 — consolidate the gains and close the remaining functional gaps

Parent review: 2026-09-14. This supersedes W8 dispatch instructions. The parent read all seven new reports: W8-01, the original W8-02, S8-OFFICE, V8-01, V8-02, V8-03 and V8-04; inspected the consequential non-UI changes; and recovered the original Word report which V8-02 had overwritten. Historical report claims remain attributed to their tested source.

## What improved

| Area | Delivered evidence | Remaining limit |
|---|---|---|
| Convex cost | W8 compact artifact/revision/tab/card models landed; actual local migration covered 1,686 artifacts, 47 tabs and 75 cards. Exact choice identities now survive projection. Authenticated Library/share/run smoke passed. | Fixture byte sizes and response sizes are not database I/O or dollar savings. Calendar still reads entire collections of canonical plans/timetables; run heartbeats still load compact tabs/cards unnecessarily. |
| Office package fidelity | S8 repaired unsigned axis IDs, real ChartEx histograms, combo identity, DOCX paragraph IDs and PPTX schema order. Independent Microsoft SDK validation plus installed Word/Excel/PowerPoint save/readback passed its finite corpus. | **Those S8 changes are still private, absent from the current primary checkout.** Later green tests did not include that source. |
| Word intake and retention | Stream byte/digest attestation, durable imported images, reload hydration, pinned-image ownership after source deletion, scheduled deletion and runtime-safe cursors improved. | The padded >4 MB fixture accepted by Spectra was subsequently rejected by Word. It proves transport handling, not a valid native export. Large projection compaction also introduces an unintended-write seam described below. |
| Educational AI | Live provider calls now have saved evidence. The guide used the supplied values correctly; vague continuation and exact-choice continuation saved real edits. Approval/heartbeat races, duplicate execution marking and preflight failure reporting were repaired. | The deck has a placeholder instead of numeric chart data; source attribution is a general source line, not passage-level research evidence. Some new completion and targeting shortcuts fail to express multi-step intent. |
| School planning | Selected-only provider requests, selection fencing, lease reclaim, stable official deadlines/personal blocks, keep/archive/reselect and completion received local evidence. | V8-01 remains partial: no ordinary-student auth/invite proof, no on-demand provider-resource import; pointer drag and personal-note preservation were not proved. Existing-account local student configuration remains authorized. |
| Bridge | Real 490-file discovery/retry, queueing a repair scan without request timeout, Windows Office observations on authorized copies, formula/equation/media preservation. | Dense 200k-cell collaboration reconnects; actual Sheets-to-PowerPoint refresh/pin/revoke journey and browser Word download remain unproved. Opening files in Office is narrower than proving a complete Spectra-to-native save. Mac remains untested. |

## Source and review findings

Primary HEAD at review was `59df8fc1`, with substantial uncommitted V8-03/V8-04 source and reports. Preserve these changes. V8-03 product commit `05d9d6e0` exists privately on top of that head; its product was mostly copied into primary, but primary lacks 200 lines across five regression files, including the new intake test. Primary also has small later differences in plan/target tests which must not be overwritten. Its final report commit is `e2e4eb39`.

S8 branch `codex/s8-office`, worktree `4bd6`, contains W8 Word `80c60c4f` (original `a6b07c81`), report `6b6df7b4`, native fixes `e5638ba1`, presentation performance `40adb3d3`. Current primary `xlsx-native.ts` still has `axId("-1000000001")` and legacy-namespace `histogramChart`; the independent validator scripts are absent. This is missing integration, not a new chart implementation task.

The meaningful parent findings are:

1. **Compaction creates native edits without user changes — reproduced.** Passing a paragraph with supported `x+1` OMML through `compactDocxProjectionForStorage` and then `docxProjectionFromContent(compact, original)` yields `replace-paragraph`, despite unchanged authored content. `docxOperationsBetween` compares raw inline JSON including preservation metadata. The lens then regenerates OMML because compaction removed its carry metadata. Fix semantic comparison and recovery from the exact bound native base; do not simply suppress all rich-inline changes. Test a neighboring edit, table cell, equation layout, stale base and unsupported OMML.
2. **One successful action can end a larger AI request — source finding.** `plan.ts:isCompleteAfterTool` returns completion for Calendar operations, navigation, Bridge setup and reference handoff without checking outstanding user work. A request to schedule two items, navigate then edit, or insert a reference then summarize can stop after the first step. Restore whole-request completion using existing plan/operation identities and bounded recovery.
3. **New targeting rules can overrule valid intent — source finding.** `promptRequestsCalendarAction` accepts any scheduling verb plus even an ordinary number (e.g. slide 2). `assertCalendarActionContract` rejects every planner update in a Calendar request, including legitimate update-then-schedule. `resolveWorkspaceMention` treats a source workspace mention as a destination and rewrites every create/add destination. Explicit target evidence must distinguish source, destination, current context and the selected clarification. Exact accessible IDs prove access, not the user's intent. Regexes may be hints, never authoritative substitutes for that distinction.
4. **Operation rewriting can invalidate dependency indexes — source concern requiring regression.** `parseSpectraPlan` drops repeated ManageBac refresh operations; Calendar repair in `plan.ts` drops redundant creates. Neither visibly remaps all later `@created:N` dependencies. Use stable graph identities or one verified remapping step for every consumer.
5. **Application execution remains split.** Legacy Calendar commands in `act.ts` bypass the common registered-command dispatch; Calendar also executes in `executeAgentReadTool`. Reference insertion emits an event and returns `needs-ui`; the browser invokes `commandAsync(...).catch(() => undefined)` without a durable result back to the run. Do not count dispatch, UI readiness, consent, canonical persistence and native verification as the same completion state. Reuse the W7 awaited command/readiness work, and preserve explicit-navigation versus Follow semantics.
6. **Cost and scalability share a payload problem.** `shared/sheet-cells.ts` chunks an array inside one value; it does not partition the Convex document or reduce total bytes. Gateway checks a 760 KiB update and 900,000-character projection; a compact DOCX projection near 848 KB can still be paired with a large update/base/fidelity payload or grow again on checkpoint. A per-route compactor cannot establish end-to-end capacity. Trace transport bytes, persisted values, full projections, replay and active subscriptions together. Keep existing providers; no automatic hosting migration.
7. **Calendar context is smaller but not bounded at its source.** `calendar:overview` collects all active items, all canonical planner/timetable artifacts and external projections before filtering a range. `compactCalendarForAgent` leaves scheduled blocks/partial-time rows unbounded. Provide paged indexed metadata and targeted cross-range discovery without truncating away the requested target. Run triggers should compare old/new compact projections before querying dependent rows on a heartbeat.
8. **Evidence needs a precise finish.** V8-03 reports a 13:00–14:00 request with a 14:00–15:00 result; the report does not explain whether steering/timezone conversion accounts for it. Verify the intended wall time and IANA zone instead of treating status=completed as enough. Follow/stop screenshots do not alone prove an in-flight steering instruction changed saved output. The V8-04 normal-file opens do not cover its outstanding linked-chart or Word-download outcomes.

The parent executed the DOCX no-op reproduction successfully. Standalone imports for additional resolver probes were blocked by Next/server-only module loading; the targeting findings above are source review, not claimed runtime reproductions. No runtime startup, provider test, UI redesign or production action was performed by the parent.

## Architectural decisions

- Keep the artifact/Yjs/ledger/lens/Bridge protocol. Strengthen its boundaries instead of adding another AI or native editing engine.
- Separate request completion from action success. Recover missing work using saved receipts and remaining obligations; do not blindly retry committed mutations or run forever.
- Use compact metadata for discovery; hydrate authoritative content only when needed. Large state must use bounded durable storage/transport supported by the existing provider, retaining permission and ownership checks.
- Treat the educational result as the deliverable: editable numeric charts, accurate units, grounded claims and usable saved outputs. Structural nonemptiness is insufficient.
- The user chose **both academic Word families in one dedicated task**: footnotes/endnotes and citations/bibliography, together with comments and tracked changes. This is separate from the reliability fixes. Native and Spectra annotation identities must remain distinguishable; imported authors are not granted Spectra access.
- Preserve the existing visual system. No cosmetic launch gate, landing-page work, admin redesign or Notion connection.

## Dispatch and sequence

Three Luna xhigh tasks run now. Only W9-00 touches primary; the others implement privately from `05d9d6e0` and do not use localhost.

1. W9-00 consolidates all completed source/tests/reports into primary and fixes the reproduced Word compaction/no-op seam.
2. W9-01 implements authorized, on-demand ManageBac resource import and the reversible local student rehearsal support.
3. W9-02 bounds Calendar reads and removes unnecessary heartbeat projection work with measured read/write evidence.

After all three finish, use RUN-NEXT-W9.md. Manual sequence: V9-00 Luna integration/student/cost acceptance; S9-DURABLE stronger large-file durability; S9-OFFICE stronger academic Word editing; S9-AI stronger complete intent/output; V9-NATIVE Luna the two remaining actual native journeys. Each implementation validates its own changed boundary and a direct neighbor. The final native task is finite, not a global re-audit.

These three stronger tasks have distinct responsibilities and run sequentially. If one returns a material incomplete dependency, resolve that dependency before moving to a dependent task; don't re-label an incomplete result as accepted.

## What still lies beyond this batch

Friend-Mac install/pair/edit/reconnect on the actual candidate; public desktop distribution/signing and hosted configuration; actual cost evidence sufficient for a hosting/storage discussion. No Actions run, purchase, provider migration or production deployment is authorized now. Advanced Office features outside the chosen academic/implemented spreadsheet/presentation lanes still need truthful capability boundaries. This is real progress toward launch, not a claim of complete Office parity or a guaranteed final wave.
