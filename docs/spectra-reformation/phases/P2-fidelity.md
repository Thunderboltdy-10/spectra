# P2 — Fidelity at Full Surface

**Goal:** the full current editing surface on mounted Office files becomes provably safe (Pablo's "broad" decision): one schema per format, real 3-way merge, stable identity, ghosts made real or honestly refusing, sheets engine correct — with the composition seam under contract test for every capability. After P2, "edit a real DOCX in Spectra and in Word" is boring.

**Prerequisites:** P1.I1, P1.I2 accepted (met 2026-08-26; P1 complete). **Architecture:** ARCHITECTURE-FIDELITY (all), ARCHITECTURE-TRUTH §1. **Findings absorbed:** Parts III–VI wholesale (DOC-*, XLS-*, PPT-*, PKG-*), SYS-1/3/4, TEST-2/3.

**Difficulty (PROCESS §4):** I1, I2, I3, V1 = Hard / GPT 5.6 Sol xhigh. I4, I5, V2 = Medium-thinking / Grok 4.6 High. First unit: **P2.I1**. V1/V2 verifiers follow PROCESS §2 / R17: repair a holdable class in-session; hand off a paste-ready prompt only when the class is too complex to hold.

## P2.I1 — One schema per format (H)

Per ARCHITECTURE-FIDELITY §1: one projection schema per format shared by lens/adapter/route/AI serialization; the duplicate `blocksFromJson` pair dies (DOC-1 root); `office-content.ts` normalizations become the single typed transform; route merge validators import the canonical schema (`z.infer`, no hand twins); editors emit typed deltas alongside content so deletions/insertions/reorders survive by construction (XLS-3, PPT-2, DOC-7). The P0 interim table-refusal is replaced by real table round-trip. Package format (`.spectra-pkg`): deterministic zip (fixed mtime — PKG-1) and a working import path (PKG-2), or the download affordance is removed until it exists — no one-way recovery fictions.

**Owns P0.V1 SYSTEMIC:** DOC-5 (SDT-wrapped table / lens identity — topology and region identity close with the one-schema work, not a table-only patch in P1) and PKG-1 (identical packages, different SHA). Do not pull these into P1.I1.

## P2.I2 — 3-way merge + stable identity (H)

Per ARCHITECTURE-FIDELITY §2–§3: stored base as first-class object; `diffExternal` sees formatting/structure (R4) with tests for every attribute the write path can emit; per-region 3-way merge with precise conflicts; paraId injection on first materialize; sdt/AlternateContent-aware pairing; PPTX `p:xfrm` + real aspect ratio; refusal law wired (no positional writes). The materialize stale-base window (DOC-3) closes here: CAS against verified revision, rebase-and-retry on failure, no in-flight bypass.

## P2.I3 — Full-surface native writes (H)

Every currently-offered command on mounted files gets a real native path or an honest refusal (R7): hyperlinks/footnotes (DOC-10), run-level soft breaks/tabs preservation (DOC-8), style aliases without dangling refs (DOC-9), cell-interior preservation on cell edits (DOC-4 — engine extension), sheet styles/borders/merges/freeze panes (XLS-10), charts read+write or honest refusal (XLS-9), speaker-notes part creation (PPT-4 real fix), OMML decision documented (DOC-12). Each lands with its L1 seam test *and* diff visibility. Anything refusing at phase end gets a Field Note naming the gap.

## P2.I4 — Sheets engine correctness (MT)

ARCHITECTURE-FIDELITY §6 list: serial dates, `^` associativity, whole-column refs, 10k truncation (raise + warn or stream), one reference-shifter for sort/paste/structural (XLS-2), percent-as-format (XLS-4), locale entry (XLS-7), rename/structural cross-sheet ref rewriting (XLS-8), cached-staleness marking (XLS-6), find-replace formula-literal safety, clear.all asymmetry (XLS-11).

## P2.I5 — Corpus + seam contract harness (MT)

ARCHITECTURE-FIDELITY §5: realistic fixtures (verified sidecars), sequence fixtures, and the L1 harness running the *production* pipeline per format in its owning verification unit — with named tests for every Part III–V CRITICAL shown failing against pre-fix code where feasible. The old direct-lens harness remains as an engine-level layer; it no longer counts as product evidence by itself.

## P2.V1 — Office coexistence verification (H)

Adversarial verifier with real Word/Excel/PowerPoint in the loop: formatting round-trips both directions; alternating edit sessions; simultaneous open; save-during-materialize races; table/content-control documents; conflict UX (can a person actually resolve one and keep both?); package export/import. Sequence evidence throughout (R11).

**Model: GPT 5.6 Sol xhigh.** Never concurrent with another live-product verifier.

## P2.V2 — Real-documents journey (MT)

Pablo supplies (or verifier synthesizes) a folder of realistic school documents; goal cards exercise mount→edit→Word-verify→re-edit cycles per format. Hash checks prove untouched files stayed byte-identical (D25 in the field).

**Model: Grok 4.6 High.** Simpler than V1 coexistence.

## Exit gate

L1 harness green in the owning verification units for all formats; every write capability has diff-visibility + identity + seam test, or visible refusal; V1/V2 PASS; no corruption reproducible by the verifier's adversarial session; Pablo pass on his own real files.

## P2.I1 implementer log — 2026-08-27

- TRIAGE: SYSTEMIC projection-boundary class across editor/Yjs, routes, lenses, and portable packages; held as one seam.
- Added one Zod projection/operation contract per Office format and made lenses/routes import it.
- Replaced the duplicate document JSON transforms with one typed table-aware transform shared by studio and Yjs.
- DOCX now projects SDT/AlternateContent tables in native flow order, assigns stable region identities, and writes cell edits to the named table.
- DOCX editor intent carries insert/delete/reorder/table-cell operations; partial AI projections remain additive, while full studio/Yjs projections propagate removals.
- Read-only Word regions refuse both replacement and deletion; stale editor intent is not persisted into collaborative state.
- XLSX absences become typed clear-cell operations; PPTX objects newly added to existing slides survive route composition.
- DOCX materialization now runs the preservation guard; external diff compares full projected blocks.
- `.spectra-pkg` output is canonical and fixed-time, import validates content/paths, and Library restores package content while retaining original bytes.
- Focused Vitest: 5 files / 47 tests passed. Scoped ESLint: 0 errors / 198 existing large-shell warnings.
- Secret scan passed across 2,067 tracked files; `git diff --check` passed.
- `tsc --noEmit` retains only pre-existing blockers in bridge tests, replicas test, presentation commands, and agent library shell; no P2.I1 file fails.
- Architecture check retains the five documented pre-existing global-event failures; no P2.I1-specific failure.
- Full repository sweep and live Word/Excel/PowerPoint coexistence were not run; P2.V1 owns independent runtime verification.
- Later owners unchanged: P2.I2 merge/CAS/broader identity; P2.I3 full native surface; P2.I4 sheets engine; P2.I5 corpus/harness.
- Status: IMPLEMENTED only; no verification or acceptance claimed.

## P2.V1 verifier log — 2026-08-27

- Started as a clean verifier walk; real Word, Excel, PowerPoint, Browser, Bridge, and current Convex were used.
- TRIAGE · SYSTEMIC: first DOCX activation failed because persisted semantic content was legitimately null; the same boundary existed in all Office formats.
- Repaired DOCX/XLSX/PPTX to start from the freshly read native projection when semantic content is absent; added regression tests.
- TRIAGE · SYSTEMIC: verified/stale external operations reactivated and old `applied` rows could keep presenters busy without a durable exit.
- Centralized active external-revision selection; retired superseded rows on upload/activation/reconciliation; made `forWork` count only actionable work; added periodic expiry.
- Deleted the now-dead DOCX table-refusal compatibility hook; no callers remained.
- DOC-5 passed in the real SDT-wrapped table fixture: stable table targeting changed the named cell without shifting neighboring content.
- FIELD NOTE · P2.I3: the bound cell's Custom XML value was not updated, so Word restored `Eric White`; no screenshot patch attempted.
- Excel alternating loop retained Spectra A1 plus Excel bold B2 and preserved chart/table/WordArt/comment/sheets.
- PowerPoint alternating loop retained the external title plus Spectra's new object; 15 slides and prior object identities held.
- Package export→import restored both cards; re-export was byte-identical (842 bytes; SHA-256 `5F2BD66…D5DEB`).
- P2.I2 owns simultaneous-open, materialize CAS/rebase races, and human conflict resolution; this VU did not claim them.
- Focused Vitest: 7 files / 76 tests passed. Verifier-owned ESLint: zero warnings/errors.
- Library shell: zero errors / 17 pre-existing design-token warnings. Secret scan and diff check passed.
- `tsc --noEmit` retained only recorded blockers; no changed production file failed.
- FIELD NOTE · P6.I3: the logger calls nonexistent `errorEvents:log`; recorded as later dead wiring, not started here.
- Evidence: `.shots/reformation/P2.V1/manifest.md` and numbered screenshots `00`–`09`.
- Verdict: PASS after class-wide repair and full remaining P2.I1 journey retest; P2.I1 remains IMPLEMENTED pending Pablo acceptance.

## P2.I2 implementer log — 2026-08-27

- TRIAGE: SYSTEMIC merge/CAS/identity class across Office lenses, native routes, Convex replica truth, and the conflict bar; held as one architecture seam.
- Added a generic keyed three-way merge with delete-vs-edit conflicts and deterministic weaving of independent insertions.
- DOCX, XLSX, and PPTX now merge at stable native region/object/cell identities; formatting, structure, order, and defined-name changes are visible to diff and merge.
- Removed the materialization in-flight bypass; stale claims fail CAS and the route performs one verified rebase retry before surfacing overlap.
- Keep Spectra applies only Spectra-changed regions over the external carry; foreign insertions remain intact and conflict responses stay HTTP 200 with precise previews.
- Persisted conflict previews in `syncConflicts`; Convex `forWork` restores them into the existing in-place conflict bar after reload.
- DOCX now reports whether native paraIds were persisted, injects deterministic anchors on first real materialization, rejects duplicate/invalid identities, and refuses concurrent merge from an unanchored stored base while allowing one-sided external promotion.
- Added regressions for formatting-only edits, foreign insertions, delete-vs-edit, preview persistence, stale-base retry, first-anchor persistence, duplicate anchors, and unanchored concurrent merge refusal.
- Focused Vitest: 7 files / 89 tests passed (`docx-lens`, `document-native-projection`, `office-route-projection`, `xlsx-pptx-lens`, `spectra-package`, `three-way-merge`, `convex/replicas`).
- Scoped ESLint: 0 errors. Secret scan passed across 2,085 tracked files. `git diff --check` passed.
- `tsc --noEmit` retains only recorded repository blockers in bridge tests, replicas test, presentation commands, and agent library shell; no P2.I2 production error.
- Architecture check retains the five documented global-event failures; no P2.I2-specific failure.
- Live Office coexistence and screenshot grading remain P2.V1 verifier work; no acceptance claim made here.
- Later owners unchanged: bound DOCX Custom XML backing data remains P2.I3; missing logger wiring remains P6.I3.
- Status: IMPLEMENTED only; awaiting independent P2.I2 verification.

## P2.I3 implementer log — 2026-08-27

- TRIAGE: SYSTEMIC native-write honesty class across the three Office lenses and their mounted command gates; held as one architecture seam.
- DOCX cell writes retain `w:tcPr` and safe paragraph interiors instead of rebuilding the whole cell.
- Bound DOCX cells resolve store identity through Custom XML properties relationships and update the safe XPath leaf with `document.xml`; ambiguous or structured bindings refuse before mutation.
- DOCX text writes emit native `w:tab`/`w:br` tokens; hyperlink and OMML ranges are preserved read-only; style aliases resolve against `styles.xml` or refuse instead of dangling.
- DOCX list-structure and table-topology/formatting commands now refuse while existing safe text remains writable.
- XLSX projects and writes semantic cell styles, fills, borders, alignment, wrapping, number formats, merges, and frozen panes; unchanged native style fields survive partial formatting edits.
- XLSX style, merge, and freeze mutations appear in semantic and part diffs; modeled stylesheet/shared-string parts are not mislabeled as preserved drift.
- XLSX charts and every other unwritten mounted family publish region refusals even when the current workbook has no such part.
- PPTX creates a native notes page, notes master when absent, content-type entries, theme/slide/master relationships, and presentation references before writing notes.
- PPTX notes creation and existing-page edits reopen through the same projection and appear as modeled diffs; unsupported slide/object sidecar flags now refuse in strict native mode.
- Focused Vitest: 8 files / 131 tests passed; full repository sweep remains deferred until paired verification.
- Scoped ESLint: zero warnings/errors. Secret scan passed across 2,088 tracked files. `git diff --check` passed.
- `tsc --noEmit` retains recorded bridge/replica test, presentation-command test, and agent-library blockers; no P2.I3 production file fails.
- Architecture check retains the five recorded unregistered global events; copy check retains the recorded missing `artifacts-shell.tsx` input.
- No browser or live Office acceptance run was performed; this implementer log does not grade P2.V1/P2.V2.
- FIELD NOTE: remaining deliberate R7 refusals are enumerated in STATE §1 and must gain a native writer plus L1 diff evidence before their gates move.
- Later owners unchanged: P2.I2 verification owns merge/CAS/conflicts; P6.I3 owns missing logger wiring.
- Status: IMPLEMENTED only; independent native Office verification remains required.

## P2.V1 reexec verifier log — 2026-08-27

- Re-executed after P2.I2/I3 landed. Isolated fixture `spectra-p2v1-reexec`; visible Word `workbook_DP2_phrase_simple_complexe.docx` and Physics PS 6/PS 8 were not driven.
- TRIAGE · SYSTEMIC: typing a native Word body nested React past its update cap. Workbar ResizeObserver treated self-caused content changes as host resizes; native incoming snapshots keyed off React `content`; TipTap option identity retriggered onUpdate.
- Held the class: ignore same-width host resizes; native incoming memo ignores body identity; collaborative onUpdate uses a ref; dirty ref/state stay paired; draft bumps coalesce.
- After full reload, essay typing of `LOOPHOLD-27` left 0 console errors; marker reached `word/document.xml`; Word COM on desktop `P2V1Reexec` read LOOPHOLD and `P2V1R-ESSAY-SPECTRA`.
- Spectra→Word formatting: heading `Complexity` is `<strong>` in Spectra and `Range.Bold=-1` in Word.
- I3 bound Custom XML: Word COM on `Content controls.docx` (reexec path) reports Ada Lovelace. First-V1 Custom XML field note closed in the live Word instance.
- Word→Spectra: italicizing the Allchin byline did not emit `<w:i` (styled paragraph). Closing Word then produced the conflict bar “Both copies changed. Nothing was overwritten.” with Keep Spectra / Keep Word and **no region previews**.
- Keep Spectra did not complete: status stayed “A verified operation is still in progress / Syncing…”. Not patched as a screenshot fix.
- PrintWindow of hidden Word hwnds is a lie (showed PS 6). Window titles and COM `FullName` are the identity source. One Word window was the p1v3-rerun essay copy; it was closed without save; the reexec essay was opened instead.
- Excel opened without a loop; A1 type did not land. PowerPoint and package SHA were not re-run; first-V1 package evidence still stands for I1.
- Focused Vitest: 7 files / 64 tests passed (native-office-draft, workbar-overflow, collaboration-change, artifact-workbar, artifact-reconciliation, preservation-guard, docx-lens). Scoped ESLint: 0 errors / pre-existing large-shell token warnings. Secret scan: no credentials in the patch; 2,088 tracked files. `git diff --check` passed.
- I1 VERIFIED/PASS from the first V1 walk is not re-graded. I2 conflict resolution is not claimed. Next remaining: finish this V1 reexec (Keep Spectra hang, Excel/PPTX alternating).
- Evidence: `.shots/reformation/P2.V1/reexec/15-essay-loophold.png`, `16-essay-conflict-bar.png`, `17-keep-spectra-stuck-sync.png`.

## P2.V1 reexec remainder verifier log — 2026-08-27

- Continuation after compaction. HEAD was `bf9b423`. Isolated fixture only; Pablo’s visible Word `workbook_DP2_phrase_simple_complexe.docx` (pid 10584) was identified via COM FullName and not driven. PrintWindow was not used as Word content proof.
- TRIAGE · SYSTEMIC (busy-gate / hung CAS): `queueMaterialization` stamped cloud current before Bridge verified; `pendingCount` treated applied Spectra writes as Syncing; Library/`forWork` counted `resolving-spectra` as open; Keep Spectra returned `pending` with no projection; client `nativeMaterialization` pending never retired when Word saved different bytes, so reconcile never ran.
- Held that class in Convex (`replicas.ts`, `bridgeSync.ts`, `syncOperationLifecycle.ts`), DOCX/office routes, and `artifact-native-sync.ts` / `native-materialization-exit.ts`. Tests: enqueue stays at base hash; applied Spectra write is not Syncing; Word save against an unverified write fails that write instead of blob-conflicting; stale pending exits when local is ahead.
- Dead Convex watcher was not killed (already gone). Started `npx convex dev --typecheck=disable` against the existing deployment; no `convex push`.
- Live: leftover Syncing cleared once Bridge was up (`19`/`20`). Spectra typed `KEEP-S-27` (0 console errors — typing loop did not regress). Headless Word `/w` COM FullName matched the fixture; Find-insert saved `WORD-OVERLAP-27` and `WORD-ONLY-27`. Zip still has LOOPHOLD-27; KEEP-S-27 never landed on disk.
- Keep Spectra did not appear; studio returned to Syncing (`25`). Release Bridge (22 Aug) calls missing `discoverResource`; debug Bridge hit `MOUNT_SCAN_NOT_CURRENT`. Excel/PPTX/package SHA were not re-run; first-V1 package SHA still stands for I1.
- Focused Vitest: replicas + replica-truth property 55; xlsx-pptx/three-way-merge/preservation-guard/native-office-draft/workbar/native-materialization-exit 55. Hidden desktop `P2V1Reexec2` closed; Convex left running.
- I1 VERIFIED/PASS unchanged. I2 live resolution still not claimed. Next remaining: finish this V1 reexec with the debug Bridge.
- Evidence: `.shots/reformation/P2.V1/reexec/18`–`26`.
