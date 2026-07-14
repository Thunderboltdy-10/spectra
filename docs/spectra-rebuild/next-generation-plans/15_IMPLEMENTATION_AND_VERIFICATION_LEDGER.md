# Implementation and verification ledger

This is the concise operational state for the persistent goal. It does not replace any plan checkbox or weaken its completion criteria. Update it whenever phase, schema/migration evidence, a known defect, or a reference comparison changes. After context compaction, reread it with the goal, master plan, currently relevant plan, and only relevant reference images.

## Current state

| Field | Value |
|---|---|
| Persistent goal | Active until every Implemented and Verified box in the full plan set is honestly complete |
| Execution owner | One primary agent only; no sub-agents or delegation in any stage |
| Active phase | Phase 1 — obsolete-system deletion |
| Current bounded work | Delete old memory/soul, ManageBac, admin, superadmin, agent, and chat-mode runtime domains; preserve only ordinary conversation and new artifact blueprints; regenerate types and own every resulting failure |
| Implementation gate | Phase 0 complete; deletion is active and replacement construction remains blocked until zero legacy-runtime imports |
| Independent verification gate | Closed until every Implemented checkbox across the plan set is complete |
| Live acceptance target | Existing application at `http://localhost:3000`, used later through Control Chrome |
| UI reference root | `docs/spectra-rebuild/spectra-next-generation-ui/` with 21 executable specifications |

## Plan-lock evidence

| Check | Evidence/status |
|---|---|
| Resolved decisions encoded | Product decision register D-01 through D-36 plus master checklist M-01 through M-20 |
| Ten first-class artifact plans | Document, Flashcard Deck, Quiz, Planner Task, Agent, Timetable/Calendar, Presentation, Sheets, Code/Interactive Visualisation, Collaborative Whiteboard |
| Workspace product plan | Home, List, Board, Timeline, Canvas, grants/projections, automatic class workspace bootstrap, later sync |
| Retired type plans/references | Removed; repository-wide next-generation plan scan is empty and must remain empty |
| Checklist schema | Balanced in every plan: 267 Implemented/Verified task pairs before M-01 was marked; only M-01 Implemented is now checked |
| Reference coverage | All images 01–21 mapped in `12_UI_REFERENCE_REVIEW.md`; history and embeds apply to every artifact; AI effects apply to every editable surface |
| Current primary-source research | Rechecked 2026-07-14 for OpenAI semantic streaming/run events, Yjs self-hosting, Sheets expectations, ManageBac public capability guidance, privacy, calendar, presentation, and canvas |
| Plan link/contradiction validation | Passed 2026-07-14: zero broken local links; resolved-decision contradiction scans and manual requirement trace complete |

## Phase evidence and migration ledger

| Phase | State | Evidence required before advancing | Evidence paths/notes |
|---|---|---|---|
| 0 Plan lock/baseline | Complete | Plan validation, git/source/schema/import/test/UI baseline, exports design, failure ledger initialized | `phase-evidence/PHASE_0_BASELINE_2026-07-14.md`; encrypted export and offline restore rehearsal recorded there |
| 1 Obsolete deletion | Active | Encrypted reversible exports, zero removed-runtime imports/routes/schema/env/jobs, complete owned failure map | Deletion map tasks DEL-02 through DEL-12 active; legacy agents and chat modes added by D-36 |
| 2 Identity/authority/ops foundations | Not started | Single-school invariant, operator sessions, permissions, audit, metering, limits disabled, secrets | — |
| 3 Artifact/live collaboration/history/embed foundations | Not started | Registry, skills, imports, Yjs, stable regions, claims, live validity, history, embeds | — |
| 4 Durable AI collaborator | Not started | Resumable runs, native progress, routing, typed operations, effects, recovery | — |
| 5 Workspaces/existing artifacts | Not started | References 01–09 and complete adjacent product behavior | — |
| 6 School data/admin | Not started | References 10–12, verified ManageBac manifest/sync, operational privacy/usage | — |
| 7 Agents/memory | Not started | References 13–14, automatic routing, universal agent product, default-on safe memory | — |
| 8 Rich artifacts | Not started | References 15–19 and complete import/collaboration/AI/history/embed behavior | — |
| 9 Implementation gate | Not started | Every Implemented checkbox complete after full-plan review; no known implementation defect | — |
| 10 Independent verification | Blocked by Phase 9 | Code/integration/browser/visual/cross-feature acceptance; every Verified checkbox complete | — |

