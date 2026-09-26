# S11 runtime and test infrastructure

Baseline: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. Runtime owner task `01a0d844-0929-79a2-81f0-5cbde762a644`; coordinator `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`. This report records Windows local evidence, not launch acceptance.

Handoff on 2026-09-26: the guarded full baseline completed on September 25 with **2,640 passed, 90 failed and one pending test**. The runner/cache repair passed its focused checks. Shared services and Profile A are stopped; restart and publication require the coordinator's reviewed source selection. No baseline rerun, install, service startup or publication was performed during this handoff.

## Configuration and evidence boundaries

The actual session `turn_context` and independent coordinator inspection agree on `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`. Owned checkout: `<local-workspace>`, branch `codex/s11-runtime-baseline`. Primary runtime checkout: `<local-workspace>`. Product baseline stayed clean and unchanged during restoration.

Read the complete S11 charter and the original campaign user message, including the user's one-stack/Profile A requirement. Historical conversation evidence includes the actual final S9-AI task `01a0d3b1-e48a-7292-b2eb-051452e961ae` (the reported 99/92 failed tests, typecheck/lint errors, incorrect first browser selection and later authenticated Profile A) and S10-RELEASE `01a0d384-8f60-7f70-973f-daa56f2684b7` (backup consistency and unexecuted native acceptance). Reports are leads, checked against current callers, diffs and reproduced outcomes below.

Private exact commands, logs, timestamps and source hashes live in this checkout's ignored `.spectra-local/launch-s11/runtime/`. No credentials, database copies, school rows, package fixtures or raw logs are committed.

## Shared runtime contract

This table records the successful September 25 restoration. Its service, browser and grant observations are historical; the stopped state and restart prerequisites below supersede them for September 26 readiness.

| Surface | Restored identity and boundary |
| --- | --- |
| Web | `http://localhost:3000`, Next development server, primary source at baseline SHA. Wrapper selects pinned local Node `v24.20.0`; ordinary shell Node is `v24.11.1`. |
| Convex | `http://127.0.0.1:3002`, site `:3003`; saved deployment `local-pablo_md-ai_school-2`, cached backend `precompiled-2026-09-11-157eb19`. Existing database was 7,803,383,808 bytes. No reset, empty replacement, cloud selection or storage migration. |
| Gateway | `http://127.0.0.1:3001`, same instance env as web. Browser websocket uses the web proxy. Shared backend and data mean a different frontend port is not data isolation. |
| Bridge | `http://127.0.0.1:47615`, existing executable SHA-256 `9fa116f0b8db54fe33272d6afbf5bce9371a334f3c315dd59e6bcf1119fa8d89`. All 33 files in its recorded 2026-09-24 build manifest match current files. This is stronger than inferring binary identity from git HEAD, but not a reproducible-build proof. |
| Active Bridge journal | Primary `.spectra-local/launch-audit/S9-OFFICE-isolated-bridge-20260923-01/bridge.sqlite`, already paired. No copying, reseeding, re-pairing or default-journal alteration. |
| Only running native grant | Device `ms7bvr48xev932adxppy2keyfh8ez0k0`, grant `grant_f968f5a6f8e5448fbb382adeaae932e6`, backend mount `n17f3fj7b6mn72cryaqq0yv9d18ezzmh`. Local path is primary `.spectra-local/launch-audit/S9-OFFICE-safe-mount`. Live authenticated status: active, cloud connected, double-sync risk false. |
| Preserved default journal | Instance-1 journal still includes `OneDrive/Documents/IBDP1 - Copy`, double-sync enabled, 490 resources. It is deliberately not the running journal. Other historical backend device/mount rows remain registered. Test writers must select the exact isolated device/grant, never an arbitrary active mount. |
| Profile A | Primary `.playwright-cli/spectra-session`. Session `s11-profile-a`, initially `/workspace`, authenticated. One browser process per persistent profile; reserve a session/tab mutation slot, use `tab-list`/`tab-new`, never competing `open --profile` calls. `close` preserves profile data; never use delete-data/kill-all. |

The authorized start command was `npm run local:start:all -- --bridge-data-dir <local-workspace> --timeout-seconds 900` in primary. `start-all` also publishes primary `convex/` and syncs instance environment through the saved local endpoint. It is not merely a process restart. Future publication must follow coordinator integration and a frozen source fingerprint.

Cheap health probes are `/instance_name`, gateway `/_spectra/health`, web `/api/health`, and Bridge `/v1/health`. Three sequential warm samples returned 200: Convex 0–16 ms/26 bytes; gateway 0–15 ms/234 bytes; web 31–32 ms/212 bytes; Bridge 15–16 ms/87 bytes. These are HTTP response sizes, not database read costs. `/v1/status` and direct authenticated `bridge:devices`/`bridge:activeMounts` established actual device/grant state separately.

