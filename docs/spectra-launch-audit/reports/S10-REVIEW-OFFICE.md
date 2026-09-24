# S10 REVIEW-OFFICE — independent academic/native review

Date: 2026-09-24. Branch: main; inherited dirty baseline preserved. **Source repairs and offline validation ready; authenticated K-bar, short-viewport review controls and a new installed-Word cycle await the coordinator's runtime slot.** No current live acceptance is claimed.

The session initially had workspace-write/restricted network. After the explicit continuation its actual permissions became danger-full-access / approval never. No branches, staging, commits, runtime changes, real school files or original IBDP1 files were changed.

## Repairs and exact ownership

| Finding | Reproduction and repair |
| --- | --- |
| P1: cloud bibliography paragraph identity collision | A cloud document with an ordinary paragraph ID `bibliography` received another block with that ID. The collision loop checked a native hash but assigned the cloud string. `document-academic-operations.ts` now checks the actual identity it will assign. Regression verifies both paragraphs and distinct IDs survive Yjs. |
| P2: low-level editor note insertion bypass | Mounted `SpectraNotes.insertFootnote/insertEndnote` generated 31-bit note IDs although the native writer/edit schema accepts 1–32767. `insertContent` also deleted selected prose. Both commands now allocate an unused Word-compatible ID, validate the shared academic anchor, insert at the selection end and select the note for editing. Tests reproduced the deleted `Keep` text before repair; both note kinds now preserve prose and permit immediate body edits. References already used the shared path; no direct UI caller of these legacy insert commands was found. |
| P2: Delete note obscured by composer | The independent review rail had only 10px bottom padding. It now consumes `--spectra-composer-safe-area`, adds matching scroll padding, and prevents flex sections shrinking over their controls. The rail and close button receive accessible names. Existing visual structure is retained. |
| Stale combined roundtrip assertion | The inherited readback change allows omitted defaults on new paragraphs; one test still compared raw defaults. It now retains exact existing-block comparisons and checks the intent-aware digest. Independent negative variants removing a note or its bold body formatting must mismatch. No writer refusal or loss check was removed. |

Changed product/test paths owned by this lane:

- `src/features/spectra/commands/office/document-academic-operations.ts` — bibliography identity allocation only.
- `src/features/spectra/editor/document-notes.tsx` — low-level note insert commands only.
- `src/features/spectra/editor/document-academic-commands.ts` — `academicSelection` accepts a state-bearing editor view for chain-safe validation; inherited selection fix preserved.
- `src/features/spectra/components/document-studio.tsx` — review rail/close-button accessible labels only. OPEN owns its separate readiness prop/effect.
- `src/styles/spectra-document.css` — review rail clearance and shrink behavior.
- `src/features/spectra/__tests__/document-academic-editor.test.ts`, `document-academic-commands.test.ts`, `docx-academic-review.test.ts` — focused regressions and cleanup/protection checks.
- This report. Disposable harnesses and evidence are ignored under `.spectra-local/launch-audit/evidence/S10-REVIEW-OFFICE/`.

No artifact-studio or run-loop edits. OPEN approved the rail hunks; S10-AI was informed of the unchanged typed-operation contract and bibliography fix.

## Current deterministic and package evidence

Each focused Vitest invocation used `--maxWorkers=1`. Latest outcomes by suite group:

- Academic note/citation suites: 11 passing tests; legacy ID `40000` deletion, reserved separators, note edit/move/delete, rich content, citation metadata/evidence, real fields and native source XML.
- Academic command/editor suites after repairs: 9/9. Includes shared selection, collaboration undo, preserving alignment, bibliography collision and negative native-loss assertions.
- Academic review suite: 8/8. Added ownership check removes a deleted paragraph's comment, preserves an unrelated orphan annotation, refuses deletion of a protected table comment anchor, and permits a neighboring endnote without changing that table.
- DOCX lens, XLSX/PPTX lens and XLSX W6-04: 81/81 in 21.16s. Shared-wrapper append emits no redundant reorder and readback detects changed paragraph text. No XLSX/PPTX source changes made. The historical unspecified XLSX projection failure was not reproduced by these suites.
- K-bar registry/component, Word review projection and native document projection: 25/25 in 10.43s. Active artifact dispatch/document-only visibility remain verified deterministically; this is not live K-bar evidence.
- Focused strict ESLint and `git diff --check` passed. Global build/typechecks remain coordinator-owned.

