# AI School — Next Phase: Single-PR, Zero-Skip Agent Instructions

**This is a hard contract. Do not start coding until you have created the required checklist file exactly as described.**

---

## 0) Prime Directive (non-negotiable)

- **ONE PR ONLY.** You may use multiple commits, but there must be **a single final PR**.
- **ZERO SKIPS.** You must implement **every** fix/feature listed in the 40 bullets below.
- **NO “similar alternative” substitutions.** Implement what is asked, not a different version.
- If something is blocked (e.g., missing API key), you must still ship a **graceful UI fallback** and mark it complete.

**Definition of DONE:** Every checkbox in `NEXT_PHASE_CHECKLIST.md` is ticked ✅ and has evidence in `docs/evidence/`.

---

## 1) Required workflow (prevents skipping)

### 1.1 Create `NEXT_PHASE_CHECKLIST.md` (mandatory, before any code)
Create a markdown file at the repo root named:

`NEXT_PHASE_CHECKLIST.md`

It must contain:

1. The **40 bullets verbatim** under a section called **“Source bullets (verbatim)”**.
2. Under each bullet, the **atomic checkbox breakdown** (provided in Section 3 below).
3. For each bullet:
   - **How to verify**: 2–5 concrete steps.
   - **Evidence**: a filepath like `docs/evidence/B08-compaction.gif` (or `.png`).

**DO NOT WRITE ANY CODE** until this file exists and includes all 40 bullets.

### 1.2 Evidence rule (mandatory)
- For each bullet, attach either:
  - **1 GIF** showing the behavior end-to-end, OR
  - **2+ screenshots** that clearly prove the fix.
- Store evidence in: `docs/evidence/`
- Evidence file naming convention: `B##-short-name.(png|gif)`

### 1.3 QA baseline (mandatory)
Before marking the last items as done, manually check:

- Desktop **1920×1080**
- Small width (sidebar collapsed + model selector + right panel)
- Dark mode
- No new console errors
- Keyboard: tab focus behaves intentionally (accessible focus, no ugly defaults)

Write a short section at the end of the checklist: **“Manual QA walkthrough”**.

---

## 2) Single-PR deliverables
Your single PR must include:

- `NEXT_PHASE_CHECKLIST.md` (completed, all checkboxes ticked)
- Evidence files under `docs/evidence/`
- All code changes implementing all bullets
- A short `RELEASE_NOTES.md` summarizing changes grouped by area (Sidebar / Right Panel / Models / Admin / Agents / Performance / Design / Legal)

---

## 3) Source bullets (verbatim — DO NOT ALTER)
These are the source requirements. You must implement **all** of them.

