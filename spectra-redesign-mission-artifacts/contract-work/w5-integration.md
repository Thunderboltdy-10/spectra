# Area: Wave 5 Integration
## Assertions

### VAL-W5-001: Open resumes into last active workspace context
When a returning user opens the product, the experience should land directly in the most recently active workspace context (not a generic default), with prior workspace framing visibly restored.
Tool: agent-browser
Evidence: Video/screenshot capture showing prior workspace context saved in session A and restored on fresh open in session B.

### VAL-W5-002: Last active workspace restoration is stable across rapid reopen
If the app is closed and reopened quickly multiple times, it should consistently re-enter the same last active workspace until the user explicitly switches context.
Tool: agent-browser
Evidence: Sequential run log plus captures from three reopen cycles showing the same workspace context each time.

### VAL-W5-003: Linked companion agent is implicitly available without setup friction
Within Wave 5 integrated flows, a linked companion agent should appear to participate by default (or auto-attach) without requiring explicit manual pairing by the user.
Tool: agent-browser
Evidence: Interaction recording demonstrating no manual linking step before companion-driven assistance appears.

### VAL-W5-004: Companion behavior remains context-linked and relevant
Companion outputs should reflect the current workspace/task context and update relevance after the user changes focus, without stale cross-context bleed.
Tool: agent-browser
Evidence: Captured before/after interactions showing companion output content changes immediately after context switch.

### VAL-W5-005: Planner hub exposes expected navigation buckets including ManageBac
The planner hub should present clearly segmented navigation buckets, including an explicit ManageBac bucket/path discoverable from the primary planning surface.
Tool: agent-browser
Evidence: Screenshot set of planner hub navigation IA with visible ManageBac bucket and entry path.

### VAL-W5-006: ManageBac bucket navigation is direct and recoverable
Entering the ManageBac bucket and returning to planner hub should be straightforward, with predictable back/forth navigation and preserved planner state.
Tool: agent-browser
Evidence: Screen recording of planner hub → ManageBac → planner hub round-trip showing state continuity.

### VAL-W5-007: Immediate projection executes end-to-end without manual stitching
Triggering projection from an eligible context should run a full end-to-end projection flow immediately, producing consumable output without extra orchestration steps.
Tool: agent-browser
Evidence: End-to-end capture from trigger action to projected output artifact/result availability.

### VAL-W5-008: Immediate projection latency feels instantaneous at interaction level
From user trigger to visible projection initiation, the UI response should be immediate enough to avoid perceived dead time or uncertainty.
Tool: agent-browser
Evidence: Timestamped recording showing trigger-to-feedback interval with visible immediate state transition.

### VAL-W5-009: Ghost assistance is useful, contextual, and actionable
Ghost hints/interventions should provide task-relevant utility (next best action, clarifying cue, or shortcut) tied to current user intent rather than generic tips.
Tool: agent-browser
Evidence: Captured examples of ghost prompts mapped to active task state and subsequent successful user action.

### VAL-W5-010: Ghost assistance remains non-nagging under continued work
During uninterrupted task progress, ghost behavior should avoid repetitive prompting, modal interruption, or pressure loops that degrade flow.
Tool: agent-browser
Evidence: Continuous-session recording showing bounded ghost frequency and no repeated intrusive prompts for the same step.

### VAL-W5-011: Gamification cues are subtle and non-disruptive
Any progress/reward signaling should be ambient and lightweight, reinforcing momentum without hijacking attention or blocking primary workflow.
Tool: agent-browser
Evidence: UI capture highlighting gamification moments that appear passively and do not interrupt active task interaction.

### VAL-W5-012: Template inference suggests likely structures without overcommitting
When user intent is inferable, the system should suggest likely template structures/options with clear suggestive framing, while preserving user control over acceptance.
Tool: agent-browser
Evidence: Interaction capture where inferred template suggestions appear as optional recommendations and can be accepted/ignored cleanly.
