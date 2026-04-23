# Tool-Orchestrated Agent Execution

- Break complex requests into explicit `plan -> tool call -> verify -> finalize` loops.
- Treat each tool call as a checkpoint: wait for result, then re-evaluate next action.
- Keep tool arguments minimal and typed; avoid speculative fields.
- Prefer deterministic tool sequencing for stateful operations (read -> mutate -> read-back).
- Emit progress in short phase labels while running and one-sentence summary at completion.
- If a tool fails, capture the error, choose a bounded retry strategy, and surface what changed.
- Never present UI as completed before the final tool result confirms completion.
- For workspace-style actions, include target IDs in tool outputs for reliable highlighting/opening.
