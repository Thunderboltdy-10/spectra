# S6-OFFICE-BRIDGE convergence

Status: implemented on private branch `codex/s6-office-bridge`; not merged into `main`.

## Lineage consumed

This candidate started from accepted `main` `bd40997b`, then consumed the W6 product heads and the private W6 candidate named by the launch prompt:

- W6-02: `3ad39842`, `9bdb332a`
- W6-03: `2bc8181f`
- W6-04: `d6fc5dab`, `2cbb5be3`
- W6-05: `0fd8a8db`
- W6-09: `c445f57b`
- W6-01: `fe93cfb2`
- private W6 candidate: `e492458466cbb38788e5af2e20f007631b71b753`

The resulting product commits were rewritten during conflict resolution as `3240a4d5`, `90533929`, `872f5082`, `4663fc26`, `a02dca4a`, `64c7b7b0`, `f7e4c936`, and `2fb4f2f9`. The W6-02 canonical embed confirmation is retained at import and change-group commit boundaries.

## Equation/native fidelity

`src/features/spectra/lenses/equation-interchange.ts` provides a bounded structured interchange seam. It parses supported LaTeX into an AST and emits editable OMML for text, sequences, fractions, roots, scripts, operators, delimiters, matrices, and aligned expressions. Unsupported commands are returned as explicit diagnostics; they are not silently flattened into text.

DOCX projection carries both the retained `ommlXml` and the `ommlSourceLatex` represented by that subtree at open time. An unchanged native equation reuses the exact OMML subtree. An edited supported equation is regenerated semantically as OMML. Unknown/native equation subtrees remain preserved-only at the affected region, while adjacent rich runs, fields, relationships, and preserved package parts continue through the existing preservation checks. New and retained equations use the same adapter/lens writer path; the old `[Equation: ...]` fallback is removed.

The current native ledger is:

| Format/region | Status | Evidence and boundary |
| --- | --- | --- |
| DOCX ordinary text, rich runs, hyperlinks | editable | Existing lens/adapter path and focused lens tests |
| DOCX supported equations | native editable | Structured LaTeX/OMML interchange plus semantic readback |
| DOCX unknown equation commands/subtrees | preserved-only, scoped | Diagnostic or exact retained subtree; no whole-document flattening |
| DOCX images and revision/field/content-control neighbors | preserved-only | Region remains protected; surrounding text remains editable where supported |
| XLSX workbook structures and formula/chart operations from W6 | editable/equivalent per capability matrix | Existing W6-04 lens and native route tests |
| PPTX text, charts, retained presentation package | editable/equivalent per capability matrix | Existing W6-05 lens and native route tests |
| Unsupported Office features requiring a second engine | remaining launch decision | No hosted Office engine or licensing assumption introduced |

## Native-save and transition contract

`shared/native-office-contract.ts` defines:

- `NativeSaveReceipt`: deterministic `operationId`, artifact/format, base and result payload hashes/revisions, touched region and package-part targets, semantic base/result/readback digests, preserved parts, and lifecycle state.
- `NativeTransitionReceipt`: durable storage-policy transition identity, source/managed-copy identities when available, materialization request, before/after hash/path evidence, and pending/verified/failed/cancelled state.
- `nativeOperationId(artifactId, baseRevision, resultHash)`: stable acknowledgement identity used by the native routes and Bridge/Convex journal.

DOCX/XLSX/PPTX materialization routes now perform an independent semantic open/readback before queueing. A hash or ZIP change alone is not accepted. Cloud-saved, unchanged, queued, pending, verified, conflicted, and failed outcomes carry the same receipt shape. Convex `bridgeWriteRequests`, `syncOperations`, and `workReplicas` retain the receipt; `claimWrite` returns it to Bridge and `completeWrite` advances its state and acknowledgement timestamp. This lets acknowledged own writes be recognized without suppressing genuine same-region concurrent conflicts.

Storage strategy transitions return a durable transition receipt. Existing Bridge identity, grant, conditional-write, stable-read, journal, replay, and missing-source behavior remain authoritative: an unavailable/evicted placeholder is not treated as deletion, and an authorized managed/cloud copy is retained when a source disappears. The Bridge remains a filesystem identity and write/replay boundary, not a second Office conversion engine.

## Lifecycle and recovery behavior

