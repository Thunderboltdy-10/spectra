# P10 — The Connector Protocol

**Goal:** the sync architecture stops being "the Office/local machine plus ManageBac" and becomes a **general connector protocol**: one connection model, three connector families (file-sync, calendar, school-data — EXPANSION §2), replica truth generalized to provider-revisioned targets, and a formal lens registry — with the Office/local path refit onto the new seams and **proven unregressed** before a single external connector is built. This is the highest-regression-risk phase of the expansion; it is deliberately small, Hard, and gated.

**Prerequisites:** merges wait for **RC.V1 PASS** (the fidelity baseline must be green before the seams under it move); P10.I2 additionally waits for I1+I3 merged. Implementation may begin in worktrees immediately (Wave 0). **Architecture:** ARCHITECTURE-TRUTH (replica machine), ARCHITECTURE-FIDELITY (lens law), ARCHITECTURE-CAPABILITIES (IR), EXPANSION §2/§7. **Findings absorbed:** the bridge/replica exploration of 2026-08-30 (Bridge is a local Tauri/Rust FS bridge; no Graph/OAuth exists; `OFFICE_NATIVE_FORMATS` hardcoded in `convex/replicas.ts` + `convex/bridgeSync.ts`; `workReplicas.kind` is binary cloud|local; `SpectraLens` is already format-agnostic).

**Difficulty (PROCESS §4):** I1, I2 = Hard / xhigh (serial with each other where they share the schema seam — I1 lands first). I3 = MT / xhigh. V1 = Hard / **max**.

**Binding design decisions (do not re-litigate in the field; stop-and-ask if they prove wrong):**

1. **The Bridge stays FS-only.** Cloud providers are **Convex action workers** driven by the scheduler with per-provider backoff — never extensions of the Rust claim loop.
2. **Three families, three truth stores.** file-sync → `workReplicas`/payloads; calendar → `calendarItems` + `sourceKey`/`sourceHash` (the ManageBac projection pattern, promoted to a contract); school-data → `externalRecords` + projections. A connector declares its family; no cross-family machinery reuse by copy-paste.
3. **Provider revision tokens are external truth** for connector replicas (etag/version/`headRevisionId`); `contentHash` remains the byte truth where bytes are fetchable. `baseRevision` semantics (last verified agreement) carry over unchanged.
4. **Multiple replicas per work is the normal case** (cloud + local device + Drive). The truth rules of R1/R2 apply per replica; conflicts across replicas land in the existing `syncConflicts` machinery with per-replica previews.

## P10.I1 — Connection model + provider registry (H)

- New `connections` table: scope (account or school), `provider`, family, `authKind` (`oauth` | `token` | `file` | `device`), status/health (`connected`, `expired`, `rate_limited`, `revoked`, `error` — every state with a compensating exit per R2 and a plain-words sentence per R13), granted scopes, timestamps. Tokens live in the existing AES-GCM `secretStore` (purpose-per-provider), never on the row.
- Provider descriptor registry in `src/features/spectra/connectors/core/`: id, family, display identity, auth flow, capability manifest (which artifact types / formats / directions it supports), rate-limit policy. Adding a provider = one descriptor + one worker module; the registry is the walk-through proof of the exit gate.
- OAuth plumbing: authorize/callback routes, token refresh in the action worker, revoke path.
- **Connections settings hub (skeleton):** one surface listing every connection — including the existing Bridge device + mounts presented as the "This device" connection card, and ManageBac as the school-data card. Wire the orphaned `bridge.revokeDevice` into it (known gap: API exists, no UI caller). Full UX polish is P15.I2; this unit makes it exist and be truthful.
- Owns: `convex/connections.ts` (new), `src/features/spectra/connectors/core/`, Connections hub component under `settings/ui/`. Does not own: replica schema (I2), any concrete provider (P11).

## P10.I2 — Replica & sync generalization (H)

- `workReplicas`: add `kind: "connector"` with `connectionId`, `externalResourceId`, `providerRevision`; extend state machine + `REPLICA_COMPENSATION_TABLE` (`shared/replica-truth.ts`) so every new state/edge has a sweeper exit (R2). `replicas.sweepReplicaTruth` covers connector replicas (stale claims, orphaned pendings, token-dead connections → `unavailable` with truthful labels).
- Replace the hardcoded `OFFICE_NATIVE_FORMATS` sets (`convex/replicas.ts:1737`, `bridgeSync.ts` needsPayload lists, `activateLens` enum) with a shared **format capability manifest** (`shared/format-registry.ts`) consumed by Convex, routes, and UI. Migrate-and-delete: no parallel constant survives.
- `syncPolicies` gain connection scope: per-connection defaults + per-work overrides, presented through the existing toggle vocabulary (R14) — never a new jargon surface.
- **Connector worker substrate:** Convex action + scheduler loop contract (claim → pull delta → reconcile → push queued writes → heartbeat), per-provider backoff/rate budget, idempotency via the existing `deriveSyncIdempotencyKey` framing, `syncOperations` journaling for every external move.
- **Bridge-side efficiency (owned here, not P9.I3):** `claimPendingPayloadUpload` gets a needs-upload index/flag instead of triple-state scans on a 5 s poll (4.71 GB); Bridge poll backs off when idle; `sweepReplicaTruth` payload-release loop batches its 8×take(1000) reference checks; inline `projectionBaseContent`/`projectionBaseTextIndex` blobs move off `workReplicas`/`bridgeWriteRequests` rows into payload refs.
- Owns: `convex/replicas.ts`, `convex/bridgeSync.ts`, `convex/syncPolicy.ts`, `shared/`, `bridge/` poll cadence. Does not own: lenses (I3), providers (P11).

