# Sub-Agent Coordination

- Delegate only bounded tasks with clear ownership and non-overlapping write scopes.
- Keep the critical path local; use sidecar agents for independent work.
- Require each sub-agent to return changed files, rationale, and verification notes.
- Merge results quickly and avoid duplicate work between parent and sub-agents.
- Use explicit wait points only when blocked on a dependency.
- For parallel requests, maintain per-thread state so responses never cross streams.
- Summarize each sub-agent result in one sentence for request bars/status chips.
- Close inactive agents and clean stale execution state when work finishes.
