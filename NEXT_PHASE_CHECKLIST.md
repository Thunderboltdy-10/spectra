# NEXT PHASE CHECKLIST

## Source bullets (verbatim)

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

## Checklist (B01..B40)

### B01 — Initial prompt not shown
Source bullet (verbatim): Initial user prompt not shown at start, as the main welcome screen is shown
- [ ] First-time load shows the intended initial user prompt view (not generic welcome screen).
- [ ] Returning users still behave correctly.
How to verify:
1. Open a fresh account session and confirm the initial prompt view renders first.
2. Open an existing chat session and confirm prior behavior remains correct.
Evidence: `docs/evidence/B01-initial-prompt.png`

### B02 — Monthly usage always 0%
Source bullet (verbatim): User monthly usage either doesn’t render properly, or isn’t thought about as it ALWAYS shows 0%
- [ ] Usage data renders correctly when present.
- [ ] If no data, show an explicit empty state (not misleading “0%” as default).
How to verify:
1. Seed usage data and confirm percentage + values render.
2. Test no-usage scenario and confirm explicit empty state messaging.
Evidence: `docs/evidence/B02-monthly-usage.png`

### B03 — Right panel blur + wrong layout at 1920×1080
Source bullet (verbatim): The right panel opening still blurs the rest of the screen. And in a 1920x1080 res screen, it should still be within the page, not with a separator nor the popup, in a similar way that it is done in ChatGPT as such:
- [ ] Remove blur overlay.
- [ ] At 1920×1080, right panel is integrated (ChatGPT-like), not a floating popup/separator.
- [ ] Responsive behavior is correct at smaller widths.
How to verify:
1. Open right panel at 1920x1080 and confirm no blur and integrated layout.
2. Reduce viewport width and verify responsive compact behavior.
Evidence: `docs/evidence/B03-right-panel-layout.gif`

### B04 — Searchbar blue outline
Source bullet (verbatim): The searchbar shouldn’t have a blue outline when pressing on it
- [ ] Replace default blue outline with a deliberate, accessible focus style.
How to verify:
1. Focus each search input via click/tab.
2. Confirm custom accessible focus ring replaces browser default blue ring.
Evidence: `docs/evidence/B04-search-focus.png`

### B05 — Notifications + popups system
Source bullet (verbatim): Better and improved system for conveying notifications as well as popups. Popup not needed almost none of the time, unless a specific error or message (no need to have message for mode changed, etc). And when done, it should have a similar UI to the achievement popups
- [ ] No popups for “mode changed” / minor events.
- [ ] Popups only for meaningful errors/important messages.
- [ ] Popup UI matches the achievement popup style.
How to verify:
1. Trigger mode/agent changes and verify no blocking popup appears.
2. Trigger an error flow and verify achievement-style important popup appears.
Evidence: `docs/evidence/B05-notifications.png`

### B06 — Achievements wrong triggers
Source bullet (verbatim): Achievements not correctly configured. I ran a normal prompt, and it gave me image generation achievement
- [ ] Normal prompt does NOT unlock image generation achievement.
- [ ] Add at least one regression check for achievement conditions.
How to verify:
1. Send plain text prompt and verify image achievement stays locked.
2. Run regression tests/assertions for achievement trigger logic.
Evidence: `docs/evidence/B06-achievement-trigger.png`

### B07 — Animations / hover / transitions
Source bullet (verbatim): More and cooler animations that give effect as well as professionalism. No hover effects currently, or effects when changing things (or when enhancement and compaction take place, or change in mode/agent).
- [ ] Add hover states for key interactive elements.
- [ ] Add transitions for: mode change, agent change, enhance/compact actions.
How to verify:
1. Hover key controls and confirm clear but professional hover feedback.
2. Change mode/agent and run enhance/compact to confirm transitions animate.
Evidence: `docs/evidence/B07-motion.gif`

### B08 — Compaction broken + popup bug + z-index
Source bullet (verbatim): Compaction button broken and does nothing. Image here shows two errors: when compaction is activated that opens a popup and just shows expand button, and when pressing on small screens on model selector that has a z-index lower than sidebar. It should go on top (and possibly be shifted a bit to the right):
- [ ] Compaction button performs its intended function.
- [ ] Fix “compaction popup shows only expand” bug.
- [ ] Fix model selector z-index on small screens (overlay sidebar; optionally shift right slightly).
How to verify:
1. Click compaction and verify content compacts/expands correctly.
2. Open model selector on small width with sidebar visible and confirm selector overlays it.
Evidence: `docs/evidence/B08-compaction.gif`

