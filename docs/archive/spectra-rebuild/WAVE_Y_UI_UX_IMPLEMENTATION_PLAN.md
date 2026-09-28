> Historical plan: superseded by `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md`. Retained as implementation evidence only.

# Spectra Wave Y UI/UX Implementation Plan

Wave Y targets the active post-Wave-X surfaces in `src/features/spectra` and the shared `/chat`, `/workspace`, and `/artifacts` shells. `src/components/workspace-v2` is intentionally excluded. The visual direction is a premium academic instrument: warm paper, editorial type, semantic object color, dense but quiet controls, and purposeful live-AI motion.

## 01_document_editor.png

- [x] Rebuild the document studio header with breadcrumb context, document glyph, editable title, concise summary, saved state, share, pin, and overflow actions.
- [x] Match the reference's generous reading column, editorial heading scale, compact toolbar, and warm paper surface without sacrificing split/tiled layouts.
- [x] Preserve the real Tiptap editor and expose working heading, emphasis, underline, strike, link, list, task-list, table, image, equation, callout, emoji, slash-command, and fullscreen controls.
- [x] Style slash commands, drag handles, selections, inline highlights, links, blockquotes, tables, task items, equations, images, and callouts as first-class document blocks.
- [x] Add a functional collapsible detail/callout pattern and visually distinct key-idea, study-note, and reminder treatments through the existing callout system.
- [x] Rebuild the Details/Activity inspector with blueprint state, placements, linked artifacts, tags, timestamps, creator, versions, duplicate/export/move/archive actions, and working tab switching.
- [x] Keep autosave, dirty state, explicit save/discard, version history, AI-edit preview, and conflict-safe updates visible but visually quiet.
- [x] Adapt the reference's fixed three-column geometry into responsive full, split, and tiled studio modes with a collapsible inspector below laptop widths.
- [x] Integrate the canonical quick-chat composer with document-aware focus and one full-width live-run tab that opens the side thread.

## 02_flashcard_deck_editor.png

- [x] Recreate the deck identity header with editable title, description, card/section/mastery/time metrics, active state, and working overflow actions.
- [x] Build the working section rail with collapsible groups, card counts, selected row, mastery dot, reorder affordance, and per-card menu.
- [x] Keep Add card, Add section, Import, list/grid view switching, previous/next navigation, and card count controls functional.
- [x] Recreate large front/back editing surfaces with direct text editing, image/equation/audio affordances where supported, flip control, hint/note field, and per-side menus.
- [x] Preserve functional card creation, deletion, section assignment, reordering, confidence/review data, and save/discard behavior.
- [x] Add compact study stats and a working “study deck” action that routes to the existing flashcard experience.
- [x] Reuse the full Details/Activity inspector language for placements, links, tags, audit metadata, export, duplicate, and archive.
- [x] Collapse the section rail into a drawer and stack front/back surfaces in narrow split and laptop layouts.
- [x] Represent AI-created or AI-edited cards progressively with blue trace, shimmer, and completion state without blocking manual edits.

## 03_quiz_builder.png

- [x] Recreate the quiz identity header, editable title/summary, topic tags, question/time/difficulty metrics, autosave state, Preview, and Publish controls.
- [x] Implement Builder, Settings, Preview, and Responses tabs with meaningful existing-data views rather than decorative tabs.
- [x] Rebuild the numbered question rail with type badges, truncation, selected state, reorder handles, duplication, deletion, and add-question controls.
- [x] Preserve functional multiple-choice and short-answer authoring and add visible type selection compatible with the current quiz schema.
- [x] Recreate the rich prompt editor, answer rows, correct-answer selection, add/shuffle options, explanation editor, and topic tags.
- [x] Build the question settings rail for difficulty, points, time limit, Bloom-style learning level, standards, and media/source references, persisting supported fields.
- [x] Add functional Preview mode using the real quiz content and Responses mode with empty, loading, and response-summary states.
- [x] Reuse the artifact inspector for blueprint, placement, links, tags, audit metadata, duplicate/export/move/archive.
- [x] Make the three authoring rails collapse progressively for narrow windows while keeping question navigation and publish state reachable.
- [x] Animate AI-generated questions into the rail and canvas with restrained stagger, streaming text, and review-required state.

