# P13 — School Intelligence: ManageBac & CAS

**Goal:** the ManageBac integration graduates from "records land in a cache" to the product Pablo envisioned: real class selection, assignments that automatically become planned work on the student's calendar, and CAS as a first-class product surface. The blocker named honestly: today class-workspace creation is manual one-at-a-time, `autoCreateClasses`/`autoImportTasks` are stored-but-dead policy flags, homework projects to `calendarItems` but never reaches the student's plan, and CAS is one endpoint plus empty query filters. The phase starts by **capturing what the ManageBac API actually offers** — everything downstream is built on verified contracts, not guesses.

**Prerequisites:** P13.I1 may start in Wave 0 (read-only probes). I2–I4 need P9 accepted (local instance + ManageBac key entered via P9.I4). **Architecture:** ARCHITECTURE-AI (school data in context), EXPANSION §2 (school-data family), §7.3 (one temporal truth). **Findings absorbed:** ManageBac exploration 2026-08-30 — read-only capability manifest with 7 verified personal routes; class projection intentionally disabled in `projectRecord`; timetable split-brain (`calendarItems` vs timetable artifact); CAS reflections/evidence have query filters but no API capabilities; `docs/spectra-rebuild/next-generation-plans/04_MANAGEBAC_AND_SCHOOL_DATA.md` MB-01..MB-11 unchecked.

**Difficulty (PROCESS §4):** I1, I2 = MT / xhigh. I3, I4 = Hard / xhigh. V1 = Hard / **max**.

## P13.I1 — ManageBac API capture (MT)

Turn the tenant's real API surface into verified, documented contracts:

- Live read-only probes of the v2p2 surface against the TGC tenant (auth-token header, paced within `requestBudgetPerMinute`): students, memberships, classes, tasks, timetables, resources, year groups, CAS experiences — **and the unverified frontier**: CAS reflections/evidence, grades/term grades, attendance, groups, discussions/messages, events. For each: does it exist, what shape, what permissions.
- Deliverables: `docs/spectra-reformation/research/MANAGEBAC-API.md` (endpoint → entities → schema → pagination/rate notes → verified/unavailable verdict) and a **sanitized** recorded-fixture corpus `fixtures/managebac/` (names/emails scrubbed) so every later unit tests without live calls.
- Extend `officialPersonalCapabilities()` with newly verified routes; unavailable capabilities are recorded as such so the UI can refuse honestly (no more sections-without-sources like discussions/grades today).
- Secrets discipline: token via existing `secretStore` path only; fixtures must pass the secret scan.

## P13.I2 — Class selection & sync scope (MT)

- Bulk class materialization: multi-select in `/school-data`, "create workspaces for my 6 classes" as one operation; per-class sync scope (tasks / resources / timetable toggles) stored on the integration, honored by `projectRecord`.
- **Wire-or-delete the dead policy flags** (`autoCreateClasses`, `autoImportTasks`): implement them truthfully (auto-materialize on first personal sync when enabled; import tasks to planner without workspace creation when chosen) or remove them from schema + UI (PROCESS §7 — no stored lies).
- Teacher/audience correctness for class records; `purgeAutoCreatedClassWorkspaces` remains the honest undo.
- Owns: `convex/managebac.ts` (projection policy), `school-data-shell.tsx`, `managebac-integration-shell.tsx` scope sections.

## P13.I3 — Homework → plan pipeline (H)

The envisioned behavior: an assignment appears in ManageBac → it exists as a planner task → it is visible on the student's calendar → the student (or the AI, with authority gating) schedules study blocks for it.

- Unify the temporal split-brain: `calendarItems` is the single temporal truth (EXPANSION §7.3); the timetable artifact and calendar surfaces read through it; `ensureTimetableProjection` and planner projections converge so one assignment is one task with one deadline item — no duplicate ghosts (dedup by `sourceKey`).
- Wire `calendar.scheduleTask`: from a planner task (any source), create/move work blocks; expose as IR capabilities so the AI can do it ("plan my week") with confirmation-class authority.
- Recurrence: expand MB recurring timetable slots into honest occurrences (respecting `timePrecision: "unknown"` — never invent clock times; all-day/undated presented truthfully).
- Reminders ride the P9.I2 schedule-at-write machinery.
- Owns: `convex/calendarShared.ts`, `convex/calendar.ts`, planner/timetable projection paths in `convex/managebac.ts`, planner task source handling.

## P13.I4 — CAS productization (H)

Built strictly on I1's verified contracts:

- Full CAS experience sync (year-group fan-out today; whatever I1 verified beyond it); reflections/evidence sync **if the API supports them** — if not, Spectra-native reflections attached to synced experiences, with the boundary stated in the UI (R25-style honesty applies to SIS data too).
- CAS surface in `/school-data` (or its own page): experiences by strand (Creativity/Activity/Service), status, hours/targets where derivable, upcoming CAS deadlines into the I3 pipeline.
- Reflection drafting: "write a reflection for this experience" → document artifact linked to the experience record; AI-assisted drafting through the normal run path with the experience in context (`get_school_data` purpose `cas` already exists — make it real).
- Owns: CAS sections of `managebac.ts` + route capabilities, CAS UI, `managebac-adapter.ts` kind mappings.

## P13.V1 — Live-tenant verification (H, max)

Fresh agent, local instance, account A (real TGC ManageBac identity), account B for the operator/admin side. Requires Pablo's key entered (P9.I4).

- L3 journeys: fresh identity resolve → bootstrap sync → bulk class selection → assignments appear as planner tasks on the calendar → schedule study blocks (human and AI paths) → a new assignment appearing in MB lands within one scheduled sync → CAS experiences browsable, reflection drafted and linked.
- Truth checks: no duplicate temporal ghosts across planner/calendar/timetable; sync-run journal honest (`externalSyncRuns`); conflict/overlay behavior on records edited both sides; rate budget respected under a full re-sync.
- Data safety: read-only tenant discipline — the connector must never write to ManageBac (tokenMode read_only enforced), verified adversarially.

## Exit gate

MANAGEBAC-API.md exists with verified verdicts per endpoint; class selection is a real product surface; an MB assignment reaches the student's calendar and can be planned without manual re-entry; CAS is browsable and reflectable with honest API boundaries; V1 PASS on the live tenant; Pablo pass. Deferred school-assessment scope (teacher grading queues, class-scoped quiz assignment) stays deferred — named in Field Notes, not silently absorbed.
