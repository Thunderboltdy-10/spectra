# S11 preservation contract repair

Owner task: `01a0d858-8493-7c21-8e61-69089f02a58d`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

## Scope and effective configuration

Isolated checkout `<local-workspace>`, starting HEAD `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. The recorded first turn independently confirms `gpt-6-astra`, `xhigh`, `danger-full-access`, and approval policy `never`.

This bounded repair owns the preservation guard, a package proof helper, the existing route/seam guard invocations, and fidelity declaration rows. It does not change native writers, the projection storage model, reconciliation policy, receipts, Bridge, or academic serializers. Coordinator approved the expanded seams. DOCX and DURABLE confirmed nonoverlap; DOCX retains its academic mapping classification and delta unification hunks. No subagents, new tasks, native applications, macro execution, runtime changes, or original native-file writes.

## Decision review

| Source | Original decision/finding | Current call-path evidence | Verdict and cross-system consequence | Evidence / residual |
| --- | --- | --- | --- | --- |
| `b6438503`, `preservation-guard.ts`; Office review `9321887f` O-R6 | First protected claim wins per ZIP part. | DOCX materialize/download/conflict resolution, Office materialize and seam helpers converge on this guard after readback. | REPLACE. Every scoped claim must have positive preservation evidence; declaration order cannot permit loss. Report one failed reason per part. | Direct guard and complete-subtree regressions; no application proof claimed. |
| `b6438503`; O-R7 | All one-sided parts exempted as assumed cleanup; old notes test supplied no ownership evidence. | Missing macro, embed or unclassified part bypassed every claim. | REPLACE. Any removed original part needs explicit deletion intent resolved against the original native projection and original relationship graph. Additions remain permitted. | Tests distinguish intent/no intent, original shared owners, dangling references, invalid relationship identity, and owned notes/chart/embed graphs. |
| Pinned `@ariadng/office` 0.3.0, `dist/preservation/index.js` | Guard treated matching diagnostic paths as complete evidence. | `compareXml` stops below element-name/node-kind mismatch and compares only the shared child prefix. A trailing removed element may yield only its parent's `child-count`. There is no numeric diff cap in this SDK. | REPLACE path inference with `compareXml` over every complete attached protected subtree, including count and resolved namespace. Inherited `xml:space` stays attached. | Tests reproduce the real omitted-tail path and also supply empty diagnostic lists. Namespace prefix changes remain equivalent; namespace rebinding and significant whitespace loss fail. |
| Coordinator source review of `d8cbff42`; SDK `_dropCalcChain`, `xlsx-cache-policy.ts` | Generic removed-part enforcement could refuse legitimate derived calculation-cache invalidation. | Formula-affecting operations call cache invalidation; clearing the final formula can also drop the chain before that pass. | ADD typed derived-cache proof, not a presence exemption: original workbook relationship, standard cache-only XML, no unknown relationship payload, no shared/surviving references, and either explicit recalculation flags or no remaining worksheet formulas. | Native XLSX input-edit and final-formula-clear cases; unknown cache XML refuses removal. |
| `bf9b423c` | Whole-part preservation flags froze supported edits in shared NATIVE parts. | Body, bound custom XML and academic story parts host editable and carried content together. | KEEP the existing distinction for unscoped shared-part flags. Add concrete scopes for PPTX transition/timing. Do not freeze DOCX because it has a carried field. | A broad capability flag is still not a per-record preservation proof. DOCX rich-property/extension handling belongs to OFFICE A; exact protected DOCX record locators remain outside this unit. |
| Lens `partNames.find` family declarations | Only the first part of each protected family was declared. | DOCX partRule and PPTX/XLSX preserved-family loops. | REPLACE with all matching parts while retaining the first legacy region ID. PPTX adds macro/embedded-part declarations. | Subsequent family members now participate. Native classification remains unchanged; supported chart editing versus part-level carry classification needs its own writer-boundary review. |
| Actual S9-OFFICE `01a0be89-5949-78d0-b5a1-65479faddfb6`, turn `01a0be89-5b81-7133-953b-a6b2553b2c96`; recovery/integration tasks from charter | Shared academic model, native identities and target-specific protection; combined package validation and semantic readback. | Shared reducers and DOCX writer remain in place; native routes still compare requested/readback semantics before preservation proof. | KEEP. The package guard complements semantic readback; neither substitutes for unknown-attribute preservation in the writer. | Read actual task messages and source/commit hunks, rather than treating historical validation reports as current proof. |
| S9 acceptance `01a0cc6d-92d8-73d3-92cf-56492a3180ec`, turns `01a0cf7d-b011-7f72-a01a-de3492ce17dc`, `01a0d1e8-ce98-7163-b19e-d803314cc8e7` | Native locator/default normalization prevented false refusal; later live Bridge/Word marker checks passed specific workflows. | This repair leaves semantic digests, promotion and receipt policy unchanged. | KEEP bounded normalization and distinction between source/package/native proof. | Historical native acceptance does not validate this new guard. Installed Office/Bridge acceptance is deferred to RUNTIME on disposable fixtures. |

## Implementation contract

`assertNativePreservationKept` is called on the same already-validated native packages used by the materializer. For changed scoped XML, it reads only that part and compares every matching element with the SDK's namespace-aware comparator. It does not trust diagnostic path coverage. Binary parts are not inflated again for subtree proof.

For removals, typed `remove-slide`, `remove-sheet`, `remove-chart`, `remove-table`, or `delete-image` operations resolve to existing owners in the original projection. The helper verifies original owner references and traverses known ownership relationships. It rejects any original surviving shared owner even if a faulty output also erased that owner's relationships, as well as dangling output references. Invalid roots invalidate their descendants; disconnected cycles cannot supply ownership. Shared masters/layouts/themes, VBA and unknown relationship kinds cannot be swept up as incidental descendants. Empty relationship-part cleanup is allowed only after all original owned targets are proved removed and no consumer survives. A Word image needs explicit deletion of every projected occurrence and a matching native reference count.

A relationship or filesystem absence is never a deletion authorization. This is internal materializer evidence, not an HTTP field a caller may supply. Native deletion approval and persisted tombstone/ancestry policy remain the existing server/Bridge responsibilities.

Calculation-chain removal is a distinct derived-cache case: eligible typed XLSX edits may release an original standard `calcChain` relationship only when its XML contains purely native cache entries, it has no relationship payload, and the output requests full recalculation or has no remaining formulas. Unknown XML is preserved by refusing that removal. Source inspection confirmed DOCX block deletion retains media parts, final note/comment deletion retains story parts, and PPTX object deletion retains linked binary parts; tests exercise those actual paths rather than granting speculative deletion exemptions.

## Validation

Guarded validation completed on 2026-09-25 after RUNTIME restored exact-lock dependencies and the coordinator released slot 1. Every Node invocation used RUNTIME's `fs-guard.cjs`, with one Vitest worker and no file parallelism. The worktree uses a verified new junction to the primary dependencies; no existing link was changed.

| Check | Result |
| --- | --- |
| `preservation-guard.test.ts`, `preservation-proof.test.ts` | **28/28 passed**, 2 files, 2.69 seconds. |
| Original reviewer `s11-office-review.test.ts`, exact O-R6/O-R7 tests selected from an unchanged temporary copy | **2/2 passed**; six unrelated cases deliberately not selected. Reviewer source left untouched and temporary copy removed. |
| `docx-lens.test.ts`, `xlsx-pptx-lens.test.ts`, `xlsx-w6-04.test.ts`, `seam-contract.test.ts` | **94/94 passed** across four files. |
| `office-route-projection.test.ts` | **13 passed, 3 failed**. The same three failures reproduce against the exact starting-revision source. They concern invalid zero row/column fixture dimensions and an additional dimension `set-sheet-properties` operation; OFFICE-MODELS owns them. No assertions weakened. |
| Combined five neighboring files | 107 passed / 3 baseline failures; 24.35 seconds. |
| ESLint over all eleven changed TypeScript source/test files, `--max-warnings=0` | Passed. |
| `git diff --check` / staged check | Passed. |

The initial direct run passed 27/28 because the ActiveX XLSM fixture was incorrectly assumed to contain a VBA project. Inspection confirmed it has ActiveX payloads but no VBA part. The test now uses `representative.xlsm`, whose real `xl/vbaProject.bin` is present and remains byte-identical after no-op/native cell edits. No macro was executed.

Positive native-package cases include slide duplication/removal, PPTX object deletion with media retained, DOCX no-op/text/bound-XML edits, explicit last-image deletion, image-containing block deletion with binary retained, shared-command final note/comment deletion with story parts retained, and XLSX sheet/chart/table deletion. Calculation-chain tests verify input-edit invalidation and final-formula clearing, while unknown XML prevents treating a chain as disposable cache. An actual in-memory DOCX with both DrawingML and VML using one image reproduces the old writer's unsafe release; the new proof refuses that output before queue/upload. The writer itself is unchanged.

The parent comparison temporarily substituted only the eight owned production files that differ from `d9aabfb5`, ran the 16 route-projection tests, then restored the candidate bytes in `finally`. All other production source was already at that revision; no second worktree, dependency install, shared source edit or runtime change was needed. Private commands/logs are under `.spectra-local/launch-s11/preservation/` (`focused.log`, `neighbors.log`, `baseline-projection.log`, `reviewer-guard.log`, `lint.log`).

No full typecheck, full suite, build or native application acceptance was requested/run in the guarded bounded slot. Native package evidence is not installed Office or Bridge acceptance.

## Limits

- No full suite, build, backend publication, browser, installed Office or live Bridge check in this task.
- Scoped claims preserve all matching feature subtrees in document order, their namespaces, and the enclosing namespace/name chain. Current production claims belong to the unique slide/worksheet root. This does not distinguish relocation between same-tag repeated parents and must not be used as a stable DOCX record locator; that needs an explicit owner identity. Existing mixed DOCX capability flags without scope remain informational. A sibling-index freeze would incorrectly block legal paragraph insertion and is deliberately not introduced.
- Unknown deletion relationships fail conservatively at the affected save. Supporting another cleanup family requires an explicit ownership mapping and tests.
- No production or launch-readiness claim follows from focused package tests.

## September 27 transition helper closeout

Recovery owner `01a0e28b-6f40-7b72-b293-a2e333211e19`, coordinator `01a0e289-3aa8-7ed1-bc1a-e9ede38f2dc9`. Actual recovery turn metadata confirms `gpt-6-astra`, `xhigh`, `danger-full-access`, and approval policy `never`.

The inherited four-file candidate adds the closed `scopeMode: "pptx-transition-remainder"` claim agreed with OFFICE-MODELS. It permits only Fade without through-black, leftward Push (including its default direction), Dissolve, no effect, and a valid unsigned 32-bit `p14:dur` change. It retains the transition root, advance timing, speed, sound, extensions, unknown attributes, direct text, namespace identity, and inherited significant whitespace. Unsupported transitions are compared in full so unrelated edits remain possible. Nested transitions cannot receive the direct-root exception. An ordinary whole-transition claim and an unknown scope mode fail closed, independently of claim order.

The helper indexes claims by part and the guard indexes positive scope proofs. When there are no changed scoped parts or removed parts, proof construction avoids reopening either ZIP; removal graph work runs only for actual removals. This optimization does not alter package comparison, native readback, or deletion authorization.

Recovered tests add positive effects and adversarial preservation cases, including direct text and nested extension transitions. Dependency commit `5f30a344` was initially handed off **UNRUN**; it is now covered by the September 27 focused results below, with one test-fixture correction. The earlier validation results and failures above describe `bf891b0b`, not this extension. OFFICE-MODELS owns real writer/route integration at `8715bb46`; this helper result alone does not establish that integration.

### September 27 focused results

The current coordinator granted temporary lane 1 for two test files, four-file lint, and the already prepared proof microbenchmark. The private runner preserves inherited `NODE_OPTIONS`, appends the existing filesystem guard and a 4096 MiB old-space limit, uses worktree-local temp/cache directories, runs serially with one Vitest worker and no file parallelism, and terminates each process tree at 180 seconds. No phase timed out. No dependency, service, publication, full-suite, or transitive typecheck work ran.

| Check | Result |
| --- | --- |
| `preservation-proof.test.ts` and `preservation-guard.test.ts` | **56/56 passed**, two files, 2.81 seconds Vitest duration. |
| ESLint over the four changed TypeScript files, `--max-warnings=0` | Passed, 4.12 seconds wall time. |
| Existing proof/guard microbenchmark | Passed, 1.56 seconds Vitest duration; 40 alternating samples per case. |
| `git diff --check` | Passed. |

The first focused run passed 55/56. Its namespace-prefix fixture used a global `p:` replacement, which also changed `http:` within namespace URIs. The correction replaces element-name prefixes only; production guard code and preservation assertions are unchanged. The failed evidence remains in `.spectra-local/launch-s11/preservation/transition-focused-20260927-133049.log`. Passing logs are `transition-focused-20260927-133127.log`, `transition-lint-20260927-133127.log`, and `transition-bench-20260927-133127.log` in that same directory; `transition-run-20260927-133127.json` records exit codes and phase wall times.

The benchmark compares the `bf891b0b` proof/guard with the candidate on the existing 653,105-byte, 15-slide, 100-part PPTX fixture (93 fidelity entries). Unchanged-package proof+guard median was **0.2278 → 0.0250 ms**, p95 **0.3097 → 0.0607 ms**. A controlled slide-text edit measured median **0.4920 → 0.4843 ms**, p95 **0.7779 → 0.6142 ms**; its median is effectively unchanged at this scale. The benchmark excludes lens open, package comparison, conversion, app latency, and network/database traffic. Uncontrolled last-sample heap observations are retained privately and do not establish a memory improvement. Detailed measurements are in `transition-bench/results.json`. No installed Office, live Bridge, or launch-readiness result is implied.

Deferred final prompt: on the integrated candidate, validate supported transition authoring and unrelated edits through actual prepare/materialize routes, fault the writer to remove preserved root text/advance/sound/extension content, and verify refusal precedes native queue/cloud advancement. Then perform disposable PowerPoint save/reopen and Bridge/history/retry acceptance under the shared runtime owner's reservation. Do not infer installed Office or launch acceptance from this helper suite.

### Bounded atomic-save source review

Reviewed the actual `222b` sink (`ceb840e7` foundation plus the owner's inherited source/target correction), digest, admission, appender, version creation, and payload-owner reconciliation. The earlier D1 review is closed at `a3efca8a` and was not repeated. The sink checks the bound source's artifact/account/reference/hash/revision/format and payload byte count, validates the active result payload and native readback receipt, and rejects contradictory inline/spilled update descriptors. Source and result hashes occur in the before/after version snapshots; explicit attested owners are attached before native replica advancement. Later ownership reconciliation reads both snapshots and preserves previously attested matching references. Append, history, owner attachment, native effect, and business receipt share one mutation.

Replay rechecks the original operation identity/scope and current modify permission, then returns the original retained delta or a same-room covering replay descriptor without applying a newly prepared retry candidate. Source and Bridge destination are separate identities; a verified cloud source can legitimately target its matching local replica. No new byte-binding, ancestry, retention, or replay blocker was found in this bounded source review. No DURABLE production files were edited here. This is not test or live acceptance: the current atomic test fixture uses synthetic package strings, and actual signed preparation/readback, large-content handling, exact peer consumption, and route integration remain with DURABLE/BRIDGE/ENGINE/COLLAB.

Deferred atomic-save validation prompt: run the integrated atomic transaction tests plus real DOCX/XLSX/PPTX prepare-only callers; prove current-source and destination fences, refusal on corrupt/foreign payloads, rollback after history/outbox/replica writes, source/result retention after later edits and owner reconciliation, Stop/revocation, and original receipt replay after compaction. Use actual native packages for byte/readback claims. Run the separate reserved live Office/Bridge and performance acceptance only after integration; do not report synthetic package transaction tests as Office fidelity proof.
