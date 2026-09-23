# S9-OFFICE — integrated academic Word implementation

Date: 2026-09-23 (Europe/Madrid). Branch: `main`. Status: **source-side and offline Office acceptance extended; live Bridge acceptance remains blocked on the authenticated app session and safe mount**. The original live cases below remain as historical results. The continuation at the end records corrected formal-paper materialization, independent Word/SDK readback, academic deletion/retention checks, the OLE corpus, and K-bar wiring. No successful native Bridge receipt or readback is claimed.

## Integration

Recovered the preserved private implementation `9aa91c02` from `<local-workspace>` and integrated it on current main as `c86bdeb1`, after DURABLE `0ff1f359` and its report `dace56b7`. The source worktree and its unresolved, unrelated recovery state were left untouched. The only merge conflicts were in document and DOCX text projection: the resolution retains main's equation handling and includes visible academic citation, bibliography, and insertion text when paragraphs contain images. The existing uncommitted recovery registry and handoff notes were left untouched.

The shared academic reducer supplies typed operations for human document controls, registered References/review commands and K-bar, and `artifact.update.input.documentOperations`. It commits through the existing document/Yjs/canonical path, supports collaboration undo/redo, rejects mixed replacement content or arbitrary patches, and verifies all changed semantic blocks after an AI commit. Stale text and identity fences reject conflicts before mutation. The unmounted DOCX writer uses the same native academic helpers and reports a failed write rather than substituting placeholder content. Imported Word author labels remain document provenance; no account, membership, conversation, invitation, or permission is created from them.

| Family | Supported editing and native output | Explicit boundary |
| --- | --- | --- |
| Footnotes/endnotes | Insert, edit rich note body, move/delete reference; preserve positive IDs, reserved separators, story relationship, occurrence ownership and undo | Body paragraphs with text, bold, italic, single underline, tabs and line breaks. Tables, fields, drawings, revisions and other unmodeled note formatting remain protected exact carry. |
| Citations/bibliography | Insert/edit/remove Word citations, reuse verified source handles, edit shared source metadata across uses, regenerate bibliography from used sources; genuine Word source custom XML and CITATION/BIBLIOGRAPHY fields | Book, journal article, web document, report, miscellaneous; simple fields and bounded single-paragraph complex citation fields with locale/page switches. Unrecognized source types, switches, nested fields and unrelated custom XML stay protected. Supplied URLs/metadata are not labeled verified; missing metadata stays absent. |
| Classic comments | Add range anchor, edit body, delete, import/read back native author and markers | Modern comment extensions, rich unsupported bodies, point/complex anchor changes refuse at the affected region. Native annotations remain distinct from Spectra conversations. |
| Tracked changes | Author common paragraph insertion/deletion spans, import them, individually accept/reject with original/proposed text and undo | Plain, bold, italic or single-underlined spans. Moves, structural/nested revisions, run styles and other formatting revisions remain protected. Whole-document accept/reject is unavailable. |

The citation mapping retains verified source/evidence IDs, excerpts, hashes, offsets and pages in canonical content. The existing source verifier is used for AI operations. Source inventory follows used citations while unrelated custom XML remains untouched. Notes and classic comment anchors are not flattened to paragraph text. Unsupported native regions keep targeted restrictions so neighboring paragraph/table work remains editable.

## Local evidence

- Focused Vitest: **284/284 tests passed in 28 files** across academic reducers and controls, commands/schema/AI routes, document projection and Yjs, native import/materialization, durability neighbors, authority, and retention. Cases include combined academic operations with unchanged neighboring node identity, stale anchors, shared source updates, verified evidence rejection, unmounted export, undo/redo, protected native constructs, and imported citation readback.
- `npx tsc --noEmit`, `npm run lint`, `npm run check:capabilities`, `npm run check:architecture`, and `git diff --check` passed on integrated source.
- Current-main generation scripts in ignored `.shots/missions/S9-OFFICE/integrated/` produced a combined DOCX and six slices: footnote, endnote, citation/bibliography, classic comment, tracked text, and edited imported `bibliography-source.docx`. Requested and reopened semantic digests matched for all seven. The five generated slices retained their unrelated custom XML part byte-for-byte.
- Independent `scripts/fidelity-harness/office-sdk-validator.ps1` using Open XML SDK 3.0.1 / Microsoft365 reported `validAfter: true` and **zero new diagnostics** for all seven before/after packages. The combined digest was `30a4cb9ea49dc4dd2dd62ee8272e3c5be71dd6773b7ff62469ecf40df9df8e4f`; the edited imported citation digest was `3cc184a768bb66640b1f0b2556f93c679f8adc06f971bba10005f6c2fe10a47a`.

