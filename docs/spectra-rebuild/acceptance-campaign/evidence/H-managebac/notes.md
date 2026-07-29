# ManageBac Chrome proof (school-wide connect + manual sync)

Date: 2026-07-24

## Product defaults verified
- Settings UI: API base URL + school-wide API key only
- Sync cadence: every **180 minutes**
- Auth: `auth-token` header, raw token (not Bearer)
- Portal hosts like `gcm.managebac.com` normalize to `https://api.managebac.com`
- Blank form token may use temporary `MANAGEBAC_API_KEY` from env for local verification

## Root cause of earlier quarantine
Sync page commits failed with `INTEGRATION_PAYLOAD_INVALID` because Convex reorders nested record object keys, while the bridge digest used insertion-order `JSON.stringify`.

**Repair:** both Next route and Convex now digest with shared `canonicalJson` (sorted keys). Also coerce numeric `meta.next_page` for page pagination.

## Chrome confirmation (Tab P, 1920×1080)
1. Opened `/managebac` as school admin (The Global College)
2. Settings: set **API base URL** to `https://api.managebac.com`; saved (key retained / env fallback)
3. Clicked **Sync now** in the page header
4. Result:
   - Integration status: **connected**
   - Sync run: **completed**, trigger Manual
   - First import: **281** classes created across 3 pages
   - Re-sync: **281** unchanged, 0 errors
   - Overview preview: **120** importable classes listed (preview cap)
   - Sample titles: HS Wellbeing Day (IBDP 1), HS TOP (IBDP 1), …

## Grade
**Excellent** for connect + manual sync path after digest repair.