1. Initial user prompt not shown at start, as the main welcome screen is shown  
2. User monthly usage either doesn’t render properly, or isn’t thought about as it ALWAYS shows 0%  
3. The right panel opening still blurs the rest of the screen. And in a 1920x1080 res screen, it should still be within the page, not with a separator nor the popup, in a similar way that it is done in ChatGPT as such:  
4. The searchbar shouldn’t have a blue outline when pressing on it  
5. Better and improved system for conveying notifications as well as popups. Popup not needed almost none of the time, unless a specific error or message (no need to have message for mode changed, etc). And when done, it should have a similar UI to the achievement popups  
6. Achievements not correctly configured. I ran a normal prompt, and it gave me image generation achievement  
7. More and cooler animations that give effect as well as professionalism. No hover effects currently, or effects when changing things (or when enhancement and compaction take place, or change in mode/agent).  
8. Compaction button broken and does nothing. Image here shows two errors: when compaction is activated that opens a popup and just shows expand button, and when pressing on small screens on model selector that has a z-index lower than sidebar. It should go on top (and possibly be shifted a bit to the right):  
9. Pages rely TOO HEAVILY on box components… admin/super-admin space wrong… redesign entirely… confusing navigation… options shouldn’t exist if they just tell me to go somewhere else…  
10. In admin, it is weird where there is option between personal and school admin… no back… SOUL publish error requires OPENROUTER_API_KEY…  
11. In things like email in super-admin, it should also show a dropdown-list type component where typing shows all the possible results  
12. Feedback inbox isn’t great… categorize by AI… replying doesn’t work… see which user sent it and more  
13. Improve the tour component to show MANY more functionalities and guide users…  
14. Model page visually different… search models before provider search… Tier: Normal confusing… weird hover/outline effect in model atlas sort  
15. Model providers appear twice… join them… currently hides models… remove “providers with too few models don’t show”  
16. Provider+model search should be much more intelligent… “5.3” example… missing provider icons  
17. Provider grid should be in a right panel and replaced with leaderboard when clicked… all right panels must use the same reusable component  
18. Sidebar page selector: reorder works collapsed too; scrollable smaller by default; hover expands; default state must allow scroll; depending on page it should shift  
19. Sidebar collapsing is horrible: replace arrow with panel toggle; collapsed state should NOT have hover functionality; just show all pages  
20. Add more tooltips: collapsed sidebar + compact/enhance/thinking toggles + everywhere needed  
21. Focus timer must be an actual button; user controls time  
22. Tour button persists on all screens; same for timer  
23. Move feedback button to right above tour; also fix responsive blocking of UI (send button/icons)  
24. Orchestration button can’t close  
25. Fix critic agent; add more orchestration agents; researcher sources DO NOT RENDER  
26. Mode router: using word “render” caused it to create an image  
27. Streak + XP much smaller like collapsed version; hover expands; otherwise steals space for chats  
28. Chats list + messages load dynamically by scroll; don’t render everything initially; load older on scroll up  
29. School icon bigger and school theme more prominent (currently no effect)  
30. Mark independent notifications as read  
31. General UI improvements + cooler animations without being aggressive  
32. Cookies management with accept all + other ToS needed (research)  
33. Recent chats smaller like ChatGPT tabs (not box cards)  
34. Agent creation: “student”→“user” logic; IB option; conversational AI builder; adaptive questions; expertise multi-select + “type yourself”; stop generating wrong story; formatted; system prompt font consistent; etc  
35. Auto conversation title generator broken (takes first 3 letters); must use cheap model; 2–5 words  
36. Delete image in image gallery  
37. Dark mode much less polished; improve drastically  
38. Searchboxes must stop infinite growth; auto-grow to max then scroll  
39. Settings button useless outside chat; make useful; profile picture opens account management  
40. Branding: logo shown but says “choose file no file chosen”; replace/delete old; color picker; colors actually affect theme; remove static welcome message → dynamic by time/month; live preview must show real effect; logo UI spacing/render; auto-update on change  

---

## 4) Atomic checkbox breakdown (MUST be copied under each bullet in the checklist)

> In `NEXT_PHASE_CHECKLIST.md`, create headings **B01..B40** and copy the relevant checkboxes under each.

### B01 — Initial prompt not shown
- [ ] First-time load shows the intended initial user prompt view (not generic welcome screen).
- [ ] Returning users still behave correctly.

### B02 — Monthly usage always 0%
- [ ] Usage data renders correctly when present.
- [ ] If no data, show an explicit empty state (not misleading “0%” as default).

### B03 — Right panel blur + wrong layout at 1920×1080
- [ ] Remove blur overlay.
- [ ] At 1920×1080, right panel is integrated (ChatGPT-like), not a floating popup/separator.
- [ ] Responsive behavior is correct at smaller widths.

### B04 — Searchbar blue outline
- [ ] Replace default blue outline with a deliberate, accessible focus style.

### B05 — Notifications + popups system
- [ ] No popups for “mode changed” / minor events.
- [ ] Popups only for meaningful errors/important messages.
- [ ] Popup UI matches the achievement popup style.

### B06 — Achievements wrong triggers
- [ ] Normal prompt does NOT unlock image generation achievement.
- [ ] Add at least one regression check for achievement conditions.

### B07 — Animations / hover / transitions
- [ ] Add hover states for key interactive elements.
- [ ] Add transitions for: mode change, agent change, enhance/compact actions.

### B08 — Compaction broken + popup bug + z-index
- [ ] Compaction button performs its intended function.
- [ ] Fix “compaction popup shows only expand” bug.
- [ ] Fix model selector z-index on small screens (overlay sidebar; optionally shift right slightly).

### B09 — Too many “box components” + admin space/navigation
- [ ] Reduce nested “box” components (especially analytics & model items).
- [ ] Improve spacing/typography/layout so pages look intentional.
- [ ] Redesign admin/super-admin layout where confusing/wrong.
- [ ] Remove options that just tell users to go elsewhere (make direct navigation or remove).

### B10 — Admin split + no back + SOUL publish error
- [ ] Remove/merge the “personal vs school admin” split into a coherent admin space.
- [ ] Add proper back navigation (no trap screens).
- [ ] Handle missing `OPENROUTER_API_KEY` gracefully: disable publish + show actionable message (not raw JSON).

