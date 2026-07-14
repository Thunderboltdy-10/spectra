# Wave Z — One Coherent Spectra Product

Created: 2026-07-11. This is the live coordination plan. Product behavior is defined in `SPECTRA_PRODUCT_SOURCE_OF_TRUTH.md`. Earlier completion claims are evidence only.

## Rules

- Every task has two independent states. The implementer may check **Implemented** only after integration and proportionate tests. A different agent/reviewer checks **Verified** only after inspecting connected behavior and regressions.
- Add or reopen tasks as evidence appears. Reviewer findings enter this plan before repair.
- No task is verified by compilation alone or by its implementer.

## A. Canonical architecture and cleanup

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                                        |
| ------ | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-001 | [x]         | [ ]      | Legacy workspace implementations are deleted; the `/workspace` system is the sole executable authority (commit `9c065ea`).                                                  |
| WZ-002 | [x]         | [ ]      | Permanent product source of truth exists and covers entities, surfaces, context, runs, operations, visual behavior, accessibility, performance, invariants, and edge cases. |
| WZ-003 | [x]         | [ ]      | No stale legacy imports, feature flags, stores, adapters, tests, or compatibility wrappers remain.                                                                          |
| WZ-004 | [x]         | [ ]      | One normalized client model owns selection, explicit context, visible context, continuation, open objects, and tile state without contradictory page-local copies.          |

## B. Threads, runs, streaming, and decisions

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                         |
| ------ | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WZ-005 | [x]         | [ ]      | Begin-run atomically creates/continues thread, message, run, result/tab projection, and workspace/Inbox placement with ownership and idempotency.            |
| WZ-006 | [x]         | [ ]      | All surfaces subscribe/replay one persisted ordered run stream; refresh/navigation/panel closure neither stops nor duplicates it.                            |
| WZ-007 | [x]         | [ ]      | Guarded attempt-aware lifecycle prevents duplicate active continuation, stale writes, invalid transitions, and cross-run Stop.                               |
| WZ-008 | [x]         | [ ]      | One canonical durable quick-chat tab appears immediately, opens the live panel, shows meaningful status, persists until closed, and replaces competing tabs. |
| WZ-009 | [x]         | [ ]      | User-facing progress is derived from real lifecycle/action events and remains concise, evolving, safe, and synchronized.                                     |
| WZ-010 | [x]         | [ ]      | Approval/choice accept, reject, revise, and claim behavior is canonical, atomic, visible everywhere, and recoverable.                                        |
| WZ-011 | [x]         | [ ]      | Interrupted, stopped, failed, retried, and partially completed runs preserve valid work and provide accurate recovery.                                       |

## C. Quick chat, focus, and retrieval

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                                   |
| ------ | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-012 | [x]         | [ ]      | Composer is stable and width-efficient, grows to a bounded height, sends on Enter, inserts newline on Shift+Enter, and targets Send/Stop correctly.                    |
| WZ-013 | [x]         | [ ]      | Continuation is visibly distinct from context; one target maximum; active-thread conflicts offer Wait/Stop/New thread and visible-thread conflicts resolve explicitly. |
| WZ-014 | [x]         | [ ]      | Explicit, visible/inferred, workspace-map, global-map, and continuation context compose by canonical priority and explicit context survives navigation.                |
| WZ-015 | [x]         | [ ]      | Compact Focus is width-bounded; expanded Focus is a searchable, keyboard-accessible multi-selector with reasons and uncluttered recents.                               |
| WZ-016 | [x]         | [ ]      | Object resolution searches visible/selected/workspace/global catalogs before natural clarification and never exposes internal identifiers.                             |

## D. Navigation, selection, tiling, and command system

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                |
| ------ | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-017 | [x]         | [ ]      | Primary workspace/artifact/thread/timeline/board/canvas/result/search cards open their object; secondary controls do not hijack primary action.     |
| WZ-018 | [x]         | [ ]      | Rail/navigation/open registry focuses existing destinations and object instances immediately without remount loss or duplication.                   |
| WZ-019 | [x]         | [ ]      | Shared selection works in every view, persists safely, prunes stale objects, exposes valid batch actions, and stays separate from explicit context. |
| WZ-020 | [x]         | [ ]      | Tiled surfaces batch compatible artifacts, infer visible context, support exclude/close/reorder/resize, and permit at most one continued thread.    |
| WZ-021 | [x]         | [ ]      | One command palette uses canonical search/open/context/selection/continuation/move paths and routes unmatched language through quick chat.          |
| WZ-022 | [x]         | [ ]      | Cached/local navigation and view changes acknowledge immediately; redundant subscriptions, waterfalls, and avoidable remounts are removed.          |

## E. Differentiated product surfaces

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                            |
| ------ | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-023 | [x]         | [ ]      | Home and workspace overview express workspace identity, Inbox, pins, active work, recent activity, counts, inspectors, and obvious navigation.  |
| WZ-024 | [x]         | [ ]      | Artifact library/Inbox provides dense search/filter/sort/group/view/placement flows and responsive large-collection behavior.                   |
| WZ-025 | [x]         | [ ]      | Board columns/cards, add/open/select/move actions, status variants, and narrow snap-scroll behavior are functional.                             |
| WZ-026 | [x]         | [ ]      | Timeline composition, live events, affected-object previews, selection/inspector, filters, date groups, and responsive density are functional.  |
| WZ-027 | [x]         | [ ]      | Canvas clusters, typed nodes, relationships, pan/zoom/fit/minimap, select/multi-select/open, and responsive semantic density are functional.    |
| WZ-028 | [x]         | [ ]      | Document editor matches its reference hierarchy and provides genuine focused editing plus region-aware AI work state.                           |
| WZ-029 | [x]         | [ ]      | Flashcard deck provides genuine edit/study/reveal/order/progress behavior matching its reference language.                                      |
| WZ-030 | [x]         | [ ]      | Quiz builder provides genuine question/options/answer/explanation/order/completion behavior matching its reference language.                    |
| WZ-031 | [x]         | [ ]      | Planner task editor provides dates, priority, status/progress, subtasks, notes/links, and useful task behavior matching its reference language. |
| WZ-032 | [x]         | [ ]      | `/chat`, panel, thread card, tile, and workspace object are presentations of one canonical conversation with consistent visual language.        |

