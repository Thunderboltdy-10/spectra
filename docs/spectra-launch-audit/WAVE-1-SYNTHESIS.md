# Wave 1 synthesis and integration decisions

Parent review, 2026-09-08. This is an intermediate assessment, not the final launch roadmap.

## Direction confirmed by Pablo

- Windows and macOS at launch. No Mac or Apple Developer account currently available. Prepare the Mac build path; do not run GitHub Actions. A friend's Mac is reserved for final executable testing.
- Broad native Office editing is a launch requirement. Byte-preserving read-only regions alone do not satisfy it. Do not shrink this to a fonts-only MVP or simply hide unsupported commands.
- Student and teacher capabilities are peer-oriented. Keep creation/sharing, onboarding, invitations, school setup and ManageBac; skip broad admin polish and landing.
- Continue fixing small, evident defects now. The parent reserves harder changes, migrations, hosting/storage decisions and the architectural synthesis.
- Dispatch a whole batch of Luna xhigh tasks, then stop until Pablo asks to continue. No per-task wakeups.

## Review basis and confidence

All 17 first-wave reports were read in full; actual source changes were reviewed before integration. Source findings, focused tests, old recordings and current live behavior remain different evidence classes. Recordings suggest useful reproduction targets but do not establish current build failures. W1-13 established a signed-in session displaying student and an isolated shared bridge. The parent's wave-2 walkthrough corrected the role inference: this same session exposes Super Admin via the platformOperator flag, so it is not ordinary-user authorization evidence. No actual Mac, second-user browser collaboration, or broad native Office visual readback was proven in that wave.

The existing system has substantial foundations: scoped authorization, signed bridge requests, durable AI runs, staged operation verification, reactive collaboration, native package preservation, command registries and layout priority rules. The launch work should extend those foundations rather than replace the app wholesale. Several failures appear at boundaries between these existing components.

## Integrated changes

Primary baseline before this audit: 43c45cc557942ccfb4f806092a61b6950dcdf2f3.

| Area | First-wave source | Integrated commit | Result / limit |
|---|---|---|---|
| Room loading | e424d7ce | 2e4909e2 | Avoid serializing the full artifact projection into routine native room loads. Legacy initial bootstrap explicitly requests it. This reduces response traffic; the store still reads the artifact document, so it is not a demonstrated database-I/O fix. |
| AI run streams | 3c8c2ec2 | 9f000048 | Preserve final unterminated SSE/NDJSON events; handle malformed mixed terminal/mutation tool turns with structured feedback and prevent unverified mutations. |
| Application actions | 60674967 | 4b4bc9d4 | Correct workspace/library surface classification, readable account action availability and /chat run-to-thread routing. This does not complete the universal action system. |
| Bridge | 9815617f | d21de3ac | Unix identity uses device/inode instead of file length; provider-folder recognition and browser pairing/update timeouts corrected. Unix identity is source-assessed, not Mac-tested. |
| Word | aabf214e | 1541495c | Preserve native comment anchors by refusing unsafe flattening of their ranges. This is a data-loss guard, not new comment editing support. |
| Sheets | c7d91db0 | 2cc2efc3 | Re-evaluate formula support after changes, correct two-dimensional INDEX, merge independent freeze-row/column changes. |
| Slides | f9cccf7e | 58b75edb | Follow presentation relationship order, isolate nested theme/style undo state, resolve known semantic colors in export. Broader render/import/export parity is still open. |
| Shell | 1af35262 | 7bec662c | Platform-correct search shortcut hint. |
| Embed deletion | selected files of 3718bbda | 8a04e039 | Tombstone incoming/outgoing embeds and cancel pending access requests when an artifact is deleted. Larger deletion/retention cleanup still needs design. |
| Join flow | selected uncommitted W1-09 UI change | 8a04e039 | Disable acceptance when invitation preview identifies the wrong signed-in email. Server domain-policy change was held. |
| Baseline checks | parent | 8a04e039 / 1063804d | Supply required reminders in a planner fixture; remove an unused type; use a semantic presentation theme test fixture. |