### B11 — Super-admin email dropdown
- [ ] Convert email input to searchable dropdown/typeahead with keyboard navigation.

### B12 — Feedback inbox
- [ ] AI categorize feedback into buckets + filter.
- [ ] Reply flow works end-to-end.
- [ ] Show which user sent feedback + useful metadata.

### B13 — Tour improvements
- [ ] Tour covers many more features and workflows.
- [ ] Tour exists where needed (main chat, agents, models, admin).

### B14 — Models page UX + hover bug
- [ ] “Search models” appears before provider search.
- [ ] “Tier: Normal” becomes understandable (actionable or removed/relabeled).
- [ ] Fix weird hover/outline effect in model atlas sort.

### B15 — Provider duplicates + missing models + min-models filter
- [ ] Merge duplicate providers into one.
- [ ] Ensure no models are hidden due to duplication.
- [ ] Remove “providers with too few models don’t show” behavior.

### B16 — Intelligent search + “5.3” + missing icons
- [ ] Fuzzy match version strings (e.g., “5.3” finds the real model).
- [ ] Searching a model reveals provider context appropriately.
- [ ] Provide icons/fallbacks for missing provider icons (lightweight solution OK).

### B17 — Provider grid in right panel + reusable panel
- [ ] Provider grid lives in the shared right panel.
- [ ] Clicking provider swaps panel content to leaderboard (same container).
- [ ] ALL right panels use one reusable component and switch views internally.

### B18 — Sidebar page selector (scroll + hover expand + reorder)
- [ ] Compact by default and scrollable.
- [ ] Hover expands with animation (still scrollable).
- [ ] Reorder works when sidebar is collapsed.
- [ ] Default state allows scroll (no “must expand” bug).
- [ ] Layout shifts appropriately depending on page.

### B19 — Sidebar collapse behavior
- [ ] Replace arrow collapse UI with a proper panel toggle.
- [ ] Collapsed state has NO hover-expand behavior; just show page icons.

### B20 — Tooltips
- [ ] Tooltips for collapsed sidebar icons.
- [ ] Tooltips for compact/enhance/thinking toggles.
- [ ] Add tooltips elsewhere where needed.

### B21 — Focus timer button + editable duration
- [ ] Timer is a first-class button (not buried).
- [ ] User can set the time.

### B22 — Tour + timer persist everywhere
- [ ] Tour button visible on all screens/pages.
- [ ] Timer button visible on all screens/pages.

### B23 — Feedback button placement + responsive blocking
- [ ] Move feedback button to right side above tour.
- [ ] Ensure floating buttons never cover send button/icons on any width.

### B24 — Orchestration can’t close
- [ ] Orchestration panel opens and closes reliably (and via expected controls).

### B25 — Critic agent + more agents + researcher sources rendering
- [ ] Fix critic agent behavior/output.
- [ ] Add more orchestration agents (useful set; integrated cleanly).
- [ ] Researcher sources render correctly in UI.

### B26 — Mode router misroutes “render”
- [ ] Fix routing so “render” in normal contexts doesn’t trigger image generation.

### B27 — Streak/XP too large
- [ ] Make streak/XP compact by default.
- [ ] Hover expands.
- [ ] No longer steals vertical space from chats.

### B28 — Infinite scroll/virtualization (chat list + messages)
- [ ] Chat list loads dynamically on scroll (no giant initial render).
- [ ] Messages: render recent first; load older on scroll up (stable scrolling).

### B29 — School icon/theme prominence
- [ ] Increase school icon size.
- [ ] Make school theme actually affect UI (not a no-op).

### B30 — Mark notifications read (individually)
- [ ] Each notification can be marked as read independently.

### B31 — General UI polish without aggressive animations
- [ ] Improve spacing/typography/microinteractions across the app.
- [ ] Animations feel professional, not aggressive.

### B32 — Cookies + ToS hooks (research-backed)
- [ ] Cookie banner has **Accept all**, **Reject all**, **Configure** on first layer.
- [ ] Non-essential cookies are blocked until consent.
- [ ] Provide persistent “Cookie settings” to change consent later.
- [ ] Store consent decision + timestamp.

### B33 — Recent chats as compact tabs/rows
- [ ] Replace boxy chat cards with compact ChatGPT-like rows/tabs.

### B34 — Agent creation overhaul (conversational builder)
- [ ] Replace rigid form with conversational AI builder with adaptive questions.
- [ ] Replace “student” wording with “user” and support IB option.
- [ ] Expertise supports multi-select + “type your own”.
- [ ] Prevent wrong-story generation; outputs must match user intent.
- [ ] Formatting and typography consistent with the rest of UI.

