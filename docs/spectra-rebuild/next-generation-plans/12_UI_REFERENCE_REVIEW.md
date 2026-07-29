# UI reference implementation and verification contract

## Authority

All 21 images in docs/spectra-rebuild/spectra-next-generation-ui are functional and visual specifications. Implementation should be extremely close before verification. During independent verification, each surface gets a live screenshot, direct comparison, precise discrepancy log, repair, and repeat comparison until layout, typography, density, color, spacing, hierarchy, controls, state, and behavior closely match.

The visual direction is refined editorial Spectra: warm ivory field, black serif display titles, restrained sans-serif UI, hairline warm borders, compact purposeful density, saturated violet for primary user action, green for healthy/synchronized state, and localized type colors. AI blue is a real ephemeral operation effect, not a general accent or decoration. Use the frontend-design skill throughout implementation.

Every surface shares: fixed left Spectra navigation, top breadcrumb/action bar, main bordered work area, optional right Details/Activity/History area, bottom contextual Spectra composer, consistent iconography, focus/hover/pressed/disabled/error/reconnect states, and narrow/tiled adaptations. Ordinary users see the same product navigation/capability; Admin and Super Admin entries appear only with additional management authority.

## Reference matrix

| # | Image | Required implementation |
|---:|---|---|
| 01 | 01_document_editor.png | Full document composition, toolbar/content/callouts/highlights, localized block AI effect, sync/share/top actions, composer; no reduced current editor |
| 02 | 02_flashcard_deck_editor.png | Metrics, section/card rail, front/back rich card, tags, Details/Activity, links/actions, composer; replace manual Save/Discard boundary with equivalent live-sync state without disrupting composition |
| 03 | 03_quiz_builder.png | Builder/Settings/Preview/Responses, question rail/types/editor/options/difficulty/points/time/Bloom/standards/media/details; one non-redundant correct-answer control, practice/formative only |
| 04 | 04_planner_task_editor.png | Current Spectra shell, description/properties/tags/subtasks/attachments, source/schedule/right rail/links/trash/composer |
| 05 | 05_home.png | Mission Control metrics, workspace cards/create, all-work filtering/table/grid, activity/pinned/tags/actions, role-aware nav, composer |
| 06 | 06_workspace_list.png | Library/Activity/People/Settings, pinned, all artifact type rows including Sheets, recent, integrations/details/activity, search/filter/sort/new, sharing |
| 07 | 07_workspace_board.png | Functional type columns/cards/add controls, people/activity/settings, right details/activity/tags/integrations, drag/drop/access/error states |
| 08 | 08_workspace_timeline.png | Functional date grouping, artifact cards/metadata/people, filters/range, right rail, virtualization, accessibility |
| 09 | 09_workspace_canvas.png | Functional zoomable workspace organization with groups/cards/connectors/minimap, not a static board and distinct from Whiteboard artifact |
| 10 | 10_superadmin_overview.png | Complete platform metrics/charts/storage/compute/seats/health/feedback/agents/queues/schools/insights/activity/actions; no private-content leakage; limits disabled but configurable |
| 11 | 11_school_admin_overview.png | Members/invites/approvals/workspaces/storage/usage/feedback/activity/ManageBac/settings; no platform cost or ordinary private content |
| 12 | 12_managebac_integration.png | Status/coverage/conflicts, classes/timetable/tasks/history/conflicts/provenance, preview/history/review/right settings, verified capabilities, first/later sync corrections |
| 13 | 13_agent_library.png | Clean post-deletion replacement: My/Shared/Discover catalog, search/filter/sort, cards/add state/creator/tags/reputation, universal users, placement/use/privacy/version states; no old agent UI/schema adapter |
| 14 | 14_agent_guided_creation.png | Clean post-deletion six-step training, structured purpose/outcomes/scope/tasks/behavior, resource/skill/eval/review steps, right metadata, draft/preview, live persistence; no old form/runtime reuse |
| 15 | 15_presentation_editor.png | Slide rail/canvas/toolbars/theme/settings/preview/present/notes/details/links/metrics; native quality, comments/history/import/export |
| 16 | 16_sheets_editor.png | Workbook menus/format/formula/grid/chart/summary/tabs/details/links, full calculation/collaboration/AI/import product |
| 17 | 17_code_visualisation_editor.png | Approachable code/render split, editor/settings/preview/publish, runtime status/details/links; browser/React/HTML/Python priorities and Spectra design skill |
| 18 | 18_whiteboard_editor.png | Full spatial tools/canvas/nodes/connectors/media/charts/presence/details/participants/AI assist/zoom, scale/accessibility |
| 19 | 19_timetable_calendar.png | Week calendar/layers/events/deadlines/focus/linked work/details/actions, recurrence/timezone/ManageBac overlays/AI planning |
| 20 | 20_history_comparison.png | Shared per-type history timeline, AI/user/restored attribution, historical-left/current-live-right, synced navigation/diff, restore as new version |
| 21 | 21_embedded_artifacts.png | Shared compact/expanded type embeds inside documents/threads/workspaces, live/pinned/source permissions/loading/errors/context/actions |

