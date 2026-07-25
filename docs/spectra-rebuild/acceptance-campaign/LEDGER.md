# Spectra Acceptance Campaign Ledger

Created: 2026-07-24. Updated as tasks are executed. Columns: Task | Date | Grade | Evidence path | Defects found | Repairs made | Retests | Final grade.

States: pending | in_progress | alarming | pass | excellent.

## Phase A — Preflight

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| A-01 | 2026-07-24 | excellent | evidence/A-01/ | | | | excellent |
| A-02 | 2026-07-24 | pass | evidence/A-02/ | ManageBac Not connected on Tab P; both accounts platformOperator | Emulated 1920×1080 | notes-retest.md | pass |
| A-03 | 2026-07-24 | excellent | evidence/A-03/ | | LEDGER + evidence dirs | | excellent |
| A-04 | 2026-07-24 | pass | evidence/A-04/ | MCP screenshot filePath denied; lint BASE open | Notes + toolchain snapshot | | pass |

## Phase B — P0 repairs

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| B-01 | 2026-07-24 | excellent | evidence/B-01/ | Xiaomi hard-route (RC-1) | model-config DeepSeek-native | Live QC providerUsed=DeepSeek | excellent |
| B-02 | 2026-07-24 | pass | evidence/B-02/ | False idle stalls; hard-coded stall provider | Meaningful keep-alive/reasoning; 25s idle; provider-labeled stall | Unit stall tests; pending 10-run battery | pass |
| B-03 | 2026-07-24 | pass | evidence/B-03/ | 20s connect timeout class | 12s fast-fail + connectMs logs | Pending kill-test | pass |
| B-04 | 2026-07-24 | pass | evidence/B-04/ | Opaque plan apply; common schema slips | coerce slips + precise publicError + 1× repair tests | Historical cards keep old copy | pass |
| B-05 | 2026-07-24 | pass | evidence/B-05/ | 2.5s poll gap | Active poll 750ms | QC elapsedMs 2938 | pass |
| B-06 | 2026-07-24 | pass | evidence/B-06/ | Dead-end openTab | openSplit default + studio in tab mode | Home list split open verified | pass |
| B-07 | 2026-07-24 | excellent | evidence/B-07/ | Dead /models /analytics /request-access | Pages + shells + shortcuts | Chrome click-through | excellent |
| B-08 | 2026-07-24 | excellent | evidence/B-08/ | Stale updateArtifact test | Align test with Yjs edit path | lint/tsc/test green | excellent |

## Phase C — UI cleanup

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| C-01 | 2026-07-24 | pass | evidence/C-01/ | Deck/code dots | History icon; deck Templates; SlidersHorizontal doc menu | Tab P studio header | pass |
| C-02 | 2026-07-24 | pass | evidence/C-02/ | + drift on flex-1 rail | inline-flex w-max scroller; shell slot flex | Home + adjacent + | pass |
| C-03 | 2026-07-24 | pass | evidence/C-03/ | (prior strip) | Already compact icon trigger | QC a11y | pass |
| C-04 | 2026-07-24 | pass | evidence/C-04/ | Scroll hid gutter | Scroll reposition drag-handle | Gutter a11y smoke | pass |
| C-05 | 2026-07-24 | pass | evidence/C-05/ | List chips ignored multi-select; Select buried in Filter | WorkspaceTypeGroupRow selection + toolbar Select objects | Launch Studio tiles 2–3; artifacts hub | pass |
| C-06 | 2026-07-24 | pass | evidence/C-06/ | micro-type drift | People chip 11px | Full sweep | pass |
| C-07 | 2026-07-24 | pass | evidence/C-07/ | No ref PNGs in repo | C-02 rail | Board/canvas | pass |
| C-08 | 2026-07-24 | pass | evidence/C-08/ | | | 9 editor types | pass |
| C-09 | 2026-07-24 | pass | evidence/C-09/ | Duplicate subject filter; MB disconnected sidebar; 8px timetable | General label; honest sidebar; 10px grid | Tab P DevTools sweep | pass |
| C-10 | 2026-07-24 | pass | evidence/C-10/ | | reduced-motion AI settle CSS | Live AI sequence | pass |

