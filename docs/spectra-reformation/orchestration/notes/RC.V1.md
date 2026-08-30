# RC.V1 verification note — 2026-08-30

Status: **REJECTED**. RC-1 is repaired; the clean real-corpus gate is blocked by the existing P5 realtime proxy defect.

## Evidence

- Copies only under `Downloads\spectra-rc-corpus`; OneDrive originals were untouched.
- The real EE now renders 7 tables / 40 rows / 122 cells and 695 KaTeX equations (433 display; strict render 695/695).
- Native cover image: 1106 × 830; authenticated package-part fetch 200 `image/png` / 1,186,444 bytes; unauthenticated request 401.
- Protected rich content rejected editing and remained unchanged; safe prose accepted `RCV1-SPECTRA-30`.
- Evidence: `.shots/reformation/RC.V1/manifest.md`, especially `26`–`30`.

## Blocker and verdict

- Direct gateway WebSocket upgrade on 1234 returned 101; proxied `/_spectra/realtime?foo=1` returned 400.
- `scripts/next-dev-server.mjs` forwards query-only targets as `?foo=1`, not `/?foo=1`; repeated browser WS warnings follow.
- Bridge was Connected, but its queue stayed empty and no `file.write` occurred, so the marker was browser-local and reload/native round-trip could not be proved.
- RC.V1 stops REJECTED; presentation/spreadsheet full walks are not claimed. Proxy experiment was fully reverted.

## Verification

- Focused Vitest 38/38; broader seam 87/87; scoped ESLint 0 errors; capability and secret gates pass.
- Root TypeScript names only unrelated recorded blockers; Convex one-shot typecheck passes; diff/index checks pass before commit.

## Paste-ready P5.I2 prompt

> Normalize query-only WS proxy targets to `/?…`; add regression coverage; prove direct and proxied upgrades both return 101; then prove a signed-in document edit survives reload without WS warnings and reaches native `file.write`. Preserve auth/handshake checks and run focused, lint, capability, secret, diff, and mandatory Convex one-shot gates with numbered evidence and one scoped commit.
