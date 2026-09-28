# N10 — CONVERGENCE

**Charters:** Product Engineer (primary) + Designer (visual convergence support) + Fidelity Engineer (honesty audit of capability surfaces)
**Prerequisites:** N9 accepted in `STATE.md`
**Architecture:** all Nova architecture docs as reference; no new architecture
**Evidence:** `.shots/missions/N10/` · Tier P throughout, Tier D for visual convergence, Tier R only where an honesty defect turns out to be a correctness defect

## Objective

The adapted M5: one deep, surface-by-surface pass over the product Nova actually built, until a real user could use Spectra all day without meeting a rough edge, a lie, or a dead end. Not new capability — convergence, honesty, coherence and the removal of everything the transformation left behind. At the end, single-user-plus-AI Spectra is demonstrably release-quality; multiplayer's verdict belongs to N12.

## Why now

Nine missions have added enormous surface area. HQ's M5 existed for exactly this reason and its quality bar (the `SPECTRA_LIVE_PERFECTION_CAMPAIGN.md` §2 definition of quality, inherited) still applies — now to a product with files, replicas, policies, a command surface and an AI plane.

## The bar

A surface passes when: it works at realistic density; every state it can show is true; every control does something; nothing on it is developer debris; its empty, loading, error and unavailable states are deliberate; its copy is product language; it looks like the same product as every other surface; and using it feels immediate. If any of those fails, it is not passed — it is either fixed or logged with a precise defect.

## Workstreams (ordered)

### W1 — Shell and navigation (Tier P)

1. `AppShell`, sidebar, tab rail, splits, notifications, search entry, session persistence, mobile/narrow behaviour, and the Library⇄Workspace continuity from N1 — all at density (many workspaces, long titles, deep folders, several open tabs, a running AI).
2. 1366×768 and a large viewport; both colour schemes; keyboard-only navigation of the shell.
3. Session continuity stressed: reload, back/forward, deep link, second tab of the same account.

### W2 — The organized world at scale (Tier P)

1. Library at **10k nodes** (ARCHITECTURE-STORAGE §12's real target): navigation, drag, multi-select, rename, search, sort, virtualization, and no jank. Trace if suspicious.
2. Workspace List and Board at density, including nested workspaces, mixed resources and work, and a workspace containing thousands of items.
3. Search: fast, honest about scope, and still the single surface a future semantic provider slots into (verify the seam did not rot).
4. Trash/soft-delete lifecycle end to end, including restoring work with local replicas.

### W3 — Every editor, deeply (Tier P)

1. Each of the nine types: primary workflows, empty/dense/read-only, the N7 depth, comments/history/references/details inspectors, embeds from N9, AI read and AI edit, side-panel and split layouts, print/export where applicable.
2. Each Office family in both `strict-native` and a deliberate `enhanced` case, including a preserved-feature placeholder, a disabled-with-reason command, and a conflict resolution.
3. Undo/redo integrity per type after AI edits, external edits and reconciliations.

### W4 — Files, sync and status honesty (Tier P + R)

1. Walk every state of the status vocabulary on real work and prove each one is reachable and truthful: Saved, Saved locally, Synced, Saving, Syncing, Offline · n, conflict, Unavailable on this device.
2. Audit for any place that can display a stale or optimistic state — including cards, rows, dock, tabs, hover disclosures and AI context. Anything that can lie is a stop-the-line defect (D26), fixed here.
3. Policy surfaces re-read as a normal user: can they answer "where does this live and who manages it?" in one sentence? If not, rewrite the copy.
4. Bridge disconnected/paused/update-required states across the whole product, not just settings.

### W5 — Conversations, AI and school workflows (Tier P)

1. The conversation battery: research, attachments (PDF/DOCX/XLSX/PPTX/image), long streams, stop/retry, continuation, cross-work reasoning, memory retrieval honesty, required-input flows.
2. The AI plane in anger: organization, settings changes, toolbar customization, file-effect confirmations, Follow AI across routes, two actors, and the Live Dock's narration quality throughout.
3. Calendar and ManageBac breadth with real school data (Profile P): views, layers, drag/resize, sync capabilities reporting truthfully, conflicts and provenance.
4. Agents: Foundry end-to-end (create → checks → publish → use), closing M4-E9 permanently if it is still open.
5. Admin, Analytics, Superadmin: every metric real or honestly stated as unavailable.

### W6 — Subtraction and migration cleanliness (Tier P)

1. Grep-driven sweep for everything the transformation superseded: `spectraWorkspaceItems` remnants, canvas paths, old placement helpers, legacy import-as-sync code, duplicated rich-text/embed/registry paths, dead flags, unused blueprint files, orphaned components, stale routes and redirects, dead env vars, TODO markers left by earlier missions.
2. Timetable's final resolution verified (M4-E11 decision from N1 executed, nothing concealed).
3. Schema tombstones reviewed: anything kept only for migration is either removed now or documented in STATE with a removal condition.
4. Bundle/route audit: no dev-only components shipped, no debug UI, no console noise on any primary route.
5. Zero-`SUSPECT` push: every STATE entry in a surface this mission passed becomes VERIFIED with evidence or a precise defect.

### W7 — Visual convergence with the Designer charter (Tier D)

1. One visual grammar across the whole product after ten missions of additions: type identity as accent, consistent control language, consistent density behaviour, consistent inspector conventions, consistent status presentation.
2. Fix visual incoherence that accumulated — but do **not** start N11's identity work (field/prism/motion/landing). This is convergence, not identity.
3. Copy pass: product language everywhere, especially in the new storage/policy/fidelity surfaces where engineering vocabulary leaks most easily (D39's locality language included).

### W8 — Round two (Tier P)

1. Re-run every P-flow and every active F-flow fresh, from a clean reload, after all fixes.
2. A genuine free-use session: use Spectra as a student and as a teacher for a sustained period with real files mounted, taking notes on everything that felt wrong; fix what is small, log the rest precisely.
3. Write the single-user release verdict in STATE: what is release-quality, what is known-imperfect, what is deferred to N11/N12.

## Invariants to uphold

Every CANON decision, everywhere — this mission is where CANON is enforced product-wide. Especially D14-class honesty, D26 (no lying states), D29–D32 (organization), D34 (one command surface), D40 (live identity), **D41–D44 (run PLAYBOOK §5's reuse and bounded-read audits across the whole product, not just what you changed: this is the mission that finds the last duplicated control and the last unbounded query)**. Nothing is fixed by hiding it.

## Out of scope

New capability · new artifact types · field/prism/motion/landing (N11) · multiplayer stress and its verdict (N12) · provider adapters · semantic search.

## Acceptance gates

1. Every surface listed in W1–W5 is either VERIFIED in STATE with dated evidence or has a precise, root-caused open defect with an owner (N11/N12/backlog).
2. 10k-node Library evidence (navigation, drag, search) with timings.
3. Status honesty audit complete: a table in the log mapping each status string to the state that produces it and the test/observation proving it cannot appear falsely.
4. Subtraction evidence: grep output showing the superseded paths are gone; net LOC change reported; no orphaned files.
5. All P-flows and all active F-flows pass fresh in round two.
6. Free-use session findings recorded, with fixes applied or logged.
7. The harness (Office corpora) green at close; close-out checks green.
8. STATE contains the single-user-plus-AI release verdict and a clean, honest defect list; mission log ≤40 lines.
