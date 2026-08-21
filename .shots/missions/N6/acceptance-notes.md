# N6 evidence notes — 2026-08-21

- `npx tsc --noEmit --pretty false` passed after the protected-original and policy changes.
- `npx vitest run src/features/spectra/__tests__/sync-policy.test.ts src/features/spectra/__tests__/bridge-contract.test.ts src/features/spectra/__tests__/sync-matrix.test.ts` passed.
- `cargo test` in `bridge/` passed 21 core tests, 6 chaos tests, and 1 granted-tree test.
- Live Chrome evidence: Settings → Files and devices showed Connected, Storage policy, four choices, and “Current: spectra · Account default”.
- Live Windows evidence: isolated `spectra-bridge.exe` paired once, Chrome resumed the session without another code, closing the Bridge window left `/v1/health` paired and the process alive.
- Production Bridge task and Physics folder were not used. The isolated Bridge used `.tmp-n6-bridge` only.
- N6 remains IN PROGRESS: full §10 execution, physical mirroring modes, two-device conflict resolution, and hash-proof Office acceptance still need dedicated runs before acceptance.