- W6 retained payload/snapshot/replica and canonical-embed ownership behavior remains active, including late-write denial after deletion and last-owner release.
- Direct, linked, device, and Spectra storage transitions remain idempotent through the existing transition idempotency key and journal state.
- Queue acknowledgement can be dropped and replayed without inventing a new operation; a verified semantic readback is required before release of a previous copy.
- Real same-region concurrent native edits remain focused conflicts. Disjoint supported regions can continue through the existing causal/rebase paths.
- Source rename/move, offline, placeholder, delete/recreate, grant revocation, and retry are represented as explicit Bridge states; no silent global recreation or deletion is added.

## Focused verification

Passed:

```text
npx tsc --noEmit --pretty false
npx eslint <all changed TypeScript/JavaScript files> --max-warnings=0
git diff --check
npx vitest run \
  src/features/spectra/__tests__/equation-interchange.test.ts \
  src/features/spectra/__tests__/docx-adapter.test.ts \
  src/features/spectra/__tests__/docx-lens.test.ts \
  src/features/spectra/__tests__/xlsx-pptx-lens.test.ts \
  src/features/spectra/__tests__/xlsx-w6-04.test.ts \
  src/features/spectra/__tests__/office-route-projection.test.ts \
  src/features/spectra/__tests__/bridge-contract.test.ts \
  src/features/spectra/__tests__/bridge-identity-continuity.test.ts \
  src/features/spectra/__tests__/bridge-trust.test.ts \
  src/features/spectra/__tests__/office-lens-collaboration-transition.test.ts
```

Result: 10 files, 120 tests passed. The dedicated equation/DOCX subset also passed (3 files, 45 tests). Bridge app tests passed with `cargo test --manifest-path bridge/Cargo.toml -p spectra-bridge --bin spectra-bridge -- --nocapture` (18 tests), and Bridge core tests passed in the earlier focused run (45 tests).

`cargo fmt --all --manifest-path bridge/Cargo.toml -- --check` reports pre-existing formatting drift in W6 `identity.rs`, the existing `sync.rs` assertion formatting, and a retained-tree fixture. The S6 Rust change is limited to the optional `native_receipt` field in `ClaimedWrite`; no formatter rewrite of unrelated W6 code was applied.

## Sequential acceptance cases

1. **Browser -> native Word:** create a DOCX artifact, insert a fraction and a sub/superscript equation, edit adjacent rich text, save, confirm the receipt's semantic readback digest, reload, and export. Verify the equation remains an editable OMML object and untouched parts are byte-preserved.
2. **Ordinary workbook/presentation:** import an ordinary XLSX and PPTX, perform a supported formula/chart or text/chart edit, save through the native route, disconnect acknowledgement once, reconnect, and verify journal replay reaches `verified` without a duplicate write.
3. **Retained and concurrent edits:** perform two retained native edit cycles. Make a disjoint native change and a Spectra change, then a same-region native change. Verify the disjoint case reconciles and the same-region case presents a focused conflict with no overwrite.
4. **Managed-copy recovery:** switch `device -> linked`, interrupt the transition, retry, rename the source, simulate offline/placeholder state, then restore connectivity. Verify the transition receipt and stable identity keep the managed copy and never interpret the placeholder as deletion.
5. **Ownership cleanup:** release the final media/snapshot owner, then attempt a late native write. Verify the retained package is released only after acknowledgement and the late write is denied/recoverable through the existing journal state.

These are protocol/package acceptance cases on Windows; package/XML tests are not Office GUI rendering proof.

## Friend-Mac acceptance steps

1. Build the unsigned macOS Bridge package from the current branch using the documented W6-09 packaging command; do not sign or notarize with a placeholder account.
2. Install/start the Bridge, open its browser trust setup, pair it with the local Spectra instance, and confirm the granted folder is the intended disposable fixture directory.
3. Create a fresh DOCX, XLSX, and PPTX fixture on the Mac. Edit a supported equation, workbook operation, and presentation chart/text operation in Spectra; save and open each in native Office for visual confirmation.
4. Disconnect/reconnect the Bridge, rename/move the fixture, make one disjoint and one same-region native edit, and verify receipt acknowledgement versus focused conflict.
5. Simulate a cloud-placeholder/offline source and a cancelled trust/location transition. Confirm the managed copy remains available, the transition can retry, and no source is silently deleted or recreated.

Record the macOS/Office version, package hash, pairing state, receipt IDs, screenshots of the native result, and any unsupported-region behavior. Windows/package evidence in this report must not be presented as a Mac or Office-GUI claim.