### B09 — Too many “box components” + admin space/navigation
Source bullet (verbatim): Pages rely TOO HEAVILY on box components… admin/super-admin space wrong… redesign entirely… confusing navigation… options shouldn’t exist if they just tell me to go somewhere else…
- [ ] Reduce nested “box” components (especially analytics & model items).
- [ ] Improve spacing/typography/layout so pages look intentional.
- [ ] Redesign admin/super-admin layout where confusing/wrong.
- [ ] Remove options that just tell users to go elsewhere (make direct navigation or remove).
How to verify:
1. Review analytics/models/admin pages and confirm fewer nested card shells.
2. Confirm direct navigation exists for surfaced options (no dead-end “go elsewhere” prompts).
Evidence: `docs/evidence/B09-layout-redesign.png`

### B10 — Admin split + no back + SOUL publish error
Source bullet (verbatim): In admin, it is weird where there is option between personal and school admin… no back… SOUL publish error requires OPENROUTER_API_KEY…
- [ ] Remove/merge the “personal vs school admin” split into a coherent admin space.
- [ ] Add proper back navigation (no trap screens).
- [ ] Handle missing `OPENROUTER_API_KEY` gracefully: disable publish + show actionable message (not raw JSON).
How to verify:
1. Open admin and verify a unified navigation model is shown.
2. Open SOUL publish without key and verify actionable UI state instead of raw JSON.
Evidence: `docs/evidence/B10-admin-unify.png`

### B11 — Super-admin email dropdown
Source bullet (verbatim): In things like email in super-admin, it should also show a dropdown-list type component where typing shows all the possible results
- [ ] Convert email input to searchable dropdown/typeahead with keyboard navigation.
How to verify:
1. Type into super-admin email field and verify suggestions appear.
2. Confirm arrow keys + enter selection work.
Evidence: `docs/evidence/B11-email-typeahead.gif`

### B12 — Feedback inbox
Source bullet (verbatim): Feedback inbox isn’t great… categorize by AI… replying doesn’t work… see which user sent it and more
- [ ] AI categorize feedback into buckets + filter.
- [ ] Reply flow works end-to-end.
- [ ] Show which user sent feedback + useful metadata.
How to verify:
1. Open inbox and verify category buckets and filters are present.
2. Reply to a feedback thread and verify success + persisted state.
Evidence: `docs/evidence/B12-feedback-inbox.png`

### B13 — Tour improvements
Source bullet (verbatim): Improve the tour component to show MANY more functionalities and guide users…
- [ ] Tour covers many more features and workflows.
- [ ] Tour exists where needed (main chat, agents, models, admin).
How to verify:
1. Start tour in chat, agents, models, and admin pages.
2. Confirm each has expanded step coverage with relevant actions.
Evidence: `docs/evidence/B13-tour.gif`

### B14 — Models page UX + hover bug
Source bullet (verbatim): Model page visually different… search models before provider search… Tier: Normal confusing… weird hover/outline effect in model atlas sort
- [ ] “Search models” appears before provider search.
- [ ] “Tier: Normal” becomes understandable (actionable or removed/relabeled).
- [ ] Fix weird hover/outline effect in model atlas sort.
How to verify:
1. Open models page and confirm search order is model-first then provider.
2. Verify tier control meaning is clear and sort control focus/hover is polished.
Evidence: `docs/evidence/B14-models-ux.png`

### B15 — Provider duplicates + missing models + min-models filter
Source bullet (verbatim): Model providers appear twice… join them… currently hides models… remove “providers with too few models don’t show”
- [ ] Merge duplicate providers into one.
- [ ] Ensure no models are hidden due to duplication.
- [ ] Remove “providers with too few models don’t show” behavior.
How to verify:
1. Compare provider count before/after merge logic with duplicate IDs.
2. Confirm all providers render regardless of model count threshold.
Evidence: `docs/evidence/B15-provider-merge.png`

