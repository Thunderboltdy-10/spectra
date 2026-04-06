# Area: Wave 4 — Views + Focus (W4-A1, W4-B1, W4-C1, W4-C2, W4-C3)

## Assertions

### VAL-W4-001: By Type View Groups Workspace Items by Artifact Kind
When the global view toggle is set to "By Type", all workspace items are rendered in distinct tint-zone groups separated by artifact kind (Note, Code, Visual, Export, Flashcard Deck, Quiz, Thread, Planner). Items belonging to one type do not appear under another type's group header.
Tool: agent-browser
Evidence: Visual inspection of workspace in By Type mode shows labeled group headers that match canonical artifact type labels; each item card's type icon matches its enclosing group; no item appears in more than one group.

### VAL-W4-002: By Topic View Renders Semantically Mixed-Type Groups
When the global view toggle is set to "By Topic", workspace items are arranged in groups whose composition is semantically determined rather than type-partitioned. A single topic group may contain items of different artifact types (for example, a Note and a Thread both about the same subject appear in the same group).
Tool: agent-browser
Evidence: In By Topic mode, at least one visible topic group contains items of two or more distinct artifact types with a coherent shared subject; the group header label reflects the shared theme rather than a type name.

### VAL-W4-003: By Topic Layout Is Visually Distinct from By Type Layout
Switching the view toggle from By Type to By Topic produces a noticeably different spatial arrangement: group header labels change from type names to subject names, and the item distribution across groups changes.
Tool: agent-browser
Evidence: Side-by-side comparison of group header text and item-per-group counts before and after toggle shows differing groupings; the transition is rendered without a full page reload or flash.

### VAL-W4-004: Timeline View Renders Chronological Day Buckets
When the global view toggle is set to "Timeline", workspace items are arranged in horizontal day-labeled groups ordered from most-recent to least-recent. Each group header contains a date label.
Tool: agent-browser
Evidence: Timeline mode shows a sequence of day-header groups; items within each group carry creation or last-edit timestamps matching that day's date; the overall day ordering is strictly descending (most recent first).

### VAL-W4-005: Timeline Day Groups Contain Only Items Whose Activity Falls on That Day
No item appears in a day group whose date does not match the item's creation or last-edited date. Items modified on two different days appear in the group corresponding to their most recent activity date.
Tool: curl
Evidence: API query for workspace items with known timestamps compared against rendered timeline assignment; item IDs returned match the expected day bucket; no item ID appears in a bucket whose date differs from its latest-activity timestamp.

### VAL-W4-006: Clustering Pipeline Produces Non-Trivial Named Topic Groups
Given a workspace with heterogeneous content spanning at least two subjects, the topic clustering pipeline assigns items to distinct named groups whose labels reflect actual subject matter rather than generic placeholders (for example, the label is not "Group 1" or an artifact type name).
Tool: curl
Evidence: Convex query for workspaceItems in a seeded workspace returns `topicCluster` field values; at least two distinct non-empty cluster names are present; names correspond to observable content themes rather than type labels or sequential IDs.

### VAL-W4-007: View Mode Toggle Is Global and Persists Across Workspace Navigation
Setting the view toggle to any mode (By Type, By Topic, Timeline) and then navigating to a different workspace and back returns the first workspace in the previously selected mode, not the default mode.
Tool: agent-browser
Evidence: Toggle set to Timeline in Workspace A; navigate to Workspace B; navigate back to Workspace A; workspace renders in Timeline mode without user re-selecting it; workspace store state log confirms persisted viewMode value.

### VAL-W4-008: Dragging an Item to a Different Topic Group Persists as a Cluster Override
Dragging a workspace item from its AI-assigned topic group into a different topic group updates the item's cluster assignment persistently. After closing and re-opening the workspace, the item remains in the manually assigned group rather than reverting to the AI-clustered group.
Tool: agent-browser
Evidence: Pre-drag item location recorded; drag action performed; workspace closed and re-entered; item remains in destination group; Convex item record fetched via API shows `clusterOverride` (or equivalent field) populated with the override group identifier.

