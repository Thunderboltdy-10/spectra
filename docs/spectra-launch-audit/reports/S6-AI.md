# S6-AI - durable AI orchestration

Date: 2026-09-11  
Branch: `codex/s6-ai-orchestration`  
Private source merge: `ce3b9c32` (merge of candidate `e492458466cbb38788e5af2e20f007631b71b753`)  
Product commit: `a6dddfc7` (`feat(spectra): make AI orchestration durable`)

## Consumed W6 product heads

The private checkout integrated the exact scoped product heads before S6 work:

- W6-01 `fe93cfb2`
- W6-02 `3ad39842`, `9bdb332`
- W6-03 `2bc8181f`
- W6-04 `d6fc5dab`, `2cbb5be3`
- W6-05 `0fd8a8db`
- W6-06 `a653f0e5`, `29cc744a`
- W6-07 `8de0276e`
- W6-08 `4b7372b2`
- W6-09 `c445f57b`

W6-02 was consumed from its local report. The W6-09 product head was present and integrated; its report was not present in the local Downloads report tree, so the product hash is recorded from git history rather than an invented report claim.

## Implemented

- Clarifications now receive a durable identity containing the asking message, exact option keys/titles, execution ID, target IDs/revisions, and captured authority context. Choice selection requires that identity, exact offered key/title, ownership, and an active `awaiting_resolution` run. Forged, stale, revoked, incomplete, or already-consumed choices fail closed with a recoverable error. Duplicate generated options receive distinct stable keys.
- Runs now persist `attemptId` and an explicit outcome: `proposed`, `awaiting_input`, `executing`, `canonical_saved`, `native_pending`, `native_verified`, `cancelled`, or `failed`. Retry creates a new attempt identity and rekeys retained attachment rows. Queue/approval transitions remain proposed until a worker claims the exact execution. Stop, resume, status writes, and scheduled paths are execution-fenced; a supplied stale `attemptId` is rejected.
- A completed run can promote one committed artifact ID only after checking the artifact is active, versioned, owned by the same account/school, and explicitly created by that run. This makes “make it clearer” follow-ups target committed identity instead of current focus or title reconstruction.
- The chat and Live Dock continuation payloads carry clarification ID, asking message ID, exact choice key, and execution ID. Legacy title/index reconstruction was removed. Clarification runs remain visibly awaiting input rather than falsely completing.
- Run-tab projections include attempt/outcome facts. Existing W6-07 typed application registry, authority evaluation, K-bar, settings/sync/ManageBac actions, and readiness acknowledgements remain the shared action path; unsupported mounted actions fail honestly.
- W6-08 research bundles and W6-01/08 durable attachment identities remain attached to the run/context path. W6-02 placement identity is present in the shared embed reference so canonical/provisional confirmation cannot lose its operation identity.

## Migration and recovery

The schema change is additive and optional; no vendor or hosted migration was run. Existing messages without durable clarification identity cannot be continued by guessing: they require a new request. Existing runs without `attemptId` continue through their execution ID until a retry creates the new field. Transient transport/provider recovery remains bounded by the existing retry/repair paths; identical failures settle as failed or partial with retained work and a targeted retry/follow-up surface rather than an unbounded loop. Canonical save and native verification remain separate facts; this S6 change does not fabricate native receipts.

## Focused proof

Dependencies were installed privately with `npm ci --ignore-scripts`.

Passed:

```text
npx vitest run convex/ai-run-lifecycle.test.ts \
  src/features/spectra/__tests__/application-dispatcher.test.ts \
  src/features/spectra/__tests__/ai-command-registry.test.ts \
  src/features/spectra/__tests__/run-settle-honesty.test.ts \
  src/features/spectra/__tests__/action-protocol.test.ts \
  src/features/spectra/__tests__/w6-08-research-retention.test.ts \
  src/features/spectra/__tests__/run-route.test.ts --reporter=dot
  7 files passed, 74 tests passed

npx tsc --noEmit --pretty false
  passed

npx eslint [all S6-touched product/test files] --max-warnings=0
  passed

git diff --check
  passed
```

The lifecycle tests exercise real `convex-test` mutations and storage fixtures for exact clarification selection, stale execution rejection, retained attachment retry, and committed-artifact promotion. The route suite exercises actual run/plan/act/verify/report handlers with deterministic provider seams, including no-edit answers, clarification state, partial recovery, native conflict, and saved-result behavior. This is fixture/provider-seam evidence, not a claim about real model quality, browser steering, hosted Convex, native Office rendering, or a shared runtime.

## Remaining integrated live checks

Run these sequentially on the combined S6-AI/S6-OFFICE-BRIDGE checkout with an authenticated ordinary account:

1. Create two similarly named drafts, issue a vague edit after changing focus, confirm Spectra offers a meaningful target choice, reject a forged/stale choice, then select the exact durable option and verify the chosen committed ID is edited.
2. Create one artifact, reload, ask “make it clearer,” and verify the same committed artifact is changed; separately exercise a new-artifact follow-up and a response lost after canonical commit without duplicating the mutation.
3. Start a long run, steer it, stop the exact execution, and race a superseded completion. Confirm late work cannot commit while already committed work remains visible.
4. Run the source-backed document, workbook/formula/chart, and presentation journeys with durable readback. Attach an image, force one transient failure, retry, and verify the retained authorized attachment is reused without base64 or duplicate objects.
5. Exercise K-bar navigation, settings, sync policy, ManageBac selection, and comments through the shared dispatcher; verify the mounted target acknowledgement and A -> B -> A readiness behavior in `/chat` and Live Dock.

No deployment, shared-runtime test, paid/provider/model change, external write, Actions execution, or original school-file mutation was performed in this private task.
