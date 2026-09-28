# B-02 Stream stall diagnosis and resilience

Date: 2026-07-24

## Defect
Idle watchdog treated only non-empty `content` / tool-argument bytes as meaningful. Reasoning deltas, `reasoning_details`, SSE comment keep-alives (`: ping`), empty role heartbeats, and split JSON fragments did not reset the timer. Stall copy also defaulted to a hard-coded label even when a different route was active. Short QC traffic could therefore false-stall → truncated plan → `"The first response was incomplete · retrying once"`.

## Repairs
- `streamEventIsMeaningful()` centralizes health signals: SSE comments, reasoning / reasoning_details, tool-call fragments, role/empty deltas, usage/provider heartbeats, and continued split JSON.
- `readOpenRouterResponse` / `readOpenRouterAgentTurn` pass a live `formatProviderStallLabel(provider, hint)` into `ProviderStreamStalledError`.
- Non-complex provider idle budget raised **18s → 25s** (complex remains 60s). This is first-token grace, not a run wall clock.
- Unit coverage for keep-alive/reasoning non-stall, induced stall with accurate provider label.

## Timing guidance (for the pending 10-run QC battery)

| Phase | Excellent | Pass | Alarm |
| --- | --- | --- | --- |
| Ack / run_created | < 1.5s | < 3s | silent > 5s |
| First meaningful progress (token, tool, or status) | < 5s | < 10s | gap > 25s |
| Idle gap with **no** keep-alive/reasoning/content | — | < 25s | watchdog fires |
| Complex reasoning idle | — | < 60s | watchdog fires |
| Complete (short answer QC) | < 8s model | < 20s | > 45s unexplained |

Log markers to collect: `[spectra.openrouter.phase]`, `[spectra.agent.turn]`, `providerUsed`, any `ProviderStreamStalledError`.

## Verification
`npx vitest run src/features/spectra/__tests__/openrouter-stream.test.ts` — green (includes stall + keep-alive cases).

## Residual
Live 10-run timing table and deliberate bogus-model stall UX still pending in Phase E. Historical B-01 incomplete→retry was a **plan-repair** status (not necessarily a watchdog stall); B-04 reduces that class separately.
