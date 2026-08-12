# M2 — CONVERSATION TRUTH

**Agent:** Builder · **Prerequisites:** M1 verified in STATE.md

## Objective

The entire ask→run→stream→steer→stop loop becomes truthful and pleasant: visible streaming, working cancel, exactly one dock tab per run, threads that sit beside work without wrecking layout, and one conversation system across `/chat` and the right panel.

## Root causes you are fixing (STATE.md §2.B)

1. **B1 — No visible streaming.** Production closes the SSE after `run_created`/`thread_ready` (`run/route.ts:12324–12341`) and the agent loop emits only a terminal `text_replace` (`route.ts:11390–11394`). Deliver incremental text: emit `text_delta` from the loop (or chunk server-side), and keep a live event channel to the client for the run's lifetime (SSE kept open, or durable-event tailing that is indistinguishable from streaming). The existing streaming-reveal renderer is fine — feed it.
2. **B2/B3 — Run lifecycle divorced from HTTP lifecycle.** `use-spectra-run.ts:995–1001` clears `liveExchange` when the request ends; `busy` (`:1350–1352`) and stop-button wiring (`command-bar.tsx:688–697`) follow it. Rebuild client run state around the *run*, not the request: live view persists until terminal event; stop is available whenever a tracked run is active and calls the (sound) server stop path with the right runId; stopped state propagates everywhere within seconds (CANON D11).
3. **B4 — Dock dedup + stacking.** Bind the optimistic tab to its submission and retire it the moment the durable tab exists (`live-dock.tsx:491–498`, `552–567`). Collapse the composer-chip + dock + toast tower (`workspace-shell.tsx:6250–6263`) into the compact dock grammar of CANON D8/D9.
4. **B5 — Thread promotion bug.** Delete the split→tab promotion (`workspace-shell.tsx:3673–3681`); thread + split artifact coexist side-by-side with sane min-widths (CANON D6). Fix the width-var interplay so neither panel crushes the other.
5. **B6/B8 — Unify shell wiring.** `/chat` gets the Live Dock; remove the panel-close-when-URL-matches rule (`chat-shell.tsx:284–287`) in favor of one sensible policy; forward `liveExchange`/durable-observer consistently (`workspace-shell.tsx:6418–6422`, `conversation-surface.tsx:2239–2241`). One conversation implementation at two widths (CANON D12).
6. **B7 — Thought trace + failure UX.** Replace raw incremental build-log lines with collapsed, human-readable step summaries (chevrons only where there's detail). Failed runs state what failed and offer Retry/Open-thread.
7. **B9 — Thread proliferation.** Default-continuation actually continues (verify against `convex/spectraRuns.ts:291–305`); duplicate near-identical threads stop appearing in the hub.

## Also in scope

Live Dock hover = few useful details only; click opens conversation immediately; required-input expansion works (Flow 5). Steering: the client-side fake (new-run-after-poll) must at minimum become honest — if true safe-boundary steering (dead `steering-queue.ts`) is too deep here, wire the UX truthfully and queue the runtime work explicitly in STATE.md (wire-or-delete decision documented). The live dock full polished setup, with hover details, as documented in spectra definitive transformation plan.

## Out of scope

AI output *quality* (M5), motion polish of dock/panels (M8), multiplayer presence (M9).

## Acceptance criteria

1. Golden Flows 4, 5, 6, 10 pass, plus re-run Flows 0 and 3.
2. A long run streams visibly from first token; stop at three different stages (early, mid-tool, mid-stream) halts server work and truthfully updates UI each time.
3. Two simultaneous runs = two tabs, independently updating; navigating routes never kills or duplicates them.
4. `/chat` and right-panel behave identically for send/continue/stream/stop/dock.
5. `.shots/missions/M2/` evidence incl. mid-stream captures; STATE.md updated.
