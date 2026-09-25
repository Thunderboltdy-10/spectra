# S11 memory source-authority follow-up

Status: **source candidate, validation pending the guarded focused slot**. Requires SECURITY's `6f7b7676` helper commit (`managebacVisibility.ts` and its fixtures). No schema change or backend publication.

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

Use only the RUNTIME-provided guard and scheduled slot. The original 23/23 result and 23-call ledger in `S11-CONTEXT.md` describe the earlier commit; they are not validation of this follow-up. Removing one authored evidence category also removes its fallback query. ManageBac checks add real source/mapping/membership reads; no cost or latency claim is made before measurement.
