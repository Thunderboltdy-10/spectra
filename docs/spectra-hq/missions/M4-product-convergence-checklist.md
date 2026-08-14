# M4 product convergence checklist

This file is the durable visual and product-quality ledger for M4. It supplements
`M4-one-product.md`; it does not replace or narrow that mission. An item is only
complete after implementation and direct Chrome screenshot inspection at the
relevant viewport. Screenshots that reveal a defect are diagnostic evidence,
not completion evidence.

## 1. Product-wide rules

- [ ] Spectra reads as one product: reuse the page anatomy, typography, spacing,
      hover motion, controls, and interaction language established in Workspace,
      Chat, Library, and the mature artifact surfaces.
- [ ] Every visible control earns its place. Rare, advanced, destructive, and
      secondary actions live behind a contextual menu or a disclosed panel.
- [ ] Every exposed component is a real feature: controls, selectors, lists,
      quarantines, conflicts, rails, and editors work end to end under direct
      Chrome interaction testing. Inert affordances and read-only pseudo-actions
      are wired properly or removed; nothing exists merely to make a page look full.
- [ ] Recurrent whole-product reviews interrupt local polishing: compare route
      anatomy, font scale, radii, controls, surfaces, motion, and density across
      the current screenshot sweep before propagating any new pattern.
- [ ] Do not use a bordered/card background merely to group a large page region.
      Use surfaces for cards, components, inputs, and purposeful auxiliary rails.
- [ ] Auxiliary right columns use a quiet contrasting surface, take real layout
      space, and can collapse. Collapsed means fully absent; the reopen trigger
      returns to the normal page chrome, as in Workspace. They must not blur,
      float over working content, or leave a decorative sliver behind.
- [ ] One shared route anatomy governs non-workbench pages: normal product
      background; restrained identity/header; horizontal adaptive section rail;
      flat primary content; optional fully dismissible auxiliary context; shared
      bottom safe area. Routes do not invent their own page skeleton.
- [ ] Overview pages avoid AI-looking pastel icon tiles, decorative summary
      cards, crammed metric copy, and irrelevant status prose. Summaries appear
      only when they change a decision or provide a useful route into work.
- [ ] Typography follows one scale across route headings, section headings,
      summaries, metadata, and artifact descriptions. A route cannot create a
      larger hierarchy merely because its implementation is newer.
- [ ] Radius follows one semantic hierarchy: compact controls 8px, inputs and
      interactive rows 10px, component surfaces 12px, and full pills only for
      statuses, toggles, avatars, or genuinely circular controls. Arbitrary route-
      local 7/9/16/18px rounding is removed.
- [ ] Visual hierarchy is spacing-led. Borders, dividers, containers, and
      alternate backgrounds are used only when they communicate a real boundary
      or interactive surface; they are never the default way to separate text.
- [ ] Simplicity does not mean an unstyled blank document. Use a restrained mix
      of type scale, tone, useful icons, hover/motion, and whitespace so sections
      are beautiful and legible without becoming card walls or monochrome forms.
- [ ] Prefer a recognizable icon plus a polished state/hover animation over an
      explanatory label when the meaning remains unambiguous and accessible.
- [ ] The ManageBac overview's balance—one readable state, compact visual
      destinations, and whitespace-led grouping—is the current reference to
      refine and propagate. Workspace, Library, and artifact editors are audited
      against the same rules; mature does not mean exempt.
- [ ] Minimal pages still need compositional tension: use column proportion,
      alignment, type contrast, and one useful visual anchor so removing cards
      does not leave important states floating in an under-designed blank page.
- [ ] Details and advanced configuration are closed by default unless they are
      the route's primary task.
- [ ] Remove generic `Live` / `Active` decoration. Keep presence/live language
      only where it communicates collaboration state or ManageBac sync state.
- [ ] All pages except `/chat` expose the shared Live Dock. `/chat` is scoped to
      its current thread and must not acquire the global dock.
- [ ] The shared `+` entry remains available with at least file attachment on
      every Live Dock; richer object/context actions may be route-capability
      dependent.
- [ ] Artifacts and threads can be opened from every non-chat product route
      through shared work-session primitives, not route-specific replicas.