Validation in the complete primary toolchain:
- 13 focused suites / 225 tests passed: AI agent loop and streaming, collaboration gateway, capability IR/dispatch, DOCX lens, sheets operations, three-way merge, XLSX/PPTX lenses, presentation I/O/model, work-type interactions, embed deletion.
- Changed TypeScript/TSX/MJS files pass ESLint with zero warnings after correcting one new test fixture.
- Architecture and capability IR checks pass. Their coverage is limited: registry existence is not proof of an executable end-to-end action.
- Local instance-1 production Next build passes, including TypeScript. Built at 8a04e039; 1063804d changes only a test fixture.
- Three provider-related Rust tests pass on Windows; release bridge build passes. Platform-filtered tests select zero tests on Windows because the identity regression test is Unix-only; do not count those invocations as platform validation.

## Changes deliberately held

- W1-10 / 3c905bcc mixes useful ManageBac guards with account-scoped provider-key migration. Existing unscoped data, projections, reconciliation, repeat receipts and links need a migration story. Its focused test does not prove two-account ingestion/migration safety. Extract independently safe guards in wave 2; retain the harder patch as evidence.
- W1-09's school-domain invitation restriction is not accepted just because the UI copy suggests it. Check existing policy and bootstrap/invitation paths before adding policy behavior.
- W1-12's Cloudflare realtime changes were not integrated. That provider is disabled; the patch still warrants message/socket/revocation analysis. Keep the active Hocuspocus path in focus rather than opening an optional provider project.
- No hosting or storage migration, schema-wide rewrite, permission-default change, K-bar implementation, or Notion connection was made.

## Connected findings and the questions wave 2 must resolve

### 1. Office capability is fragmented across representations

The three formats have native package lenses, Spectra editor models, ordinary converters and export code with different capabilities. DOCX ordinary export rebuilds from much simpler content; native edits preserve more but lock broad rich ranges. Sheets may show a cached/unsupported formula incorrectly or display edits that never become native operations. Presentation DOM, canvas and exported objects do not consistently resolve the same fonts, layout or chart semantics.

Source inspection also found capability-matrix rules that declare some regions permanently preserve-only. Those are old implementation policy, not an immutable product decision after Pablo's broader requirement. Merely removing guards would risk loss. Merely retaining guards would not deliver the requested editing.

Working hypothesis to investigate, not an approved rewrite: keep the original package and stable semantic identities as the lossless base; evolve format adapters and editor projections together; send human and AI changes through the same typed operations; verify changed native regions and preserve unrelated regions; reuse the same representation/serialization boundary for import, bridge sync and export. Native Spectra creation also needs a coherent route to a real package. A collection of independent converter patches cannot establish this by itself.

The next tasks must enumerate feature families across parse, render, edit, native write, merge/undo, AI access and native readback, including fonts/scripts, equations, tables, lists, references/comments, layout, spreadsheet formulas/charts/data tools, slide themes/masters/media/animation. They must distinguish adapter extension, editor-model limitation, library limitation and platform limitation. External engine/library options may be researched, with licensing and protocol/collaboration consequences, but not adopted by a child task.

Broad native Office editing and a small final implementation pass may be in tension. The parent must make that visible once the feature map is concrete, rather than promise complete Office equivalence from preservation tests.

### 2. AI reliability, navigation and K-bar share an incomplete action boundary

Terminal streaming has a bounded fix. Larger issues connect discovery, target identity, typed operation parameters, durable attachments, retries/steering and a meaningful completion acknowledgement. Limited orientation lists and swallowed read errors can make a vague request appear impossible. Separate application-tool, dispatcher and route-host definitions allow registered actions that cannot execute on a given page.

