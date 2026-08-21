# ARCHITECTURE — LENSES, FIDELITY, OFFICE FORMATS

Durable reasoning for N4, N5, N7, and every mission that touches native formats. This is the most reliability-critical document in Nova. Its law is CANON D25: **what Spectra cannot safely rewrite must survive unrelated edits untouched.**

---

## 1. The lens model

A **lens** is the bidirectional boundary between a native format and Spectra's semantic model:

```
native package (DOCX/XLSX/PPTX/…)
   ⇅  lens
semantic projection  +  preserved-part carry  +  fidelity map
   ⇅  existing artifact runtime
Yjs live state → studios, AI operations, collaboration
```

- **Parse:** the lens opens the OPC package, models what Spectra understands into the artifact's semantic content (the existing Zod/Yjs models, extended as N7 deepens them), and retains *everything else* as opaque preserved parts/nodes bound to their positions.
- **Mutate:** Spectra edits map to **part/feature-level mutations**. Only dirty parts are re-serialized; untouched parts (and unmodeled nodes within touched parts) pass through byte-/structure-identical. Whole-package regeneration from the semantic model is forbidden, forever.
- **The preserved carry lives with the replica**, not in the browser: the cloud replica stores the full native payload (ARCHITECTURE-STORAGE §6); the lens works against it (server/worker-side) when materializing writes. The browser edits the semantic state only.

## 2. Fidelity classes (per feature/region, never per file)

- **NATIVE** — Spectra understands, renders, edits, and round-trips it faithfully.
- **EQUIVALENT** — represented differently in Spectra but reliably mappable both ways (e.g. a list style ↔ Spectra list model).
- **PRESERVED** — Spectra cannot edit (possibly cannot render) it, but its native data survives all unrelated edits. May have a visual placeholder ("native chart" thumbnail) or be invisible (custom XML) — surfaced only where the user interacts with it. Honesty without banner-spam: a normal document is never covered in "unsupported feature" notices, and support is never a single per-file boolean — capability varies by file, region, object, property, operation, profile, provider, permission and protection state.
- **EXTENSION** — Spectra state the native format cannot hold (live embeds, interactive outputs). Stored in Spectra's replica; written to the native file only as a **defined native fallback** (rendered image/SVG/static table) plus, where safe, a custom XML part carrying the Spectra reference for round-trip re-association.

The lens produces a **fidelity map** — region/feature → class — persisted with the replica and consumed by:

- the **command registry** (ARCHITECTURE-COMMANDS): in `strict-native` profile, commands whose result cannot be represented in the backing format are disabled-with-honest-reason or hidden;
- the **AI plane**: AI only receives operations valid in the current profile/fidelity context;
- the UI: quiet by default, precise at interaction points.

## 3. Compatibility profiles (CANON D36)

- **strict-native** (default for mounted existing files): only NATIVE/EQUIVALENT operations enabled. The file's ceiling is respected; the user's trust is the product.
- **enhanced:** EXTENSION features allowed where a fallback is defined; the file gains a fallback + reference part; the user opted in knowingly.
- **spectra-native:** no external ceiling; export is a separate explicit act.
- Profile changes are explicit, explained, reversible where possible, and journaled.

## 4. The transition law (the canonical worked example — generalize it)

A PPTX slide has a transition Spectra can't play: Spectra shows the slide, may indicate a native transition exists, edits to the title or other objects re-serialize only the touched parts — the transition XML is untouched; PowerPoint later still has it. Only when the user edits the transition itself does compatibility resolve: choose a Spectra transition with an exact PPTX equivalent → safe replace; choose something PPTX can't hold → blocked in strict-native, or enhanced-with-fallback. **Never silently discarded.** Apply the same reasoning to Word fields, bibliographies, tracked changes, section/layout machinery, formulas Spectra's engine lacks, chart configs, masters, embedded OLE, unknown package parts, and future provider quirks.

Tracked changes deserve one explicit rule now: in strict-native, a document containing revision marks opens **read-carefully** — Spectra edits are allowed only if the lens can insert them without corrupting revision structure (plain insertions/deletions outside revised runs qualify); resolving/accepting revisions is a NATIVE capability only when genuinely implemented, otherwise PRESERVED.

## 5. External-edit reconciliation (with ARCHITECTURE-BRIDGE §5)

When the Bridge reports an external revision (Word saved):

1. Lens diffs **semantically** at the part level against the replica's `baseRevision` — never byte-diff naïveté; Office rewrites large package regions on save.
2. Changes classify per region: external-only → apply into Yjs/cloud as one attributed external transaction (D28; history shows "Edited in Word"); Spectra-only → scheduled for the next materialization; both-touched → conflict record with region precision (I7).
3. Open Spectra surfaces update in place through the normal Yjs path (D40) — the external transaction is just another actor's edit as far as the editor is concerned.
4. Preserved parts changed externally simply replace their carried copies (Spectra never claimed to understand them).

## 6. The corpus and the harness (Tier R, non-negotiable)

`fixtures/office/` (created in N4, grown forever):

- **Nasty fixtures** per format covering the full hostile surface — styles, tables, comments, footnotes, equations, fields, tracked changes, floating objects, sections, headers/footers, numbering, charts, embedded objects, metadata, pivots, conditional formatting, validations, merged cells, masters, transitions, animations, media, unknown extension parts. Generated in real Office where possible; supplemented with public torture corpora; each fixture documented with what it contains.
- **The round-trip harness** (`scripts/fidelity-harness` or test-suite integration) asserts, per fixture, per mutation script (edit title / edit unrelated paragraph / edit cell / add slide object / no-op open-save):
  1. untouched parts byte-identical (or structurally identical where re-zip metadata differs — the harness knows which);
  2. semantic digest of modeled content matches expectations;
  3. the file reopens in the reference validator without repair;
  4. the specific preserved feature is still present (targeted XPath-level assertions for marquee features: the transition, the field, the tracked change).