SDK validation proves package schema validity for these generated feature slices. It does **not** prove that installed Microsoft Word saves and reopens them faithfully. The live Microsoft Word evidence below is recorded separately from package validation.

## Live acceptance — 2026-09-23

The existing local instance 1 and authenticated Profile A were used. No second stack was started. The local workspace was `y97f358m8acp541a2hwfb39zw18eyfbx`. All edited artifacts and files were disposable copies; the original IBDP1 files were not opened for editing.

| Acceptance path | Result | Evidence |
| --- | --- | --- |
| Human academic controls on the formal paper | Canonical edits saved: one footnote, one citation and regenerated bibliography, one plain-prose comment, and one proposed insertion that was individually rejected. An equation-containing paragraph selection was refused as stale; a plain-prose range succeeded. | Artifact `wx7bckbz85gt17zwfyn4wanzf18ezat3`, final canonical version `ws7egak9mza3v7z8p7x6j3tmkh8eyg28`; 963 projected blocks, 695 equations, 7 tables, and the source paper's inline image. The fixture citation metadata is deliberately synthetic and marked “not verified.” |
| Formal paper native materialization and Word reopen | **Not completed.** The materializer refused twice with HTTP 400 `DOCX_LENS_FAILED`: “Spectra kept a part of this Word file untouched because rewriting it would change something Spectra does not edit. Your Spectra copy still has your change.” The response did not identify the guarded part. No native output was produced for this edited paper. | Formal-paper canonical edits remain in Spectra. This result is not a Word roundtrip for the formal paper. |
| Combined feature fixture: Word external edit and Spectra reimport | Completed on a smaller disposable DOCX. Spectra edited its footnote; Word 16.0 edited and saved it; the Word-saved copy was imported into Spectra. Readback retained the footnote, citation and bibliography, comment author/body, and tracked insertion. The Word-saved comment uses modern extensions, so Spectra displayed it read-only. | Combined fixture `wx74htsdp8npkv1422wp50kb858ez0wq`; Word-edited import `wx72a7efpzvc3jxjastzdfy4918ezz78`. Comment: `Fixture Author` / `A native annotation.` Revision: `Fixture Reviewer` / insertion `qualifies`. Citation source tag `Source1`. |
| Live AI academic operation | Completed and saved canonically on the Word-edited feature fixture. Input: “Add a single footnote to the end of the first paragraph with the exact body: AI acceptance note, 23 September 2026. Keep it as a Word-native footnote. Make no other edits; preserve the existing citation, bibliography, comment, tracked insertion, and neighboring paragraph.” | Model `openai/gpt-5.6-luna`; run `wh71c2mzdv09endefksb07tmcx8ezw5e`; result card `xd7d12qp497f5m3pkd8838m8hd8ez4em`; outcome `canonical_saved`; artifact version `ws721wjvxm5m70g4fvveqknmj18ey4k9`. The saved note reads `AI acceptance note, 23 September 2026.` |
| Post-AI native package validation | Valid DOCX; zero Open XML SDK 3.0.1 / Microsoft365 diagnostics before and after, and zero new diagnostics. Changed parts: `word/document.xml` and `word/footnotes.xml`. | `.spectra-local/launch-audit/evidence/S9-OFFICE-20260923/academic-ai-sdk.json` |
| Post-AI Microsoft Word reopen | Word 16.0 opened the downloaded DOCX read-only. It showed 3 paragraphs, 2 footnotes (including the AI note), 0 endnotes, 1 comment, 1 tracked revision, 2 fields (`CITATION "Source1"` and `BIBLIOGRAPHY`), and visible citation/bibliography text. | `.spectra-local/launch-audit/evidence/S9-OFFICE-20260923/academic-ai-word-readback.json`; generated copy `academic-ai-after.docx`. |
| Bridge local readback | **Blocked by stale Bridge device state.** A materialization was queued only to the safe disposable fixture mount and then canceled while still pending. Its device heartbeat was about 22 days old; the write was not left queued. The Bridge process also had a stale panic in its existing log. Bridge was not restarted. | No local native receipt or Bridge readback is claimed. The selected mount had `doubleSyncRisk: false`; no IBDP1 mount was used. |
| Embedded OLE import | Import failed with HTTP 500 during schema parsing; the attempted artifact could not be fetched. | No OLE edit or roundtrip is claimed. Request payload and UI capture are in the same evidence directory. |