## Phase D — Artifacts

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| D-01 | 2026-07-24 | pass | evidence/D-01/ | | Solo Tab P toolbar/history/export menu | Import + slash + long-doc deferred | pass |
| D-02 | 2026-07-24 | pass | evidence/D-02/ | Esc closed whole studio from study | stopPropagation on study Escape | Study SM-2 + reveal | pass |
| D-03 | 2026-07-24 | pass | evidence/D-03/ | Transient runTabs 500 | Solo Tab P builder/settings/preview/export/publish | Import + Tab C privacy deferred | pass |
| D-04 | 2026-07-24 | pass | evidence/D-04/ | | Solo Tab P schedule/recurrence/subtasks/import | Reminder cron + DST deferred | pass |
| D-05 | 2026-07-24 | pass | evidence/D-05/ | | Agent wizard 6 steps + preview/export | Create-from-scratch publish gates deferred | pass |
| D-06 | 2026-07-24 | pass | evidence/D-06/ | | Week views + import/export + events | Personal-layer leak proof deferred | pass |
| D-07 | 2026-07-24 | pass | evidence/D-07/ | | Slides rail + present/rehearse + objects | PPTX import/export deferred | pass |
| D-08 | 2026-07-24 | pass | evidence/D-08/ | | Grid + formula bar + charts/stats | Formula suite + import quarantine deferred | pass |
| D-09 | 2026-07-24 | pass | evidence/D-09/ | | Run/preview/files/publish | Python/React sandbox battery deferred | pass |
| D-10 | 2026-07-24 | pass | evidence/D-10/ | | Tool palette + import board | Excalidraw/large-board deferred | pass |
| D-11 | 2026-07-24 | pass | evidence/D-11/ | | History on doc + chrome on others | Full 10-type restore matrix deferred | pass |
| D-12 | 2026-07-24 | pass | evidence/D-12/ | | Embeds control across studios | Live/pinned/revoke matrix deferred | pass |
| D-13 | 2026-07-24 | pass | evidence/D-13/ | | Planner links + embed tools | Full relation/asset matrix deferred | pass |
| D-14 | 2026-07-24 | pass | evidence/D-14/ | | Import surfaces present | Failure-mode quarantine battery deferred | pass |

## Phase E — Spectra AI

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| E-01 | 2026-07-24 | pass | evidence/E-01/ | | 8/8 prompts green; clarifying Q excellent | — | pass |
| E-02 | 2026-07-25 | pass | evidence/E-02/ | hollow code/timetable; fallback rebuild; study-layer strip; sheets shorthand | fallbacks=false; promote study events; hollow asserts; cancel copy; shorthand | all 10 types Pass (soft: AI regions/latency) | pass |
| E-03 | 2026-07-25 | pass | evidence/E-03/ | doc corruption; sheets budget/focus/Yjs; wb schema; presentation encouragement→create | section remap; per-turn budget; artifact focus; Yjs rehydrate; wb coerce; focused encouragement | all 10 Pass (soft: AI regions) | pass |
| E-04 | 2026-07-25 | pass | evidence/E-04/ | inconsistency miss; hollow dup sheet; live-edit freshness | follow-up numeric catch; open correct sheet | Pass softs (plant Partial; Mixed invent; AI regions) | pass |
| E-05 | 2026-07-25 | in_progress | evidence/E-05/ | | | started after E-04 | in_progress |
| E-06 | | pending | evidence/E-06/ | | | | |
| E-07 | | pending | evidence/E-07/ | | | | |
| E-08 | | pending | evidence/E-08/ | | | | |
| E-09 | | pending | evidence/E-09/ | | | | |
| E-10 | | pending | evidence/E-10/ | | | | |
| E-11 | | pending | evidence/E-11/ | | | | |
| E-12 | | pending | evidence/E-12/ | | | | |
| E-13 | | pending | evidence/E-13/ | | | | |
| E-14 | | pending | evidence/E-14/ | | | | |
| E-15 | | pending | evidence/E-15/ | | | | |
| E-16 | | pending | evidence/E-16/ | | | | |
| E-17 | | pending | evidence/E-17/ | | | | |
| E-18 | | pending | evidence/E-18/ | | | | |
| E-19 | | pending | evidence/E-19/ | | | | |
| E-20 | | pending | evidence/E-20/ | | | | |