- **Status vocabulary the harness proves:** render fidelity / semantic fidelity / mutation safety / round-trip preservation / unsupported-but-preserved / unsupported-read-only / genuinely unsupported file (opens as generic resource, never mangled).
- The harness runs in CI mode at every N4/N5/N7 gate and at every later mission's close if it touched lens-adjacent code. A red harness is stop-the-line.

## 7. Engine strategy (evaluate, then commit — inside N4's first workstream)

Do **not** hand-roll OOXML from scratch, and do **not** adopt any engine without the evaluation gate. Candidates identified in planning research (2026-08, unvalidated — treat as leads, not facts):

- **TypeScript, part-preserving:** `@ariadng/office` (zero-dep, modeled/preserve-only tiers, byte-copy of untouched parts, browser+Node); the `docx-editor.dev` core (canonical-tree preservation, corpus-CI'd — check real license/maturity); `docXMLater` (round-trip-focused DOCX).
- **Rust (Bridge/worker-side):** `office_oxide` (unified read-modify-write preserving untouched OPC parts), `ooxmlsdk` (OpenXML-SDK-derived round-trip), Go `spine` (byte-identical untouched parts, all three formats) if a sidecar is ever preferable.
- **Univer (Apache-2.0 core)** — *not* as an editor replacement (Spectra keeps its studios) but its formula engine is a candidate for Sheets calculation depth in N7. Import/export live in Univer *Pro* (commercial) — irrelevant to us; we do lenses ourselves.
- **Rejected as core:** ONLYOFFICE/Collabora (embedding a whole suite contradicts Spectra's product identity; AGPL server infrastructure); SuperDoc (AGPL, replaces rather than underlies our editor); any MCP-based path (mandated out).

**Evaluation gate (N4 W1):** for each candidate actually considered: license verified from the source (AGPL contamination = reject for core), preservation claims proven against our nasty fixtures via a spike, browser/worker runtime fit, maintenance signals, and an exit strategy (the lens API wraps the engine; swapping engines must not rewrite the lens contract). The decision, evidence, and losers are recorded in the N4 mission log and a short addendum to this file. Building the thin preservation layer ourselves on OPC primitives (JSZip/fflate + XML) is an acceptable outcome for the *preservation* path if engines disappoint — the modeled-feature breadth then grows via N7 rather than being bought.

**N4 decision addendum (2026-08-20).** Spectra adopts `@ariadng/office@0.3.0` (MIT) behind the format-agnostic lens contract. On five hostile Microsoft Open XML SDK fixtures it opened every package, produced byte-identical no-op saves, made the requested paragraph edit, and changed only `word/document.xml`. `office-oxide@0.1.8` (MIT/Apache-2.0) opened the same files but rewrote unrelated OPC parts on no-op and failed two edit probes; `docxmlater@12.1.0` (MIT) was not selected after runtime/package-cost review. The spike summary is `fixtures/office/docx/engine-evaluation-report.json`, while the durable regression proof is `fixtures/office/docx/harness-report.json`. The exit strategy is the `SpectraLens` boundary: payload transport, projections, semantic deltas, fidelity maps and preserved carry do not expose engine types.

## 8. Format part maps (starting scope — N4/N5 refine into per-format addenda)

- **DOCX (N4):** model body text/runs/paragraph+character styles/lists/tables/images/links/headers-footers(read)/footnotes(read)/comments(map to Spectra comments where safe) → NATIVE/EQUIVALENT. Fields, bibliography/citations machinery, tracked changes, sections/columns, text boxes/shapes, SmartArt, OLE, custom XML → PRESERVED initially; promoted deliberately by N7+.
- **XLSX (N5):** cell values/formats/formulas(recognized set)/tables/basic charts(read) → NATIVE/EQUIVALENT; pivots, macros (never executed; `.xlsm` stays macro-enabled and untouched), advanced conditional formatting, external links → PRESERVED. Formula semantics: unrecognized functions keep native formula text + cached value; Spectra recalculation only over the recognized set; a cell whose formula Spectra can't evaluate shows the cached value honestly, is editable-as-formula-text in strict-native, and never gets its formula rewritten as a literal.
- **PPTX (N5):** slides, text frames, shapes(core set), images, slide order, notes → NATIVE/EQUIVALENT; transitions, animations, masters/layout edits, media, SmartArt → PRESERVED with placeholders where visible.
- **spectra-pkg (N5):** the portable Spectra package for native-only artifact types — a zip container: `manifest.json` (format version, type, schema version), `content.json` (semantic state), `assets/`, `history/` optional. Stable, versioned, documented in the package itself, openable without Convex, migratable, honest about what it is (never masquerades as an Office file). Code artifacts stay real folders/files wherever possible — no packaging of repos.

## 9. What the old import/export becomes

Existing mammoth/exceljs/pptxgenjs/pdfjs paths remain as **"Import a copy" / "Export a copy"** — explicit, one-shot, lossy-by-declaration operations (useful, honest). They are never invoked by the sync path. N4/N5 relabel and fence them accordingly and delete any code path where an import silently pretended to be a link to the original.