## Cross-reference rules

- Reference 01’s blue effect generalizes to every card and editable semantic region across all artifact types. It must form/replace/move real content and fully clear after every terminal state. Reduced motion remains meaningful.
- Reference 20 applies to every artifact type using a type-faithful historical renderer, not raw JSON/text.
- Reference 21 applies to every artifact type with compact and expanded modes and permission-safe source behavior.
- Progressive disclosure is mandatory: common actions visible; advanced/rare controls in tabs, menus, inspector, or expanders. Redundant/nonfunctional controls are removed.
- A visual element is not complete because it exists. Its action, state, keyboard/touch behavior, permission path, failure/reconnect behavior, responsive layout, activity/history, and AI interaction must work.
- Storage indicators display metered usage, not enforced commercial caps. Any “of 10 GB” reference value becomes a configured informational/future limit with enforcement off.
- Operational Share/star controls shown generically may be replaced with meaningful authority/session actions while preserving composition.
- No image overrides privacy, read-only ManageBac, no-offline, live-save, formative-quiz, or single-school decisions.

## Responsive and state matrix

For all 21 surfaces implement and verify: reference viewport; wide desktop; 1280 desktop; 1024 split; 768 tablet; 320–480 narrow/panel where meaningful; tiled artifact view; 200% zoom; keyboard-only; screen reader; high contrast; reduced motion; touch. States: empty, one item, dense/large, loading, synchronizing, synchronized, reconnecting, unsynchronized, validation error, permission lost, read-only, no access, deleted/archived, partial AI, failed/cancelled/rejected AI with complete visual cleanup, and import quarantine where applicable.

## Visual verification ledger

For each reference record: route and fixture; viewport/browser scale; baseline screenshot path; pixel/difference overlay or side-by-side; typography/spacing/color/layout/control/state discrepancies; functional discrepancies; fixes/commits; final screenshot; remaining intentional deviations with resolved-decision reason. One surface at a time. Do not batch-approve similar artifact editors.

## UI tasks

### UI-01 Implement the shared Spectra shell, exact typography/tokens/icons/borders/spacing/density/composer/right-rail grammar and responsive foundations under frontend-design

- [ ] Implemented
- [ ] Verified

### UI-02 Match and fully implement references 01–04 for the four existing artifacts, including real AI/history/embed adaptations and all controls

- [ ] Implemented
- [ ] Verified

### UI-03 Match and fully implement references 05–09 for Home and every workspace view

- [ ] Implemented
- [ ] Verified

### UI-04 Match and fully implement references 10–14 for superadmin, school admin, ManageBac, agent library, and guided creation

- [ ] Implemented
- [ ] Verified

### UI-05 Match and fully implement references 15–19 for Presentation, Sheets, Code/Visualisation, Whiteboard, and Timetable

- [ ] Implemented
- [ ] Verified

### UI-06 Apply references 20 and 21 to every artifact with type-specific history and embed renderers

- [ ] Implemented
- [ ] Verified

### UI-07 Implement real artifact-aware working effects, concurrent independent animation, complete terminal cleanup, and reduced motion across every type

- [ ] Implemented
- [ ] Verified

### UI-08 Implement progressive disclosure, remove redundancy, and prove every visible control/function across reference, responsive, permission, failure, and reconnect states

- [ ] Implemented
- [ ] Verified

### UI-09 Capture/compare/fix/recapture each of the 21 references individually in Chrome and close every discrepancy ledger

- [ ] Implemented
- [ ] Verified

### UI-10 Run cross-surface visual regression, keyboard, screen-reader, 200% zoom, contrast, touch, reduced-motion, narrow, tiled, and data-density verification

- [ ] Implemented
- [ ] Verified
