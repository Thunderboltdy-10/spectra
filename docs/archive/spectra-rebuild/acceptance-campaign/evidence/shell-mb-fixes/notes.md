# Shell + ManageBac product fixes (mid-campaign)

Date: 2026-07-24  
Operator: parent agent (Chrome exclusive).

## ManageBac
- Sync no longer auto-creates class workspaces (`projectRecord` returns `{ projected: false }` for classes).
- Admin `/managebac` reframed as connection setup (API URL + school-wide key + sync).
- User `/school-data` dashboard: list class candidates, select which to materialize, sync with cooldown via `requestAiRefresh`, purge auto-created class workspaces.
- Purged **281** auto-created `managebac-class` workspaces from Tab P (hard delete after archive left list polluted).
- Fixed `spectraWorkspaces:list` scan window so active workspaces are not buried under archived rows.

## Shell UX
- Home Recent activity rail hides when artifact split studio is open.
- Home activity rail + workspace Inspector collapsible (PanelRight pattern, persisted).
- Opening a workspace opens a **new hub tab** (Home remains).
- Back/forward arrows left of first tab restore prior hub/artifact UI state.

## Typography
- Display/serif tokens use Manrope; Georgia serif fallbacks removed; lining/tabular nums on body + `.font-display`.
