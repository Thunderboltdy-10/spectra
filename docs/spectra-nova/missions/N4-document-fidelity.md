# N4 — DOCUMENT FIDELITY

**Charters:** Fidelity Engineer (primary) + Product Engineer (editor integration)
**Prerequisites:** N3 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-FIDELITY (all); ARCHITECTURE-BRIDGE §5, §7, §8; ARCHITECTURE-STORAGE §2, §8, §9; ARCHITECTURE-COMMANDS §2 (availability)
**Evidence:** `.shots/missions/N4/` plus harness runs under `fixtures/office/` · **Tier R throughout**, Tier P for the editing experience

## Objective

Make a real `.docx` on the user's disk a first-class Spectra Document: it opens in Spectra's own editor, humans and AI edit supported content immediately, the local file catches up asynchronously and verifiably, Word can be used on the same file in parallel, and **everything Spectra does not understand survives untouched**. This is the mission where CANON D25 stops being a sentence and becomes tested machinery.

## Why now

DOCX is the highest-value format and the hardest preservation problem; solving it first establishes the lens contract that XLSX, PPTX and every future provider reuse. Doing Sheets first would tempt a shortcut (formulas feel tractable) and would leave the hardest architecture question unanswered.

## The single law of this mission

If the lens cannot safely rewrite something, that thing must come out of a Spectra edit **byte-for-byte where the package permits and structurally identical otherwise**. A regeneration of the whole package from Spectra's model is forbidden — not as a temporary step, not behind a flag, not for "simple" files.

## Workstreams (ordered)

### W1 — Engine evaluation gate (Tier R, hard gate before any dependency lands)

1. Build the nasty-fixture starter set first (W2.1 may run in parallel) — evaluation without hostile inputs is theatre.
2. For each candidate actually considered, record in a table: license **read from the source repository** (AGPL or unclear = reject for core), preservation model, runtime fit (Node worker, browser, Rust/Bridge), maintenance signals, package size, and an exit strategy.
3. Candidate leads from planning research (unvalidated — verify everything): `@ariadng/office`, the `docx-editor` canonical-tree core, `docXMLater` (TypeScript); `office_oxide`, `ooxmlsdk` (Rust, Bridge-side); Go `spine` if a sidecar ever wins. Rejected as core by CANON: ONLYOFFICE/Collabora, SuperDoc, any MCP path.
4. Run a spike per shortlisted engine: open five nasty fixtures, mutate one paragraph, re-serialize, assert untouched parts unchanged and the file opens in Word without repair. An engine that fails this is out, regardless of its README.
5. **Acceptable outcome:** none of them wins and Spectra builds a thin preservation layer on OPC primitives (`fflate`/JSZip + XML) itself, growing modeled breadth through N7. Choosing this is a success, not a failure — it is chosen with evidence, not by default.
6. Record the decision, the evidence and the losers in the mission log plus a short addendum to ARCHITECTURE-FIDELITY §7. The lens API wraps the engine so a future swap does not rewrite the contract.

### W2 — Corpus and harness (Tier R, grows forever)

1. `fixtures/office/docx/` with documented nasty fixtures covering: multi-level numbering, style inheritance, tables with merged cells and nested tables, comments, footnotes and endnotes, equations (OMML), fields (TOC, cross-references, page numbers, `DOCPROPERTY`), bibliography/citation sources, tracked changes with multiple authors, floating shapes and text boxes, SmartArt, embedded OLE, headers/footers with section variation, columns, content controls, custom XML parts, unusual metadata, a macro-enabled `.docm`, a password-protected file, a corrupt file, and a file with an unknown future extension part. Each fixture ships a sidecar note describing exactly what it contains and what class each feature should get.
2. Prefer generating fixtures in real Word where possible; supplement with public torture corpora; never rely on fixtures produced by our own writer.
3. The harness (`scripts/fidelity-harness` or an equivalent test target) asserts per fixture × mutation script (`no-op open+save`, `edit one paragraph`, `edit a table cell`, `insert a paragraph`, `apply a style`, `AI edit via the operations layer`):
   - untouched parts byte-identical, or structurally identical where zip metadata legitimately differs (the harness knows which and why);
   - a semantic digest of modeled content matches expectations;
   - the file opens in the reference validator without repair;
   - targeted XPath assertions prove marquee preserved features still exist (specific field, specific revision mark, specific bibliography source, specific custom XML part).