### B16 — Intelligent search + “5.3” + missing icons
Source bullet (verbatim): Provider+model search should be much more intelligent… “5.3” example… missing provider icons
- [ ] Fuzzy match version strings (e.g., “5.3” finds the real model).
- [ ] Searching a model reveals provider context appropriately.
- [ ] Provide icons/fallbacks for missing provider icons (lightweight solution OK).
How to verify:
1. Search for “5.3” and verify the real 5.3 models appear.
2. Verify unknown providers render fallback icon treatment.
Evidence: `docs/evidence/B16-intelligent-search.png`

### B17 — Provider grid in right panel + reusable panel
Source bullet (verbatim): Provider grid should be in a right panel and replaced with leaderboard when clicked… all right panels must use the same reusable component
- [ ] Provider grid lives in the shared right panel.
- [ ] Clicking provider swaps panel content to leaderboard (same container).
- [ ] ALL right panels use one reusable component and switch views internally.
How to verify:
1. Open provider view and verify shared right panel container.
2. Click provider and confirm internal view swap to leaderboard without new modal.
Evidence: `docs/evidence/B17-right-panel-shared.gif`

### B18 — Sidebar page selector (scroll + hover expand + reorder)
Source bullet (verbatim): Sidebar page selector: reorder works collapsed too; scrollable smaller by default; hover expands; default state must allow scroll; depending on page it should shift
- [ ] Compact by default and scrollable.
- [ ] Hover expands with animation (still scrollable).
- [ ] Reorder works when sidebar is collapsed.
- [ ] Default state allows scroll (no “must expand” bug).
- [ ] Layout shifts appropriately depending on page.
How to verify:
1. Use collapsed and expanded states and confirm scrolling always works.
2. Reorder pages in collapsed mode and verify persistence.
Evidence: `docs/evidence/B18-sidebar-selector.gif`

### B19 — Sidebar collapse behavior
Source bullet (verbatim): Sidebar collapsing is horrible: replace arrow with panel toggle; collapsed state should NOT have hover functionality; just show all pages
- [ ] Replace arrow collapse UI with a proper panel toggle.
- [ ] Collapsed state has NO hover-expand behavior; just show page icons.
How to verify:
1. Collapse sidebar and confirm panel-toggle UI and stable collapsed behavior.
2. Hover collapsed sidebar and verify no auto expand occurs.
Evidence: `docs/evidence/B19-sidebar-collapse.png`

### B20 — Tooltips
Source bullet (verbatim): Add more tooltips: collapsed sidebar + compact/enhance/thinking toggles + everywhere needed
- [ ] Tooltips for collapsed sidebar icons.
- [ ] Tooltips for compact/enhance/thinking toggles.
- [ ] Add tooltips elsewhere where needed.
How to verify:
1. Hover collapsed sidebar items and chat action toggles.
2. Confirm tooltip text appears with consistent style and delay.
Evidence: `docs/evidence/B20-tooltips.png`

### B21 — Focus timer button + editable duration
Source bullet (verbatim): Focus timer must be an actual button; user controls time
- [ ] Timer is a first-class button (not buried).
- [ ] User can set the time.
How to verify:
1. Confirm timer button is visible in persistent app controls.
2. Set custom duration and start/pause/reset successfully.
Evidence: `docs/evidence/B21-focus-timer.gif`

### B22 — Tour + timer persist everywhere
Source bullet (verbatim): Tour button persists on all screens; same for timer
- [ ] Tour button visible on all screens/pages.
- [ ] Timer button visible on all screens/pages.
How to verify:
1. Navigate chat, models, agents, admin, analytics and verify both controls persist.
2. Confirm controls stay accessible on mobile/small width.
Evidence: `docs/evidence/B22-global-controls.png`

### B23 — Feedback button placement + responsive blocking
Source bullet (verbatim): Move feedback button to right above tour; also fix responsive blocking of UI (send button/icons)
- [ ] Move feedback button to right side above tour.
- [ ] Ensure floating buttons never cover send button/icons on any width.
How to verify:
1. Check placement on desktop and small screens.
2. Confirm chat send controls remain unobstructed at all tested widths.
Evidence: `docs/evidence/B23-feedback-placement.png`

