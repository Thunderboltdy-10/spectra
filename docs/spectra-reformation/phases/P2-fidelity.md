# P2 — Fidelity at Full Surface

**Goal:** the full current editing surface on mounted Office files becomes provably safe (Pablo's "broad" decision): one schema per format, real 3-way merge, stable identity, ghosts made real or honestly refusing, sheets engine correct — with the composition seam under contract test for every capability. After P2, "edit a real DOCX in Spectra and in Word" is boring.

**Prerequisites:** P1.I1, P1.I2 accepted. **Architecture:** ARCHITECTURE-FIDELITY (all), ARCHITECTURE-TRUTH §1. **Findings absorbed:** Parts III–VI wholesale (DOC-*, XLS-*, PPT-*, PKG-*), SYS-1/3/4, TEST-2/3.

## P2.I1 — One schema per format (H)

Per ARCHITECTURE-FIDELITY §1: one projection schema per format shared by lens/adapter/route/AI serialization; the duplicate `blocksFromJson` pair dies (DOC-1 root); `office-content.ts` normalizations become the single typed transform; route merge validators import the canonical schema (`z.infer`, no hand twins); editors emit typed deltas alongside content so deletions/insertions/reorders survive by construction (XLS-3, PPT-2, DOC-7). The P0 interim table-refusal is replaced by real table round-trip. Package format (`.spectra-pkg`): deterministic zip (fixed mtime — PKG-1) and a working import path (PKG-2), or the download affordance is removed until it exists — no one-way recovery fictions.

## P2.I2 — 3-way merge + stable identity (H)

Per ARCHITECTURE-FIDELITY §2–§3: stored base as first-class object; `diffExternal` sees formatting/structure (R4) with tests for every attribute the write path can emit; per-region 3-way merge with precise conflicts; paraId injection on first materialize; sdt/AlternateContent-aware pairing; PPTX `p:xfrm` + real aspect ratio; refusal law wired (no positional writes). The materialize stale-base window (DOC-3) closes here: CAS against verified revision, rebase-and-retry on failure, no in-flight bypass.

## P2.I3 — Full-surface native writes (H)

Every currently-offered command on mounted files gets a real native path or an honest refusal (R7): hyperlinks/footnotes (DOC-10), run-level soft breaks/tabs preservation (DOC-8), style aliases without dangling refs (DOC-9), cell-interior preservation on cell edits (DOC-4 — engine extension), sheet styles/borders/merges/freeze panes (XLS-10), charts read+write or honest refusal (XLS-9), speaker-notes part creation (PPT-4 real fix), OMML decision documented (DOC-12). Each lands with its L1 seam test *and* diff visibility. Anything refusing at phase end gets a Field Note naming the gap.

## P2.I4 — Sheets engine correctness (M)

ARCHITECTURE-FIDELITY §6 list: serial dates, `^` associativity, whole-column refs, 10k truncation (raise + warn or stream), one reference-shifter for sort/paste/structural (XLS-2), percent-as-format (XLS-4), locale entry (XLS-7), rename/structural cross-sheet ref rewriting (XLS-8), cached-staleness marking (XLS-6), find-replace formula-literal safety, clear.all asymmetry (XLS-11).

## P2.I5 — Corpus + seam contract harness (M)

ARCHITECTURE-FIDELITY §5: realistic fixtures (verified sidecars), sequence fixtures, and the L1 harness running the *production* pipeline per format in its owning verification unit — with named tests for every Part III–V CRITICAL shown failing against pre-fix code where feasible. The old direct-lens harness remains as an engine-level layer; it no longer counts as product evidence by itself.

## P2.V1 — Office coexistence verification (H)

Adversarial verifier with real Word/Excel/PowerPoint in the loop: formatting round-trips both directions; alternating edit sessions; simultaneous open; save-during-materialize races; table/content-control documents; conflict UX (can a person actually resolve one and keep both?); package export/import. Sequence evidence throughout (R11).

## P2.V2 — Real-documents journey (M)

Pablo supplies (or verifier synthesizes) a folder of realistic school documents; goal cards exercise mount→edit→Word-verify→re-edit cycles per format. Hash checks prove untouched files stayed byte-identical (D25 in the field).

## Exit gate

L1 harness green in the owning verification units for all formats; every write capability has diff-visibility + identity + seam test, or visible refusal; V1/V2 PASS; no corruption reproducible by the verifier's adversarial session; Pablo pass on his own real files.
