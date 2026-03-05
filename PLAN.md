# Active Prompt Plan (2026-03-05)

## Latest User Request (structured)

1. Restore broken admin areas:
- Soul & Personality and Branding in `/admin` must not show "coming soon".
- "Open editor" must work.
- Keep admin navigation improvements, but do not route to broken `/admin/school` hub.

2. Sidebar + utility regressions:
- Revert bottom sidebar hover behavior so details are hidden until hover.
- Keep improved button visuals and per-button tooltip behavior.
- Timer/Feedback popups must open reliably, including when sidebar is collapsed on desktop.
- Popups must not be compressed unpredictably.

3. Composer/search + attachment UX:
- Remove unwanted gray inner outline on searchable/input areas.
- Keep outer composer border, including top border + top rounding.
- File attachment area should be separate, tip-like, connected, and not resize the main composer awkwardly.

4. Feedback flow:
- Auto-capture full-page screenshot when opening feedback.
- If auto-capture fails, provide graceful fallback messaging.
- Support pasted screenshots (Ctrl/Cmd+V) plus manual attach.

5. Streaming/presentation regressions:
- Show model/provider badge during generation without generic fallback glyphs.
- Reduce streaming-to-final visual flicker.
- Keep mode updates visible in UI while generation is in progress.

6. Pricing/orchestration correctness:
- Ensure manual/live catalog merge and vision prepass fallback remain correct.
- Keep monthly budget scan bounded to current month records.
- Avoid estimated pricing behavior where exact pricing is unavailable.

7. Process request:
- Add AGENTS.md guidance so each new prompt rewrites PLAN.md with current request context.

## Assumptions

- Existing unrelated dirty worktree changes remain untouched.
- Restoring Soul/Branding editor routes from prior working versions is acceptable.

## Blockers

- Local lint/test execution remains limited by environment toolchain mismatch.