4. The harness prints a per-fixture fidelity report using the exact vocabulary of ARCHITECTURE-FIDELITY §6 and fails loudly on regressions. Red harness is stop-the-line.

### W3 — Lens architecture (Tier R)

1. `src/features/spectra/lenses/` with the format-agnostic contract: `open(payload) → { projection, fidelityMap, preservedCarry }`, `mutate(preservedCarry, semanticDelta) → newPayload`, `diffExternal(payloadA, payloadB) → semantic change set`, `materialize(projection + carry) → payload`, `capabilities(profile) → availability facts`.
2. Execution home: lenses run **server/worker-side** (Node) against payloads from the payload module; the browser edits only the semantic state; the Bridge only moves bytes and never interprets formats. If W1 picks a Rust engine, the lens contract stays identical and the Bridge hosts the implementation — the contract must not leak the choice into callers.
3. The preserved carry lives with the cloud replica payload (ARCHITECTURE-FIDELITY §1), versioned, addressable, and never reconstructed from the projection.
4. The fidelity map persists with the replica and feeds command availability (C2) and the AI operation set. A file whose map says "tracked changes present" narrows what Spectra offers, honestly and quietly.
5. Compatibility profiles per D36: mounted existing DOCX opens `strict-native`; profile changes are explicit, explained, journaled and reversible where possible.

### W4 — DOCX end to end (Tier R + P)

1. Open: a mounted `.docx` projects into the existing Document artifact model (Yjs `spectra:document-v2`) with the part map of ARCHITECTURE-FIDELITY §8 — body text, runs, paragraph and character styles, lists, tables, images, links as NATIVE/EQUIVALENT; fields, bibliography machinery, tracked changes, sections, text boxes, SmartArt, OLE, custom XML as PRESERVED.
2. Edit: typing is immediate and never waits (I2). Local materialization is asynchronous, journaled, verified through the N3 write pipeline, and reported with the real status vocabulary.
3. Reopen in Word after Spectra edits: edits present, no repair prompt, preserved features intact. This is a manual gate as well as a harness assertion.
4. Unsupported files fail honestly: a password-protected or corrupt DOCX opens as a generic resource with a truthful reason, never a mangled document.
5. Import-a-copy paths (`mammoth`, `import-docx.ts`) are relabelled and fenced per ARCHITECTURE-FIDELITY §9 — explicitly lossy, one-shot, and unreachable from the sync path. Delete any code path where an import pretended to be a link to the original.

### W5 — Word coexistence (Tier R + P)

1. External revision arrives from the Bridge → lens diffs semantically at part level against `baseRevision` → classification per ARCHITECTURE-FIDELITY §5.
2. External-only changes apply into Yjs/cloud as **one attributed external transaction** (D28); history shows "Edited in Word" (attribution model in ARCHITECTURE-AI §6).
3. Open Spectra surfaces update in place through the normal Yjs path (D40): no remount, no duplicate item, no lost scroll, no closed split. Verify with the document open in a split while Word saves.
4. Same-region double edits produce a precise conflict record and a calm, specific conflict surface ("Word changed the bibliography while Spectra edited it") with keep-which choices. Never last-write-wins (I7).
5. Preserved parts changed externally simply replace their carried copies.
6. Tracked-changes rule from ARCHITECTURE-FIDELITY §4 is implemented as written: documents with revision marks allow only edits the lens can make without corrupting revision structure; accepting/rejecting revisions stays PRESERVED until genuinely implemented.

### W6 — Availability wiring and honesty (Tier P)

