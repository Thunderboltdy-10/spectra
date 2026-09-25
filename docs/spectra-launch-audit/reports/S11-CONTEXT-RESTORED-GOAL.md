# S11 restored-goal gather handoff

Source-only follow-up to orientation; its new regression is **unrun** because the prior focused slot has been released. No runtime activation or backend change is included.

ENGINE's authenticated `spectraRunContinuations.restore({runId, executionId})` returns the full original request and consumed clarification answers. Runtime composes those into the current model prompt and passes `buildContext` the fourth-option `restoredGoal: { originalRequest, clarificationResponses }`. The option is server-owned and is not accepted from the request body.

When supplied, gather uses that complete prompt for target extraction and replaces the legacy truncated active-goal excerpt with a compact reference to the current user request. It does not repeat the potentially large original request/answers inside orientation, or mark an old 2,400-character excerpt as authoritative. Existing callers and legacy continuation behavior remain unchanged when the option is absent.

Source review verified `callModel` includes its entire `prompt` under `User request` and carries `activeGoal` through compact orientation. ENGINE owns preserving that representation across its provider-body refactor. Its integration tests must verify original-request and answer tail constraints survive the actual provider-message serialization, plus that source-revision changes force fresh typed reproposal and candidate operations never become approval/execution receipts.

The added gather fixture supplies a long root and answer alongside an older clarification record, and checks that orientation references the full current request without overriding it with the old excerpt. This does **not** prove 256k compaction or full runtime intent preservation by itself. No additional query is added; runtime reuses the already-authenticated restoration.
