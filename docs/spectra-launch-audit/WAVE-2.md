# Wave 2 — targeted live testing and contained fixes

Prepared by the parent after reviewing all 17 first-wave reports and integrating selected fixes. Source baseline 1063804d (production app built at 8a04e039; the later source change is test-only). Consult RUNTIME.md for actual readiness and build identity.

## Shared instructions

Read START-HERE.md, WAVE-1-SYNTHESIS.md, REPORT-TEMPLATE.md, RUNTIME.md and your assignment below from the PRIMARY checkout <local-workspace> Read only the relevant earlier reports listed. They contain leads and sometimes overclaims; confirm consequential facts yourself.

All tasks are gpt-5.6-luna at xhigh, actual Codex worktree tasks, not subagents. Do not create more tasks or contact/wake the parent individually. Complete your report and stop; Pablo will resume the parent after the batch.

Source changes belong in your own worktree. Implement clear small defects, read neighboring code and run proportional meaningful checks. Leave harder changes as exact contracts, file/function targets, migration needs, tradeoffs and acceptance checks. Commit your own source changes and report hashes; source tests are not a live test of that patch because the shared runtime remains on the parent baseline. Do not edit primary application source, switch its branch, rebuild it, deploy Convex from your worktree, or restart its services. No final mega-suite or broad refactor.

If your worktree has no node_modules, reuse the primary installed dependencies via a Windows directory junction or explicit tool path; do not spend the task diagnosing absent Vitest/React or install 24 duplicate toolchains. Never mutate shared dependencies via a junction. W2-21 may use an isolated install for deliberate dependency work. Use 1-2 Vitest workers for focused suites. All helpers started with Start-Process must use WindowStyle Hidden.

Browser work uses <local-workspace> Use a unique named session launch-w2-XX, unique profile, and disposable LA-W2-XX artifacts/threads/files. Follow RUNTIME.md's private auth-copy instructions. Never close-all/kill-all, interact with another task's tabs, or print credentials/private student records. Preserve ordinary testing freedom: multiple sessions on one account may show self-collaboration; label it and keep artifacts separate. No resource leases or additional bridge instances. All browser tasks share the one local production app, Convex and bridge. You may create unique fixture mounts; do not reconfigure another task's mount. Record per-session timing/bytes, and label concurrent server noise.

At least one actual end-to-end browser workflow is required for live assignments when runtime/auth permit. Begin that work early; don't spend the whole task collecting source then label browser work a future step. Take meaningful before/after/error screenshots and verify saved target IDs/readback. Trace screenshots to causes. A mock, package parse or AI success sentence is not a live/native Office pass. If an account/provider/platform genuinely prevents a case, record exactly what was attempted and use a bounded harness for additional evidence without conflating them.

Read-only external documentation/configured integration reads are allowed. No external emails/invites/messages, production deploys, paid-plan changes, CI dispatch, or alteration of original IBDP1/recordings. No local database reset or real-content cleanup. No lowlevel-computer-use MCP. Mac workflows must NOT run now. Broad Office editing remains required, with larger architecture reserved for the parent.

Write your rich report only to primary docs/spectra-launch-audit/reports/W2-XX.md; evidence only under primary .shots/launch-audit/W2-XX/. Include exact fixes/commits, current build versus old recording, steps/data identity/readback, passes/failures/limits, and grouped remaining work. Keep private captures ignored. Source ownership below prevents parallel patches to the same feature; cross-owner discoveries are report-only.

## W2-01 — Measured costs and hosting options

Mode: live measurement + source + current primary documentation.

Earlier reports: W1-01, W1-02, W1-13.