## 04_planner_task_editor.png

- [x] Recreate the task-first layout with workspace breadcrumb, orange planner identity, editable title, and concise planning guidance.
- [x] Preserve a functional rich description editor with formatting, links, lists, quotes, and slash commands.
- [x] Rebuild status, priority, due date, start/end schedule, all-day, and time-estimate controls with persisted planner data.
- [x] Implement editable tags, add/remove behavior, and semantic priority/status colors.
- [x] Preserve functional subtasks with completion toggles, inline editing, add, reorder affordance, overflow, and completion count.
- [x] Preserve attachments with file metadata, remove/open actions, and a working drop/click upload surface using the artifact attachment path available in the app.
- [x] Recreate the right rail with blueprint state, schedule summary, workspace/thread/artifact links, created/updated metadata, and destructive delete action.
- [x] Keep reminders, progress note, source references, save/discard, and AI mutation provenance visible through compact expandable sections.
- [x] Stack the right rail below the task form and keep the composer docked safely on narrow screens.

## 00_card_language_overview.png

- [x] Define the shared warm-paper surface, ink hierarchy, semantic object accents, 8px spacing rhythm, radii, borders, elevation, and arc/noise texture tokens.
- [x] Implement distinct artifact, inbox, workspace, board, pinned, timeline, canvas, result, and side-card variants in the shared card system.
- [x] Implement default, hover, pressed, focus-visible, selected, pinned, disabled, completed, warning, failed, and AI-working visual states.
- [x] Standardize compact rows, type icons, status dots, tag pills, timestamps, and borderless icon actions with accessible tooltips.
- [x] Apply the card grammar consistently to `/chat`, `/workspace`, and `/artifacts` rather than only reference-gallery components.

## 01_artifact_card_patterns.png

- [x] Rebuild standard artifact cards with type icon, title, summary, tags, timestamp, pin, collaborators, favorite, and overflow actions.
- [x] Make hover reveal contextual actions and lift/texture depth without causing layout shift.
- [x] Make selected and multi-selected states unmistakable with check indicator, accent border, and keyboard-visible focus.
- [x] Add dense list-row and rich-detail variants chosen by the active library/workspace density.
- [x] Wire open, pin, favorite, share/copy-link, collaborator, move, and overflow actions to existing mutations or safe native behavior.
- [x] Adapt preview imagery to artifact content and workspace subject; never hard-code the biology foliage shown in older references.

## 02_inbox_unplaced_patterns.png

- [x] Recreate the collapsible Inbox/Unplaced section with count, filter, density switch, and expanded/collapsed states.
- [x] Give unplaced cards a quieter neutral surface while retaining type-specific icons and clear placement actions.
- [x] Implement grid and compact-list variants for document, deck, quiz, task, thread, run, and system entries.
- [x] Wire pin, activity/history, more, delete, and Add to workspace actions with disabled/loading/error feedback.
- [x] Surface a real suggested-placement treatment only when workspace/context evidence exists, with a working accept action.
- [x] Preserve responsive collapse and horizontal density for large inboxes.

## 03_workspace_card_patterns.png

- [x] Replace oversized generic workspace tiles with scalable hero, rail, and summary variants selected by viewport and context.
- [x] Show workspace identity, description, artifact/member/thread counts, freshness, pinned/premium markers, and recent activity where space permits.
- [x] Generate workspace accents and arc texture from workspace identity instead of subject-specific decorative imagery.
- [x] Add hover, pressed, selected, active-AI, warning, and archived states plus working overflow actions.
- [x] Keep workspace cards dense enough for many workspaces and responsive rails.

## 04_board_card_patterns.png

- [x] Rebuild board columns with title/count, add, column actions, clear separators, sticky headers, and horizontal overflow.
- [x] Use compact, standard, pinned, selected, richer-summary, completed, and archived card variants according to object state.
- [x] Preserve type, title, concise why-it-matters summary, tags/metadata, time, assignee/comment data, and action reveal.
- [x] Wire drag/reorder or workspace movement through the existing placement mutation path with visible drop-target and drag-preview states.
- [x] Make Add artifact, open, pin, share, more, archive, and selection interactions functional and keyboard reachable.

## 05_pinned_card_patterns.png

