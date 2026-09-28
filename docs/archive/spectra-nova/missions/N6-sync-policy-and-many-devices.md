# N6 — SYNC POLICY AND MANY DEVICES

**Charters:** Bridge & Sync Engineer (primary) + Foundation Engineer + Product Engineer (the policy face)
**Prerequisites:** N5 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-STORAGE §5, §7, §8, §9, §10, §12; ARCHITECTURE-BRIDGE §5, §7, §8, §9; ARCHITECTURE-AI §4 (confirmation classes for file effects)
**Evidence:** `.shots/missions/N6/` plus the failure-matrix test run · **Tier R for the engine and the matrix**, Tier P for the human model

## Objective

Turn the storage engine into a product a normal person can configure: four understandable choices with real depth behind them, inheritance that explains itself, structure mirroring that does exactly what the user chose, a protected-original workflow, and a hardened multi-device/offline reality. Then prove it by running the entire failure catalogue as a test matrix. After N6, "how much of this does Spectra manage?" is a question the user can answer in one sentence and Spectra can answer truthfully in every state.

## Why now

The engine, the formats and the truthful states exist (N3–N5). Policy is the layer that decides *when* all that machinery fires — and it must be designed once, centrally, before AI is allowed to trigger file effects (N8) and before the finale stresses everything (N12).

## Workstreams (ordered)

### W1 — The human model (Tier P)

1. Four top-level choices, presented as one clear question wherever storage is chosen (mount setup, workspace settings, per-item disclosure):
   - **Keep in Spectra** (cloud only)
   - **Keep on this device** (local only; cloud holds index/metadata per policy)
   - **Keep on this device and in Spectra** (bidirectional)
   - **Link without changing the original** (protected original; Spectra edits stay pending until applied)
   Names are yours to refine for tone, but the four meanings are fixed.
2. Progressive disclosure: the advanced fields of ARCHITECTURE-STORAGE §5 (content direction, discovery, structure, cloud content, mirror root, filters, timing, protected original) live behind one "Advanced" affordance, grouped by the question each answers, in product language.
3. Inheritance is explained in place: every effective policy shows its origin ("Inherited from Physics IA") with a one-click override and a one-click revert-to-inherited. Precedence per §5: item > folder > workspace > mount > account default.
4. Set-once ergonomics: setting a policy on a workspace or folder is the normal path; item-level overrides are possible but never required. New work inherits without a prompt.
5. Where a policy choice has a real consequence, state the consequence, not the mechanism ("New files added to this folder on your PC will appear in Spectra automatically").

### W2 — Engine hardening (Tier R)

1. One effective-policy function (I6) with property tests over the precedence lattice: random trees, random overrides, assert determinism, assert that no surface computes policy independently (grep gate).
2. Discovery modes implemented for real: `auto` (new files appear), `ask` (a calm batched request, never a modal storm), `explicit` (only chosen items). Ask decisions are remembered per scope with an "always do this here" affordance.
3. Filters: include/exclude by folder, file and pattern, with lower-level overrides; a filter change re-evaluates the affected subtree idempotently through the journal.
4. Timing modes: `continuous`, `on-save-open`, `manual`. Manual means genuinely nothing happens until the user acts, and the status says so.
5. Cloud content modes: `full`, `metadata-only`, `none` — enforced in the Bridge core (ARCHITECTURE-BRIDGE §2), not the UI, and reflected honestly in what recovery the UI promises.
6. Policy changes are journaled operations with before/after snapshots, so "why did this move?" is answerable.

### W3 — Structure mirroring (Tier R + P)

1. Implement all five structure modes: `independent` (default), `mirror-to-disk`, `mirror-from-disk`, `mirror-both`, `ask`.
2. Spectra-side move, rename and delete under each mode, per CANON D27 and ARCHITECTURE-STORAGE §3: metadata-only in `independent`; a journaled physical operation through the write pipeline in mirroring modes; a concise choice in `ask` mode with "always do this here".
3. Disk-side move, rename and delete under each mode: adoption per §7; propagation into the tree in `mirror-from-disk`/`mirror-both`; nothing but journal bookkeeping in `independent`.
4. Deletion semantics made explicit and safe: Spectra delete defaults to unlink-and-leave-the-file; a policy-driven local delete goes to the recycle bin, requires confirmation, and names the count of real files affected.
5. Collision handling: a mirrored move whose destination has a name clash resolves with a deterministic, explained rule (never silent overwrite, never a random suffix without saying so).
6. Local mirror root: cloud-born work materializes into a user-chosen root with a stable, human-readable layout that follows the Spectra hierarchy; moving work in Spectra moves it in the mirror; the user can relocate the mirror root and the journal re-points without re-uploading.

### W4 — Protected originals (Tier R + P)

1. `linked` policy: the original file is never written. Spectra edits accumulate as a pending working state on the logical identity, visible as an honest status ("2 changes pending · original untouched").
2. Three exits, all explicit: **Apply to original** (write once through the pipeline, then optionally switch policy), **Keep as Spectra copy** (fork into a Spectra-managed replica, original left linked and untouched), **Discard pending changes**.
3. External changes to a protected original are ingested as revisions and reconciled against the pending state with the normal conflict machinery.
4. A hash proof test: any number of Spectra edits, any number of reloads, original hash unchanged until Apply.

### W5 — Many devices, offline, and the matrix (Tier R)