- [ ] Thread creation has a deterministic placement: current workspace when one
      is active, otherwise the explicit unplaced collection.

## 2. Screenshot diagnosis: supplied Library + Whiteboard split view

- [ ] Reduce the four competing control rows: shell tabs, Library search/create,
      Library collections/view controls, and artifact chrome.
- [ ] Stop Library title/description from consuming a permanent left column when
      the content pane is narrow.
- [ ] Replace the overflowing Library collection tabs with the shared adaptive
      selector at constrained widths.
- [ ] Consolidate Library filters, sort, selection, and view mode so labels never
      wrap into two lines and the control group does not dominate the listing.
- [ ] Make large collection counts quieter and resilient to 2–4 digit values.
- [ ] Prevent cards from clipping titles, summaries, metadata, or actions.
- [ ] Remove the always-visible five-action footer from every card. Keep the
      primary open behavior direct; move secondary actions into one More menu.
- [ ] Use list presentation before a multi-column card grid becomes too narrow.
- [ ] Compact the artifact identity to one restrained row plus a short optional
      description. Do not repeat a large second heading above the editor.
- [ ] Replace generic `Live` in artifact chrome with collaboration presence only
      when collaborators are actually present.
- [ ] Keep essential artifact actions visible; move share, history, details, and
      similar secondary actions into a coherent More/side-panel model.
- [ ] Whiteboard More menus overlay the workbar and never expand its height or
      create vertical overflow.
- [ ] Whiteboard page/layer/template/search and insertion choices disclose as
      proper menus/panels; they do not compete in the primary workbar.
- [ ] The canvas and its editor shell use compatible base tones. Auxiliary rails
      may use a deliberate contrasting tone, but not an accidental white slab.
- [ ] The global composer remains centered in the page regardless of any open
      right panel and never covers Library actions, canvas content, or minimaps.
- [ ] Split-pane proportions remain usable at 1440, 1280, 1024, and 850 px;
      collapse/simplify before either side becomes a miniature desktop UI.

## 3. Shared shell and navigation

- [ ] Sidebar does not flash expanded during hydration when preference is
      collapsed.
- [ ] Sidebar footer stays pinned to the viewport bottom at every route height.
- [ ] Collapsed sidebar utility actions stack vertically and keep clear targets.
- [ ] No route gets the Workspace/Library rail unless it is part of the actual
      shared work-session model. Agents never gets a decorative rail or fake path.
- [ ] Page header is consistent across Settings, School, Admin, Superadmin,
      Analytics, Usage, ManageBac, Calendar/Timetable, and Agents.
- [ ] Page-level sections use one adaptive section-navigation component: tabs
      when there is room, a mature compact selector when there is not.
- [ ] Overflow actions and section rails use an accessible three-dot menu, not a
      visible text label reading `More` or a horizontally scrolling option rail.
- [ ] Admin must not introduce a third unrelated tab/select visual language.
- [ ] All selectors, segmented controls, sliders, filters, and search fields reuse
      shared Spectra states and hover/focus treatment.

## 4. Live Dock and work session

- [ ] Input remains page-centered at every route and viewport; opening or
      collapsing an auxiliary rail never shifts it.
- [ ] Dock never reduces the document viewport or creates a reserved horizontal
      strip that cuts the page short.
- [ ] Dock never obscures scrollable content; pages provide only the required
      bottom safe area.
- [ ] `+` is always present; attachment is always available.
- [ ] Context actions describe real route capabilities and do not expose dead or
      workspace-only actions elsewhere.
- [ ] Artifact/thread panels take real width, use a quiet contrasting background,
      and are collapsible.
- [ ] Multiple open items remain navigable without making the shell tab rail a
      second application header.
- [ ] Large thread/artifact counts do not cram Workspace or Library.

## 5. Artifact system

- [ ] Each artifact type has a maintainable editor module; common shell, identity,
      workbar, menus, panels, sync, comments, references, and responsive behavior
      remain shared.
- [ ] No `v2` filenames remain.
- [ ] Artifact descriptions are compact, line-clamped, and expandable on demand.
- [ ] One adaptive workbar model covers document, deck, quiz, planner, presentation,
      sheets, code, whiteboard, timetable, and agent editors.
