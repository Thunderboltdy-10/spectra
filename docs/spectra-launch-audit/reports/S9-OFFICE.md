# S9-OFFICE — integrated academic Word implementation

Date: 2026-09-23 (Europe/Madrid). Branch: `main`. Status: **implementation complete; application acceptance deferred**. This report records local source, deterministic tests, and independent package validation. It does not claim browser, live AI, Bridge, or Microsoft Word application proof.

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

SDK validation proves package schema validity for these generated feature slices. It does **not** prove that installed Microsoft Word saves and reopens them faithfully. There is no known implementation blocker. No shared runtime was managed, no browser acceptance or live AI call was made, and installed Word was not launched in this phase.

## Finite deferred acceptance checklist

1. On the integrated served source and normal authenticated Profile A, exercise each human control and K-bar command plus one small AI academic operation. Record canonical artifact/version IDs, input, saved revisions and readback. Check keyboard selection, visual placement, stale-base refusal, undo/redo and disjoint neighboring edits.
2. On disposable feature fixtures and the combined formal paper with equation, image and table, save/reload, materialize, reopen in Windows Word, edit one native note/citation/comment/revision, save, and read it back in Spectra. Record native receipt/verification IDs separately from canonical versions and compare authors, source identities, anchors, before/after text and unaffected package parts.
3. Exercise relationship cleanup, source/annotation identity after native external edit, and retention through pinned version, source deletion and final owner release. Verify protected unsupported constructs remain exact carry or give an actionable regional refusal.

No Mac or native application result is claimed. No Actions, external sharing, production deployment, or original IBDP1 edit was performed.