The imported feature fixture confirmed the human References controls for footnotes, comments, and individual revisions were enabled after the region-map fix. Whole-document accept/reject controls remain unavailable. In the formal paper, individual rejection restored the original paragraph and left zero revisions. The strict equation-paragraph anchor returned “The paragraph changed. Reload it and select the range again.” No stale edit was applied.

The focused source regression run after the region-map fix passed **49/49 tests in 2 files** (`fidelity-regions.test.ts` and `docx-lens.test.ts`). The wider integration suite and checks above were recorded before this live run. Existing academic reducer/editor tests exercise collaboration undo/redo; live undo/redo was not performed here. K-bar was not exercised; the global K-bar command list does not currently surface the academic document operations. Relationship cleanup and retention were not exercised as live Office cases. These live cases remain acceptance gaps.

No Actions, external sharing, production/provider/billing changes, or original IBDP1 edits were performed. The acceptance does not claim full native completion for the formal paper, Bridge verification, OLE import, live K-bar, live undo/redo, or live Office relationship cleanup/retention.

## Continuation — offline source-side acceptance — 2026-09-23

This continuation used the already-running local instance and disposable files. Canonical artifact saves, offline DOCX materialization, installed Word readback, and Bridge-native writes are separate evidence paths. Only the first three completed here.

### Formal paper materialization and Word readback

The formal paper's current canonical version is `ws788w3ybskn9vwzqp12stn6058ez23b` (artifact `wx7bckbz85gt17zwfyn4wanzf18ezat3`). Its supported footnote has a valid Word ID `27752` and exact text `S9-OFFICE formal-paper footnote, 23 September 2026.` The offline materializer produced `formal-offline-final.docx` with four paragraph operations and no preservation violations. Its semantic readback retained 963 blocks, 695 equations, the note, citation, comment, bibliography, and original inline image.

Open XML SDK 3.0.1 / Microsoft365 validation reported `validAfter: true`, zero diagnostics before or after, and zero new diagnostics. Microsoft Word 16.0 opened the output read-only: 1,118 paragraphs, 7 tables, 1 inline image, 695 equations, 1 footnote, 1 classic comment, 0 endnotes, and 0 revisions. The citation, bibliography, and 109 fields were present. This closes the earlier offline package materialization gap; it does not supersede the earlier live native refusal or establish a Bridge write.

### Academic deletion and package relationship integrity

An offline follow-on deleted the footnote, classic comment, and citation, then regenerated the bibliography. Word readback showed zero footnotes, endnotes, comments, revisions, and citation fields; the bibliography field remained. The two source custom XML parts and source record `Source300588959` were retained for reuse. The package still had 15 parts; only `word/document.xml`, `word/footnotes.xml`, and `word/comments.xml` changed.

Open XML SDK validation remained clean with zero diagnostics. A package-level relationship check found three relationship parts before and after, no dangling internal targets, and no changed relationship files. Word 16.0 reopened the result read-only with the same 7 tables, inline image, and 695 equations. This verifies safe record deletion plus intentional source retention on a disposable package; it is not a live cleanup/retention case.

### Standalone native endnote cycle

On a separate disposable Microsoft Open XML SDK footnote/endnote fixture, the native materializer inserted endnote ID `4` at the end of the second paragraph, edited its body, moved its reference to the third paragraph, and deleted it. Spectra reopen confirmed each intermediate state. Word 16.0 read-only reopen showed the count change from two endnotes to three, preserved the inserted bold body, displayed the edited italic body, placed the moved reference in paragraph three, and returned to two endnotes after deletion; both original endnotes and both original footnotes remained. Open XML SDK 3.0.1 validation reported zero diagnostics for all four transitions. Only `word/document.xml` and/or `word/endnotes.xml` changed; the three relationship parts stayed byte-identical with no dangling internal targets.

This verifies standalone native DOCX materialization and Word compatibility for the endnote lifecycle. It does not replace the pending human selection/placement UI case or a Bridge-native receipt/readback.

### Standalone Word edit/reimport and stale-edit refusal