- [ ] Essential actions survive constrained widths; secondary actions move to a
      real More menu with no toolbar reflow.
- [ ] Details, Comments, and References open as collapsible sidebars in fullscreen.
- [ ] Split mode and fullscreen both remain usable for every artifact type.
- [ ] Timetable layer filters are collapsible and do not permanently consume the
      working surface.
- [ ] Cards and editors handle long text, large numbers, empty data, and narrow
      widths without overlap, clipping, unexpected wrapping, or explosive height.

## 6. Route convergence

- [ ] Workspace: reduce visible button density; verify every exposed action;
      preserve mature layout and responsive rail behavior.
- [ ] Library: simplify collection/filter/view chrome; support high counts and
      dense inventories; keep cards/list rows calm and readable.
- [ ] Settings: settings is a full page, not an overlay/drawer, and uses the same
      header/content anatomy and normal product background as School and other
      product routes.
- [ ] School: same anatomy as Settings; accurate partial/available capability
      states for an admin/superadmin account. Test every section, not only Overview,
      and repair any option that does not load or perform its stated action.
- [ ] Admin/Superadmin/Usage: replace rushed cards and bespoke controls with the
      shared hierarchy; show all authorized data without fake locked states.
- [ ] ManageBac: keep sync status language, remove redundant headers, reuse shared
      controls, eliminate the dizzying summary/card matrix, test every section,
      and use Workspace-style fully dismissible auxiliary context. Period Map
      columns must not be wrapped in redundant containers; the context rail uses
      its own background consistently and receives the same typography, spacing,
      and separator audit as the main page.
- [ ] Calendar/Timetable: remove permanent filter clutter, add collapsible layers,
      and test dense data plus narrow viewports. Dragging a work block must show
      the live candidate time/position, commit without stale-revision conflicts,
      and retain the dropped position. Top/bottom resize handles must preview and
      commit duration changes with visible start/end times. Calendar grid height
      is the priority: date navigation, freshness, refresh, and creation controls
      share a compact header rather than consuming a second tall control row.
      Unscheduled work lives in the standard fully dismissible right rail so the
      weekly grid retains primary visual priority and route structure stays familiar.
- [ ] Agents: no fake breadcrumb, `Live collection`, or exclusive rail; use shared
      page anatomy, workbar, cards, composer, and empty/loading states.
- [ ] Analytics: shared page anatomy and truthful instrumentation states.
- [ ] Chat: retain the mature current-thread experience; do not add the global dock.

## 7. Validation matrix

- [ ] Inspect each major route at 1440 px.
- [ ] Inspect Workspace, Library, Settings, Admin, Calendar, Agents, and each
      artifact family at 1024 px.
- [ ] Inspect core shell, cards, Live Dock, and split editor at 850 px.
- [ ] Reload while the sidebar is collapsed and capture the loading/skeleton state.
- [ ] Capture and inspect every artifact type in split mode.
- [ ] Capture and inspect every artifact type in fullscreen mode.
- [ ] Capture and inspect Details, Comments, and References sidebars.
- [ ] Exercise whiteboard More, pages, layers, templates, search, object details,
      and presentation mode; no overlap or workbar growth.
- [ ] Exercise long titles/descriptions, large counts, dense lists, empty states,
      unavailable states, and admin/superadmin data states.
- [ ] Exercise every Settings, School Data, Admin, Superadmin, ManageBac, and
      Calendar section/action rather than accepting the default Overview screen.
- [ ] After each route batch, pause for a whole-product screenshot comparison and
      record any grammar drift before continuing; repeat this throughout M4 rather
      than treating broad critique as a one-time checkpoint.
- [ ] Reproduce and resolve `CALENDAR_GESTURE_CONFLICT` under repeated drag/move;
      verify optimistic preview, authoritative rollback, and resize gestures.
- [ ] Run Golden Flow 0–12 only after the visual system is settled.
- [ ] Run lint, typecheck, tests/build, and secret scan only at the end.
- [ ] Resolve every STATE §2.E row as deleted, wired, or fixed; no deferrals.
- [ ] Stop and ask before Git-history scrubbing.

