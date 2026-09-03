# P8 — School Launch Release Gate

**Goal:** decide whether this exact commit can be launched in a school environment. P8 prepares a production-like local composition, runs the completed real-corpus gate, then keeps one terminal verifier program active through first-person onboarding, combined chaos/multiplayer/AI/Bridge verification, perceptual and cost gates, every class-wide repair, clean reruns, and a plain GO or NO-GO verdict.

**Prerequisites:** P5.V1, P6.V1 and P7.V1 VERIFIED. P1–P4 are closed historical foundations. **Explicit exclusion:** no P9–P15 expansion feature chain, connector expansion, broad artifact-depth expansion, memory/soul system, assignment/grading slice, or timetable retirement is imported during P8. ManageBac first-run class selection and later editability are explicitly included launch entry behavior, not assessment expansion.

**Serial order:** P8.P1 → RC.V1 → P8.V1. P8.V1 is resumable across replacement agents but remains one serial unit and one evidence ledger through repairs and verdict.

**Model routing:** P8.P1 = Grok 4.6 High. RC.V1 and P8.V1 = GPT 5.6 Sol xhigh. P8.V1 does not fan out or route repair cards elsewhere. If its agent is replaced, the new verifier rereads the governed stack and resumes the same unit from `final-verification/PROMPT.md` and `.shots/reformation/P8.V1/run-state.json`.

## P8.P1 — Frozen-candidate production preflight (MT)

**Model: Grok 4.6 High.** This is a bounded implementation/operations unit. It creates evidence and fixes preflight gaps; it does not declare release readiness.

### Inputs to record

- Candidate commit and clean Git status; Node/npm/Rust/Convex versions; production-build hash.
- Local Convex instance id/data directory, seeded operator/admin/member identities, collaboration gateway build, Bridge build/config, and test folder paths. Record no secrets.
- Exact launch scope and excluded expansion register from `EXPANSION-ARCHIVE.md`.
- Account A and account B capabilities; originals and sacrificial corpus-copy paths.

### Work

1. Start from a fresh deterministic local instance using the checked-in local scripts. Seed through the real onboarding saga, not raw database inserts. Validate operator-without-membership and school-admin entry.
2. Build the production app, run it against local Convex and the collaboration gateway, pair a disposable Bridge profile, and mount only a verified sacrificial fixture/corpus copy.
3. Add/verify health and readiness checks for web, Convex, gateway and Bridge. A green endpoint must prove dependency readiness, not merely process existence.
4. Establish one evidence manifest format shared by RC.V1 and P8.V1: commit, environment, hashes, actors, steps, observations, budgets, repairs and verdict.
5. Run a smoke of sign-in/invitation, Library, one native file, one collaboration edit, one AI operation, one reminder and one clean restart. Repair any preflight class with focused tests.

### Prohibited shortcuts and exit

No cloud-test dependence, no original-file edits, no copying secrets into evidence, no disabling auth, no dev-server verdict, no raw seed inserts, no expansion imports. Exit when the frozen candidate is reproducible from the runbooks, all services are readiness-green, the school seed is usable, the sacrificial paths/hashes are recorded, and the production smoke passes.

### P8.P1 implementation log — 2026-09-02

- Production local stack: `local:build` inlines instance Convex URL; `local:start:prod` serves `.next` against instance 1.
- Convex CLI 30s default aborted the 6.4 GB SQLite bind (P6.V1 class). Set `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=900` and keep the same backend after `convex env set` instead of stopping and paying bootstrap twice.
- Web `/api/health` treated Convex `/instance_name` JSON parse failure as not_ready despite HTTP 200. Probe now accepts text/plain; stack start waits for `status: "ready"`.
- D42: one coalesced thread index (limit 40); in-flight coalesce for threads, shareInvitations, collaboration tokens.
- `queueMaterialization`: artifact modify + this actor's local replica/payload; collaborators cannot write the owner's disk. Storage-strategy owner checks left owner-only.
- Seed verify-only: The Global College saga ready; A school_admin; B operator without membership. Originals unmounted. Disposable fixture `P8P1-smoke.docx` sha256 `b790e6bc…`.
- Smoke (prod, A): Library, collab marker, AI run asked which duplicate New Document, Calendar/notifications, Admin 2 members, native import, clean restart recovered Library.
- Bridge health not_ready; no disposable pair. Convex CLI printed a cloud spending-limit warning; local :3002 still answered. One Library AUTH race recovered via Try again.
- Checks: local-harness 7/27, replicas+hocuspocus 2/41, capability ghost, production build. Evidence `.shots/reformation/P8.P1/`. Status: IMPLEMENTED.