### B35 — Auto title generator
- [ ] Stop using “first 3 letters”.
- [ ] Use cheap model to generate 2–5 word titles.
- [ ] Cache/avoid re-generating unnecessarily.

### B36 — Delete image in gallery
- [ ] Add delete action with confirm.
- [ ] Delete removes from UI and storage/source of truth.

### B37 — Dark mode redesign
- [ ] Improve contrast, borders/elevation, and theme consistency.
- [ ] Ensure key pages look intentional in dark mode.

### B38 — Searchboxes max height
- [ ] Inputs auto-grow up to a max height, then scroll internally (no infinite growth).

### B39 — Settings + account management
- [ ] Settings is useful outside chat (contextual or account entry).
- [ ] Profile picture opens account management.

### B40 — Branding end-to-end
- [ ] Logo display is correct (no “choose file no file chosen” mismatch).
- [ ] Replace logo deletes old asset.
- [ ] Color picker exists and works.
- [ ] Theme colors actually apply across the app.
- [ ] Replace static welcome message with dynamic greeting (time-of-day + month).
- [ ] Live preview shows real effect.
- [ ] Branding updates apply immediately.

---

## 5) Scope guardrails (avoid derailing the single PR)

- You MAY refactor if needed, but only if it **directly helps** satisfy bullets.
- Do not introduce new page systems if an existing reusable component can be extended.
- Prefer incremental changes over risky rewrites.

---

## 6) (Optional) Small “new features” that are allowed ONLY after bullets are satisfied
These are permitted only once B01–B40 are all checked:

- Cmd/Ctrl+K command palette (search chats/agents/models/providers)
- Global status strip (Saving/Synced/Offline/Budget-limited → switched model)
- Right panel internal back/history (still using the single reusable right panel component)

If any of these risk delaying B01–B40, skip them.

---

## 7) Final checklist (before opening the PR)
- [ ] `NEXT_PHASE_CHECKLIST.md` exists and contains all 40 bullets verbatim + all checkboxes
- [ ] All checkboxes are ticked
- [ ] Evidence exists for every bullet under `docs/evidence/`
- [ ] Manual QA walkthrough is written
- [ ] `RELEASE_NOTES.md` exists and is concise

---

## 8) Latest QA Delta (2026-02-25) — Must be completed

This section tracks follow-up issues reported after the first implementation pass. These are additional acceptance checks for the same single PR.

### 8.1 Immediate interaction fixes
- [ ] Remove blue/default outlines from search inputs in chat, agent builder, and model/search surfaces; keep a deliberate non-blue accessible focus style.
- [ ] Move persistent cookie settings entry out of intrusive floating placement; keep it reachable in a non-blocking location.
- [ ] Remove broken "hide controls" entrypoint/UI until it can be restored safely.
- [ ] Restore and deepen compaction behavior (not placeholder UI), including stable open/close and visible results.
- [ ] Fix focus timer button wiring so it never opens feedback.
- [ ] Ensure right panel can close, switch content, and reopen without stuck state.
- [ ] Remove all background blur behavior when right panels open.

### 8.2 Tours, utilities, and global controls
- [ ] Tour works on every required page (not only chat), with valid on-screen targets.
- [ ] Fix off-screen/unavailable tour targets by gating steps on visible elements.
- [ ] Expand tour coverage, especially on agents and sidebar flows.
- [ ] Keep notifications/tour/feedback/timer available globally without blocking core controls.
- [ ] Replace intrusive bottom-right stack with a compact persistent global controls zone.
- [ ] Fix notification bell markup error ("button cannot be a descendant of button").

### 8.3 Agents creation and discovery
- [ ] Add explicit option to provide manual system prompt in agent creation (available but not recommended).
- [ ] Simplify conversational builder onboarding and sequence so users understand start-to-finish flow.
- [ ] Make builder search input style consistent with the main search experience.
- [ ] Add stronger search/filtering for agents with semantic/fuzzy behavior (similar spirit to models).

### 8.4 Usage, models, and right-panel UX
- [ ] Remove money spent label (`$0`/monthly money text) from usage display; keep progress-only semantics.
- [ ] Fix usage progress computation so it no longer sticks at 0% when data exists.
- [ ] Redesign model atlas layout for large screens so content is not compressed.
- [ ] Show models and providers simultaneously in a clearer split layout.
- [ ] Increase model provider icon prominence where currently too small.
- [ ] Remove or relabel non-actionable "budget profile normal" / "tier" controls when users cannot change them.
- [ ] Prevent provider click from unexpectedly switching to leaderboard.