## Failure and defect ledger

Record every expected deletion failure and every discovered defect; never hide one with a stub or compatibility wrapper.

| ID | Phase | Surface/symbol | Failure or defect | Reproduction/evidence | Owning plan/task | State | Resolution/verification |
|---|---|---|---|---|---|---|---|
| BASE-001 | 0 | `src/app/api/spectra/run/route.ts` | Lint: three `prefer-const` errors plus unused `_operationId`, `_jsonPatchVerb`, `lastPersistedLength`, and `lastPersistedAt` warnings | `npm run lint` on baseline commit | AI-03/AI-04 and deletion failure mapping | open | Pending owning replacement/refactor and lint regression |
| BASE-002 | 0 | `src/features/spectra/components/durable-run-tabs.tsx` | Lint: impure `Date.now()` during render and hook called inside callback | `npm run lint` on baseline commit | AI-03/AI-07 | open | Pending durable run UI replacement and lint/browser regression |
| BASE-003 | 0 | `src/features/spectra/components/artifact-studio.tsx` | Lint: unused `FileText`, `aiPreviewSections`, and `lineDiff` | `npm run lint` on baseline commit | AS-03/UI-02 | open | Pending Artifact Studio removal/replacement and lint regression |
| BASE-004 | 0 | `src/features/spectra/pages/workspace-shell.tsx` | Lint: unused `workspaceLoading` and unstable `workspaceHeader` effect dependency | `npm run lint` on baseline commit | WS-02/WS-03 | open | Pending workspace shell replacement and lint/browser regression |

States: expected-deletion-failure, open, fixing, needs-retest, closed. A closed defect records the code check, browser retest, visual comparison where applicable, and adjacent regression evidence.

## Visual acceptance ledger

Do not begin until Phase 9. Work strictly one reference/surface at a time: open, capture, compare, describe precise differences, fix, recapture, and repeat.

| Ref | Surface | Route/fixture | Baseline | Current screenshot | Exact discrepancies | Iterations | Functional acceptance | Final comparison | State |
|---:|---|---|---|---|---|---:|---|---|---|
| 01 | Document editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 02 | Flashcard deck editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 03 | Quiz builder | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 04 | Planner task editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 05 | Home | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 06 | Workspace list | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 07 | Workspace board | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 08 | Workspace timeline | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 09 | Workspace canvas | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 10 | Superadmin overview | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 11 | School-admin overview | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 12 | ManageBac integration | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 13 | Agent library | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 14 | Agent guided creation | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 15 | Presentation editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 16 | Sheets editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 17 | Code/visualisation editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 18 | Whiteboard editor | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 19 | Timetable/calendar | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 20 | History comparison across every type | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |
| 21 | Embedded artifacts across every type | Pending | Pending | Pending | Pending | 0 | Pending | Pending | Blocked |

## Required cross-feature acceptance ledger

| Combination | Implementation evidence | Live verification evidence | State |
|---|---|---|---|
| AI editing while another user is present | Pending | Pending | Blocked |
| Concurrent non-overlapping human/AI edits | Pending | Pending | Blocked |
| Same-region conflict queue/pause/resolution | Pending | Pending | Blocked |
| AI starts over unversioned user work | Pending | Pending | Blocked |
| Mixed human/AI history and restore | Pending | Pending | Blocked |
| Agent routing with workspace/artifact context | Pending | Pending | Blocked |
| ManageBac first sync into class workspaces/tasks/time | Pending | Pending | Blocked |
| ManageBac later source changes/overlays/tombstones/conflicts | Pending | Pending | Blocked |
| Live/pinned embeds update and revoke with source | Pending | Pending | Blocked |
| Permission changes during AI run | Pending | Pending | Blocked |
| Import, native editing, and export for every applicable type | Pending | Pending | Blocked |
| Multi-artifact workflow including Sheets links/charts | Pending | Pending | Blocked |
| Durable run recovery after navigation/interruption | Pending | Pending | Blocked |
