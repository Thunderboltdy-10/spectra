# M1 — MAKE IT EDITABLE

**Agent:** Builder · **Prerequisites:** none · **This is the foundation mission. Nothing else matters until an owner can open their own work and type.**

## Objective

Any user with edit access opens any of their work and edits it instantly, reliably, with correct persistence — and the owner-mode design flaw is eliminated product-wide.

## Root causes you are fixing (details in STATE.md §2.A)

1. **A1 — Gateway blocks broadcast on persistence.** `scripts/collaboration-gateway.mjs:489–562` computes a full document projection and synchronously awaits a Convex append (`convex/collaborationGatewayStore.ts:390–728`) *before* Hocuspocus applies/broadcasts. Restructure to broadcast-first: apply + broadcast immediately, enqueue projection/append asynchronously with retry (mirror the Cloudflare room's ordering in `workers/collaboration/room-core.ts:103–105`). Debounce/batch projection (100–300ms). Claim checks may stay synchronous but must be cheap.
2. **A3 — Gateway reliability.** Diagnose and fix the stuck "Round One Durable Sync / could not complete" failure visible in every screenshot (`use-artifact-live-model.ts:84–88` timeout path). Editing must degrade gracefully: if durable sync is behind, the user keeps editing locally with an honest, quiet indicator — never a blocking error, never a dead editor.
3. **A4/A5/A7 — Owner modes.** Implement CANON D1–D4:
   - Owners/editors always land in the authoring view. Remove Write/Read/Review(/Focus) as peer tabs in `DocumentStudio` (`artifact-studio.tsx:6405–6471`, toggle `7311–7337`); keep "Preview as reader"/Focus as overflow actions.
   - Kill non-editing split-panel defaults (`artifact-studio.tsx:6464`, `8220`, `12185`) for anyone with edit access.
   - Quiz: owner default = Build; Attempt becomes a clearly-labeled action, exits back to Build (`quiz/experience.ts:451–452`). Same principle for Flashcards (Study) and Presentation (Present).
   - Wire the mode logic through the existing-but-unused kernel (`availableWorkModes` / `workCan`, `work/registry/registry.ts:38–96`) instead of ad-hoc per-studio toggles — this is a wire-or-delete case: wire it.
4. **A6 — Ownership-blind readOnly.** `artifact-studio.tsx:3707–3743`: `readOnly` must never be true for an owner/editor due to transport `level === "read"` without an actual permission change; reconcile gateway `authorize` so owners are never issued read-level room access.
5. **A2 — Client re-projection storm** (*only the part needed for correct editing*): stop the `incomingSnapshot` rebase/`setContent` path from firing on live Yjs-origin changes (`artifact-studio.tsx:5091–5170`); full perf work is M3's.
6. **A8/A9** — Surface claim-conflict queuing honestly; wire Sheets' ignored `_synchronizationReady` (`sheets-studio.tsx:716`).

## Also in scope (sweep targets you will inevitably touch)

- Remove the campaign's test-data debris from the real account (the "Round One …", "New Document"×3, "Tiny" items) — Flow 0 must pass.
- The persistent "N X Issues" badge and stuck error toast: if they're a dev overlay, gate them dev-only; if product UI, redesign per CANON D13/D14 (this may complete in M4, but the *stuck* state must die here).

## Out of scope

Streaming/dock/thread layout (M2), broad perf (M3), visual hygiene systems (M4), migrating the 8 JSON-projection types to native Yjs (A10 — queue it; M3/M5 decide timing).

## Acceptance criteria (all browser-verified)

1. Golden Flows 0, 1, 2 pass — every one of the 10 work types opens editable for its owner, instantly, incl. split/side-panel.
2. Typing in a Document with the gateway under load shows no perceptible latency; killing the gateway mid-session leaves the editor usable with an honest sync indicator; restarting it reconciles without data loss.
3. No mode toggle anywhere can strand an owner in a non-editable state; Quiz/Flashcards/Presentation dual views work as actions (Flow 7 for quiz).
4. `.shots/missions/M1/` contains the evidence set; STATE.md §2.A entries moved to VERIFIED with paths; new discoveries logged.

## Mission log — COMPLETE 2026-08-12

- Dev collaboration is broadcast-first with asynchronous debounced durable projection/retry; the editor never waits on persistence before echoing human input.
- Reconnect and unsynchronized states preserve local editing with an honest quiet indicator; a gateway-off Document edit reconciled and survived reload.
- Owner/editor permission is authoritative over transient transport state; every registered type opens in authoring in split/side-panel context.
- Document/Code native Yjs changes no longer re-enter the whole-body React projection path; Sheets honors synchronization readiness without freezing input.
- Owner-stranding mode tabs were removed/wired through the work-mode kernel. Document reader preview, Quiz Attempt, Flashcards Study, and Presentation Present are actions with a return to authoring.
- Fixed quiz normalization forcing `published` back to false; durable Publish → Attempt now works and has regression coverage.
- Standardized opaque editor workbars, consolidated Code chrome, removed nested editor backgrounds/borders, and made full-surface editors consume available height.
- Side artifact/thread panels participate in layout; Live Dock remains centered with reserved bottom space; workspace cards respond to reduced width; loading rails keep stable geometry.
- Removed Round One artifact probes and generated New Document debris through the product UI.
- Golden Flow 0 passed for Workspace and Library with dated screenshots.
- Golden Flow 1 passed with immediate Document typing and post-reload persistence screenshots.
- Golden Flow 2 passed with dated authoring evidence for all ten registered types.
- Flow 7 passed with dated Quiz Build and real Attempt evidence; Flashcards Study returns to Build.
- Gateway interruption/recovery passed with dated Synchronizing/editable, Live recovery, and post-reload persistence evidence.
- Final code gates recorded: TypeScript passed; 73 test files / 687 tests passed. Repository-wide pre-existing lint debt is queued in STATE.