Measure the production local build's cold/warm library and workspace navigation, one Office artifact open/edit/reopen, an AI edit, and idle /chat/dock/library activity. Capture per-session requests/WebSocket messages and distinguish browser-returned bytes, database documents/bytes read, storage/egress and Fly compute. Do not claim local browser bytes equal billed Convex I/O or extrapolate whole-server totals from concurrent testers. The root observed a 7.54 GB local SQLite file and about 19.5 GB backend working set during startup; investigate current data shape/retained versions without deleting/resetting it. W1's room projection patch still ctx.db.get's the full artifact: quantify that exact seam. Use existing instrumentation and bounded read-only diagnostics, no dump of private content. Refresh official Convex/Fly/self-hosting prices and operational requirements. Produce a measured/estimated/unknown cost table and ranked fixes/options, including cloud binary storage versus database content and self-hosted Convex reliability/backups. No hosting/storage migration, load flood, spending change or source changes in this task; W2-02 owns simple data-read optimizations. Give the parent a decision-ready comparison, not a price-based recommendation detached from measured workload.

## W2-02 — Unnecessary reads and loading fixes

Mode: source fixes + live network inspection.

Earlier reports: W1-01, W1-02, W1-11.

Trace actual consumers of listWorkspaceContents, listVersions, asset-gallery URL fetches, native-download filename reads and mounted-but-hidden UI subscriptions. Verify full artifact/body data is requested only when needed; inspect parent callers and AI consumers before changing return shapes. Implement contained summary/pagination/skip-query fixes only where existing contracts already support them. Preserve complete discovery: do not silently truncate large workspaces or histories to reduce cost. If changing a return contract requires cursor propagation or a migration, provide the precise contract and consumers instead. Own data-read performance changes (not permanent-delete lifecycle, AI search semantics, shared action routing or import validation). Reproduce useful cases in your named browser and compare requests; source patch isn't live until parent integration. Include large-workspace and closed-panel neighboring checks, not a whole-repo suite.

## W2-03 — Vague AI requests and correct targeting

Mode: live adversarial-but-realistic testing + contained AI fixes.

Earlier reports: W1-03, W1-04, W1-16.

Use ordinary language across library, an open artifact and an older thread: 'sort out my revision', 'make this clearer', 'update the final version' with a different draft open, and an old artifact outside initial orientation lists. Create your own similarly named test artifacts. Follow through to saved target IDs and fresh reload/readback, checking untouched siblings. Reproduce historical apparent edit rollback and final/draft targeting, but do not assume the old recording proves a current bug. Trace orientation limits, lookup/search quality, read failures swallowed as empty data, stale clarification selections and bounded replanning. Implement small discovery/error-result/target-forwarding defects within AI lookup/agent-loop/read tools when behavior is clear. Durable choice-identity or protocol redesign is report-only. Waiting for a necessary user answer is legitimate; infinite retries and ignoring stop are not fixes. Own lookup/target/recovery behavior, not attachment transport or app action dispatcher.

## W2-04 — AI attachments vision steering and retry

Mode: live testing + run-lifecycle source audit/fixes.

Earlier reports: W1-03, W1-16.

Test an image containing a chart/equation, an attached document and spreadsheet, an ordinary vague followup grounded in the attachment, a recoverable failure/retry, a steering message sent while a run is working, explicit stop, and resume. Generate small nonprivate fixtures yourself and inspect actual results rather than taking AI prose as proof. Track whether original attachment bytes survive retries, stale events from a superseded run affect UI/work, duplicate followups create duplicate effects, and the final partial stream event reaches the user after W1's fix. Inspect use-spectra-run, run route/request context, durable metadata and retry assembly. Implement narrow forwarding/cleanup/race fixes with meaningful lifecycle checks where contained. Durable attachment storage and run-supersession schema changes are plans, not incidental patches. Own attachment/run-client lifecycle; W2-21 owns upload/security limits, W2-03 owns target lookup.

## W2-05 — AI research and professional output quality

Mode: live output evaluation + source-backed capability analysis.

Earlier reports: W1-03, W1-07, W1-08.

