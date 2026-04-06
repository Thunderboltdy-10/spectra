# User Testing

Testing surfaces, tools, and concurrency guidance for mission validators.

---

## Validation Surface

### Surface A: Browser UI (primary)
- Tool: `agent-browser` (preferred), Playwright-compatible browser checks when needed.
- Scope: workspace canvas, quick chat, projection visibility, view toggles, context menus, planner hub, companion behaviors.
- Auth: Clerk/Google sign-in may be required for realistic workspace/chat validation.
- If sign-in blocks automation, return to orchestrator for user-assisted auth, then resume.

### Surface B: API/Contract checks
- Tool: `curl`
- Scope: projection invariants, org-boundary checks, dedupe/idempotency, layout ownership enforcement, classifier metadata/fallback traces.

### Surface C: Rapid interaction/state integrity
- Tool: `tuistory` (or equivalent scripted interaction runner)
- Scope: rapid switching, stream-state integrity, cache invalidation behavior under churn, undo consistency chains.

---

## Validation Concurrency

Machine profile observed during dry run:
- CPU cores: `8`
- Memory available during run: ~`19 GB`

Concurrency policy uses conservative headroom and integration stability:

- Browser validators (`agent-browser`): **max 5**
  - Rationale: Playwright/Chromium surface validated; UI checks are primary and parallelizable.
- API validators (`curl`): **max 5**
  - Rationale: low resource footprint, bounded by backend consistency needs.
- Rapid-state validators (`tuistory`): **max 3**
  - Rationale: higher risk of interaction interference and nondeterminism at high parallelism.

If instability appears (auth popups, streaming race failures, resource spikes), temporarily reduce browser concurrency to 2–3.

---

## Required Evidence Conventions

For each assertion:
- record assertion ID
- include command/action trace
- include screenshot/video or API output
- include request IDs/log markers when available
- mark result as `passed`, `failed`, or `blocked` with reason
