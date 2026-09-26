# S11 Office model recovery candidate

2026-09-26. OFFICE-MODELS-R `01a0dd89-a99c-79d3-899c-99f2108da08e`, owned checkout `<local-workspace>`, branch `codex/s11-office-models`. Resumed clean review commit `8ca81b124143449ccd27da96a851e753625b0e9f` on product baseline `d9aabfb5`. This is a bounded source candidate, not launch acceptance.

## Recovery and decision evidence

Read actual original OFFICE-MODELS task `01a0d858-8492-7d72-ad7e-8dffde066363`: its one working turn ended after source discovery and review cherry-pick; both subsequent turns failed with the Azure resource-reference error. There was no implementation to discard or restart. Read the actual S9 recovery task `01a0c3c8-b1cd-7f71-842b-10664ec7b630` and recent S9 acceptance turns `01a0cc6d-92d8-73d3-92cf-56492a3180ec` alongside the `8ca81b12` review, regression source and current callers. Those historical native passes concern DOCX, not new PPTX/XLSX acceptance.

| Finding | Source/call-path evidence | Candidate and verification contract |
| --- | --- | --- |
| O-R4 deleted objects resurrect | `pptxArtifactContent` exposes every modeled native object; `pptxProjectionFromContent` previously iterated the old list and appended new objects. | Explicit third argument `{ objectLists: "complete" }` makes a supplied validated object array authoritative. Default sparse calls retain unmentioned objects even when theme/nativeBinding match a full snapshot. Omitted arrays retain; explicit complete `[]` removes modeled original identities. Native-only package objects are never removal targets. |
| O-R5 absent feature blocks supported first writes | `xlsx-lens.ts` region rows classified charts/tables/names/dimensions/structure/calculation by their existing presence despite native writer operations. | Supported creation regions are NATIVE when absent. Existing unsupported validation/conditional rules, pivots, comments and package preservation claims remain restricted. New positive tests create and reopen sheet, dimensions, view settings, tab color, name, table, chart, validation and conditional rule. |
| Full office-route-projection baseline has three failures | The converter always sets `rowCount`/`columnCount` to zero or inferred coordinates even when absent from the projection/content. | Omitted bounds stay omitted. Existing or explicitly authored positive extents expand for new cells. Existing route tests retain their exact expected operations; a new distant-cell save/reopen checks actual extension. |
| Tab color written but invisible on reopen | Writer uses worksheet `sheetPr/tabColor`; reader used workbook `sheet` metadata as its root. | Read worksheet XML, preserving the existing color representation. Positive property readback asserts the color. |
| False native-transition declaration | Human capability was available when a native transition existed although the operation schema/writer has no transition operation. | Native-transition editing reports unavailable and preserved native XML remains unchanged through a separate title edit. This is an honest intermediate state; actual transition authoring remains required. |

## Caller authority and ownership

Coordinator explicitly approved the completeness option, full per-object schema and unique-ID validation, sparse default, and the `runPptxProductionSeam` adapter.project update argument. D1 owns `projectionFor`'s route argument. Remaining materialization arguments are coordinated with BRIDGE-R because it owns prepare-mode edits. No route changes are in this initial candidate.

Inventoried complete route calls at baseline: `projectionFor` (line 192), initial materialization update (246), ancestor conversion for retry (261), post-merge update (316). The seam uses complete `presentationYjsAdapter.project` content at line 178. Arbitrary sparse tools do not receive removal authority. Tests explicitly contrast identical metadata with and without the option and reject duplicate/invalid authored object lists.

## Evidence and execution boundary

`git diff --check` passed. The new seven-test `s11-office-models.test.ts`, the existing O-R4/O-R5 tests, full `office-route-projection.test.ts`, and `xlsx-pptx-lens.test.ts` are **UNRUN in this recovery** pending the globally scheduled guarded slot. No test pass is claimed. The formerly incorrect absent-feature test now checks supported availability and retains unsupported pivot/comment assertions; separate positive native readback tests justify this correction.

The coordinator explicitly authorized attaching the absent `16e5/node_modules` junction after exact absolute-path and broken-reparse absence checks. The junction targets the existing regular primary dependency directory. No dependency install, removal or replacement occurred. No service, browser, Bridge, native Office, production, school record or original local file was mutated. Subsequent tests require the inherited `2b0f` filesystem guard, maxWorkers=1 and no file parallelism.

## Required follow-through

- Route argument integration and exact PPTX readback still require verification. The route's digest includes redundant slide title/text and native reading-order indices; removal can write the right package while leaving stale expected mirrors. This candidate does not claim end-to-end native completion until this boundary is resolved and verified. Do not weaken the readback check.
- Full model ordering is retained by conversion; actual reordered native output still needs the writer/readback check. Pictures/charts/media and notes have explicit carried-part comparisons in the new tests.
- Existing new-object insertion geometry/identity and CRAFT's layout normalizer are separate owned work. CRAFT recovery is `01a0dd89-976d-7c22-be2f-dfaa7055ee59`.
- Native transitions need a typed shared model, precise supported XML import/native operation, writer, user/AI availability, preservation of unknown transition/animation XML and installed-PowerPoint readback. Merely marking them unavailable does not satisfy the user's transition requirement. Native media authoring remains required separately.
- No DOCX, shared guard, Node-route or durable reconciliation ownership is assumed by this report.