Ask Spectra to complete two substantial realistic educational jobs without prescribing tool calls: a source-backed research explanation with references, and a polished presentation backed by a spreadsheet analysis/chart. Include a vague improvement request after inspecting the first output. Evaluate factual support, actual source retrieval versus search snippets, citation/source ID binding, calculations, chart labeling/units, narrative quality, visual readability, overflow and exported artifact readback. Use modest fixture datasets and verify results independently. Inspect generated artifacts/screenshots/native package where possible. Trace failed output to prompting, missing tools, source plumbing, renderer/serialization, budget or user ambiguity. Small search/source-result plumbing fixes are allowed; do not edit Office renderer/converter files owned by W2-07/08/09 or overhaul prompts wholesale. Return a concrete 'professional output' acceptance set and smallest pipeline changes, with what genuinely worked.

## W2-06 — Unified actions K-bar and follow mode

Mode: live route/action testing + bounded wiring fixes + precise design.

Earlier reports: W1-04, W1-11, W1-16.

Exercise AI opening artifacts/threads, switching pages, visible follow behavior, human interruption, allowed settings controls, folder actions and ManageBac entry points from library, workspace, settings and /chat. Respect /chat's prohibition on opening a right-side chat panel. Trace missing route dispatchers, insert_reference's reported missing handler, run.openConversation without explicit threadId, z.null application params and executeCommand's immediate boolean/void promises. Implement obvious missing forwarding/handler wiring to an existing safe operation; do not implement the full K-bar or broad dispatcher rewrite. Own application command/dispatcher/router wiring. Produce a concrete shared typed action contract and an action inventory with parameters, availability, target, completion, cancellation, authority and viewport effect. Specify K-bar ranking examples, search+action blending, parameter entry/direct toggles, continue/stop behavior and settings context. AI can guide bridge/setup operations through proper user authority; don't decree all configuration permanently human-only. Explain follow pacing using observed events, not arbitrary global sleeps.

## W2-07 — Word editing and native roundtrip depth

Mode: live browser + OOXML fixtures + format source fixes.

Earlier reports: W1-06, W1-15, W1-17.

Test Word through ordinary import, linked bridge lens, Spectra-created document export and reopened native package. Build/copy your own rich fixtures: mixed fonts including Unicode/East Asian names, bold/italic spans, inline/display OMML, numbered lists, tables/merges, images, links, comments, tracked ranges, footnotes, headers/sections and styles. Prioritize ordinary font/equation fidelity and a meaningful edit adjacent to a rich region; preserved read-only is not completion of the user's editing goal. Use browser screenshots and native XML/readback; native Office automation only on your disposable copies, no lowlevel MCP or original school files. Implement contained font/script serialization, incorrect gating or rich-format forwarding defects inside DOCX lens/document converter/editor ownership. Do not remove preservation guards blindly or write an entire OMML converter in this task. Produce feature-by-feature parse/render/edit/write/undo/merge/AI/readback matrix, exact loss points for the multiple conversion paths, and implementation-ready extensions for broad editing.

## W2-08 — Excel editing formulas and native fidelity

Mode: live browser + XLSX fixtures + format source fixes.

Earlier reports: W1-07, W1-15, W1-17.

Exercise ordinary import, linked bridge editing and exported/reopened XLSX with styled/merged/hidden rows, dates/locales, unsupported formulas with cached results, two-dimensional INDEX, lookup modes, charts, tables/filter/sort, names, validation, conditional formats, multiple sheets and freeze panes. Verify numerical results independently and package changes after edit/reload, not only formula text. Investigate the known cached-result drop in ExcelJS import, hidden-row merge geometry and lookup-mode correctness; implement small obvious fixes with neighboring checks. Do not broaden a formula engine by returning plausible-but-wrong results or silently ignore requested native changes. Own sheets model/import/render and XLSX lens changes; do not edit the hardcoded historical diagnostic fixture test owned by W2-23. Return the broad editing matrix, native operation omissions and coherent feature-extension plan, separating preservation from real editable support. Do not use another tester's workbook.

## W2-09 — PowerPoint editing rendering and export

Mode: live browser + PPTX fixtures + format source fixes.

Earlier reports: W1-08, W1-15, W1-17.