### B24 — Orchestration can’t close
Source bullet (verbatim): Orchestration button can’t close
- [ ] Orchestration panel opens and closes reliably (and via expected controls).
How to verify:
1. Open orchestration panel from chat controls.
2. Close via close button and toggle action; verify both work.
Evidence: `docs/evidence/B24-orchestration-close.gif`

### B25 — Critic agent + more agents + researcher sources rendering
Source bullet (verbatim): Fix critic agent; add more orchestration agents; researcher sources DO NOT RENDER
- [ ] Fix critic agent behavior/output.
- [ ] Add more orchestration agents (useful set; integrated cleanly).
- [ ] Researcher sources render correctly in UI.
How to verify:
1. Run orchestration with critic enabled and inspect output quality path.
2. Trigger researcher citations and confirm source list renders in panel/message.
Evidence: `docs/evidence/B25-orchestration-agents.png`

### B26 — Mode router misroutes “render”
Source bullet (verbatim): Mode router: using word “render” caused it to create an image
- [ ] Fix routing so “render” in normal contexts doesn’t trigger image generation.
How to verify:
1. Submit text prompt containing “render” in normal context.
2. Confirm response remains text workflow unless explicit image intent exists.
Evidence: `docs/evidence/B26-router-render.png`

### B27 — Streak/XP too large
Source bullet (verbatim): Streak + XP much smaller like collapsed version; hover expands; otherwise steals space for chats
- [ ] Make streak/XP compact by default.
- [ ] Hover expands.
- [ ] No longer steals vertical space from chats.
How to verify:
1. Check sidebar default size of streak/xp block.
2. Hover and verify expansion while chats retain usable viewport area.
Evidence: `docs/evidence/B27-streak-xp.gif`

### B28 — Infinite scroll/virtualization (chat list + messages)
Source bullet (verbatim): Chats list + messages load dynamically by scroll; don’t render everything initially; load older on scroll up
- [ ] Chat list loads dynamically on scroll (no giant initial render).
- [ ] Messages: render recent first; load older on scroll up (stable scrolling).
How to verify:
1. Seed many chats and confirm incremental loading while scrolling list.
2. Open long chat and confirm upward scrolling fetches older messages.
Evidence: `docs/evidence/B28-dynamic-loading.gif`

### B29 — School icon/theme prominence
Source bullet (verbatim): School icon bigger and school theme more prominent (currently no effect)
- [ ] Increase school icon size.
- [ ] Make school theme actually affect UI (not a no-op).
How to verify:
1. Verify larger school logo/icon in sidebar/header placements.
2. Change school branding theme and verify visible global UI impact.
Evidence: `docs/evidence/B29-school-theme.png`

### B30 — Mark notifications read (individually)
Source bullet (verbatim): Mark independent notifications as read
- [ ] Each notification can be marked as read independently.
How to verify:
1. Open notification list and mark one item read.
2. Confirm only that item updates read state.
Evidence: `docs/evidence/B30-notification-read.gif`

### B31 — General UI polish without aggressive animations
Source bullet (verbatim): General UI improvements + cooler animations without being aggressive
- [ ] Improve spacing/typography/microinteractions across the app.
- [ ] Animations feel professional, not aggressive.
How to verify:
1. Perform quick pass through major pages and validate consistency upgrades.
2. Confirm reduced motion still usable and animation timing remains subtle.
Evidence: `docs/evidence/B31-ui-polish.png`

### B32 — Cookies + ToS hooks (research-backed)
Source bullet (verbatim): Cookies management with accept all + other ToS needed (research)
- [ ] Cookie banner has **Accept all**, **Reject all**, **Configure** on first layer.
- [ ] Non-essential cookies are blocked until consent.
- [ ] Provide persistent “Cookie settings” to change consent later.
- [ ] Store consent decision + timestamp.
How to verify:
1. Open first visit and confirm consent options appear in first layer.
2. Inspect local state/storage and verify status + timestamp updates with changes.
Evidence: `docs/evidence/B32-cookie-consent.png`

### B33 — Recent chats as compact tabs/rows
Source bullet (verbatim): Recent chats smaller like ChatGPT tabs (not box cards)
- [ ] Replace boxy chat cards with compact ChatGPT-like rows/tabs.
How to verify:
1. Open sidebar recents and verify compact row/tab treatment.
2. Confirm hover/active states remain readable in light and dark modes.
Evidence: `docs/evidence/B33-chat-rows.png`

