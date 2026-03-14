# Plan Sync - 2026-03-14T00:00:00+01:00

Latest user request (verbatim when practical):
"fix those too. no errors or warnings"

Actionable tasks:
1. Reproduce build and warning output in correct runtime (WSL path) to avoid UNC false failures.
2. Fix all real build errors and warnings across app code/config.
3. Re-run build and lint/type checks until clean.
4. Report exact fixes and clean verification commands.

Blockers / assumptions:
- Build must be run in Linux workspace context to avoid Windows UNC resolver failures.
- If a dependency install mismatch exists, repair lock/install state minimally and safely.