Exercise imported/linked/native-created slides with mixed fonts and run styling, themes/masters/layouts, equations, images, charts/tables, shapes/groups, notes, transitions and animation. Verify slide order against presentation relationships including orphan parts, font resolution across DOM/canvas/export, wrap/overflow and undo/reload. Do not accept exported charts as rectangles or hidden overflow moved into notes as professional-quality equivalence. Implement contained font forwarding, ordering, nested-state or serialization defects inside PPTX/presentation ownership. Do not rewrite the scene model or theme engine wholesale. Report a parse/render/edit/write/undo/merge/AI/native-readback matrix and which extensions need shared package adapters versus editor work. Compare actual screenshots and native bytes from your own fixtures. W2-05 evaluates AI narrative/output, you own renderer/native fidelity.

## W2-10 — Office protocol architecture and operation coverage

Mode: deep source tracing + executable diagnostic harnesses; report-only architecture.

Earlier reports: W1-06, W1-07, W1-08, W1-12, W1-17.

Independently trace the full path human/AI command -> editor/Yjs projection -> native delta -> preserved package -> bridge write/readback -> merge/undo for DOCX/XLSX/PPTX. Inspect command capability matrix, lens capabilities, artifact manifest, source bindings and normal import/export paths together. Find operations offered by UI/AI that cannot produce a native delta or that can return success without changing the intended native region. Evaluate whether current model identities and deltas can support broad native editing, including mixed rich ranges and cross-artifact embeds, without a separate fork. Existing preserve-only matrix policy is historical implementation, not the new product scope. Do not merely weaken guards or demote every feature. Build small isolated harnesses to demonstrate consequential mismatches, but no product source edits across format owners. Deliver a concrete architecture proposal with alternatives, retained interfaces, required changed contracts, migration needs and grouped feature families. Explain how a shared lossless package base could serve imports, new Spectra artifacts, export and bridge, and where that idea fails. Parent makes the decision.

## W2-11 — Office engines standards and connector extensibility

Mode: current primary-source research + installed library inspection; report-only.

Earlier reports: W1-05, W1-06, W1-07, W1-08.

Inspect installed @ariadng/office and actual versioned API depth first, then use authoritative OOXML/Open XML/Office/engine documentation and primary repositories. Compare extending the existing package/semantic adapters with using a mature editing/rendering/conversion engine where useful; cover licensing, hosting/browser cost, offline/local use, collaborative editing, fonts/equations/charts, Mac/Windows and preserving Spectra's action/AI/bridge protocol. No dependency adoption, server install, licensing purchase or CI runs. Avoid generic product recommendations and 'supports DOCX' claims without edit/roundtrip evidence. Identify which missing features the current dependency already supports versus what Spectra omits, and realistic limits of full Office equivalence (including macros/embedded objects) without silently shrinking the requested broad native-editing goal. Assess Notion/cloud connectors only for adapter extension boundaries; Notion remains deferred unless an exceptionally small path is demonstrated. Provide citations and decision-ready tradeoffs for the parent.

## W2-12 — Windows bridge trust and file lifecycle

Mode: live shared-bridge browser + disposable filesystem scenarios + contained core fixes.

Earlier reports: W1-05, W1-13, W1-15, W1-16.

Use the existing one shared bridge, pairing and local backend. Test your own uniquely named files/subfolder/mount: clone-first versus current direct mode, independent Spectra/source folder organization, moving/renaming files, local source deletion, cloud deletion, offline/reconnect, permission preset changes, conflict resolution, native external edits and provider-style temp/lock/placeholder behavior. Never edit original IBDP1 or recording fixtures; copy first. You may create a unique fixture mount; do not clear/repoint the shared bridge or change another mount. Warn/report possible same-account self-collaboration without restricting other testers. Verify actual native bytes, hashes and visible status; scripted provider emulation is not real OneDrive proof. Inspect identity/safe-writer/watcher/sync policy semantics and implement clear small bridge-core defects only. App packaging/startup belongs W2-13. Return a state-transition table covering changing trust/storage policies and source deletion, plus simple browser-first permissions/preset guidance and unresolved architecture decisions.

## W2-13 — Mac packaging and quiet bridge startup

Mode: Windows source/build verification + Mac build preparation.