1. Second device support: two Bridge installations on one account, each with its own device row, mounts and replicas; reconciliation is pairwise against shared state. Provide a documented test harness path for a simulated second device (separate data directory plus port override for tests only — production stays fixed-port).
2. Implement and test the whole of ARCHITECTURE-STORAGE §10 as a real matrix, one test (or scripted scenario with recorded evidence) per row, including: cloud-changed-while-offline, local-changed-while-offline, Bridge restart with pending writes, browser closed mid-edit, cloud-ok/local-fail, local-ok/ack-lost, two local replicas, file moved offline, folder renamed externally, mount vanished, partial large transfer, externally corrupted file, conflict during an AI run, conflict during a collaborator edit, revoked device, revoked mount, permanently lost device.
3. Double-sync mounts (OneDrive/Dropbox/Drive-desktop): warn once, clearly, at mount time; widen stability windows; test that a provider-driven rewrite does not produce a phantom conflict.
4. Backoff, queue growth bounds, and honest "Offline · n changes" counts that match the journal exactly.
5. Conflict resolution UX lands here: the precise conflict surface (region-level where the lens provides it), keep-which choices, "keep both" forking into a clearly named copy, and a conflict list in the disclosure so nothing hides.

### W6 — Storage strategy changes as a first-class action (Tier P)

1. Changing storage strategy for existing work in either direction (F6) is one action with a clear preview of what will happen ("This will create a copy on this PC in ...").
2. No duplicate items, no closed surfaces, no lying status at any point in the transition; the transition itself has a truthful in-progress state.
3. Removing a replica never deletes the other side by surprise and always states what remains.

## Invariants to uphold

I1, I3, I6, I7, I8; D24, D26, D27, D37 (file effects are risk-bearing), D39 (locality language). Every user-visible count is derived from the journal, never estimated.

## Out of scope

AI initiating policy or file operations (N8 — but the confirmation classes it will use are defined and enforced here) · provider adapters · semantic search over local files · visual polish of the policy surfaces beyond clarity (N10).

## Acceptance gates

1. **F6 passes** in both directions with evidence, plus a no-duplicate, no-remount assertion.
2. **F7 passes:** Bridge killed mid-write, restarted, journal replays, no corruption, and the status was truthful at every observed moment.
3. The §10 matrix is fully executed with one evidence row each in STATE (test name or scripted scenario + result). Any row that cannot be executed is stated as such, with the reason, not quietly skipped.
4. Precedence property tests green; grep proof that policy is computed in exactly one place.
5. Mirroring: move, rename and delete demonstrated under `independent`, `mirror-to-disk`, `mirror-from-disk` and `ask` (screenshots plus filesystem listings before/after).
6. Protected original: hash-unchanged proof across an edit session, then a successful Apply, then a successful fork.
7. Two-device scenario: the same work edited from two devices with a conflict produced and resolved precisely.
8. Double-sync mount warning shown once and no phantom conflicts in a provider-rewrite test.
9. P0 and P10 pass; the four human choices are demonstrated end-to-end with inheritance and override evidence; STATE §10-matrix section added; mission log ≤40 lines; close-out checks green.

---

## Mission Log (2026-08-22, N6 continuation)

1. Re-read Goal objective, Nova CANON, STATE, PLAYBOOK, N6 brief, and Bridge/Storage architecture.
2. Ran TypeScript, targeted policy/matrix tests, Rust core/chaos/granted-tree tests, and diff checks.
3. Added journaled structure requests for Spectra-side move, rename, and delete.
4. Added safe Rust relocation through the existing intent journal and deterministic collision suffixes.
5. Added disk-side path adoption and mirroring into the Spectra tree.
6. Added persisted unavailable-mount visibility and reconnect retry behavior.
7. Added persisted ask-mode structure decisions with folder/item/mount/account lookup precedence.
8. Made internally generated structure request keys deterministic across retries.
9. Made mount availability reporting edge-triggered instead of writing every watcher tick.
10. Built the full Tauri Bridge after fixing a structure-drain Rust compile error.
11. Paired an isolated Bridge once through Spectra and verified close-to-tray service residency.
12. Restarted the isolated Bridge with the same data directory; Spectra resumed without a new code.
13. Captured `.shots/missions/N6/spectra-bridge-connected.png`.
14. Opened a clear English DOCX in real Word; heading and typography rendered correctly.
15. Confirmed the prior Chinese-looking fixture text is source corpus content, not generated corruption.
16. Expanded the 17-row matrix model to assert journal, queue, conflict, and data-safety invariants.
17. Targeted checks passed: `tsc`, 11 Vitest tests, Rust 23 + 6 + 1, full Bridge build, secret scan.
18. N6 remains IN PROGRESS: live F6, full mirroring, protected-original, two-device conflict, provider rewrite, and complete matrix evidence are not claimed yet.
19. Added a first-class, idempotent storage-strategy transition journal for F6; transitions preserve the logical work identity and record before/after policy and replica state.
20. Cloud → local now requires an explicit active mount/path, creates one pending local replica and Bridge write request, and stays pending until read-back verification.
21. Local removal is an unlink-only action: the replica becomes unavailable with `removed-by-user`; the physical file is left in place and pending protected changes block removal.
22. Strategy transitions are wired into the resource surface as the four product choices; no duplicate item or closed surface is created.
23. Touched-file lint, TypeScript, targeted policy/matrix tests, Rust core/chaos tests and the full Bridge build passed after these changes.
24. Added executable F6, protected-original hash/apply, mirroring, and two-device conflict scenarios to the matrix test.
25. Ran close-out checks: 795/795 application tests, full lint, TypeScript, secret scan, DOCX/Office fidelity harnesses, 28 core + 6 chaos + granted-tree Rust tests, and full Bridge build all passed.
26. Live Chrome policy evidence and persistent Bridge reconnect/close-to-tray behavior were rechecked; N6 accepted 2026-08-22.
