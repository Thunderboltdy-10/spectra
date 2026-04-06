# Area: Wave 1 Foundation
## Assertions
### VAL-W1-001: Canonical taxonomy mapping normalizes entities into stable classes
When mixed workspace entities are loaded, each item is behaviorally projected into the canonical visible class (artifact, thread, planner, territory, or hub primitive) with no ambiguous dual-class rendering in the same frame.
Tool: agent-browser
Evidence: Capture a single workspace load where each seeded entity appears as exactly one canonical visual class and no item renders in two class shells simultaneously.

### VAL-W1-002: Unknown taxonomy types fail safely without corrupting visible state
When an unsupported or malformed entity type is introduced, the UI does not crash and does not misclassify neighboring entities; unsupported items are omitted or shown in a neutral fallback state.
Tool: curl
Evidence: Submit malformed type payload and record successful response plus subsequent UI session showing existing valid entities unchanged and no fatal error surface.

### VAL-W1-003: Artifact creation projects immediately into the active workspace
When a new artifact is created from the active context, its shell appears immediately in the visible workspace without requiring full-page reload or manual refresh.
Tool: agent-browser
Evidence: Record timestamped interaction of artifact creation and immediate appearance in the current workspace viewport.

### VAL-W1-004: Thread creation projects immediately with usable preview metadata
When a thread is created, it appears immediately with preview metadata (title/summary or equivalent compact descriptor) sufficient to distinguish it from neighboring cards.
Tool: agent-browser
Evidence: Capture before/after viewport showing new thread card rendered instantly and containing non-empty preview text.

### VAL-W1-005: Planner item creation projects immediately and is interactable
When a planner item is added, it appears immediately and can be interacted with (select/open/focus) in the same interaction sequence.
Tool: agent-browser
Evidence: Capture creation clickflow followed by immediate planner card selection in the same session trace.

### VAL-W1-006: Projection ordering is deterministic under burst creation
When multiple artifacts/threads/planner items are created in quick succession, projected cards appear in a deterministic and repeatable order policy rather than jittering across refresh cycles.
Tool: tuistory
Evidence: Replay identical burst input twice and compare ordered card sequence snapshots showing stable ordering policy.

### VAL-W1-007: Batched content refresh coalesces rapid updates into bounded paint cycles
When multiple content updates occur rapidly, refresh behavior coalesces into batch application (rather than one full repaint per update), preserving responsiveness.
Tool: tuistory
Evidence: Terminal/UI trace of rapid update stream showing grouped render commits and no per-event full redraw waterfall.

### VAL-W1-008: Batched refresh preserves latest content correctness
After coalesced refresh, each card reflects the latest update state (last-write-wins for visible fields) with no stale intermediate text left visible.
Tool: agent-browser
Evidence: Execute rapid successive edits to one entity and capture final viewport showing only newest values after batch settles.

### VAL-W1-009: Bounded cache evicts old entries without unbounded memory growth
Across sustained navigation through many distinct entities beyond capacity, earlier entries are evicted and the system avoids unbounded growth symptoms while remaining functional.
Tool: tuistory
Evidence: Long-run navigation trace showing access beyond capacity and observable eviction behavior with continued responsive operations.

### VAL-W1-010: Cache miss refetch restores evicted entity correctly
When revisiting an evicted entity, the system refetches and reconstructs the visible state correctly rather than showing broken placeholders or stale ghost content.
Tool: curl
Evidence: Force revisit after eviction, capture network refetch event and resulting UI card matching source-of-truth fields.

### VAL-W1-011: Discard persistence survives reload and clears transient drafts
When a user discards pending changes, draft/transient modifications do not reappear after reload or workspace re-entry.
Tool: agent-browser
Evidence: Create draft change, discard it, reload workspace, and capture absence of discarded content in reopened entity.

### VAL-W1-012: Discard operation is scoped and does not wipe unrelated entities
Discarding one entity’s pending changes does not remove committed state or drafts belonging to other entities in the same workspace.
Tool: agent-browser
Evidence: Prepare two entities with different states, discard one, and capture that the second entity remains unchanged.

### VAL-W1-013: Undo entrypoint restores last reversible workspace action
Invoking the undo entrypoint reverses the most recent reversible action (move/create/edit as supported) and returns the workspace to the prior visible state.
Tool: agent-browser
Evidence: Perform one reversible action, trigger undo entrypoint, and capture before/after parity with pre-action state.

### VAL-W1-014: Undo boundary handling is safe at empty history
When undo is invoked with no reversible history, the system remains stable and signals no-op behavior without altering current state.
Tool: tuistory
Evidence: Start fresh session with empty history, invoke undo, and capture explicit no-op indication plus unchanged workspace snapshot.

### VAL-W1-015: Spatial zoom and territory boundaries preserve navigation correctness
Zooming in/out and crossing territory boundaries maintains consistent card positioning semantics and keeps target territory context accurate after transitions.
Tool: agent-browser
Evidence: Capture controlled zoom transitions and territory hops showing consistent relative placement and correct territory labels/context markers.

### VAL-W1-016: Glance suite and hub primitives remain available and non-destructive during navigation
Glance affordances and hub primitives are accessible from standard workspace states and opening/closing glance views does not mutate underlying entity state unless explicit edit actions occur.
Tool: agent-browser
Evidence: Open/close each glance entrypoint and hub primitive access path, then verify unchanged underlying entity content in follow-up snapshot.