## RC.V1 — Final real-corpus fidelity gate (H)

**Model: GPT 5.6 Sol xhigh.** This is the complete run that never finished earlier. The old partial/rejected RC evidence is diagnostic history, not a pass. Run after P8.P1 on the frozen production build, immediately before the final chaos gate.

### Corpus and safety protocol

Use copies of Pablo's Extended Essay, complex real presentation, and Physics IA workbook. Hash originals and copies before work; never open an original through a writable Spectra mount. Each mutation starts from a fresh copy. Keep an untouched control copy. After every Spectra and Office round trip, compare package parts and re-hash the original tree.

### DOCX card

- Inventory and render paragraphs, nested/wrapped tables, OMML equations including equations in tables, images/anchors/alt text, footnotes/endnotes, citations/bibliography Custom XML, headings, TOC/fields, section/page settings, comments/tracked changes, content controls, OLE and macros where present.
- Edit one safe paragraph, one table cell, formatting, insert, and AI operation. Exercise every offered Word capability or record its truthful refusal before mutation.
- Spectra → durable collaboration reload → Bridge/native queue → Word open/save → Spectra reconcile. Region identity must remain stable; untouched native structures remain byte-identical where the operation contract says preserved.

### XLSX card

- Inventory sheets, 200k-scale cells if present, recognized and cached-only formulas, named ranges, styles, dates/serial system, merges, freeze panes, comments, charts/tables/validation, external links, custom XML, ActiveX/macros.
- Prove initial render responsiveness and a real React cell commit; durable Yjs append and fresh reload; Bridge/native readback in Excel; formula text/cached values retained. “Paste values” over a formula must refuse with `XLSX_FORMULA_LITERALIZATION_BLOCKED`, never `UNKNOWN`.
- Exercise every offered Sheets capability or truthful refusal. Verify changed package parts and no formula literalization, date drift, absent-vs-zero freeze drift, or renderer stall.

### PPTX card

- Inventory masters/layouts/themes, placeholders, transitions, animation timing, notes, charts/embedded workbook, media, OLE and macros.
- Render every slide; edit title/object/geometry, add/move/delete a slide, set notes/alt text, and perform one AI operation. Exercise every offered capability or truthful refusal.
- Durable reload and PowerPoint round trip must preserve masters, notes, transitions/timing, embedded workbook and untouched media; slide identity/order must remain correct.

### Failure handling and exit

Triage each failure LOCAL/SYSTEMIC, repair holdable classes, add a real-corpus-derived minimal fixture where legally/safely possible, and rerun the entire format card. Never shrink the offered capability matrix, flatten a preserved construct, regenerate a package wholesale, weaken part comparisons, or call “opened” a pass. RC.V1 passes only when all three format cards and original-integrity hashes pass on the frozen production build.

### RC.V1 verification log — 2026-09-03

- Production instance 1 + Bridge on disposable `RCV1Continue`; valid mount `spectra-rc-v1-final-mounted-20260903`.
- Keep Word class: incremental native fragment adopt + Yjs-origin `filterTransaction` bypass. Live Maths EE ProseMirror then contained `RCV1WORDNATIVE7` through hard reload.
- DOCX workbar inventory + package compare vs control: customXml/media/theme identical; `word/document.xml` changed as expected.
- XLSX xlsx-run3: grid 1044ms; Excel COM Y1=`RCV1EXCELY1`; Keep Excel 200; reload B1+Y1+D4; sheet2 still 327 formulas. Linked-file workbar refusals titled. Spectra-side durable reload green.
- PPTX workbar inventoried with honest native refusals. `Updating presentation content.` hung 45s — R2, owner P8.V1, not a silent pass.
- **Status: VERIFIED (Pablo owner-closed 2026-09-03).** Three format cards proven on frozen production build.
- **Deferred to P8.V1:** xlsx-run3 Bridge `file.write` + Excel package readback hash (70s poll showed no on-disk write; Spectra Keep Excel path already durable). Original-tree integrity card and PPTX R2 timed exit also remain P8.V1 scope.

## P8.V1 — Terminal school-launch verification and repair program (H)

**Model: GPT 5.6 Sol xhigh.** Use the same candidate lineage and evidence manifest as RC.V1. Read `../final-verification/` in its mandatory order; that folder is the executable context, matrix, process, evidence contract, scripts, and continuation packet for this section.

### Required coverage

