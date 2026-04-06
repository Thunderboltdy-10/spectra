# Cross-Area Flows
## Assertions

### VAL-CROSS-001: Open-to-Workspace-to-Chat-to-Artifact Projection
Opening the app and entering the workspace allows initiating a chat that produces an artifact projection visible in the shared workspace context without requiring page reload.
Tool: agent-browser
Evidence: Recorded browser run shows sequence app-open -> workspace load -> chat send -> artifact projection rendered.

### VAL-CROSS-002: Workspace Move with Immediate Undo Recovery
After moving a workspace item, invoking undo restores the prior spatial state and preserves associated chat/artifact links.
Tool: agent-browser
Evidence: Interaction log captures drag/move event followed by undo action returning item to original coordinates with intact references.

### VAL-CROSS-003: By-Topic and Timeline Coherence
Switching from by-topic grouping to timeline view preserves the same underlying items and ordering semantics adapt correctly without data loss.
Tool: agent-browser
Evidence: Before/after view comparison confirms identical item set with only presentation/order transformation.

### VAL-CROSS-004: Focus Mode Interplay with By-Topic and Timeline
Enabling focus mode while alternating by-topic and timeline filters narrows visible scope consistently and can be exited to restore full context.
Tool: agent-browser
Evidence: Session capture shows focused subset maintained across view toggles and full restoration after focus exit.

### VAL-CROSS-005: Classifier-to-Skills Routing with Visual Dual-Render
Classifier output routes to the appropriate skill path and yields synchronized dual-render outputs (textual decision + visual panel state) for the same interaction.
Tool: curl
Evidence: API trace shows classifier label and downstream skill invocation; UI capture shows matching visual dual-render state.

### VAL-CROSS-006: Skills Invocation Reflects Classifier Changes
When classifier confidence or category changes across similar inputs, selected skill path updates accordingly and downstream workspace effects reflect the new routing.
Tool: curl
Evidence: Consecutive request/response traces demonstrate classifier variation and corresponding skill selection changes observable in UI outcomes.

### VAL-CROSS-007: Planner to ManageBac Task Creation Flow
Planner-generated action items can be pushed into ManageBac with preserved task metadata (title, due context, category) and confirmed navigation back to workspace.
Tool: agent-browser
Evidence: End-to-end run shows planner output -> ManageBac creation confirmation -> return navigation with task linkage visible.

### VAL-CROSS-008: ManageBac Navigation Round-Trip Integrity
Navigating from workspace into ManageBac details and back retains active session context (selected thread, artifact focus, and current filters).
Tool: agent-browser
Evidence: Round-trip navigation recording confirms same session anchors before and after external area traversal.

### VAL-CROSS-009: Agent Action Creates Ghost Preview Before Commit
Agent-triggered changes first appear as ghost previews and only become committed artifacts after explicit accept action.
Tool: agent-browser
Evidence: Interaction timeline shows transient ghost state, acceptance click, then persistent artifact materialization.

### VAL-CROSS-010: Ghost Rejection Preserves Gamification Fairness
Rejecting ghost suggestions does not grant completion rewards, while accepted and completed actions increment gamification metrics exactly once.
Tool: agent-browser
Evidence: Metric panel snapshots before/after reject vs accept-complete paths show zero vs single increment behavior.

### VAL-CROSS-011: Agent+Ghost+Gamification Multi-Step Chain
A multi-step agent session with sequential ghost proposals updates streak/progress indicators only for accepted steps and reflects partial completion accurately.
Tool: agent-browser
Evidence: Step-by-step capture ties each acceptance to progress delta and ignored steps to no metric change.

### VAL-CROSS-012: Cross-Wave Resilience Under Rapid Context Switching
Rapid transitions across workspace manipulation, chat generation, artifact projection, and navigation maintain state consistency without orphaned or duplicated entities.
Tool: tuistory
Evidence: Terminal-driven automation transcript verifies repeated fast switches with stable entity identifiers and no duplication artifacts.
