# Plan - 2026-03-06 22:29:00 +01:00

## Latest user request
Inspect the codebase for school/org settings support related to admin feature toggles, especially whether a SearXNG-enabled org setting already exists or needs to be added. Identify the exact files/functions/types to patch for admin settings persistence and bootstrap exposure. Do not make changes; just report concise findings with file refs.

## Actionable tasks
1. Locate org/school settings schema, types, and defaults related to admin feature toggles.
2. Trace admin settings persistence paths from UI/form handlers into backend mutations/queries.
3. Trace bootstrap/session exposure paths that surface org settings to the client.
4. Determine whether a SearXNG-specific org setting already exists and list the precise patch points if it does not.

## Blockers / assumptions
- Assumption: "school/org settings" refers to tenant-scoped settings used by admin flows and bootstrap payloads.
- Assumption: The required outcome is an inspection report only; no functional code changes should be made beyond this required plan sync.
- No blockers identified yet.