### B34 — Agent creation overhaul (conversational builder)
Source bullet (verbatim): Agent creation: “student”→“user” logic; IB option; conversational AI builder; adaptive questions; expertise multi-select + “type yourself”; stop generating wrong story; formatted; system prompt font consistent; etc
- [ ] Replace rigid form with conversational AI builder with adaptive questions.
- [ ] Replace “student” wording with “user” and support IB option.
- [ ] Expertise supports multi-select + “type your own”.
- [ ] Prevent wrong-story generation; outputs must match user intent.
- [ ] Formatting and typography consistent with the rest of UI.
How to verify:
1. Build agent through conversational flow and verify adaptive follow-up questions.
2. Confirm final generated prompt aligns with entered goal/scope and uses consistent typography.
Evidence: `docs/evidence/B34-agent-builder.gif`

### B35 — Auto title generator
Source bullet (verbatim): Auto conversation title generator broken (takes first 3 letters); must use cheap model; 2–5 words
- [ ] Stop using “first 3 letters”.
- [ ] Use cheap model to generate 2–5 word titles.
- [ ] Cache/avoid re-generating unnecessarily.
How to verify:
1. Create new chats and verify 2-5 word model-generated titles.
2. Reload/open chat and confirm title does not regenerate repeatedly.
Evidence: `docs/evidence/B35-auto-title.png`

### B36 — Delete image in gallery
Source bullet (verbatim): Delete image in image gallery
- [ ] Add delete action with confirm.
- [ ] Delete removes from UI and storage/source of truth.
How to verify:
1. Delete an image from gallery and confirm confirmation flow.
2. Refresh gallery and verify image remains deleted.
Evidence: `docs/evidence/B36-image-delete.gif`

### B37 — Dark mode redesign
Source bullet (verbatim): Dark mode much less polished; improve drastically
- [ ] Improve contrast, borders/elevation, and theme consistency.
- [ ] Ensure key pages look intentional in dark mode.
How to verify:
1. Toggle dark mode and inspect chat/models/admin/analytics surfaces.
2. Confirm contrast ratios and component hierarchy are visually coherent.
Evidence: `docs/evidence/B37-dark-mode.png`

### B38 — Searchboxes max height
Source bullet (verbatim): Searchboxes must stop infinite growth; auto-grow to max then scroll
- [ ] Inputs auto-grow up to a max height, then scroll internally (no infinite growth).
How to verify:
1. Type long content in feedback/search/composer inputs.
2. Confirm field maxes out and internal scroll takes over.
Evidence: `docs/evidence/B38-autogrow-maxheight.gif`

### B39 — Settings + account management
Source bullet (verbatim): Settings button useless outside chat; make useful; profile picture opens account management
- [ ] Settings is useful outside chat (contextual or account entry).
- [ ] Profile picture opens account management.
How to verify:
1. Use settings on non-chat page and confirm meaningful actions are available.
2. Click profile picture and verify account management opens.
Evidence: `docs/evidence/B39-settings-account.png`

### B40 — Branding end-to-end
Source bullet (verbatim): Branding: logo shown but says “choose file no file chosen”; replace/delete old; color picker; colors actually affect theme; remove static welcome message → dynamic by time/month; live preview must show real effect; logo UI spacing/render; auto-update on change
- [ ] Logo display is correct (no “choose file no file chosen” mismatch).
- [ ] Replace logo deletes old asset.
- [ ] Color picker exists and works.
- [ ] Theme colors actually apply across the app.
- [ ] Replace static welcome message with dynamic greeting (time-of-day + month).
- [ ] Live preview shows real effect.
- [ ] Branding updates apply immediately.
How to verify:
1. Upload/replace logo and verify old asset cleanup + immediate updated rendering.
2. Change colors and confirm immediate global theme updates and accurate live preview.
3. Confirm greeting changes by local time/month rules.
Evidence: `docs/evidence/B40-branding.gif`

## Manual QA walkthrough

- [ ] Desktop 1920×1080 verified.
- [ ] Small width flow verified (collapsed sidebar + model selector + right panel).
- [ ] Dark mode verified.
- [ ] No new console errors.
- [ ] Keyboard tab focus behavior verified.