Before startup the machine had 17.74 GiB available physical memory, after startup about 8.26 GiB. A later process snapshot showed the backend at 489 MiB working set, gateway 188 MiB, Next 738 MiB, Bridge 32 MiB, and Profile A Chrome aggregate 1,466 MiB. All Node processes included unrelated task tooling and were not attributed to Spectra. There is insufficient evidence to justify many concurrent Next servers. Keep one shared frontend; use sequential reviewed source or one later integration frontend. Reserve `3100` for a possible integration-only frontend; do not start it before checking available memory and freeing a heavy slot. If used, inherit the instance env, override `SPECTRA_WEB_PORT=3100`, keep Convex `3002/3003` and gateway `3001`, and use that worktree's own `.next`. Bridge's restored origin is `localhost:3000`; another port does not automatically receive native authority.

Fingerprint manifest records sorted path+SHA-256 inventories: web `f5656cdac6034621d6a78351de5c45ff023674b918552a6a6ef4b396c967fb15` (954 files), backend/shared `1de7373564baf3a326b96fa7d0471846539a4c2845498ea2e68a61373a0aea32` (190), gateway/shared `91c32eadbd45636baaea37b528e35b5f0d78f3d2b4117893367113cd9dbd5b40` (65), Bridge source `a2e4b4f946b3a92b1e6e0c733587b6c70f25e073ab745d7d9b9b15d806415b22` (32 tracked). Instance env SHA-256 `6b555ac62315597e80ef66ead492f2d9957eb91ab77eeb7a760a4216bb65de2e`; root env differs. No secret values were included in the manifest.

## Decision ledger

| Decision / source | Original finding and implementation | Current call path and verdict | Consequences, evidence and residual |
| --- | --- | --- | --- |
| Saved deployment restart, `ba6484c5` | Convex CLI tried cloud selection on restart. Added pinned cached backend, exact saved identity/ports/database checks and 900s readiness. | `start-all → stack.startInstance → existingLocalBackend/savedBackendConfig → syncSavedLocalBackend`. **Keep.** | Successfully restored the existing 7.27 GiB DB; config/binary absence fails closed. Unit arguments test covers identity. Windows-only live proof; no restore/crash proof. |
| Startup implies publication, `ba6484c5` | Reuse backend through self-hosted endpoint, disable codegen/typecheck for publication, sync env. | `syncSavedLocalBackend` writes temporary admin env, `convex dev --once`, then env set, finally removes the temporary env. **Keep with explicit runtime contract.** | Fresh publish was coordinated at clean baseline. Health does not prove type safety; separate typecheck is red. Future startup may publish source changes and must be scheduled. |
| Gateway ownership/env, `5250792d` | Root env could override instance settings; foreign listeners could be killed/reused. Consolidated launcher, exact secret bytes, owned-child supervisor and bind refusal. | `stack → serve-collaboration-gateway → loadCollaborationEnv/runGatewayProcess`. **Keep.** | Live same-env web/gateway work. Existing source tests cover precedence/foreign listeners/own-child recovery. No hosted rollout claim. |
| Readiness and truthful preflight, S10-RELEASE / `eac1567b` | Earlier preflight emitted hardcoded successful user journeys and mount assertions. Removed invented observations; strict HTTP/service checks. | `readiness.mjs`, `preflight-evidence.mjs`, `stack.status`, `start-all.bridgeStatus`. **Keep replacement; remove reliance on old canned evidence.** | Current health independent from authenticated/native proofs. Bridge camelCase accepted; a listening unpaired process remains only service-ready. Preflight BUILD_ID is not source identity. |
| Default Bridge mount reuse, historical S9 isolated journal | Original default profile mixes real corpus and test mounts. Existing isolated journal was prepared for safe native acceptance. | Launcher accepts explicit data directory. **Replace default choice for this campaign.** | Read-only SQLite inspection plus authenticated live exact grant check passed. Default journal/data preserved. Historical cloud mounts must not be mistaken for running grants. |
| Dependency restoration | Primary node_modules empty at first start, so CLI/typecheck could not launch. | Exact-lock `npm ci`, preserving `.npmrc` (`legacy-peer-deps=true`), package and lock. **Keep exact-lock restoration; replace assumption of enduring shared-directory integrity.** | First restore installed 1,398 packages in 50s and verified versions; later deletion incident below. Missing tools are infrastructure errors, not product failures. |
| Shared node_modules junctions | Avoid repeated multi-GB installs in worker checkouts. | Worker junctions point to primary. **Needs evidence; restrict broad runs to disposable private dependencies during incident.** | Packages disappeared after verified install. No responsible process yet proved. Temporal overlap with tests and managed worktree creation is not causation. Guarded attribution required. |
| Hidden test discovery, S10-RELEASE / `eac1567b` | Broad Vitest discovered copied backend/evidence files. Narrow defaults-plus hidden exclusions. | `vitest.config.ts` excludes `.spectra-local` and `.shots`. **Keep.** | Baseline files-only discovery lists 317 and zero hidden copies; no further broad exclusions justified. |
| Node tests misclassified as Vitest | Two tracked `.test.mjs` files use `node:test`; Vitest reports no suite. | Renamed to `.node.mjs`, added `test:node`, routed `test:run` through it. **Replace runner classification, retain every assertion.** | All 11 Node tests pass. Vitest discovery now lists 315 files; exactly these two were removed from its runner, with no hidden-tree test additions. |
| Shared mutable test caches | Worktree dependency junctions made default `node_modules/.vite` cache shared. | Top-level Vite `cacheDir` now resolves to worktree `.spectra-local/vitest-cache`. **Replace shared cache placement.** | Ten local config/scaffold tests passed and generated cache is in the owning worktree. This addresses cache isolation, not the unproved deletion root cause. |
| Bounded full baseline | Prior AI task reported 99 then 92 failed tests and labeled time budgets separately. | Direct tools, one worker, hard process-tree timeout, exact metadata/JSON logs. **Keep bounded method; remove contaminated aggregate from product baseline.** | Typecheck and lint reproduced before deletion; initial full suite contaminated by missing packages. Guarded exact-baseline archive run completed: 2,640 passed, 90 failed, one pending; allocation below. |
| Frontend per worker / Profile A | User proposed shared backend with frontend ports. | Dev wrapper supports explicit port + shared gateway; profile/browser/backend still shared. **Keep capability, defer extra servers.** | Measured available memory fell ~9.5 GiB after restore/task/browser activity. Separate port is not native origin authority or data isolation. Sequential integrated frontend is practical first choice. |
| Native and release conclusions | Earlier tasks had focused green suites with open native, prod and OS gaps. | Service health, auth, mount inventory, saved/native receipts and rendered artifacts are distinct. **Remove any inference of release readiness from baseline startup.** | No Office mutation, production deployment, DB reset or model/provider change performed. |

