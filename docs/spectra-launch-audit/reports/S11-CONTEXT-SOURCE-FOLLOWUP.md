# S11 memory source-authority follow-up

Status: **31/31 memory tests, 38/38 visibility tests and 7/7 authority tests passed; scoped ESLint passed** under the RUNTIME guard and assigned focused slot. Requires SECURITY's `6f7b7676` helper commit (`managebacVisibility.ts` and its fixtures). No memory schema change or backend publication.

The follow-up also consumes SECURITY `328890bb` (its approved exact membership index and visibility-reader factory). Memory creates one lazy reader per authenticated list/export/context invocation, reusing actor/integration/mapping and class-period checks across distinct source records. No reader or claim-access result survives that invocation. The memory patch itself adds no schema field; the dependency does add its documented index.

The earlier `450e4df8` repair rechecked sources across memory context/list/export but left two provenance weaknesses: ManageBac checked school alone, and `product_event` counted as independent authored evidence. This follow-up supersedes those portions of the first report.

ManageBac availability now delegates to `getReadableManagebacSourceRecord(ctx, actor, sourceId)`. It accepts only exact `managebac:<externalRecords ID>` provenance. The shared helper verifies current actor/membership, current integration and verified mapping, source state, explicit audience, and class membership/selection in the same academic period. Missing, malformed and unresolved legacy identities fail closed. Legitimate inherited class material remains readable; no capped list is used as proof of access.

There is no trusted product-event memory producer or canonical event-identity evaluator in the current code. Public `remember` therefore rejects `product_event` provenance with `MEMORY_SOURCE_UNSUPPORTED`. Historical event-only claims remain stored but unavailable. Product events no longer qualify for the bounded independent-authorship fallback. Genuine `user_statement`/`correction` evidence and other currently readable sources continue to support mixed claims, with unavailable event/source previews omitted. The schema retains the historical type.

The direct memory fixtures exercise list, export, and AI context together: inherited ManageBac access and deselection/reselection; revoked mapping/integration/membership; academic-period mismatch; tombstones; another user's personal row; malformed provenance; mixed authored evidence; unsupported new product-event input; and historical event-only/mixed memory. SECURITY's helper has separate lower-level actor/audience/period coverage.

The withdrawn lexical-only relevance implementation is not part of this work. Its prior regression ideas are preserved in the ignored `memory-relevance.pending.patch` while the measured semantic approach is designed; they are not claimed as passing authority tests.

```powershell
node node_modules/vitest/vitest.mjs run convex/memory-retrieval.test.ts convex/managebac-visibility.test.ts convex/authority-shared.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose
node node_modules/eslint/bin/eslint.js convex/memory.ts convex/memory-retrieval.test.ts --max-warnings=0
```

Use only the RUNTIME-provided guard and scheduled slot. The original 23/23 result and 23-call ledger in `S11-CONTEXT.md` describe the earlier commit. The current 21-versus-221-evidence fixture returned identical results and **22 API calls, 22 documents and 13,646 UTF-8 JSON row bytes** in both cases. Removing one authored evidence category removed its fallback query; absolute bytes can vary slightly with generated IDs/timestamps between runs.

The direct memory handler fixture with four distinct ManageBac sources made one integration query, one identity-mapping query, three exact membership probes and one selection query, then correctly denied the next invocation after mapping revocation. Source rows still receive current reads. These are returned-row/query observations, not engine scans or billing. Logs: `.spectra-local/launch-s11/context/context-guarded-tests.log` and `context-guarded-lint.log`. No full typecheck/build or served ManageBac/backend acceptance was performed.