## F. Card, state, motion, and discoverability system

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                      |
| ------ | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-033 | [x]         | [ ]      | Shared tokens implement warm paper/ink/editorial type/artifact accents/arc texture/state colors/elevation with light and dark coherence.                  |
| WZ-034 | [x]         | [ ]      | Workspace, document, deck, quiz, task, thread, run, result, Inbox, board, canvas, timeline, and pin cards have purposeful composition and state variants. |
| WZ-035 | [x]         | [ ]      | AI-created shells and real in-place edits progress from genuine mutations using restrained blue flow and settle correctly, including concurrent objects.  |
| WZ-036 | [x]         | [ ]      | Hover, press, focus, selection, open, pin, AI-active, waiting, warning, error, completion, and disabled states are distinct without layout shift.         |
| WZ-037 | [x]         | [ ]      | Every icon-only action has an accessible name and reliable unclipped hover/focus tooltip; dead decorative controls are removed.                           |

## G. Responsive, accessibility, recovery, and quality

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                                  |
| ------ | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-038 | [x]         | [ ]      | Desktop, laptop, narrow, split, panel, artifact+thread, and tile layouts retain primary actions and readable/useful minimum sizes.                                    |
| WZ-039 | [x]         | [ ]      | Keyboard order, visible focus, Escape, dialogs/menus/listboxes/tabs, IME-safe composer, live regions, contrast, and reduced motion meet the source-of-truth contract. |
| WZ-040 | [x]         | [ ]      | Loading/empty/error/partial/interrupted states are contextual, preserve drafts/work, and offer real recovery without backend language.                                |
| WZ-041 | [x]         | [ ]      | Focused tests cover core invariants and discovered regressions; existing tests remain green.                                                                          |
| WZ-042 | [x]         | [ ]      | TypeScript, ESLint, production build, Convex/codegen validation, dead-code/import audit, and dependency audit pass without introduced warnings.                       |
| WZ-043 | [x]         | [ ]      | Final independent cross-surface review finds no unresolved contradiction, placeholder, duplicate system, or unchecked task.                                           |

## Discoveries and reopened work

| ID     | Implemented | Verified | Acceptance criterion                                                                                                                                                                                                                     |
| ------ | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WZ-044 | [x]         | [ ]      | Deletion fallout is repaired in surviving Convex modules: no removed workstream/workspace helper imports, removed-table reads, or stale generated route validators remain.                                                               |
| WZ-045 | [x]         | [ ]      | Canonical workspace thread placement uses a first-class thread projection; compatibility `create`/`createFromRun`/keep paths cannot create competing thread representations.                                                             |
| WZ-046 | [x]         | [ ]      | Stop, retry, confirmation, event, and patch writes require the current attempt/execution identity so stale UI or worker actions cannot mutate a later attempt.                                                                           |
| WZ-047 | [x]         | [ ]      | Durable execution ownership survives request/process detachment and reconciles worker loss without collapsing interrupted/partial work into generic failure.                                                                             |
| WZ-048 | [x]         | [ ]      | Run observers replay unseen terminal events and discover remote runs without per-surface lifecycle divergence or a fresh-response blind spot.                                                                                            |
| WZ-049 | [x]         | [ ]      | Revise is supported as a first-class decision and an execution claimed after approval cannot remain permanently stranded after worker failure.                                                                                           |
| WZ-050 | [x]         | [ ]      | Baseline run-route sanitization regression is repaired; invalid operation failures always emit one safe, actionable public error event.                                                                                                  |
| WZ-051 | [x]         | [ ]      | Page-local studio, thread/run panel, tile order/size, and isolated-work-set state are removed in favor of the canonical shared open-object registry, including cross-route focus/move/close behavior.                                    |
| WZ-052 | [x]         | [ ]      | First-class workspace thread items render, select, open, continue, search, and participate in timeline/board/canvas without synthetic `thread_reference` artifacts or artifact-editor paths.                                             |
| WZ-053 | [x]         | [ ]      | The command palette opens from Cmd/Ctrl+K and shares canonical object search/open/context/selection/continuation/tile/new-thread/AI-submit paths, including thread results and unmatched language.                                       |
| WZ-054 | [x]         | [ ]      | Composer drafts clear only after begin-run acknowledgement, remain recoverable on failure, and every Stop/retry/decision action carries the displayed attempt identity.                                                                  |
| WZ-055 | [x]         | [ ]      | Legacy duplicate run-tab rows are collapsed by canonical thread identity on the client while backend projection reconciliation completes.                                                                                                |
| WZ-051 | [x]         | [ ]      | Surviving chat, planner, notes, memory, ManageBac, admin, and orchestrator paths contain no executable dependency on the removed workstream/workspace architecture; current behavior is adapted to Spectra or deleted when disconnected. |
| WZ-052 | [x]         | [ ]      | Generated Convex API/types and Next route manifests are regenerated after deletion and contain no imports for removed modules/routes.                                                                                                    |

Baseline evidence on 2026-07-11: legacy deletion was committed in `9c065ea`, but the initial Linux-native type check found surviving references to deleted workstream/workspace modules and tables. The initial test run passed 370 tests and failed one run-route sanitization assertion. These are implementation evidence, not accepted baselines.
