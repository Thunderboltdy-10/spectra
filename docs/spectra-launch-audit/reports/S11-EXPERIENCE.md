# S11 EXPERIENCE — interactive embed lifecycle

Worker task: `01a0d846-8f45-7540-93ce-910912fbfc72`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

Base: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. Branch: `codex/s11-embeds`. Checkout: `<local-workspace>`. Current session turn metadata and coordinator independently verified `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`.

The charter, entire private user brief and original coordinator user turn were read. This is a finite first implementation unit, not full embed or launch acceptance. General artifact opening belongs to PERFORMANCE; this lane owns embed/interactive lifecycle. No shared services, backend publication, school/native data, schemas or production deployments were changed.

## First unit: authenticated, bounded published-package loading

Published private embeds selected `/api/spectra/runtime/embed?embedId=...` but fetched it with `credentials: "omit"`. The route calls `requireActor()`, which requires Clerk's authenticated request. That omitted the cookie required by the route. The authenticated proxy introduced in `f683c055` was sound; retaining the old public-storage fetch credentials at its new caller was not.

Two independent lifecycle defects compounded this: `response.arrayBuffer()` retained an arbitrarily large chunked body before checking the limit, and clicking Retry started a request whose returned cleanup function React never owned. Finally, every newly allocated but equivalent build projection retriggered the load effect, tearing down a working preview and repeating its network/verification work.

Implemented:

- A single `published-runtime-loader.ts` owns package loading and existing format, version, runtime, SDK, size, SHA-256 and embedded-asset verification. Private embeds use the fixed relative proxy URL with same-origin credentials; public storage URLs continue to omit credentials.
- The browser and server share `runtime-response.ts`, re-exported from the old server helper so existing imports remain valid. It checks declared and streamed size, cancels rejected/aborted bodies and uses one growing bounded buffer instead of retaining an object per chunk. The existing 14,000,000-byte limit is unchanged. This bounds application-retained package bytes; it is not a measured browser-heap bound.
- A package attempt has a 30-second deadline with an explicit retry state. There is no automatic retry loop. Cancelling the host ends a stalled request without waiting for its deadline.
- React owns every request cleanup, including manual Retry. A changed build/source disposes its previous runtime immediately. Equivalent projection objects preserve the active verified preview and avoid another package request. Resource/title/compact changes remain props rather than build changes.
- Existing visual structure and Spectra classes are preserved. HTTP 401/403 now give actionable sign-in/access copy inside the existing error surface. Integrity failures still prevent execution.

Production files: `components/published-code-runtime.tsx`, `code/published-runtime-loader.ts`, `code/runtime-response.ts`, `code/embed-runtime-integrity.ts`, all beneath `src/features/spectra`.

## Evidence and verification

`node node_modules/vitest/vitest.mjs run src/features/spectra/__tests__/published-runtime-loader.test.ts src/features/spectra/__tests__/published-code-runtime.component.test.tsx src/features/spectra/__tests__/artifact-embeds.test.ts --maxWorkers=1`

Result: **35/35 passing across 3 files**. The component uses the actual loader, fetch responses, parsing and hashing; only the final sandbox renderer is replaced by a mount probe. These tests establish host/package behavior, not browser sandbox security or live authentication.

The same component regressions were executed with the original `d9aabfb5` component temporarily restored, then the repair restored in a `finally` block. All three selected regressions failed on the base: authenticated private package never renders, a manually retried request remains un-aborted after unmount, and an equivalent projection removes the verified preview. Private evidence: `.spectra-local/launch-s11/experience/baseline-runtime-regressions.txt`.

Additional cases cover successful recovery after denial, 401/403, size/hash/version/runtime/SDK mismatch, individually corrupted embedded assets despite a matching package hash, known oversize before fetch, undeclared oversized streaming bodies, 10,000 small chunks, misleading content length, timeout then a fresh successful attempt, cancellation of a stalled body, a late body after cancellation, source navigation with a late reply, failed replacement integrity, and React Strict Mode cleanup. Initial new-test failure was missing jest-dom matcher registration; that setup was fixed without weakening assertions.

Scoped ESLint and `git diff --check` pass. Impeccable's scoped detector returns `[]`. Full typecheck/build is deliberately delegated to the coordinator while RUNTIME establishes the known-red baseline; no claim of full repository health. Dependencies use a junction to RUNTIME's exact-lock primary install; its target and lockfile were not modified by this lane.

Profile A authenticated chat/dock acceptance is queued with RUNTIME, which owns services and the shared profile. It remains an integration gate: actual cookie-backed private load, denied access, recovery, offscreen/unmount cancellation and public share loading. No live result is claimed yet. No native Office result is claimed.

## Architecture and independent decision ledger

Historical conversations inspected with `read_thread`: S9-AI integration `01a0cb47-5362-7f51-83b1-0a2b0775fe3d`, turn `01a0cb47-a868-7672-9b1b-a8eac6a69b5a`; final live S9/S10-AI `01a0d3b1-e48a-7292-b2eb-051452e961ae`, turn `01a0d3b1-e8af-7d72-ae44-47f7cb278cad`. The latter explicitly deferred ownership, chat/side-panel and theme-consistent embeds; its successful contract counts were not authenticated embed acceptance. Relevant ancestry inspected: `f683c055`, `b63daf0c`, with current callers read on `d9aabfb5`.

