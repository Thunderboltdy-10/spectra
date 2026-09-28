# F/G session notes — 2026-07-26

## Environment
- Tab P: P MD (School Admin) · Tab C: Pablo MD (Student)
- Stack healthy: web 200, collab ready, Convex synced after selectTab repair

## Repairs landed this session
1. Restored broken `selectTab` in `convex/spectraRuns.ts` (syntax corruption after soft `no_run` return).
2. Deselect thread no longer throws in workspace/artifacts shells.
3. Line-scoped decoration: when `/lines/N` paths exist, never paint whole block / `all`.
4. `preferLineScopedPaths` strips coarse `/blocks/.../text` once line paths exist; drops `/`.
5. Accept calls durable `dismissAiEdit` (new mutation + API action).
6. AI edited flash 15m → 90s (Convex + client fallbacks).
7. Settling effects no longer keep sr-only “Updating the document” working chrome.
8. Post-apply hold no longer forces `previewPhase: streaming` (was sticking owner UI in updating).
9. Idle AI peers filtered out of avatar strip unless streaming/pointing.
10. Mid-stream highlight merge: while AI `previewPhase===streaming`, only presence target paths light (stops deck 15-region wash).
11. `resolveAiHighlightPaths` drops sticky `/` once concrete paths exist.

## Evidence grades (critical)

### Document G-02 (shared Study Notes)
- Marker `G02-LIVE-ms1p26` applied on last Key Takeaways bullet — **Pass/Excellent for apply**.
- Tab P mid-stream: `P MD's AI` + Live · 2 + region label — **Pass** (label still cites first list excerpt, not last bullet — not Excellent).
- Tab C mid-stream: content sync OK; **missed live `P MD's AI` chrome** (saw Accept/Reject after settle) — **Pass, not Excellent**.
- Fixture still polluted with prior markers — **Pass / fixture hygiene fail**.

### Deck F/G (Short Deck, newly shared modify)
- Invite → Artifacts Invitations → Accept works (not Notifications) — **Pass**.
- AI applied `DECK-G02-ms1p26` on card 1 back — **Pass**.
- Mid-stream Tab P: **15 `data-ai-region`s** (whole deck wash) before streaming-path fix — **Alarming → repaired, needs rerun**.
- Tab C peer: settle Accept/Reject; **no mid-stream owner AI presence** — **Pass, not Excellent for G-02**.
- Settle still lit 3 regions (card 1 + unrelated card + textarea) — **Pass, not Excellent**.

## Still below Excellent (next)
1. Rerun deck AI mid-stream after streaming-path-only highlight fix; prove ≤1–2 regions + Tab C sees `P MD's AI`.
2. Quiz / planner / sheets / presentation / whiteboard / timetable / code — same dual-tab mid-stream protocol.
3. Clean Study Notes markers.
4. Shared list “AI editing” badge stuck after settle — verify dismissAiEdit clears for peers.
5. Region labels for lists should prefer the changed line excerpt.