## Static baseline allocation

`tsc --noEmit --pretty false --incremental false` (4 GiB Node heap bound, 300s process timeout) exited 2 in 58.578s. It reported **15 diagnostics across six files**:

| Owner / class | File and evidence |
| --- | --- |
| Workspace deletion product defect | `convex/spectraWorkspaces.ts:767`: missing `DISSOLVE_CHILD_BATCH`. |
| Data test typing | `convex/s10-perf-pages.test.ts:44`: four `_handler` property errors, unknown result and rest type errors (six). |
| School test typing | `scripts/s10-platform-school-regression.test.ts:124`: untyped arrays and union record normalized access (five). |
| Embed/context UI typing | `artifact-embeds-panel.tsx:290`, `viewport-context-picker.tsx:87`: possibly null values (two). |
| Command UI typing | `universal-kbar.tsx:310`: result may be boolean true, so `.message` is invalid (one). |

Full ESLint exited 1 in 94.797s with exactly two warnings in `library-organizer.tsx`: unused `Loader2` at line 18, missing `page` effect dependency at line 428. No rule was disabled. `node --test scripts/local/start-all.node.mjs`: 3/3 passed.

Authenticated initial `/workspace` load produced repeated React `flushSync` lifecycle errors and a DOCX lens HTTP 401 while Clerk remained signed in. These are untriaged product leads, not proof of a service outage or an authorization bypass. Console evidence is private and a separate owner must trace it before assigning root cause.

## Completed guarded test baseline

The source archive of `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`, beside the private exact-lock dependencies, ran from **2026-09-25 12:10:35.513 UTC to 12:17:21.341 UTC**, exiting 1 after 405.828 seconds without reaching its 900-second timeout. The command was `node --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<private guarded-vitest-result.json>`, with the inherited deletion guard. Exact invocation, working directory and completion metadata are in `guarded-full-baseline.json` and `guarded-full-baseline.log`.

`guarded-vitest-result.json` records **2,731 tests: 2,640 passed, 90 failed and one pending**. Its `testResults` array contains **317 actual files: 299 passed and 18 failed**. The reporter's 779 total suites include nested suites and must not be presented as file count. Sixteen files contain the 90 failed assertions; two additional files failed discovery because they use `node:test`.

