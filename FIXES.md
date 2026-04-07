# Wave 1+2 Fix Tracker

## BATCH 1 — Quick Code Fixes
- [x] Remove "Policy correction:" text from pipeline.ts — all occurrences, g flag, inline patterns
- [x] Fix thinking block: removed show/less toggle, always shown with max-h-52 auto-scroll; ThinkingBlock now in right panel too
- [x] Fix admin OPENROUTER warning — bootstrap route overrides with Next.js process.env
- [x] Fix platform stats aggregation: zero-guard removed, always full rebuild
- [x] Fix artifact error: errData.error String() coercion added

## BATCH 2 — Hub Bar Overhaul
- [x] Add toggle-completed-faded/hidden control to hub — always visible pill above + button
- [x] Add background mode cycling control (dots→grid→none) — always visible
- [x] Add showConnections toggle to hub — always visible
- [x] Redesign + create button as radial/roulette fan menu — semicircle at 30°–150°
- [x] Fix context menu close: pointerdown capture handler works correctly
- [x] Add "New workspace" creation option to hub radial menu

## BATCH 3 — Workspace Canvas Fixes
- [x] Remove committed WorkstreamNode from view (hidden: isCommitted) — ugly card gone
- [x] Fix initial workspace entry: handleInit calls setVisibleWorkstreamIds + fetchContent, uses focusWorkstreamId fallback
- [x] Fix duplicate nav — WorkspaceCommandBar removed from canvas and panel
- [x] Left sidebar: layout prop replaced with animated width to prevent Maximum update depth
- [x] Workspace page: no top header, fully full-bleed

## BATCH 4 — Panel & Chat Fixes
- [x] Fix right panel extra right-margin — inner div uses w-full instead of fixed width
- [x] Fix quick chat animation — EdgeUtilityOverlay no longer affected by canvas layout prop
- [x] Fix "Naming this chat" phase: removed from phase plan UI; pipeline only generates title when needed; unified panel filters out "title" phase
- [x] ManageBac base URL — hardcoded to api.managebac.com, not editable
- [x] Fix workspace creation via quick chat — detectWorkspaceIntent properly opens dialog pre-filled

## BATCH 5 — Artifact Editor Fixes
- [x] Fix floating add/drag buttons displaced — scroll offset correction applied
- [x] Fix image block: now opens file picker on click (handleDOMEvents intercept)
- [x] Fix copy-paste white flash — paste handler only intercepts external docs
- [ ] Add quick chat bar to artifact editor — pending
- [x] Fix notes not saving — save logic verified/fixed in NotePanelContent

## BATCH 6 — Smaller Fixes
- [ ] Make cookie consent smaller and more discreet
- [x] Right panel empty right margin fix — w-full applied
- [ ] Visualization inline rendering (SVG in chat directly)

## ADDITIONAL (from this session)
- [x] Chat panel: ReactMarkdown rendering for assistant messages
- [x] Chat panel: In-panel composer (Reply input + send button) 
- [x] Chat panel: Context-aware empty state
- [x] Pipeline: Policy correction stripping with /g flag + inline patterns
