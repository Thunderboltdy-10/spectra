# M9 — MULTIPLAYER FINALE

**Agent:** Builder (Designer on call for field/motion tuning) · **Prerequisites:** M8 verified

## Objective

Prove and perfect Spectra's defining capability — humans and AI working together live — using the two real profiles, and tune how the field and motion systems express collaboration in practice. This was deliberately deferred until everything else was hardened; you are validating a finished product, not debugging a broken one.

## Profiles

Per `SPECTRA_LIVE_PERFECTION_CAMPAIGN.md` §4: **Profile P** (Chrome `pablo.martinez.dovale@gmail.com` / Spectra `[school-account-email]`, ManageBac-connected) and **Profile C** (Chrome `carlos.martinez.mozo@gmail.com` / Spectra `pablo.martinez.dovale@gmail.com`). Keep the identities straight when attributing presence/AI/comments.

## Scope (inherits campaign §14–§15 wholesale)

1. **Sharing & permissions:** P→C private/read-only/edit, revoke, downgrade-while-open, workspace access. Read-only must block every mutation path including AI (permission change mid-run: no forbidden write lands).
2. **Presence:** join/leave/switch/selection/idle/reconnect — alive, never noisy; field expresses collaborator loci correctly (M6 wiring under real multi-user load).
3. **True merge:** Documents and Code, concurrent typing in different areas and around the same paragraph; convergence with no lost edits; undo stays actor-scoped.
4. **Leases in anger:** dropdowns, pickers, drags, resizes, reorders from both directions — the second user is locally, gracefully blocked; nothing collapses or reverses an active gesture. (If M4 deleted the coordination controller, this is where its replacement must prove itself — the lease UX must exist and work here.)
5. **Every work type:** simultaneous different-target edits, type-appropriate same-target contention, one undo each, refresh, convergence. Whole-JSON-replacement "collaboration" that merely converges eventually is not acceptable for launch types — document honestly per type.
6. **AI × collaboration (the defining experience):** P's AI visible to C as P's Spectra; AI waits calmly when C holds a target, resumes and re-resolves; humans blocked locally from AI-held controls; two AIs on the same work (different + overlapping targets); steering while collaborating; refresh/reconnect mid-run (run survives the tab).
7. **Reconnect:** interrupt C's network; safe local state, convergence, no duplicate presence, no permanent badges.
8. **Field & motion reaction pass:** with real two-user + AI sessions running, walk the product and tune every place the field/motion misrepresents or underplays collaboration (with the Designer). Capture rapid intermediate screenshots during live AI/collaborator actions — this is where the "alive workspace" promise is either kept or broken.
9. **Final marathons** (campaign §20): the general project, the school workflow on P's real ManageBac data, the agent workflow used from both accounts, the collaboration stress scenario, and a final free-use session.

## Acceptance criteria

1. Every scenario above VERIFIED in STATE.md with dual-profile evidence (side-by-side screenshots, both perspectives, including mid-action captures).
2. All Golden Flows pass one final time on both profiles, fresh.
3. STATE.md §4 (UNKNOWN) is emptied — everything moved to VERIFIED or precise open defects.
4. The campaign completion standard (§21) holds in full. Closing entry in STATE.md: the release-readiness verdict Pablo takes to his school, with any honest residual risks listed.