Current lens checks read the actual historical Word-saved disposable `endnote-word-disjoint.docx` (SHA-256 `e5b67cab998179e3db7eb14893e21469c1c78461d9e8667f75a32934d9d4c360`). Word had renumbered the inserted endnote from `4` to `2`; the current lens found its body/reference at `docx:paragraph:65321359`, edited the current identity, and rejected both the old ID and a stale body against the separately Word-edited conflict file. The input hash remained unchanged. The output digest matched the requested semantics and neighboring blocks stayed equal. Only `word/document.xml` and `word/endnotes.xml` changed; all three relationship files remained byte-identical.

The current combined fixture edit retained one comment, two revision marks, and one source; only `word/footnotes.xml` changed. Open XML SDK 3.0.1 / Microsoft365 independently validated both generated outputs with **zero diagnostics before/after and zero new diagnostics**.

| Output | SHA-256 |
| --- | --- |
| `word-renumbered-after.docx` | `a8c2247e4fe662c5097932ef23e366219094cae30d4a067594dff9f0784abbf8` |
| `combined-after.docx` | `41d5ebf725779ad44400e5677a99befe3968532bd80a01c2a3118ab884287bf6` |

Evidence: `native-checks.ts`, `native-checks.json`, `word-renumbered-sdk.json`, `combined-sdk.json`, and corresponding before/after DOCX files in the S10 evidence directory. Historical Word execution establishes the input's provenance; it does not count as a newly run Word check.

## Review-rail layout evidence

An isolated local HTML fixture used the actual before/after document CSS and representative rail markup with a 160px published safe area. It did not contact the application or mutate the shared browser. At maximum scroll:

| Viewport | Before: final button bottom / dock top | After | Pointer check |
| --- | --- | --- | --- |
| 1280×720 | 700.17 / 572 | 534.17 / 572 | Before obscured; after clicked |
| 390×844 | 824.17 / 696 | 658.17 / 696 | Before obscured; after clicked |

Evidence: `prepare-layout.mjs`, `check-layout.js`, `layout-results.txt`, and four `rail-*.png` captures. This proves the CSS correction in the isolated geometry. The full served app's layout and keyboard journey still need the reserved slot.

## Preserved contracts and remaining acceptance

- Unsupported note stories, modern comments, structural/formatting revisions and complex table anchors retain targeted protections. A neighboring supported edit must not promote those regions to editable.
- Imported author names remain native provenance. No account, invitation, Spectra thread or permission is created by these operations.
- Owned annotation deletion differs from pruning unrelated orphan records. Reserved note stories/relationships and reusable native source records remain intentional carry.
- Native note IDs may change on Word save; assert saved body plus actual reference/paragraph association. Stale identity/body operations must refuse instead of guessing a replacement identity.
- Exported copies, canonical saves, queued linked writes and verified linked-native writes are distinct outcomes. Existing unmounted export tests pass; SDK success does not prove Bridge delivery or installed-Word reopen.
- Coordinator's queue: DATA build/deploy, first AI study/deck case, then this lane's short viewport/K-bar/Word slot, then COLLAB/RELEASE. Live simultaneous collaboration, process/OS crashes, exhaustive retry states, exact V9 linked Sheets/PowerPoint journeys, macOS and production remain outside the evidence here.

### AI export inspection handoff

The coordinator confirmed this lane will inspect AI's exact first guide/deck exports immediately after the AI live corpus, once its native slot is granted. AI and OFFICE agreed on one helper: `.spectra-local/launch-campaign-20260924/S10-AI/inspect-native-exports.ps1`. OFFICE extended the prepared helper with a separate input copy, source/copy hash checks, Word notes/comments/revisions, PPT speaker notes, an explicit PPT read-only check, native aspect-ratio PNG sizing, and failure JSON. It retains the AI exports-root restriction and refusal when Word/PowerPoint is already running. The duplicate OFFICE helper was removed before execution. PowerShell syntax parsing passed; **no Office process was launched and no render/readback is claimed by this preparation**.
