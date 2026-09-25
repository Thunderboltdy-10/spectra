# S11 context orientation source candidate

Status: **source reviewed; tests and lint unrun under the shared dependency hold**. This unit does not enable orientation at runtime. It has no schema changes, backend publication, browser acceptance, or launch claim.

## Change

`buildContext(actorClerkId, body, prompt, { mode: "orientation" })` carries authenticated exact object identities and the current conversation without loading artifact catalogs, workspace/thread discovery, memory, recent activity, links, subtrees, or live editor bodies. It does this for every request wording, with no greeting/factual classifier. The existing expanded mode remains the default for existing callers and resumed execution.

The new `spectraContext.getArtifact` and `getWorkspace` queries authorize exact references through the existing authority helpers. Artifact metadata uses the current summary read model; a legacy/missing summary reads one canonical artifact row as a compatibility fallback. Output contains bounded title/summary metadata and an explicit `contentAvailable: false`. Missing title metadata remains visibly incomplete. Read permission is checked at each request, including inherited workspace access. A metadata response is not a write grant.

Follow-up source review removed an additional local same-school condition: the central authority policy deliberately permits existing cross-school direct account invitations. Exact metadata must preserve that authority while still denying cross-school inheritance. A direct regression fixture covers both sides; it remains unrun with the other fixtures.

Gather deduplicates same-request artifact metadata reads, preserves explicitly selected/attached IDs and existing choice continuation, and uses thread summaries for attached noncurrent threads. Current conversation loading remains unchanged. `gatherResolvedArtifactContext` continues to read permitted full content and live state at execution demand.

## Activation dependency

ENGINE identified that plan resolution validates IDs before `gatherResolvedArtifactContext`. A target discovered by search/read but absent from initial context therefore needs an authenticated handoff into resolution. ENGINE owns that handoff and the runtime opt-in. Backend publication must include the new query module before that opt-in. Search → read → write for a target absent from initial context is an integration acceptance requirement, not established by this unit's gather tests.

## Pending verification

The direct Convex fixtures cover inherited access, revoke/regrant, expiry, deletion, unplaced direct references, absent summary fallback, incomplete metadata, and a returned-row byte comparison with a 220 KB body. The gather fixtures cover zero source reads/hydration without exact objects across greeting/factual/create wording, deduplicated metadata, allowed/denied exact update targets, demand-only content hydration, current conversation/choice preservation, attached identities, and expanded default behavior.

These fixtures have **not run**. No row-byte result is claimed. Once RUNTIME clears the hold, run the two focused files, existing gather/continuation regressions, and scoped ESLint. Database measurements use the existing returned-document observer and do not estimate engine scans, network bytes, or billing.

```powershell
node node_modules/vitest/vitest.mjs run convex/spectraContext.test.ts src/app/api/spectra/run/loop/gather-orientation.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose
node node_modules/eslint/bin/eslint.js convex/spectraContext.ts convex/spectraContext.test.ts src/app/api/spectra/run/loop/gather.ts src/app/api/spectra/run/loop/gather-orientation.test.ts --max-warnings=0
```

## Residuals

Current conversation truncation and active-goal excerpt limits remain; this is not 256k compaction or durable original-goal restoration. Memory relevance and thread cross-retrieval are separate units. Summary authority relies on the existing synchronous read-model maintenance invariant. Missing/legacy summary fallback can read a large canonical body and is not represented as a cheap database read. Orientation retains a scoped library path read when an exact location is provided, and the current thread query still has its existing bounded trace work.