- [x] Create a warmer amber pinned language with star/pin marker, accent edge, elevated surface, and restrained arc texture.
- [x] Apply pinned treatments consistently in home/workspace, collection, list/table, board, and compact contexts.
- [x] Implement featured, gradient-accent, icon-accent, and minimal pinned variants without losing artifact type identity.
- [x] Animate pin/unpin with a short elevation and marker transition and respect reduced-motion preferences.

## 06_run_thread_result_patterns.png

- [x] Consolidate temporary conversation/run tabs into one canonical full-composer-width tab strip with idle, active, updating, completed, error, and needs-input states.
- [x] Make the canonical tab open the live thread at the side; remove duplicate/competing tabs and fullscreen-only controls.
- [x] Rebuild compact run rows with title, status, elapsed time, progress, review/cancel/retry actions, and borderless overflow.
- [x] Rebuild result cards for answer, tool result, success, confirmation, error, and informational update states.
- [x] Integrate run context directly above the composer for idle, completed, continuing, confirmation, and error flows.
- [x] Apply the same conversation/run/result language to `/chat` messages, `/workspace` quick chat, and artifact studio quick chat.
- [x] Keep every action functional: open, pin, inspect, share, continue, download where available, refresh, retry, cancel, delete, review, and confirm.

## 07_canvas_card_patterns.png

- [x] Rebuild the canvas as a soft spatial field with named clusters, object counts, subject accents, and semantic relationship lines.
- [x] Use appropriately scaled document, deck, thread, run, quiz, note, and unclustered cards with meaningful metadata.
- [x] Preserve canvas pan/zoom, minimap, fit/fullscreen, auto-layout, cluster-view, filter/share, and add/find controls where supported.
- [x] Wire card open/select/multi-select, cluster selection, relationship inspection, and object creation to current workspace state.
- [x] Make relationship labels and lines readable without dominating the surface and animate new AI-created nodes/edges progressively.
- [x] Adapt cluster layout and controls for split panels, narrow windows, and semantic zoom.

## 08_timeline_card_patterns.png

- [x] Use this sheet for type/state/density semantics while retaining the larger timeline composition from `02_workspace_timeline_run_inspector.png`.
- [x] Give each event a type icon, action label, why-it-matters summary, workspace/actor/time metadata, and optional token/model/run detail.
- [x] Implement default, hover, focused, pinned, AI-edited-review, failed, and archived/dimmed event states.
- [x] Support standard, compact, and micro densities chosen by viewport and event volume.
- [x] Wire open-new-tab, pin/unpin, more, filter, and date-group collapse interactions.

## 01_workspace_cards_overview.png

- [x] Recreate the workspace overview hierarchy with title/description, counts, view tabs, creation menu, and scalable content grid.
- [x] Use newer workspace/card patterns instead of copying the oversized biology hero card literally.
- [x] Add pinned/active objects, grouped document/practice sections, see-all links, and quick actions using real workspace content.
- [x] Rebuild the overview inspector with health, counts, storage/activity summaries, recent runs, pinned threads, and creation shortcuts from available data.
- [x] Keep the activity tray and canonical command bar docked without hiding workspace content.
- [x] Make inspector and workspace rail collapsible for laptop and split configurations.

## 02_workspace_timeline_run_inspector.png

- [x] Recreate the vertical date-grouped timeline with time rail, status nodes, rich event cards, affected-object previews, and recent-first ordering.
- [x] Build the selected-run inspector with status, summary, metrics, affected objects, open/details/continue actions, share, and delete.
- [x] Show simultaneous live runs in a compact dock with progress, completion, cancellation, and generating states.
- [x] Wire timeline event selection, run selection, continue, open object, retry/cancel, and inspector close interactions.
- [x] Preserve date grouping, sticky group labels, and responsive collapse into compact/micro cards on narrow screens.

## 03_artifacts_library_grouped_list.png

- [x] Recreate the artifact library header with search, workspace filter, new-artifact menu, and type filters.
- [x] Implement the quiet Inbox section followed by collapsible workspace groups with counts and view-workspace actions.
- [x] Build dense rows with type, title, workspace/status context, updated time, open, move, delete, pin, and overflow actions.
- [x] Preserve grid/list/board switching, sorting, long-title truncation, large-library virtualization-friendly density, and empty/loading states.
- [x] Make search, type/workspace filters, sort, collapse, move, open, placement, and deletion functional.