The following is a failure-routing inventory, not a claim that each assertion identifies a product defect. Owners must distinguish invalid fixtures or timing expectations from broken behavior against their current candidate.

| Routing area | Baseline file | Failed assertions | Observed symptom |
| --- | --- | ---: | --- |
| Bridge / authority | `convex/bridgeSync.test.ts` | 27 | Missing upload/structure claims, receipt state and fencing expectations. |
| Bridge / authority | `convex/replicas.test.ts` | 34 | Predominantly `WORK_NOT_FOUND`, plus claim/receipt state expectations. |
| Bridge / authority | `convex/replica-truth.property.test.ts` | 1 | `WORK_NOT_FOUND` while replaying an external-save prefix. |
| Retention / deletion | `convex/collaboration-durable-payload.test.ts` | 1 | Deletion did not drain. |
| Retention / deletion | `convex/inline-native-retention.test.ts` | 3 | Deletion never reached the expected complete phase. |
| Retention / authority | `convex/pinned-native-authority.test.ts` | 5 | Deletion never reached the expected complete phase. |
| Retention / deletion | `convex/w7-02-retained-lifetime.test.ts` | 2 | Deletion did not drain. |
| Workspace / summary | `convex/p9-summary-writer-integration.test.ts` | 1 | Deleted-workspace provenance remains in a summary. |
| School / ManageBac | `convex/managebac-isolation.test.ts` | 3 | Missing or stale timetable/deadline projections. |
| School / ManageBac | `convex/managebac-retention.test.ts` | 1 | Expected projection absent (`recordId` access). |
| School / fixture route | `src/app/api/spectra/managebac/__tests__/provider-fixture-route.test.ts` | 1 | Fixture route expected success but returned false. |
| Collaboration | `convex/w9-02-heartbeat-short-circuit.test.ts` | 1 | Strict timestamp increase expected; timestamps equal. |
| Collaboration | `scripts/collaboration-persistence-window.test.mjs` | 2 | `finish is not a function`. |
| Collaboration | `src/features/spectra/__tests__/hocuspocus-transport-lifecycle.test.ts` | 4 | Synchronization/modify state and sync timeout expectations. |
| Office projection | `src/features/spectra/__tests__/office-route-projection.test.ts` | 3 | Cell delta mismatch and schema validation errors. |
| Organization / UI | `src/features/spectra/__tests__/org-tree-invariants.test.ts` | 1 | Expected 15, received one. |

The one pending reporter entry is a skipped native materialization case in `src/features/spectra/__tests__/xlsx-run3-materialize-diagnosis.test.ts`. It is not a native acceptance pass.

The two zero-assertion failed files are `scripts/local/managebac-provider-fixture.test.mjs` and `scripts/s10-security-authorization.test.mjs`, both reporting `No test suite found`. This owned repair renames them to `.node.mjs` without changing their contents, adds all three Node test files to `test:node`, and runs that script before Vitest in `test:run`. **11/11 Node tests passed** (`node-tests-fixed.log`); discovery changed **317 to 315**, removing exactly the two reclassified files and no hidden copies (`discovery.log`, `discovery-fixed.log`). The pre-repair archive baseline is preserved; no post-repair full-suite result is claimed.

The separate cache repair sets Vite's top-level `cacheDir` to the owning worktree's `.spectra-local/vitest-cache`. **10/10 config/scaffold tests across two files passed** using that cache (`cache-fixed.log`). Package lock and all Node assertions remain unchanged. These changes repair test infrastructure and do not resolve the 90 baseline assertion failures.

## Dependency deletion incident

The successful shared install was followed by real removal of `.bin`, `.package-lock.json` and scoped packages alphabetically before `@next`; later packages remained. `@next`'s directory timestamp was 11:34:51 UTC. Multiple workers independently reported `@jridgewell/sourcemap-codec` missing through the same previously working junction. npm logs contain no second install after the 11:18 install. No active installer or cleanup shell was found.

The broad baseline began 11:33:38 UTC and ended 11:38:43 (305.281s), one worker, no timeout. Its 1,801 passes/150 failed assertions and failed-import suites are **contaminated evidence, not a clean product failure count**. Discovery itself remains valid. Cleanup call-site review found temporary-directory removal in scaffold/status/env/foundation tests, but no shared dependency unlink. Managed tasks also began around 11:34:35, so host setup cleanup remains a hypothesis. It has not been established as the root cause.