## 8. Recurring whole-product reviews

### Review 1 — reference surfaces vs first convergence batch

Screenshots 100–111 compare Workspace, Library, Chat, Library + Whiteboard,
Calendar, ManageBac, and Settings as one user journey.

- [x] Preserved the strongest shared character: quiet warm canvas, Manrope-led
      operational text, high-contrast display headings, fine line icons, restrained
      Spectra accents, direct hover states, and underline-based section selection.
- [x] Identified and began removing arbitrary radius drift; Live Dock was reduced
      from 18px to the shared 12px component-surface radius.
- [x] Rebuilt Settings from a centered divider document into the shared left-aligned
      route anatomy with type/spacing-led two-column preference groups.
- [x] Workspace still overuses a page-title icon tile and six summary cards; replace
      these without losing its useful operational density.
- [x] Library still renders a visible `More` label and shows card-like objects while
      the List view is selected; fix the shared collection rail and view truth.
- [ ] Library skeletons still imply large empty card containers; align loading with
      the selected row/card representation and avoid an expanded-card flash.
- [ ] Audit local workbench/modal z-index values after the global Dock/modal layering
      fix so Chat, Workspace, Library, and Agents cannot overlap their own dialogs.

### Review 2 - Library truth and operational-route anatomy

Screenshots 113-129 compare the corrected Library List/Threads/Board/Canvas
states with School, Admin, Superadmin, Agents, Analytics, and Calendar as one
continuous route journey.

- [x] Library List now uses flat rows, one ellipsis action menu, and a functional
      in-menu workspace picker; Threads uses the same row truth and exposes only
      direct open plus a tested Live Dock continuation action.
- [x] Library Board now includes unplaced work instead of silently hiding 74
      objects, and its workspace grouping is expressed through calm headers rather
      than bordered full-height container cards.
- [x] Calendar is the strongest operational-route reference in this batch: its
      work grid owns the page, the unscheduled-work rail takes real space and can
      disappear, and the global Dock remains centered.
- [ ] School keeps the right route skeleton but its partial-coverage banner does
      not lead to a decision, the primary overview is compositionally empty, and
      its summary rail still uses stacked separators instead of calm grouped rows.
- [ ] Admin and Superadmin are the largest grammar outliers: remove pastel square
      metric tiles, divider-led KPI matrices, repetitive source prose, and crowded
      context rails; preserve real administrative actions and authoritative data.
- [ ] Analytics repeats `Current` status on every metric and presents six verbose
      cards before its useful visualizations; compress provenance once at page
      level and let the data form a readable spacing-led composition.
- [ ] Agents has correctly lost the fake path, generic Live state, and exclusive
      rail, but still begins with an ornamental square tile and an oversized row
      of search/filter controls; simplify without weakening discovery or creation.
- [ ] Reuse Calendar/ManageBac's calm working-surface priority for operational
      routes, while retaining the horizontal Library-style section selector and
      the purpose-specific controls each route genuinely needs.

### Review 3 - administration, school, analytics, agents, and workspace

Screenshots 130-161 cover both administration levels, every School section,
Agents discovery and filters, Analytics, and the Workspace home in one repeated
cross-route critique.

- [x] Admin and Superadmin now share stable route titles, flat semantic metrics,
      spacing-led sections, and quiet auxiliary context instead of pastel metric
      tiles and divider matrices; all eleven Admin sections loaded successfully.
- [x] School was exercised across all nine sections, including the overflow menu.
      Unsupported and verified-empty states are explicit, five sync capabilities
      report current truthfully, and the final unlinked class workspace was created
      successfully through the real provider-backed action.
- [x] Agents now begins with agents: the ornamental identity tile is removed and
      the three discovery selectors live behind one tested filter disclosure.
- [x] Analytics shows freshness once, uses compact flat metrics, and brings its
      useful type and run-outcome visualizations into the first viewport.
- [x] Workspace no longer opens with a title tile plus six summary cards; its real
      spaces, inventory, contextual activity, and centered Dock now own the view.
- [ ] Continue the same critique across every artifact family in split and
      fullscreen modes before treating these route-level improvements as settled.
