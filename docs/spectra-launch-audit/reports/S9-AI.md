# S9-AI — complete intent and durable quality

Date: 2026-09-23 (Europe/Madrid). Branch: `main`. Status: **implementation complete; live quality and end-to-end acceptance pending**.

## Integration and contracts

Recovered the clean AI checkpoint `8b38f2e4` from `codex/s9-ai-complete-intent` and integrated it after DURABLE `0ff1f359` and OFFICE `c86bdeb1` as `b63daf0c`. The recovery worktree was read only. Conflict resolutions retained OFFICE academic operations and main's bounded Calendar read, while adding AI's typed wall times, graph and receipt changes. Pre-existing uncommitted W9 recovery/handoff notes were untouched. The earlier AI report named historical pre-recovery commits `bcb7647`/`3d69454`; those objects are unavailable in this checkout, so the reviewed recovery source is the checkpoint diff.

The existing plan and operation journal now stage registered application actions before execution. Calendar aliases normalize once; read tools cannot perform an application mutation outside the journal. Execution rechecks authority, exact operation identity and approval scope, and records distinct handoff, queued, canonical and native outcomes. Request obligations map to final operation indexes, so a single action cannot complete a mixed request. Staged and terminal operations share one dependency graph; dropped duplicate refreshes remap `@created:N` references and obligation indexes, while authored text is not rewritten. The old title-match planner substitution and destination keyword rewrite are gone: exact owned IDs, typed source/target/destination roles and clarification govern mutations. A requested new artifact is not silently turned into an old one.

Reference insertion writes the canonical document or whiteboard through the durable artifact path even with the host editor unmounted. Its placement operation ID is stable across replay; the receipt is checked against the saved version and removed placements cannot be replayed into existence. Stop fences further writes; saved earlier work remains visible as partial completion. Lost acknowledgement is reconciled by saved receipts. Approval and rejection paths retain run/execution scope. Unknown local-file effects do not become an asserted zero-file approval.

Calendar accepts local civil times with an IANA zone, verifies supplied epoch values, and refuses nonexistent or unresolved ambiguous DST times. Native Calendar scheduling still preserves the official source deadline. Explicit navigation and Bridge setup are staged application actions; their UI readiness and local consent remain separate from canonical writes. The existing Follow, manual override, /chat and dock choreography are retained. Relevant numeric attachments require an editable chart or table with numeric values; a labelled shape is not accepted. OFFICE's verified source handle and passage checks remain in the shared document path. These are structural and deterministic contracts, not a claim that generated teaching material is good.

The executable application action matrix covers every currently AI-enabled registered application command plus Calendar aliases, denial at the read boundary, explicit prohibitions and approval rejection. `import_managebac_resource` is explicitly unavailable to AI because its school download path owns provider identity and import receipts; the user can import from the selected ManageBac class shelf. The human import path remains available. No second engine, provider/model/billing change or interface redesign was added.

## Automated evidence

All checks ran against local source with mocks or deterministic fixtures. No stack, browser, configured live AI, provider write, external message or native Office app was used.

| Check | Result |
| --- | --- |
| Focused action, graph, time, reference, quality and loop Vitest | 7 files, 111/111 passed |
| Neighbor target, UI event, registry, Convex Calendar and placement Vitest | 5 files, 54/54 passed |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm run check:capabilities` | Passed |
| `npm run check:architecture` | Passed |
| `git diff --cached --check` before commit | Passed |

Fixtures cover mixed request completion, staged dispatch, duplicate-create dependency rejection/remapping, multiple creates and links, Unicode/duplicate targets, source versus destination, Stop and declined approval, lost reference receipt and host-unmounted insertion, Calendar wall time/DST, numeric chart/table structure and placeholder rejection. They establish contract behavior only. No model/provider/token/read-count/latency comparison was possible without the prohibited live run. No implementation blocker was observed in these checks; live quality remains unknown.

## Finite deferred live acceptance corpus

Run these on integrated served source with normal authenticated Profile A only when live acceptance is authorized. Record source/run/attempt/operation/version IDs, saved and native receipts, exact times, token/read counts and latency. Use disposable fixtures and held-out wording; do not infer success from the first tool or a valid schema.

1. **Study and present:** Give a PDF, small numeric CSV and short brief; ask vaguely for study material and a presentation. Inspect the saved guide and deck for useful explanation, checked values/units, an editable chart or table, and claim-level supporting passages/pages. Repeat with a held-out topic and phrasing. Reload persisted models and inspect DOCX/PPTX/native output independently.
2. **Create and edit:** Create a guide and separate flashcards, then give a vague edit. Exercise a real duplicate-target clarification, changed focus, long/batch choice and reload. Verify preserved attachments and destination B when the source is workspace A and the current destination is B.
3. **Mixed actions:** Update a saved task note and schedule it; schedule two distinct blocks; navigate and then edit/open another requested object. Check every result, exact account-zone wall time, unchanged official deadline and no duplicate artifacts. Move a presentation slide-number heading and verify it never enters Calendar handling.
4. **Authority and references:** Approve one reversible setting change, fixture-backed ManageBac refresh and disposable Library deletion; reject counterparts and exercise undo. Check actual saved effects and unchanged rejected targets. Exercise Bridge's real local consent handoff. Insert references with the host unmounted, reload and inspect the saved placement. Contract-check remaining exposed actions and consequential denials.
5. **Control and recovery:** Steer an active run and inspect changed saved output; Stop the displayed attempt and prove no later old mutation commits. Inject lost receipt/restart after persistence and verify one effect. Check /chat and dock continuation, navigation with Follow off, Follow readiness, manual override and result mounting using existing choreography.

Live educational quality, browser behavior, native Office readback and end-to-end acceptance are **pending**. SDK/package validity or schema checks alone cannot satisfy them.