Coordinator held tests and managed worktree creation. An exact-lock private dependency installation under ignored runtime/deps succeeded after copying the repository `.npmrc` too; omitting that file reproduces a peer-resolution failure and is not an equivalent install. A source archive of baseline HEAD was extracted beside the private dependencies, avoiding a junction removal blocked by automatic approval review. No shared link was changed.

The private Node deletion guard covers synchronous, callback and promise `rm`, `rmdir` and `unlink`, resolves existing junction ancestry, refuses dependency-root/ancestor deletion, and records caller stacks. A disposable self-test verified direct, ancestor and junction-alias refusal, sentinel preservation and allowed unrelated cleanup. It permits only the exact `.vite` subtree inside dependencies. This is an operational containment aid, not a security boundary against another process or arbitrary native cleanup commands.

Six cleanup-related suites passed 36/36 under the guard; every recorded deletion touched OS-temp fixtures/Vitest temporary output. Private codec/Office/aggregate packages remained intact. Coordinator then authorized controlled restoration: **24,105 missing files copied** from the identical private install, **zero existing files overwritten**, no services restarted or source published. Critical package/entrypoint bytes matched; package.json and lock retained their original hashes. A guarded shared smoke run passed 9/9.

During the completed baseline interval, the shared guard log recorded 1,526 deletion calls across multiple processes and **zero blocked calls**; this interval count is not attribution of every process to the baseline. At the September 26 11:41 UTC handoff snapshot, the cumulative log contained 4,094 calls through 11:40:58.894 UTC. Its only four blocked calls were the deliberate September 25 self-test against disposable sentinel paths. There is no recorded dependency-deletion caller. The final baseline log contains no missing-module/package or ENOENT errors matching the dependency incident.

Focused tests require coordinator slot allocation with the inherited guard and one worker. Any later broad run needs separate authorization; none is part of this handoff. Managed task creation was held during the incident; its later scheduling remains the coordinator's responsibility. The guard has not established the deletion root cause. No product assertion was weakened.

## Current readiness and coordinated restart

Read-only inspection at **2026-09-26 11:41:25 UTC** found no listeners on 3000, 3001, 3002, 3003 or 47615; no matching Spectra test/server process; and no Chrome process using Profile A. Available physical memory was 16.85 GiB. Evidence: `handoff-readiness.log`. These are point-in-time observations, not a test-slot release or a guarantee that another worker will remain idle.

At 11:42:16 UTC, the existing shared junction still targeted primary `node_modules`; `.bin` and `.package-lock.json` existed. Six sampled entrypoints/manifests (Vitest, TypeScript, ESLint, sourcemap-codec, aggregate and docx) existed in both installations with matching SHA-256 hashes. The saved Profile A directory and isolated Bridge journal still existed. Evidence: `handoff-dependencies.json`. This sampling supports using the prescribed guarded focused checks; it is not a full dependency-tree integrity proof.

Integration was clean at `d7e88046931ab77eccf0b40a86eff1135a672e14` during this handoff and is not cleared for publication. The runtime fix is offered as an owned commit for coordinator review/cherry-pick. RUNTIME occupies neither heavy-test slot; the coordinator owns all pending DOCX/EXPERIENCE/DURABLE/COLLAB allocations.

The safe restart sequence, once separately cleared by the coordinator, is:

1. Select and freeze the reviewed revision to run from primary; record fresh web/backend/gateway/Bridge source fingerprints and the existing instance environment hash. `local:start:all` publishes primary `convex/` and syncs instance environment, so permission to probe or run focused tests does not authorize this step. Recheck available memory, port/process ownership and the Profile A lock before starting.
2. Reconfirm the saved deployment `local-pablo_md-ai_school-2`, existing database and backend binary. Select only primary `.spectra-local/launch-audit/S9-OFFICE-isolated-bridge-20260923-01` as the Bridge data directory. Preserve the default journal and real OneDrive corpus untouched. Re-evaluate Bridge binary/source compatibility if its source changed after the recorded build.
3. From primary, run `npm run local:start:all -- --bridge-data-dir <local-workspace> --timeout-seconds 900`. Preserve the saved local identity and database; never reset or select cloud deployment to make startup pass.
4. Check all service health endpoints and authenticate through the single Profile A process. Reinspect live Bridge status and backend mount inventory: the exact device/grant/mount above must still resolve to `S9-OFFICE-safe-mount` with double-sync risk false. Only then may the coordinator allocate disposable-fixture browser/native mutations. A healthy port alone does not establish safe native authority or acceptance.

No additional frontend is needed for this handoff. If later requested, its port, source, shared-backend compatibility, origin authority and memory allowance must be explicitly coordinated. Runtime restoration, product correctness, native Office readback and publication remain separate acceptance decisions.