0. **Do not repeat closed work.** RC.V1 contributes only xlsx-run3 Bridge `file.write` + Excel package readback hash, original-tree read-only integrity (including the live EE 4 lock), and the PPTX R2 timed exit. P5.V1's unchanged 30-client/65-minute soak is inherited unless a repair reaches that load path.
1. **First person:** a fresh database and real sign-in reach useful work; explicit ManageBac class selection handles noise, empty/degraded/disconnected states, reload and double-submit; the selection remains editable from School or ManageBac without deleting work; every other onboarding choice remains editable in Settings.
2. **Actors:** both signed-in humans and two distinct AI runs edit the same artifact and the same region; Follow AI route crossing; claims, authorship, stop/retry/undo and revocation truth.
3. **Failures:** gateway kill mid-write, Bridge kill mid-native write, browser crash, network partition, Convex latency, failed checkpoint, stale token, permission change and device revoke. Every entered state must have the R2 exit.
4. **Recovery:** restart from clean processes and profiles; replay journals/updates once; no duplicate operation, false saved/current label, manual DB surgery or reinstall.
5. **Endurance:** multi-hour realistic session; memory, handles, timers, animation loops, IndexedDB and update-log growth remain bounded.
6. **Scale:** 10k-node Library, 40-page document, 200k-cell workbook, 120-slide deck, many Dock tabs, and the inherited 30-client/65-minute classroom result unless a repair reaches that path.
7. **School journeys:** invite/accept, operator school session, admin member management, teacher/student/member basics in launch scope, reminder delivery, Bridge pairing/mount, Library organization, collaboration and AI help. Deferred assessment/connectors must be absent or honestly labelled, never half-wired.
8. **Security and privacy:** secret scan, authorization matrix, signed URLs, sandbox/network boundaries, audit visibility, expired/revoked access, and no internal token/code in user copy.
9. **Perceptual seams:** complete-viewport screenshot analysis catches unreadable endings behind the Dock, panes that blur/cover instead of share width, competing action clusters, misaligned/poorly overflowing chrome, effects larger than their subject, formatting/control disagreement, robotic copy, and all related sibling surfaces. Repair the shared geometry, state, or projection class rather than the screenshot.
10. **Cost:** measure current per-action, idle Library, idle collaboration, scheduled, first-paint, Bridge, and AI windows. Close polling, scan, fat projection, lifecycle, and egress classes against ARCHITECTURE-PLATFORM §4; historical dashboard leaders are leads, not current verdicts.
11. **Full machine floor:** full Vitest, typecheck, production build, zero-warning lint, architecture/copy/capability/token/secrets gates, DOCX/Office/seam fidelity, Bridge tests/build, local-stack/foundation tests, and every focused suite introduced by repairs.

PASS requires every matrix card with real evidence. A failure is triaged and repaired inside this verifier session under R12/R17, then the whole affected sequence and its consumers are rerun on a rebuilt production candidate. A replacement agent may continue the same P8.V1 only for a truly unholdable multi-independent-seam class. Hosting remains a named operational risk until the production deployment is actually exercised; local composition must not claim otherwise.

### P8.V1 foundation log — 2026-09-03

- Recast P8.V1 as the terminal, serial, resumable verifier/repair/release program; removed the extra P8 lanes from operational truth and evidence schema.
- Preserved independent verification: this verifier starts after earlier implementation/RC sessions; a replacement agent resumes from files, never inherited chat.
- Built `final-verification/` with mandatory context, RC dedup map, covering matrix, execution/evidence contracts, and one paste-ready continuation.
- Added first-person onboarding and explicit ManageBac class selection/later editability; assessment/grading remains excluded.
- Promoted Pablo's screenshots into perceptual-seam cards for safe-area, shared pane allocation, action hierarchy, row pressure, bounded effects, and style fidelity.
- Added playwright-cli observers/checkpoints plus onboarding, close, Follow, perception, and selected-style probes as single function-expression scripts.
- Added non-destructive fresh-instance allocation and a resumable card ledger that protects passed cards unless a repair explicitly invalidates them.
- Added sanitized Convex usage windows with action/idle/collaboration/scheduled gates; arguments and user content are discarded.
- RC.V1 feature inventories and the unchanged P5.V1 soak are explicitly not repeated; only the three recorded RC carryovers remain.
- Foundation checks and current governance/static evidence are recorded in the closeout commit; product verification remains OPEN.

## Exit gate

P8.V1 ends against one clean, immutable candidate whose manifest and STATE row agree. GO has zero launch-blocking failures, every numeric budget met, and a tested rollback/incident path. NO-GO names exact failed cards and remains honest resumable P8.V1 work; expansion does not begin until the school-launch line reaches GO or Pablo explicitly changes scope.
