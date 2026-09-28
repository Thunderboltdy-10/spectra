# ARCHITECTURE-FIDELITY — the lens pipeline, rebuilt on one schema and a real merge

Owner phase: P2. Binding under CANON R3–R5, R7, D25, D36. The lens *concept* (project native → edit semantic → materialize typed ops with byte preservation) is validated and kept; its seams and merge model are replaced.

## 1. One schema per format (R5)

Today one capability crosses 10+ hand-mirrored schemas; two different `blocksFromJson` implementations disagree about tables (the DOC-1 corruption root). Target shape per format:

- **One projection schema** (the lens's) is the canonical semantic model for linked work, shared by: lens open/materialize, the Yjs adapter, the route, and the AI serialization. It lives in one module with one Zod schema and `z.infer` types; route validators import it.
- **Editors may keep richer view-models** (TipTap doc, grid model, canvas objects) but each derives from/to the projection through **one typed, tested transform** — the second copies (`office-content.ts` normalizations, route merge Zod twins, studio-local `blocksFromJson`) are deleted, not deprecated.
- **Editor intent flows as typed deltas** where it exists: editors emit the lens's semantic delta vocabulary (`replace-paragraph`, `set-cell`, `add-slide-object`, …) alongside content, so materialize applies intent instead of re-deriving it by diffing projections (fixes position-blind inserts, dropped reorders, delete propagation by construction — DOC-7, XLS-3, PPT-2 class).

## 2. Identity (R3)

- DOCX: `w14:paraId` primary. On first materialize of a document lacking paraIds, **inject them** (Word-compatible, part-level change) so subsequent edits have stable anchors. Tables pair by identity (paraId of anchor / stable table id), never by body-child counting; sdt/AlternateContent-wrapped tables are first-class in the pairing walk (DOC-5).
- XLSX: sheet id + cell address (address shifts on structural ops are handled by the *delta*, which names the structural op explicitly).
- PPTX: slide partName + `p:cNvPr` id; geometry reads honor both `a:xfrm` and `p:xfrm`; deck aspect ratio read from the package, never assumed 16:9 (PPT-3).
- **Refusal law**: a write whose region identity cannot be established stably is refused with a plain reason. No positional fallback for writes, ever.

## 3. Three-way merge (replacing 2-way blind diff)

The stored base (ARCHITECTURE-TRUTH §1) makes real merge possible: **base** (last agreed projection + payload revision), **ours** (Spectra semantic state), **theirs** (external bytes' fresh projection).

- `diffExternal` compares full projections — text, formatting attributes, structure — not `{id,text}` (R4 / DOC-2). The digest covers everything the write path can change.
- Merge is per-region 3-way: changed-in-one-side applies; changed-in-both conflicts precisely (region-level, both values shown); formatting-only external changes are *changes*.
- Materialize always bases on the verified current revision with CAS; the in-flight-write bypass (`replicas.ts:485-487`) is removed — a stale base is a retry-after-rebase, never a silent overwrite (DOC-3).
- "Keep Spectra" resolution applies only Spectra-changed regions over theirs (no wholesale document reapply, no `DOCX_UNSUPPORTED_EDIT` throw on foreign insertions — DOC-6).

## 4. Full surface, honestly (R7 — Pablo's "broad" decision)

The current command surface on mounted files is the commitment; the program makes it real rather than shrinking it:

- Every command that claims native-writability must have: a lens delta, diff visibility for what it writes (R4), stable identity (R3), and an L1 seam contract test. That includes today's ghosts: hyperlinks, footnotes, sheet styles/borders/merges/freeze panes, charts (write-back), speaker notes (create the notes part when absent instead of dropping text — reversing PPT-4's regression).
- What cannot meet the bar by P2's gate ships as an **honest strict-native refusal** (visible, reasoned, D36-compliant) — never a silent no-op — and carries a Field Note naming what it would take.
- `assertPreservationKept` guards **every** materialize path including DOCX (today it guards only the office route); the XLS-1 worksheet-regex false-claim is fixed in P0.
- The engine (`@ariadng/office`) is kept as the OPC/preservation substrate; mutation gaps (cell-interior preservation — DOC-4, notes-part creation, chart parts) are closed by extension/fork, evaluated per-gap in P2. Regenerating whole files from the semantic model remains forbidden (D25).

## 5. Corpus and sequences (with L1/L2)

Fixtures must look like a school's real files: content-control-wrapped tables, merged/nested tables, tables in headers, tracked-changes wrappers, AlternateContent-heavy decks, SmartArt, video parts, real pivot workbooks, external links, non-16:9 decks, locale-formatted workbooks. Sidecar claims are verified against fixture bytes (TEST-2's "merged and nested" fixture that contained neither is the counterexample). Sequence fixtures are first-class: scripted multi-edit sessions, undo mid-sequence, rapid saves, edit→external-save interleave — because every field symptom was sequence-dependent.

## 6. Sheets engine correctness (Spectra-side, same phase)

Dates as Excel serials (the underlying library already handles serials + 1904 — use it); `^` associativity; whole-column refs; the silent 10k-address truncation; **one** formula reference-shifter shared by sort/paste/structural ops (three exist today, one correct); percent-format as format not value-mutation; locale-aware entry parsing; cached-formula staleness marking (visible "shown from Excel cache" aging). Cached-only formulas remain non-recalculated (the no-literalization contract is kept — it is correct).