### VAL-W4-009: Cluster Override Survives a Reclustering Event
When the backend reclustering trigger fires (after 3+ new items or on the scheduled batch), items with a manual cluster override are not moved back to their AI-computed cluster. Override wins over the recalculated assignment.
Tool: curl
Evidence: Item seeded with a `clusterOverride` value; reclustering job triggered (via API/action); subsequent query of item shows `topicCluster` may update but rendered cluster respects the override; override field remains non-null and unchanged.

### VAL-W4-010: Renaming a Topic Group Persists After Workspace Re-Entry
When a user renames a topic group in By Topic view, the new name is stored and shown when the workspace is closed and reopened. The original AI-assigned cluster name is no longer displayed.
Tool: agent-browser
Evidence: Rename action performed on a topic group; workspace closed and re-entered; group header shows user-supplied name; Convex record for the cluster or workspaceItem metadata reflects persisted rename value.

### VAL-W4-011: Topic Group Rename Persists Through a Reclustering Event
After a topic group is user-renamed and a backend reclustering event fires, the group header retains the user-supplied name rather than reverting to the AI-generated label.
Tool: curl
Evidence: Cluster rename stored; reclustering job triggered; subsequent fetch of cluster label or workspaceItem metadata confirms user-supplied name is intact; AI-generated label is not re-applied over the override.

### VAL-W4-012: Focus Mode Activates Automatically When the Study Timer Starts
Starting the Pomodoro-style timer in the hub timer widget triggers the focus mode state in the workspace canvas. No additional user action is required beyond starting the timer.
Tool: agent-browser
Evidence: Canvas observed before timer start (no focus mode indicators); timer started; canvas immediately enters focus state (dimming or highlighting consistent with focus mode spec); workspace store state log shows `focusActive` or equivalent flag toggled true.

### VAL-W4-013: Focus Mode Narrows Visual Attention to the Active Context Without Hiding Other Items
While focus mode is active, non-current context areas are visually de-emphasized (dimmed/reduced) but remain present and accessible on the canvas. Items are not hidden, removed, or replaced by a modal overlay.
Tool: agent-browser
Evidence: In focus mode, non-primary workspace items are visually present at reduced opacity or contrast; user can still scroll/pan to and click on non-primary items without dismissing focus mode; no full-screen lock or modal blocking is observed.

### VAL-W4-014: Focus Mode Does Not Block Workspace Interaction or Content Editing
While focus mode is active, the user can still interact with canvas items — clicking, editing, and navigating — without needing to exit or pause focus mode. Focus mode is a visual layer, not a routing blocker.
Tool: agent-browser
Evidence: In focus mode, clicking a workspace item opens it at Touch tier or Deep Edit as expected; chat input in Quick Chat remains functional; no error or redirect occurs; focus timer continues running during these interactions.

### VAL-W4-015: By Type Is Shown as Fallback When Topic Clustering Has Not Yet Run
When a workspace has never been clustered (no `topicCluster` values assigned), attempting to switch to By Topic view either displays a By Type fallback or shows a pending/loading state rather than rendering empty groups or an error.
Tool: agent-browser
Evidence: Workspace with no cluster data; toggle set to By Topic; UI either shows By Type layout with a visible fallback indicator, or shows a non-error skeleton/pending state; no blank canvas or JavaScript error is produced.

### VAL-W4-016: Fallback State Does Not Surface Stale or Error Cluster Labels
When the workspace is in fallback mode (clustering unavailable or not yet run), no stale cluster names, null labels, empty group headers, or raw error strings are displayed to the user in any view mode.
Tool: agent-browser
Evidence: With clustering unavailable, inspect all three view modes; group headers in By Type show canonical type names; By Topic fallback shows meaningful labels or a single placeholder; Timeline shows date labels; no group header is empty, null, or contains an exception string.
