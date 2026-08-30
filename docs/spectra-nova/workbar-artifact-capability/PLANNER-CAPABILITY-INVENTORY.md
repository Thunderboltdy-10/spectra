# Planner Capability Inventory

**Unit:** P12.I5

**Leaders used for the gap analysis:** Todoist, Notion databases, Linear

**Artifact:** `planner_task` (the Plan studio)

**Pre-unit IR census:** 17 planner definitions (6 workbar actions and 11 field-format actions)

**Post-unit IR census:** 40 typed planner definitions
**Contract:** every row below is `SHIP`, `REFUSE HONESTLY`, or `DEFER - <owner>` under CANON R6, R7, and R26.

The Plan studio is one shared task graph. List, Board, Timeline, saved views, AI operations, imports, exports, and Workload are projections of the same `PlanContent`; none may keep a second task or scheduling store. Workload reads `/api/spectra/calendar` and derives scheduled effort only from returned `calendarItems`.

## Capability contract

| Outcome | Leader reference | Decision | Capability / product truth |
|---|---|---|---|
| Create, rename, describe, and delete a task | Todoist quick add; Linear issues | **SHIP** | Typed create/update/delete operations; delete names descendant and dependency consequences before committing. |
| Sections and milestones | Todoist sections; Linear projects/cycles | **SHIP** | Create sections, move tasks, attach milestones, and keep ordering in the canonical plan. |
| Nested subtasks | Todoist subtasks; Notion parent relation | **SHIP** | Stable `parentTaskId`, arbitrary safe depth, parent-cycle refusal, and descendant-aware deletion. |
| Lightweight checklist inside a task | Notion to-do blocks; Todoist checklist-style subtasks | **SHIP** | Add, rename, toggle, and remove stable checklist items without creating parallel tasks. |
| Dependencies and blockers | Linear issue relations | **SHIP** | Add/remove stable dependency IDs; missing references and dependency cycles refuse before commit. |
| Status workflow | Linear status; Todoist completion | **SHIP** | Backlog, To do, In progress, Blocked, Done across List, Board, Timeline, bulk actions, and AI. |
| Recurring tasks | Todoist recurring due dates | **SHIP** | Daily, weekly, monthly, and yearly recurrence with interval, weekday selection, optional end date, and exceptions. Completing a recurring task advances the same stable task, resets its checklist, and records the occurrence. |
| Free-form RRULE and phrases such as "the last business day" | Todoist advanced recurrence | **REFUSE HONESTLY** | The recurrence editor says which bounded patterns Spectra supports and leaves the existing rule unchanged when a pattern cannot be represented. |
| Natural-language due entry | Todoist quick add | **SHIP** | Deterministic parsing for today, tomorrow, next weekday, ISO/local calendar dates, and optional unambiguous times. Preview the resolved date before persistence. |
| Ambiguous dates or timezone guesses | Todoist quick add | **REFUSE HONESTLY** | "Spectra could not read that date without guessing. Use today, tomorrow, next Friday, or a date such as 2026-09-04." No timestamp is written. |
| Priorities | Todoist priorities; Linear priority | **SHIP** | None, Low, Medium, High, Urgent in task detail, filters, saved views, bulk changes, import/export, and AI. |
| Labels | Todoist labels; Linear labels; Notion multi-select | **SHIP** | Stable normalized label strings, multi-label filtering, bulk add/remove, CSV interchange, and AI operations. |
| Assignees and source/reference links | Linear assignees/relations; Notion relations | **SHIP** | Preserve existing assignee IDs, linked artifact IDs, source references, and official deadline provenance. |
| List view | All three leaders | **SHIP** | Hierarchical rows, section grouping, filters, saved-view restoration, direct status/due editing, and bulk selection. |
| Board view | Notion board; Linear board | **SHIP** | Same filtered task set and task IDs as List; status-column movement updates the canonical task. |
| Timeline view | Notion timeline; Linear timeline | **SHIP** | Same filtered task set and task IDs as List; due dates, milestones, dependencies, and official-deadline refusal remain visible. |
| Filters | All three leaders | **SHIP** | Typed query, status, section, provenance, priority, labels, and due-window filters shared by all projections. |
| Saved views | Notion database views; Linear custom views | **SHIP** | Create, apply, rename, and delete persisted views containing a base projection and typed filters. Default List/Board/Timeline views remain recoverable. |
| Workload over the calendar | Linear workload; Notion calendar | **SHIP** | A bounded Workload view fetches the calendar API and derives scheduled minutes per task from `calendarItems`; no calendar block payload is persisted in the Plan. Loading, empty, and error states are explicit. |
| Dragging workload blocks or editing calendar truth inside Plan | Linear workload | **REFUSE HONESTLY** | Plan explains that scheduled blocks are edited in Calendar. Workload is a read-only projection, so it cannot fork temporal truth. |
| Reminder rule model and editor | Todoist reminders | **SHIP** | Per-task relative reminders are typed, editable, IR-routed, and preserved in Plan v4. |
| Reminder delivery and schedule-at-write jobs | Todoist reminders | **DEFER - P9.I2** | P9.I2 owns `convex/plannerReminders.ts`, reminder indexes, and schedule-at-write machinery. Its landed adapter still reads the legacy top-level planner shape, so P12.I5 preserves the ownership boundary and says Plan v4 reminder timing is saved but delivery is not active yet. |
| Bulk status, section, priority, labels, due date, and delete | Todoist multi-select; Linear bulk edit; Notion bulk edit | **SHIP** | All mutations plan first, preserve honest refusals, name destructive consequences, and route through typed capabilities. |
| CSV/TSV import | Todoist CSV; Notion CSV | **SHIP** | Header-aware import with row-level warnings; imported rows are personal tasks and cannot claim official deadline authority. |
| CSV, ICS, and JSON export | Todoist/Notion export | **SHIP** | Explicit copy boundaries; priorities, labels, recurrence, reminders, hierarchy, and provenance survive where the target format can represent them. |
| Live Todoist synchronization | Todoist | **DEFER - later Tier-2 Todoist connector unit** | The planner import surface offers an explicit CSV/TSV copy boundary and never claims live sync. EXPANSION §2 explicitly keeps the connector outside P12. |
| Offline task truth and collaborative editing | Linear/Notion | **SHIP** | The existing artifact/Yjs persistence path remains the only durable Plan truth; this unit introduces no local task database. |
| Per-task email, push, or SMS channel configuration | Todoist reminders | **REFUSE HONESTLY** | The reminder editor says delivery channels are not configurable in Plan; it does not show inactive channel toggles. |
| Automations triggered by arbitrary field changes | Notion database automations; Linear integrations | **DEFER - future automation protocol owner** | P12.I5 defines planner operations, not a new automation engine. No control is shown and no execution is implied. |