## 04_workspace_cards_selected_artifact.png

- [x] Recreate the selected artifact state with accent outline/check, clear card metrics, and inspector synchronization.
- [x] Build the selected-artifact inspector with type, title, created/updated time, summary, placement, linked artifacts, and quick actions.
- [x] Wire open, create-from-this, add note, link navigation, and remove-from-workspace actions.
- [x] Keep recent activity and live-run tray visible below the card grid without crowding it.
- [x] Support click, keyboard, and multi-select while distinguishing selected, open, focused, and pinned states.

## 05_workspace_canvas_soft_clusters.png

- [x] Retain the soft-cluster composition, dotted field, central selected object, linked satellite groups, and right inspector.
- [x] Use content-derived cluster names/colors and newer canvas cards rather than literal biology decoration.
- [x] Rebuild the canvas inspector with summary, linked objects, more count, open/add note/create quiz/run analysis/remove actions.
- [x] Wire minimap, zoom, fit, selection, link navigation, and quick actions against current canvas/workspace state.
- [x] Preserve readable spatial hierarchy under resizing and inspector opening, with responsive auto-fit and semantic card density.

## 06_artifacts_board_columns.png

- [x] Preserve the workspace-column organization, workspace tint, counts, add-artifact footer, and grid/list/board controls.
- [x] Replace the older plain cards with the newer board card variants and state treatments.
- [x] Show document/deck/thread/quiz/task/run metadata, completed/in-progress badges, priority, and due dates from real records.
- [x] Wire column add, workspace overflow, card open/select/move, and board scrolling with keyboard accessibility.
- [x] Collapse to snap-scrolling columns and compact cards on laptop/narrow layouts while retaining clear workspace identity.

## Cross-cutting implementation

- [x] Design tokens: unify warm ivory surfaces, ink scale, object accents, state colors, arc texture, borders, radii, shadows, and z-index layers in shared CSS variables.
- [x] Typography: use the configured Fraunces/Manrope/Plex pairing intentionally, with editorial display hierarchy and compact utilitarian metadata.
- [x] Spacing: enforce an 8px rhythm with dense 4px/12px exceptions and responsive content gutters.
- [x] Card language: centralize variants and states while allowing artifact-specific composition instead of one generic card markup.
- [x] Responsive layouts: verify full width, narrow laptop, workspace/thread split, artifact/thread split, tiled artifacts, resized inspectors, long titles, and large collections.
- [x] Motion: choreograph entry, selection, panel, live trace, progressive creation, and completion transitions with reduced-motion fallbacks.
- [x] Hover and press behavior: add purposeful lift, reveal, compression, and cursor feedback without layout shift.
- [x] Focus states: provide high-contrast `:focus-visible` rings, logical tab order, escape behavior, and keyboard equivalents for pointer actions.
- [x] Loading states: replace generic spinners with layout-matched skeletons and compact progress traces.
- [x] Empty states: provide contextual creation/search recovery actions for chat, library, board, canvas, timeline, and editors.
- [x] AI-working states: distinguish reading, editing, creating, streaming, awaiting confirmation, completed, failed, and cancelled states.
- [x] Real-time mutations: animate newly created cards/tabs, in-place edits, reordering, and live counts without losing selection or scroll position.
- [x] Accessibility: preserve semantic controls, labels/tooltips, 44px touch targets where practical, contrast, status announcements, and reduced motion.
- [x] `/chat` consistency: apply the same typography, cards, result surfaces, composer, run tabs, inspector, and live-AI state language as `/workspace`.
- [x] Quick-chat context repair: resolve named objects against visible, selected, active-workspace, open-thread, and retrievable catalog context before failing; replace ID-shaped model output with resolved IDs when confidence is sufficient.
- [x] Quick-chat error recovery: return specific, recoverable clarification only after bounded retrieval fails, while preserving ordinary conversational answers that require no object mutation.
- [x] Canonical run tabs: remove duplicate treatments and ensure the single composer-width tab opens the live side thread across surfaces.
- [x] Verification: run focused tests, type/lint checks, production build, and responsive browser validation on `/chat`, `/workspace`, and `/artifacts`.
