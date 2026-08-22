# N6 evidence notes — 2026-08-21

- `npx tsc --noEmit --pretty false` passed after the protected-original and policy changes.
- `npx vitest run src/features/spectra/__tests__/sync-policy.test.ts src/features/spectra/__tests__/bridge-contract.test.ts src/features/spectra/__tests__/sync-matrix.test.ts` passed.
- `cargo test` in `bridge/` passed 21 core tests, 6 chaos tests, and 1 granted-tree test.
- Live Chrome evidence: Settings → Files and devices showed Connected, Storage policy, four choices, and “Current: spectra · Account default”.
- Live Windows evidence: isolated `spectra-bridge.exe` paired once, Chrome resumed the session without another code, closing the Bridge window left `/v1/health` paired and the process alive.
- Production Bridge task and Physics folder were not used. The isolated Bridge used `.tmp-n6-bridge` only.
- N6 remains IN PROGRESS: full §10 execution, physical mirroring modes, two-device conflict resolution, and hash-proof Office acceptance still need dedicated runs before acceptance.
- Live Chrome follow-up: a single click on `N4-controlled-fields.docx` opened the native DOCX directly into the Document editor; the preserved-features notice was dismissible and stayed dismissed after a reload; the old `15193 bytes` summary rendered as `14.8 KB`.
- Shared UX hardening: Library rows now open work on one click, drag surfaces expose grab/grabbing cursors, elapsed verification ages use minutes/hours/days, and resource summaries use human-readable byte units.
- Close-out: full Vitest suite 795/795, full ESLint, `tsc`, secret scan, DOCX/Office fidelity harnesses, Rust core 28/28 + chaos 6/6 + granted-tree 1/1, and Bridge build all green on 2026-08-22.
- Matrix additions: deterministic two-device divergent revisions, protected-original hash unchanged until Apply, and mirror-both move propagation are executable in `sync-matrix.test.ts`.