## IR families to land

| Family | Definitions required |
|---|---|
| Structure | task create/update/delete; section create; parent, section, milestone, and dependency changes |
| Planning fields | status, due phrase/date, estimate, priority, labels, recurrence, reminders |
| Checklists | checklist add/update/toggle/remove |
| Views | projection select; filters apply/clear; saved-view create/apply/rename/delete; workload refresh/open-calendar |
| Bulk | status, section, priority, labels, due date, delete |
| Interchange | import CSV/TSV; export CSV/ICS/JSON |

Every shipped mutation has one `CapabilityDefinition`, one typed Zod parameter schema, one studio execute binding, a matching manifest operation, and an AI-facing description. Workbar placement is only a presentation projection. Inspector controls, keyboard paths, menus, and workbar buttons dispatch the same definitions.

## Verification obligations

- Migration: legacy single-task/v3 and existing internal v4-shaped values normalize idempotently to the canonical Plan schema without losing recurrence, reminders, priority, labels, or links.
- Projection parity: a saved filter yields the same task IDs in List, Board, and Timeline.
- Recurrence: completion advances supported rules deterministically, records the occurrence, and resets checklist completion without changing the task ID.
- Natural due: supported phrases resolve from an injected clock/timezone; ambiguous phrases return the exact refusal and write nothing.
- Workload: derivation accepts only calendar item input; no Plan field can act as a duplicate time-block store.
- Protocol: capability conformance, manifest symmetry, keyboard dispatch, narrow overflow reachability/order, and the ghost gate remain green.
- Honesty: reminder delivery, unsupported recurrence, ambiguous dates, calendar editing, notification channels, and Todoist sync display the decisions above without a dead control.
