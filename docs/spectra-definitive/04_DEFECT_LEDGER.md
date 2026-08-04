# Defect ledger

| ID | Severity | Surface | Defect | Resolution | Status |
|---|---|---|---|---|---|
| DEF-001 | Architectural | Routes/navigation | Legacy Artifacts, Timetable, and Memory routes remain primary. | Canonical Library, Calendar, and Settings routes own normal navigation; lightweight redirects remain for retention-safe compatibility until Phase 12/16. | Mitigated |
| DEF-002 | Architectural | Collaboration | Hocuspocus and JSON-region compatibility paths remain for rollback/unmigrated surfaces. | Native document/code are active on Cloudflare; retire compatibility at Phase 12/16 gate. | Mitigated |
| DEF-003 | Architectural | AI runtime | Tool schemas and orchestration remain concentrated in the run route. | Tool schemas/policy/execution moved to Registry V2; route retains orchestration and domain mutation handlers pending final Phase 12/16 compatibility removal. | Mitigated |
| DEF-004 | Product | Settings | Current settings are a small drawer rather than an application. | Full responsive Settings application plus a deliberately small quick drawer share scoped v2 preferences. | Resolved |
| DEF-005 | Product | Workbench | Library/Workspace and sidebar ownership are duplicated. | Phase 6. | Open |

Baseline gate failures discovered during implementation are recorded here before feature work proceeds.