Earlier reports: W1-05, W1-13.

Windows AND macOS are launch requirements. Pablo has no Mac or Apple Developer account; a friend's Mac will be used at the end. Prepare but DO NOT RUN GitHub Actions, publish releases, sign with guessed credentials, buy accounts or claim Mac runtime verification. Inspect Tauri bundle targets, updater feeds/signatures, hosted production origins/Convex configuration, autostart, credential storage and Unix reader/identity semantics. Investigate and fix the Windows release console/terminal (main currently lacks windows_subsystem attribute), dead tray/embedded actions, Windows-only Mac copy and portable provider tests where obvious. Browser-first setup remains intentional; do not restore routine native-window pairing. Make contained packaging/config/template/workflow improvements with local validation, leaving signing/distribution decisions explicit. Separate unsigned friend's-Mac test artifacts from a frictionless public launch. Own bridge-app packaging/startup/configuration and related browser copy, not bridge-core watcher/sync policies. Provide exact final Mac build/test steps and what cannot be established on Windows.

## W2-14 — Onboarding invitations and class selection

Mode: live ordinary-user flows + auth harnesses + contained UI fixes.

Earlier reports: W1-09, W1-10, W1-13.

Verify invitation-only entry, signed-out/sign-in return, correct/wrong account, expired/replayed invite, school creation/setup and onboarding progression for ordinary users. Students/teachers are peers; do not add teacher-control semantics. Use existing local test identities and convex-test for multi-identity cases where real browser accounts are unavailable; never send external invitations/emails or fake a live account pass. Verify class picker loading/empty/error/current-year selections during onboarding and later edit access, with actual configured personal ManageBac visibility. W2-15 owns live sync/materialization; coordinate by separate artifacts, not global source edits. W1-09's unmerged domain-policy guard needs policy/caller validation, not blind integration. Implement contained onboarding/invitation UI/route fixes; no school-policy redesign or schema migration. Return blocked real-account steps precisely and keep local harness evidence distinct from actual first-user experience.

## W2-15 — ManageBac student sync and useful tasks

Mode: live configured integration + browser workflow; source diagnosis.

Earlier reports: W1-10, W1-09, W1-16.

As an ordinary student, find ManageBac controls without admin pages, inspect/select classes, perform an authorized manual sync of configured educational data and create useful planner/task/calendar work from it. External integration calls must be read-only; do not message people or modify the school system. Use own local task artifacts and sanitized evidence. Check later class add/remove, current academic period signals, archived/deleted classes, sync progress/errors, schedule initialization, source updates, completed task preservation, personal notes/planned times and timetable links. Trace realistic failures to provider capabilities, API responses, account scoping or UI. Do not change shared account-wide selection merely to accommodate tests without restoring it; no extra global runtime restart. W2-16 owns ManageBac source fixes; this task is live evidence and exact implementation requirements, with tiny isolated UI copy fixes only if they do not overlap onboarding/configuration owners. A mocked provider test cannot be called a live sync pass.

## W2-16 — ManageBac isolation and safe guard fixes

Mode: source + multi-account integration tests + selected small fixes.

Earlier reports: W1-10, W1-09, W1-17.

Review held commit 3c905bcc in the git object database/worktree eb23; do not cherry-pick it wholesale. It mixes account-scoped provider-key migration with independent guards. Extract and verify small fixes such as filtering tombstoned memberships and restricting school-wide conflict resolution/visibility to the correct authority. Ensure personal conflict queries include integration scope and cross-school/account lookups cannot attach another person's work. Construct meaningful two-account ingestion/projection/conflict tests and duplicate-delivery tests. Design migration/reconciliation for existing unscoped keys, stable task/calendar source IDs, source-owned versus personal overlay fields, idempotent receipts and scheduling based on actual provider capabilities. Broad key/schema migration, overlay redesign and policy changes remain report-only. Own ManageBac server/ingestion/scheduler source (not onboarding UI); preserve peer roles and do not enumerate student credentials for school-wide polling.

## W2-17 — Shared Office access and peer collaboration