## P10.I3 — Lens registry + interchange seam (MT)

- Formal registry `nativeFormat → SpectraLens` replacing ad-hoc route wiring; routes resolve lenses through it. The `SpectraLens<P, D>` contract itself does not change.
- Two non-OOXML proof lenses: **`md`** (document ↔ Markdown; frontmatter/wiki-links preserved-not-interpreted, declared in the fidelity map) and **`csv`** (sheets single-table; boundary declared). These prove the registry with cheap formats before Google arrives.
- **Interchange shim contract** for providers whose native format is remote (Google): connector exports provider-native → interchange bytes (OOXML) → existing lens; the shim declares its conversion boundary in the fidelity map so capability gating stays honest (R7).
- Harness generalization: `scripts/fidelity-harness/` gains a shared contract runner; corpus layout `fixtures/<provider-or-format>/` with sidecar assertions, mirroring the Office pattern. Ghost gate (`check:capabilities`) extended: a capability claiming a connector-backed native write with no registered delta fails the build (R6).
- Owns: `src/features/spectra/lenses/` (registry, md, csv), `scripts/fidelity-harness/`, fixtures. Does not own: provider auth or workers.

## P10.V1 — Office refit regression gate (H, max)

Fresh agent, local instance, `office-com` + `bridge` leases. The single question: **did the refit change anything for the proven core?**

- Full DOCX/XLSX/PPTX fidelity harnesses + seam contract + sequence fixtures; bridge chaos suites (Rust + Convex); replica property/truth suites — all unchanged tests, all green.
- **RC corpus re-run** (archived ORCHESTRATION §8 protocol, copies only): the Extended Essay, the real presentation, the Physics IA — render, edit, round-trip through real Office on the new seams (R19).
- md/csv conformance suites green (the new seams do something, not just nothing-broken).
- Connections hub truthfulness walk: Bridge card states, ManageBac card states, revoke paths.
- Sequences, not moments (R11); triage before fix (R12); verifier may repair class-wide (R17).

## Exit gate

The "add one connector" walk-through recorded as evidence: descriptor + worker + (lens | shim | projection) with **zero core schema changes**. All Office/local suites green on unchanged tests; RC corpus green; V1 PASS. **P11 is frozen until this gate passes.**

## P10.I1 implementation log — 2026-08-31

- Added account/school-scoped `connections` truth with explicit health transitions, a two-minute stalled-state sweeper, audit events, and token-free query projections.
- Extended the AES-GCM secret bridge with account envelopes bound to `connector:<provider>:<connectionId>:oauth-token`; ownership, provider, scope, and purpose are revalidated at every read/write/revoke.
- Added the provider registry contract and registered the existing Bridge and ManageBac implementations without merging their workers or truth stores.
- Walk-through proof: the ManageBac descriptor selects `school-data`, its existing `executionScheduler:dispatchManageBacSync` worker, and existing `externalRecords` projections; no provider-specific core schema branch was required.
- Added generic authorize/callback, refresh, and revoke plumbing. Invalid grants become `expired`; HTTP 429 becomes a scheduled `rate_limited` retry; local revoke failure remains actionable instead of claiming success.
- Replaced Files and devices with a unified Connections settings section while preserving the legacy `devices` URL alias. Bridge mounts and ManageBac project into the same overview without migration.
- Wired `bridge.revokeDevice` through a destructive confirmation, cleared the local Bridge session, and stated that local files remain unchanged.
- Focused Vitest: 4 files / 25 tests passed. TypeScript passed. Scoped ESLint: 0 errors, 5 pre-existing Settings token warnings.
- Capability ghost gate, secret scan, seam fidelity (13 tests), and `git diff --check` passed.
- DOCX fidelity inherited failure: `bibliography-source.docx` insert-paragraph aborts with `DOCX_UNSUPPORTED_EDIT` in untouched lens/harness code.
- Office fidelity inherited failure: `sheets.clipboard.paste.values` reports expected `XLSX_FORMULA_LITERALIZATION_BLOCKED`, got `UNKNOWN`; all other recorded Office assertions passed.
- No browser screenshot was taken because this worktree held no browser/local-stack lease. No live Convex, Bridge, Office, or cloud resource was used.
- Implementation complete; no acceptance claimed. Merge remains gated on RC.V1 PASS and P10.V1 owns the inherited fidelity verdicts.