Starting from the inserted-endnote output, Word 16.0 added `S9-OFFICE Word disjoint marker.` to paragraph three. Reopening that exact saved file through `docxLens.open` showed the marker in paragraph three and retained the Spectra-inserted bold endnote/reference in paragraph two. Word renumbered that inserted endnote from ID `4` to ID `2` while preserving its body and reference; the readback was matched by body and anchor, not the assumed pre-Word ID. The Word-saved file SHA-256 is `e5b67cab998179e3db7eb14893e21469c1c78461d9e8667f75a32934d9d4c360`.

On a separate copy, Word changed an existing endnote body. Reopening the saved DOCX through the lens showed the Word body; an edit carrying the old expected body was refused with “The note changed. Reload it before editing.” The source file hash remained identical before and after the refused operation. Word assigned that note ID `1` and added a leading space in its projected body. Both Word-saved packages pass Open XML SDK validation with zero diagnostics; the three relationship files are unchanged and have no dangling targets. The first verifier attempt falsely missed these outcomes because it assumed IDs and whitespace stayed fixed; verification now follows the saved body/reference identity.

These are direct file-to-lens checks on disposable files, not an authenticated Spectra import artifact, canonical app save, or Bridge receipt. The application-level disjoint Word/import artifact case remains pending the sign-in session.

### OLE corpus and Word open

The full DOCX fidelity harness now passes **16 fixtures and 168 assertions**. On the embedded-OLE fixture, no-op open/save was byte-identical; paragraph text, insertion, style, run formatting, paragraph formatting, and AI text edits changed only `word/document.xml`, with the embedded OLE part preserved. Microsoft Word 16.0 opened a separate pristine fixture read-only, saw one embedded inline object, and left the file hash unchanged.

A separate import completion record reports `status: imported` and exact OLE preservation. An earlier HTTP 500 import attempt remains recorded; it was not reproduced by this completed job. The OLE fixture work was offline and does not claim a live Bridge materialization.

### K-bar wiring and code checks

The global K-bar now adds the registered document academic commands only when a document artifact is mounted. It sends a typed `document.executeCommand` event to that artifact's editor, which rechecks registered command availability and returns unavailable feedback when the editor cannot handle it. Component and routing tests cover document-only visibility and active-artifact dispatch. K-bar was not exercised in the signed-in browser session.

The same change set bounds new/edit/move Word note IDs at 32767 while allowing deletion of a larger positive legacy ID; avoids false block reorder detection when inserted/deleted paragraphs sit in shared Word regions; and fixes the DOCX harness to choose editable paragraphs and gate refusals by the exact command capability. The tracked-changes matrix now reflects its partial support: individual proposal/accept/reject commands can edit supported spans, while whole-document accept/reject remains refused.

Focused Office suites passed **131/131 tests across 10 files**. `npx tsc --noEmit` and `git diff --check` passed. A nearby XLSX projection suite had earlier unrelated failures on fixture row/column counts and remains outside this change.

### Pending live acceptance and UI follow-up

The app's in-browser session is still awaiting the user's sign-in. The dedicated empty path `.spectra-local/launch-audit/S9-OFFICE-safe-mount` has not yet been added through Settings → Devices, and no file has been placed there. Until the picker flow confirms that exact root and `doubleSyncRisk: false`, no Bridge write is attempted. There is no current successful native receipt or native readback. The earlier canonical snapshot query had `pendingCount: 0` and zero conflicts; the old HTTP 400 `DOCX_READBACK_MISMATCH` remains a failed request, not a receipt. Live K-bar, undo/redo, selection/placement, source-evidence AI coverage, app-level disjoint Word-to-Spectra edit, stale/conflicting native edit, and live relationship ownership/cleanup also remain pending the authenticated browser session.

Moderate UI follow-up: at the default short viewport, the review-rail Delete note action fell beneath the fixed Live Dock composer. It became clickable at 1600×1200, so the action is accessible with more vertical room, but it needs responsive placement or scrolling clearance. High-impact review targets are the legacy Word-ID deletion boundary, Word-renumbered note identity across body/reference anchors, projection reorder classification around shared Word wrappers, and the K-bar command event's active-artifact routing and availability recheck.

No changes were made to the original IBDP1 mount, deployment selection, or W9 files in this commit. Canonical edits were limited to the designated disposable S9 artifact; the local database was not reset and the deployment was not switched.