Mode: authorization source + two-identity harness + browser if accounts available.

Earlier reports: W1-12, W1-17, W1-06.

Reproduce the suspected seam where an artifact modify grant permits editing but native replicasForWork/payloadForWork/activateLens remain owner-only. Test owner, same-school peer, read-only peer, revoked peer and foreign-school account across artifact, native payload/lens/media/export and bridge operations. Use two actual browser accounts if available without sending invites; otherwise explicitly use convex-test identities and identify the missing live proof. Determine the exact authority a peer needs to edit shared Office content without gaining another device's private filesystem/credentials. Review domain-restricted public links that cannot resolve viewerDomain; do not substitute client-supplied domain or hostname. Implement only unmistakable small authorization forwarding fixes with negative-neighbor tests; do not broaden ACLs or change sharing policy as an incidental patch. Return a precise capability-scoped shared-Office design and UX outcomes. Do not modify ManageBac authorization owned by W2-16.

## W2-18 — Collaboration durability embeds and selective restore

Mode: live own-artifact collaboration + isolated fault harnesses.

Earlier reports: W1-12, W1-15, W1-16.

Exercise two named browser contexts on your own documents/slides/sheets and embedded references: concurrent disjoint edits, true conflicting edits, offline/reconnect, undo, comments, permission revocation where available, deleted source/container and restore. Same-account multi-session presence is expected, not proof of another real collaborator. Trace durable native log/vector/checkpoint replay to artifact detail/embed convergence; demonstrate crash windows in an isolated in-process harness, not by killing the shared stack during other testers' work. Verify selective restore preserves unrelated regions; avoid whole-snapshot restore as a claimed selective implementation. W1 embed tombstones are integrated; broader retention deletes belong W2-22. Keep disabled Cloudflare provider disabled. Implement contained replay/cleanup/ack defects only when behavior and neighboring projections can be verified. Larger checkpoint/restore protocol changes are concrete plans.

## W2-19 — Overloaded layouts navigation and understandable errors

Mode: live UX testing with screenshots + contained UI fixes.

Earlier reports: W1-11, W1-15, W1-16.

Use the impeccable and playwright-cli skills. Test discovery without knowing K-bar at desktop 1280x800, a wider screen and narrow/mobile layout. Reproduce library/sidebar/expanded folder tree/artifact/comments/search/thread combinations; assess useful editor width, reachable controls, reversible focus changes and recovery when closing panels. Inspect novice tasks like finding an old idea, returning to a thread, understanding sync conflict/status and locating ManageBac controls. Implement small clipping/collapse/misleading-empty-state/focus/copy fixes using existing tokens and components, not a redesign. Distinguish real network errors from 'No chats' and remove AI-facing internal language where a concrete user action can replace it. Own shell/library density and generic error presentation; W2-24 owns /chat-specific behavior, W2-06 action dispatcher, W2-13 bridge setup copy. Return a coherent panel-priority proposal if cross-shell state changes are needed; don't polish every pixel.

## W2-20 — Educational workflows and secondary artifact interactions

Mode: live end-to-end functional testing + small existing-operation fixes.

Earlier reports: W1-12, W1-15, W1-16, W1-17.

Cover the remaining nonlanding surfaces with realistic peer educational work: create/share/use a quiz and an agent, review flashcards, create a planner task linked to calendar, reschedule/complete it, embed a document/chart into another artifact, and smoke whiteboard/code/resource work. Verify creation, reopening, saved content, sharing outcomes, linked task/calendar updates and duplicate action retries. No teacher-supervision hierarchy or broad admin polish. Prefer a few connected workflows over exhaustive secondary-editor cosmetics. Inspect the reported calendar.scheduleTask duplicate insertion and stable event/task source IDs; implement a contained idempotency or field-forwarding fix only if it fits existing contracts, otherwise specify the migration needed. Own secondary-artifact interactions/calendar scheduling, not ManageBac source update code or generic embeds/deletion. Record actual capabilities of teacher/peer creation and gaps hidden by admin-only navigation.

