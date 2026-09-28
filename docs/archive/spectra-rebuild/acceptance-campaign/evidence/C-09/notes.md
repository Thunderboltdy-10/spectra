# C-09 Reference sweep — system surfaces (refs 10–14, 20–21)

**Date:** 2026-07-24  
**Environment:** Tab P (`P MD`, school admin + platform operator), 1920×1080, Chrome DevTools MCP  
**Grade:** **pass** (not excellent — reference density and some history/embed depth gaps)

## Routes exercised

| Route / surface | Ref | Result |
|-----------------|-----|--------|
| `/superadmin` | 10 | Loads; privacy-safe copy; metrics honest (“Awaiting meter”, “Unknown”); ManageBac service health **Operational**; operational queues (5 failed AI runs). Sparse vs reference charts/seat scale. |
| `/admin` | 11 | **School Admin Overview** for The Global College; 281 class workspaces; ManageBac card **Connected**, last sync ~8–10 min; feedback inbox clear; usage meters empty but labeled. |
| `/managebac` | 12 | **Connected**; sync coverage 100%; 120 importable classes; sync history shows completed + partial runs honestly; tasks preview “No task records have synchronized yet”; timetable preview grid present. |
| `/agents` | 13 | Agent Library with filters, My agents, Shared, Discover; **New agent** creates draft. |
| Agent guided creation | 14 | Six-step rail: Purpose → Users & access → Knowledge → Capabilities → Tone → Review & publish; Purpose step fields + clarification modes visible. |
| History comparison | 20 | **Document** (`Collaboration Acceptance – Document C`): v1 AI / v2 user, split compare, restore copy. **Quiz** (`Spectra Launch Certification`): overlay works; **0 meaningful versions** (empty timeline copy). |
| Embedded artifacts | 21 | **Quiz**: modal “Compose with live artifacts”, Add, live vs pinned copy. **Document/Quiz** studio headers expose **Embedded artifacts** control (ref 21 shell). |

## Console / network

- No console errors observed on admin/superadmin/managebac/agents sweeps.
- DevTools MCP `filePath` screenshots **denied** (workspace root); evidence is snapshot-based.

## Reference gaps (not repaired this task)

- Superadmin/admin lack reference-scale charts, seat donut, and rich activity tables (product data + metering backlog).
- ManageBac tasks/timetable previews empty until source events/tasks sync (UI is honest).
- Agent library card density vs ref 13 (acceptable; filters functional).

## Defects found

1. **Agent Library:** Subject filter listed **duplicate “All subjects”** because untagged agents used `subjectLabel` fallback `"All subjects"`.
2. **ManageBac (disconnected):** Sidebar showed **Automatic** auto-import / **Review** conflict mode while integration status was **Not connected** (misleading).
3. **ManageBac:** Timetable preview grid used **8px** type (readability).

## Repairs made (code)

| File | Change |
|------|--------|
| `agent-library-shell.tsx` | Default subject **General**; exclude from subject filter list (removes duplicate option). |
| `managebac-integration-shell.tsx` | Disconnected sidebar: sync-dependent rows show **Unavailable until connected**; timetable grid **10px**. |

## Retest

- `/agents` Subject combobox: single “All subjects” + capability options; cards show **General** where untagged.
- Tab P `/managebac` connected state unchanged (sync now, classes, history).
- Agent wizard opens from library card with six steps.

## Residuals

- Quiz (and likely sheet/deck without checkpoints) may show **0 meaningful versions** until idle grouping commits — overlay UX is fine, data thin.
- Embed modal exercised; no live embed instances validated in-document (D-12 depth).
- Superadmin **Failed AI runs (5)** worth H-15 follow-up; not a C-09 UI defect.
- Canvas showed **stuck “Creating …”** progress on some quiz cards during workspace navigation — watch in C-10 / RC-2, not fixed here.

## Latency (informal)

- Route navigations felt &lt; 2s at 1920×1080; artifact studio open &lt; 2s for document/quiz/agent.