1. In `strict-native`, commands whose result cannot be represented are disabled with an honest one-line reason or hidden — decided per command, recorded in the registry, never a banner farm across the document.
2. The AI receives only the operation set valid for this file, profile and fidelity map (C2/A2).
3. Where a preserved feature is visible (a native chart, a SmartArt block, a content control), it renders as a quiet placeholder that says what it is and that Spectra is keeping it safe — one small affordance, not a warning.

## Invariants to uphold

D25 (the preservation law), D26 (truthful status), D28 (external edits as transactions), D36 (profiles), I2, I7, I8, C2. The corpus grows before the capability, always.

## Out of scope

XLSX and PPTX (N5) · `spectra-pkg` (N5) · deep Word feature parity such as full field editing or accepting revisions (N7 promotes deliberately) · policy UX (N6) · AI-initiated file operations (N8).

## Acceptance gates

1. **Engine decision recorded** with license evidence, spike results and the exit strategy; if an engine was adopted, its preservation claims are proven on our fixtures, not its documentation.
2. Harness green across the DOCX corpus for every mutation script, including a `no-op open+save` that must produce an untouched package. Dated run in the log; report committed.
3. **F2 passes:** mounted DOCX opens, types immediately, materializes locally (status reaches `Saved locally` only after read-back verification), reopens in Word with edits present and a named Word-only feature intact.
4. **F3 passes:** Word saves while the artifact is open in Spectra; the open surface updates in place; a same-region collision produces a precise conflict with a working resolution.
5. Preservation spot-proofs: for at least five marquee features (a field, a tracked change, a bibliography source, an embedded OLE object, a custom XML part), an XPath assertion proves survival across three unrelated Spectra edits.
6. Honest failure: password-protected, corrupt and `.docm` fixtures behave per plan (resource, honest reason, macros untouched and never executed).
7. Command availability in `strict-native` demonstrated with screenshots (a disabled command with its reason; a preserved-feature placeholder).
8. P1, P2, P8, P11 pass on a mounted DOCX as well as a native document; P12 sentinel unaffected on a large fixture.
9. STATE gains a fidelity section with per-feature classes and the harness path; mission log ≤40 lines; close-out checks green.

## Mission log — 2026-08-21

- Adopted `@ariadng/office@0.3.0` (MIT) behind `SpectraLens`; five hostile-fixture spike passed byte-identical no-op and single-part edit probes. `office-oxide` failed preservation/edit probes; `docxmlater` lost on runtime/package cost. Exit remains the format-agnostic lens contract.
- Added 16 public Open XML SDK fixtures plus sidecars and the DOCX harness. Final run: 16 fixtures, 101 assertions, green; no-op packages byte-identical.
- Persisted semantic projections, preserved carry, fidelity maps, strict-native capabilities and verified payload materialization through Convex replicas and the Bridge journal.
- Mounted DOCX now opens in the native Yjs Document editor with Word heading styles, protected field rows and stable region IDs.
- Fixed native editor lifecycle races that replayed stale artifact content over fresh Yjs keystrokes; typing remains immediate through acknowledgement.
- Real F2 pass on `.tmp-n4-mount/N4-controlled-fields.docx`: Spectra edit retained, Word lock reported Waiting, unlock materialized and read-back verified, status reached Saved locally, TOC/fields survived and Word showed no repair prompt.
- Real F3 pass: Word save produced a persisted same-region conflict with Keep Spectra / Keep Word controls; Keep Word applied in place and surfaced Edited in Word.
- Five marquee XPath spot-proofs survived three unrelated Spectra edits: field, tracked change, bibliography source, embedded OLE and custom XML.
- Password-protected/corrupt fixtures fail honestly as resources; `.docm` macro parts remain untouched and are never executed.
- Strict-native command registry disables unsafe template/import operations with reasons; preserved Word fields render as a quiet protected placeholder.
- Identity continuity tests cover duplicate local candidates and resource→document activation without changing work ID.
- Close-out: `tsc`, lint, 23 focused tests, DOCX harness, secret scan and `git diff --check` green. Bridge stopped after testing; production Physics grant untouched.