## W2-21 — Dependencies upload bounds and payload integrity

Mode: targeted security source review + meaningful tests + contained patches.

Earlier reports: W1-17, W1-02.

Validate current npm audit findings and exact exploit-relevant dependency paths with official advisories, prioritizing Next, PDF parsing, PPTX and Convex/helper compatibility. Do not blindly major-upgrade or run npm audit fix. You may make clearly compatible targeted dependency fixes using a private install in your worktree; NEVER change the shared junctioned node_modules. Trace Office/AI upload byte limits before arrayBuffer, archive expansion/member limits and finalizer hash/MIME verification versus stronger HTTP paths. Implement small bounded intake/integrity guards with meaningful malformed/oversized/valid controls, keeping attachment transport ownership W2-04 intact. Cross-format parser redesign or major upgrade is report-only. No production probing/deploy/CI. Keep this a focused user-upload/dependency pass, not a speculative compliance checklist. Explain residual limitations and how normal large educational documents remain usable.

## W2-22 — Deletion retention and large-history lifecycle

Mode: source + bounded data diagnostics + narrow lifecycle fixes.

Earlier reports: W1-02, W1-12, W1-14.

Trace artifact/folder permanent deletion, replica/payload/native version/bridge operation/room log cleanup, abandoned imports/uploads and stale projections. Read bounded counts/metadata from the local instance only where useful; do not remove user data, reset Convex, or perform wholesale GC to shrink the test database. Determine which blobs are shared/referenced and which retention contracts are missing. W1 embed tombstones are already integrated; verify behavior survives tree deletion and source/container deletion. Implement small orphan/status/abort cleanup fixes if reference ownership and retries are unambiguous. Large cascades, cursor state/schema and retention policy are precise resumable-job designs for the parent. Own delete/abort/lifecycle paths, not read pagination W2-02 or intake/security finalizers W2-21. Include native offline replica and future local-to-cloud migration consequences.

## W2-23 — Downloads cleanup and portable fixtures

Mode: authorized reversible filesystem cleanup + one test portability fix.

Earlier reports: W1-14, W1-13.

Complete useful cleanup of remaining direct-child spectra-* Downloads folders by reversible archival under primary .backups/launch-audit-downloads-20260908, preserving unique fixture/evidence bytes. Historical references alone do not require a corpus to remain in Downloads: the parent explicitly authorizes relocation, with manifest and current dependencies handled. NEVER touch ai-school, Spectra video captures or non-Spectra folders. Recheck resolved absolute containment, reparse/junctions, live process/mount usage and git worktrees before each move; PowerShell native Move-Item -LiteralPath only, no cross-shell recursive deletion. Don't traverse the node_modules junction or move currently mounted files. The current bridge uses the isolated LA-W1-13 fixture root, not old RC journals. Fix the hardcoded xlsx-run3-materialize-diagnosis.test.ts path to an explicit fixture input or portable controlled fixture, without committing private school content. Keep an old->new/hash manifest and a single fixture index so Office testers needn't chase stale paths; they should otherwise create own fixtures. Preserve active dependencies and report precise remaining blockers, not a blanket owner-approval requirement.

## W2-24 — Full chat and dock experience parity

Mode: live /chat versus dock testing + contained chat-specific fixes.

Earlier reports: W1-03, W1-04, W1-11, W1-16.

Compare /chat with library live dock/right thread using ordinary conversation, reopening an older thread, attachment display, continuing/stopping, streaming tool cards, opening generated artifacts, back/forward navigation and returning after reload. Verify the same durable thread/artifact IDs and readable statuses, with no empty result masking fetch errors. In /chat, never open another chat into a prohibited right-side panel. W1 run-to-conversation handler is integrated; verify visible effect, not just event emission. Implement contained chat-shell/thread browser/rendering defects with adjacent dock checks; do not alter core AI run lifecycle W2-04 or action contracts W2-06. Identify missing shared behaviors and choose existing shared components over duplication. Include keyboard/focus and narrow-screen basic usability, but keep scope functional rather than cosmetic.