| Decision / source | Current evidence and consequences | Verdict / proof / residual |
| --- | --- | --- |
| Private runtime proxy (`f683c055`) keeps bearer storage URLs out of ordinary projections | `artifactEmbeds.runtimeBuildAccess` authorizes host and source; `/api/spectra/runtime/embed` requiresActor, reads/verifies storage bytes; `publishedRuntimeSourceUrl` picks a fixed same-origin URL. Client retained public-storage `omit` credentials. | **Keep proxy, repair caller** in unit 1. Actual-loader tests assert the fixed URL/credentials and public isolation. Browser auth pending. |
| Published package integrity and size checks (pre-S9 retained by final AI) | Client and server both hash; client previously checked streamed size only after full body allocation. | **Keep verification, replace client reader** with the shared bounded reader. Size/hash/version/asset failure tests pass. No production RAM measurement yet. |
| Runtime lifetime (pre-S9 retained by final AI) | `ArtifactEmbed` pauses code offscreen/hidden. `PublishedCodeRuntime` effect used build object identity and manual Retry discarded cleanup. | **Repair published session ownership** in unit 1; three base regressions reproduced. LiveCodeRuntime has analogous manual-prepare/asset cancellation paths still to assess. |
| Shared chat/dock rendering (final live AI deferred acceptance) | `pages/chat-shell.tsx` uses `ConversationSurface`; `live-thread-panel.tsx` and artifact studio use `ThreadConversation`, which uses the same surface. It mounts `ArtifactEmbedList`. ComposerArtifactDock creates canonical thread references via `artifactEmbeds.create`. | **Keep shared surface.** Existing supported embeds are already wired into chat; adding a second renderer would fragment it. Live exact-source navigation and AI placement are unproven. |
| Canonical placement receipts (`b63daf0c`) | Added `getPlacementReceipt` checks embed ID, operation ID, host access and actual canonical-version content; replay cannot revive a removed saved placement. | **Keep invariant, needs broader evidence.** Placement identity is not proof of the user's general one-owning-placement lifecycle. Existing enum/helper tests alone cannot establish history/deletion across all hosts. |
| Pinned ownership/deletion (retained S9 DURABLE contract) | `artifactEmbedOwnership.ts` ties retention to `removedAt`. `projection()` deliberately allows retained pinned source snapshots after deletion, while `runtimeBuildAccess` rejects every deleted source and requires current source authority. | **Needs cross-owner decision.** Contradictory retained-code behavior and possible authority implications; do not relax either authorization path incidentally. Coordinate with DURABLE/HISTORY/SECURITY. |
| Theme protocol (pre-S9 retained by final AI) | SandboxedArtifactRuntime sends light/dark only on ready or other dependency updates. It does not observe host theme changes. `sandbox-protocol.ts` sets a dataset but injects fixed light `--spectra-*` values and exposes a hard-coded SDK token object; violet references an uninjected `--brand-primary`. | **Replace theme transport**, next recommended finite unit. Send only an allowlisted snapshot of actual Spectra tokens; retain existing SDK token names. No parallel palette. Verify changes without iframe restart. |
| Active-content sandbox (pre-S9 retained by final AI) | `sandbox="allow-scripts"` omits same-origin; explicit CSP, capabilities, source+channel message validation, bounded resources and isolated Python worker are present. | **Keep isolation, needs live adversarial evidence.** Unit 1 does not weaken iframe/network permissions. Authentication belongs to the host loader, not active artifact code. |
| Native/export fallback (final AI deferred acceptance) | An escaped SVG/PNG reference fallback helper exists with a source link. Repository source search finds no production import of that helper; its current test only checks generated SVG strings. | **Needs end-to-end Office/export proof** with OFFICE lane. Helper existence is not evidence of native placement, visual fallback or lossless re-save. |
| Projection cost | `listForContainer` collects every placement and calls full `projection` for each; composer also queries it merely to identify kept IDs. UI code-runtime pausing does not prevent source snapshots from reaching the browser. | **Needs demand-loading unit**, coordinated with DATA. Prefer a metadata/list contract plus demand-loaded authorized details over client-only hiding. Measure DB rows/bytes separately from response size. |
| User-facing code naming | `code` is a persisted registry/tool/schema discriminator; `workTypeMeta` derives a separate manifest displayName, while legacy labels also exist in `src/lib/artifact-types.ts`. | **Keep persisted type; change display language separately.** Recommend “Interactive” or “Visualisation” in product-facing names with source/runtime controls remaining precise. No discriminator migration or tool rename in unit 1. |

## Remaining finite units

1. Propagate live Spectra theme tokens into the sandbox and existing SDK aliases, with light/dark/update tests. Reserve `embed/sandbox-protocol.ts`, `components/sandboxed-artifact-runtime.tsx` and focused tests before edits.
2. Resolve retained pinned-source authorization consistently with DURABLE/HISTORY/SECURITY; then test source deletion, revocation, restore and playback through the authenticated endpoint.
3. Split container metadata from demand-loaded embed detail with DATA; measure row bytes, subscriptions and browser mount counts. Include live-runtime retry/asset cleanup and navigation.
4. Prove owning placement, AI-selected placement, chat/dock navigation and native/export fallback across disposable document/presentation/sheet fixtures with OFFICE and RUNTIME.
5. Coordinate the user-facing display rename with CRAFT while retaining persisted `code` contracts.