### 8.5 Analytics and admin restructuring
- [ ] Redesign analytics with fewer card wrappers; charts/graphs should read as first-class page elements.
- [ ] Rework "topics explored by type" presentation to match redesigned analytics language.
- [ ] Organization settings defaults should be ON for new toggles unless explicitly disabled by user.
- [ ] Remove daily token budget control.
- [ ] Reorder admin sections for clarity; reduce oversized role-management block and expose usage context better.
- [ ] Add role filtering/search where missing.

### 8.6 SOUL, branding, and theme behavior
- [ ] Add clear back navigation from School SOUL screens.
- [ ] Replace raw SOUL publish error with actionable UI state/message and proper fallback.
- [ ] Ensure accent color has visible effect across interface surfaces (not primary-only).
- [ ] Extend branding-driven theming so changes are immediate and obvious.

### 8.7 Sidebar/navigation behavior update
- [ ] Remove page reordering capability.
- [ ] Remove "more pages" divider behavior in all sidebar states.
- [ ] Use fixed-width, scrollable page rail showing nearby pages around current location.
- [ ] Remove disliked sidebar text animation behavior on collapse/expand.
- [ ] Move sidebar toggle below school icon and increase school icon prominence.
- [ ] Keep the surrounding-pages behavior natural when navigating deep pages (analytics/admin/super-admin/models/images context).

### 8.8 Additional global UX requests
- [ ] Add global command palette (kbar/Cmd+K) with cross-page actions and navigation.
- [ ] Update conversation subheading metadata to "time ago" style instead of "model used".

### 8.9 Execution protocol additions
- [ ] Before each implementation batch, re-open this `PLAN.md` and confirm pending items.
- [ ] After each compaction pass, re-open this `PLAN.md`, re-render pending scope, and continue.
- [ ] After each major batch, run lint/build/tests and log pass/fail in checklist/release notes.

## 9) Execution Log — 2026-02-25 (Pass 2)

### Completed in this pass
- [x] Search/focus style normalization:
  - Removed blue/default-style focus rings from shared `Input` and `Textarea` components.
  - Added explicit non-blue focus treatment to chat model search and command palette search.
- [x] Cookie settings intrusion reduction:
  - Removed cookie-settings shortcut from intrusive global settings drawer surface.
  - Cookie settings remain accessible via command palette event.
- [x] Compaction restoration/depth controls:
  - Added in-depth compaction presets in chat header (`Compact now`, `Deep compact`, `Gentle compact`).
  - `compactConversation()` now supports `keepLatestMessages` payload.
- [x] Right panel stability hardening:
  - Added panel close/open event dispatch in panel context.
  - Added orchestration dismissal lock when user closes orchestration panel mid-stream.
  - Increased dock width logic and guard behavior to reduce stuck/unstable panel behavior.
- [x] Small-screen compaction/UI regression:
  - Unified panel and settings drawer no longer open collapsed by default on compact layouts.
- [x] Usage bar and wording cleanup:
  - Removed budget-profile wording from sidebar/session usage labels.
  - Added activity fallback signal (recent-chat based) so progress no longer appears stuck at 0 in no-cost telemetry paths.
  - Reworded monthly tier error copy to guardrail language.
- [x] Model Atlas redesign iteration:
  - Upgraded to full-bleed layout for large screens.
  - Increased provider icon prominence in model cards and provider panel.
  - Reworked right panel to show providers and leaderboard simultaneously (no forced view swap).
  - Removed spending-tier wording in visible model restrictions copy.
- [x] Tour reliability/coverage:
  - Improved guided-tour step skipping for missing/off-screen targets.
  - Reordered base tour to utility-first targeting.
  - Added additional tour steps for branding and super-admin feedback pages.
  - Added `data-tour` anchors for branding + super-admin feedback surfaces.
- [x] Agent builder clarity improvements:
  - Improved guided builder onboarding copy.
  - Reduced conversational clutter (single active question + captured-summary chips).
  - Added step value hydration when revisiting text-entry steps.
- [x] SOUL back-navigation behavior:
  - Updated SOUL "Go back" to behave as actual navigation back (with safe fallback route).

### Validation results for this pass
- [x] `npm run lint` passed
- [x] `npm test` passed
- [x] `npm run build` passed
