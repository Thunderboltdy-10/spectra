# Release Notes — Next Phase UI + Reliability

## Sidebar
- Redesigned sidebar collapse/expand behavior with a panel-style toggle.
- Added compact streak/XP display with hover expansion to preserve chat list space.
- Added collapsed-mode page reorder controls and tooltips for icon-only navigation.
- Converted recent chats to compact row/tab-like items and added incremental chat list loading.

## Right Panel
- Unified right-side panel surface styling via shared `right-panel-surface` utility.
- Removed heavy blur behavior for docked desktop panel layouts and improved integrated 1920x1080 behavior.
- Consolidated provider/leaderboard experience in models page right panel with internal view switching.
- Improved orchestration panel reliability (open/close flows) and consistent panel transitions.

## Models
- Reworked model explorer search hierarchy (model search before provider search).
- Improved fuzzy search behavior for version queries (e.g. `5.3`) and provider-aware matches.
- Merged duplicate providers and removed provider suppression by low model counts.
- Added provider icon fallback mapping for less common providers.

## Admin + Super Admin
- Improved school admin navigation coherence and direct-link workflows.
- Added graceful SOUL behavior when `OPENROUTER_API_KEY` is missing (actionable UI + disabled publish/preview).
- Refined super-admin feedback inbox with bucketed categorization, sender/org metadata, and working reply/status flows.
- Improved branding controls with live theme preview, dynamic greeting preview, and immediate theme propagation.

## Agents
- Replaced rigid agent creation with conversational builder flow and adaptive IB-specific step.
- Added expertise multi-select and custom expertise entry.
- Replaced `student` wording with user-centric language in agent creation/generation flows.
- Improved generation fidelity and fallback behavior in `generate-full` route.

## Chat + Orchestration
- Fixed compaction flow reliability and compaction status handling.
- Added richer orchestration specialist roles and improved source hint capture/merging.
- Ensured researcher/fact-checker source hints feed citation rendering paths.
- Improved mode-router handling to avoid false image routing for generic `render` requests.

## Performance + Stability
- Added incremental message rendering strategy: show recent first, load older on upward scroll.
- Preserved scroll position while loading older messages.
- Fixed multiple TypeScript blockers and validated with full production build.
- Full validation passes: `lint`, `test` (97 tests), and `build`.

## Design + Interaction
- Improved dark mode contrast/hierarchy and global theme tokens.
- Added subtle motion polish for mode/agent/automation transitions.
- Removed default blue input focus appearance in favor of consistent accessible focus styling.
- Added/expanded tooltips and interaction affordances across controls.

## Legal + Consent
- Added cookie consent manager with first-layer `Accept all`, `Reject all`, and `Configure`.
- Added persistent cookie settings control and consent timestamp persistence.
- Added legal pages for Cookies, Privacy, and Terms.
- Added consent-aware gating for theme preference persistence/restore.