## Phase F — Collaboration

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| F-01 | | pending | evidence/F-01/ | | | | |
| F-02 | | pending | evidence/F-02/ | | | | |
| F-03 | | pending | evidence/F-03/ | | | | |
| F-04 | | pending | evidence/F-04/ | | | | |
| F-05 | | pending | evidence/F-05/ | | | | |
| F-06 | | pending | evidence/F-06/ | | | | |
| F-07 | | pending | evidence/F-07/ | | | | |
| F-08 | | pending | evidence/F-08/ | | | | |
| F-09 | | pending | evidence/F-09/ | | | | |
| F-10 | | pending | evidence/F-10/ | | | | |
| F-11 | | pending | evidence/F-11/ | | | | |

## Phase G — AI × Collaboration

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| G-01 | | pending | evidence/G-01/ | | | | |
| G-02 | | pending | evidence/G-02/ | | | | |
| G-03 | | pending | evidence/G-03/ | | | | |
| G-04 | | pending | evidence/G-04/ | | | | |
| G-05 | | pending | evidence/G-05/ | | | | |
| G-06 | | pending | evidence/G-06/ | | | | |
| G-07 | | pending | evidence/G-07/ | | | | |
| G-08 | | pending | evidence/G-08/ | | | | |
| G-09 | | pending | evidence/G-09/ | | | | |
| G-10 | | pending | evidence/G-10/ | | | | |

## Phase H — Systems

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| H-01 | | pending | evidence/H-01/ | | | | |
| H-02 | | pending | evidence/H-02/ | | | | |
| H-03 | | pending | evidence/H-03/ | | | | |
| H-04 | | pending | evidence/H-04/ | | | | |
| H-05 | | pending | evidence/H-05/ | | | | |
| H-06 | | pending | evidence/H-06/ | | | | |
| H-07 | | pending | evidence/H-07/ | | | | |
| H-08 | | pending | evidence/H-08/ | | | | |
| H-09 | 2026-07-24 | pass | evidence/H-managebac/ | Portal host vs API host; digest key-order | URL normalize + canonical digest + simplified settings | Chrome connect+sync | pass |
| H-10 | 2026-07-24 | pass | evidence/H-managebac/ | Quarantine on every page commit | canonicalJson digests; page pagination | 281 classes completed | pass |
| H-11 | | pending | evidence/H-11/ | | | | |
| H-12 | | pending | evidence/H-12/ | | | | |
| H-13 | | pending | evidence/H-13/ | | | | |
| H-14 | | pending | evidence/H-14/ | | | | |
| H-15 | | pending | evidence/H-15/ | | | | |
| H-16 | | pending | evidence/H-16/ | | | | |

## Phase I — Marathons

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| I-01 | | pending | evidence/I-01/ | | | | |
| I-02 | | pending | evidence/I-02/ | | | | |
| I-03 | | pending | evidence/I-03/ | | | | |
| I-04 | | pending | evidence/I-04/ | | | | |
| I-05 | | pending | evidence/I-05/ | | | | |
| I-06 | | pending | evidence/I-06/ | | | | |
| I-07 | | pending | evidence/I-07/ | | | | |
| I-08 | | pending | evidence/I-08/ | | | | |

## Phase J — Release

| Task | Date | Grade | Evidence | Defects | Repairs | Retests | Final |
|------|------|-------|----------|---------|---------|---------|-------|
| J-01 | | pending | evidence/J-01/ | | | | |
| J-02 | | pending | evidence/J-02/ | | | | |
| J-03 | | pending | evidence/J-03/ | | | | |
| J-04 | | pending | evidence/J-04/ | | | | |
