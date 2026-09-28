# A-04 Baseline capture

Date: 2026-07-24

## Environment
- Commit base: `4766b5c` (campaign start); working tree carries Phase B repairs in progress.
- Viewport: emulated `1920x1080` via Chrome DevTools MCP (`emulate` viewport) — native `resize_page` blocked when window maximized.
- Screenshot `filePath` writes into the workspace are denied by the DevTools MCP; baselines recorded as live page captures + notes.

## Surfaces visited (Tab P = [school-account-email])
- `/workspace?home=1` — home hub loads
- `/managebac` — loads; connection state: **Not connected** (plan assumed connected; live ground truth)
- Pending visual set: artifacts hub, 10 artifact type fixtures, `/agents`, `/memory`, `/admin`, `/superadmin`, `/chat` — continued in campaign fixtures during Phase D/E

## Toolchain baseline (pre B-08)
- `npx tsc --noEmit`: clean after transport/routing type fixes
- `npm run lint`: 35 errors / 78 warnings at campaign start (BASE defects) — repair delegated under B-08
- `run-route.test.ts`: 26/26 pass after planner schema fixture + progress event title assertions

## Grade
**Pass** — environment and identity baselines established; visual screenshot file archive blocked by MCP path policy; ManageBac not connected; lint gate open until B-08.