A unified action contract should eventually drive app controls, AI offers and contextual K-bar actions. That contract needs parameter schemas, availability, authority, target identity, progress/completion, cancellation and viewport effects. It must preserve /chat restrictions and human interruption of follow mode. Some AI operations can remain richer composites over the same primitives.

Test ordinary vague requests and actual saved output, not only precise prompts that name tool IDs. A displayed success card is not durable edit verification. Waiting for a genuinely necessary clarification is not a failure merely because an old recording waits for two minutes. Do not solve reliability with infinite retry or by ignoring explicit stop.

### 3. Cost and responsiveness need operation-level attribution

Full workspace detail reads, long histories/log collections, reactive invalidation, background polling and repeated projections matter alongside binary storage. The reported 60 GB is database I/O, not proof that file hosting alone caused the bill. The current room-load patch illustrates the distinction between database bytes read and bytes returned.

Measure the production local build for browser payloads, subscription behavior, cold/warm navigation and idle activity. Map database reads separately using source/instrumentation and representative data. Concurrent whole-server measurements are not a per-user estimate. Historical cost models are scenarios, not forecasts.

Keep Convex Cloud versus self-hosted Convex/Fly/object storage as an explicit decision after current bottlenecks are quantified. Self-hosting adds backup, recovery, upgrades and availability responsibilities. No production topology is deployed yet; that fact alone is not a discovered product failure during a predeployment audit.

### 4. ManageBac needs user-scoped identity and durable personal overlays

Account/provider key collisions, stale memberships, conflict visibility and source/task linkage cross ingestion, projections, permissions and scheduling. A class-selection dialog alone cannot establish selective sync correctness. Source refresh must preserve a student's completion state, notes and planned time while updating official facts.

Inspect actual configured capability support before assuming personal credentials can schedule a school-wide sync. Verify onboarding and later class changes for an ordinary student, current academic periods, deselection/removal, duplicate callbacks and delayed refresh. Do not infer current year from a guessed name or add teacher control semantics. School setup and invitations remain necessary even with broad admin UX excluded.

### 5. Bridge trust, collaboration and delivery form one lifecycle

Clone/direct-edit policies, independent folder organization, provider placeholders, deletion, conflict handling and account-scoped shared Office access interact. Office replicas/payload endpoints may be owner-only despite a modify grant to the artifact. That needs capability-scoped collaboration design; sharing a local device credential or broad local-file access is not the solution.

Hocuspocus has actual authorization checks. More important launch questions include replay/checkpoint convergence, stale artifact projections after a crash, selective restore affecting unrelated regions, idempotent task/calendar links and embed deletion/retention. Existing delete transactions are not a complete garbage-collection design.

Windows startup should not show a console. Browser-first bridge setup is intentional; do not restore routine native-window confirmation based on older recordings. macOS packaging, configured hosted origins and real filesystem semantics need explicit work. Prepare Mac artifacts/workflows without executing them now.

### 6. Usability needs coherent space and discovery, not a visual overhaul

The crowded library/folder/editor/comments/thread scenario is plausible. Existing local width rules do not necessarily coordinate route-level panels and the shell. Verify that a person can locate material, recover from an error and keep meaningful editor width without knowing K-bar shortcuts.

Prioritize dead controls, ambiguous outcomes, internal jargon, misleading empty states, clipped essential actions and loss of work. Do not spend the wave polishing every visual inconsistency. /chat and live dock should share the same meaningful capabilities.

## Wave 2 objective and stopping rule

Use many focused tasks with distinct ownership and a substantial live-testing component. Each task reads only the relevant first-wave reports plus this synthesis, follows through to cause/readback, implements clear small fixes, and returns concrete remaining contracts and neighboring checks. The parent reads the complete batch together.

The intended final roadmap groups connected work into a few substantial implementation packages with verification embedded in each. Do not recreate spectra-reformation's large serial certification tail. Additional investigation is justified only for a consequential unresolved question, not to chase every cosmetic issue.
