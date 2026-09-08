# Wave 1 — architecture, targeted checks, recordings and local baseline

All tasks: gpt-5.6-luna, xhigh. Primary baseline main 43c45cc5. Read START-HERE.md first.
Confirmed user clarification: Windows AND macOS bridge must support launch. Students and teachers are peers; focus on student use and teacher creation/sharing, school setup and ManageBac. Broad administration UX is out of scope. These requirements override any broader role wording below.
Task/source fixes are isolated; reports live in the primary checkout. This is the first evidence wave, not the final roadmap.
Wait for all tasks before synthesis; do not infer a wave verdict from early finishes.

## W1-01 — Convex and Fly cost model

Report: reports/W1-01.md

Trace the actual production composition, deploy configs, Convex functions, cron/scheduled jobs, realtime gateway, AI callbacks and Fly resources. Identify the dominant current database I/O and bandwidth amplification paths with caller-to-query/write chains, idle subscriptions/polls, content duplication, list/detail projections, indexes, and lifecycle cleanup. Separate historical billing from current measured behavior. Read the historical Convex usage evidence selectively. Verify current official Convex/Fly pricing and self-hosting documentation; produce a transparent scenario model for a small pilot and larger school usage, including units and assumptions, database reads/writes versus file storage/egress, compute and operating/backup burden. Compare managed Convex, supported self-hosted Convex on Fly, and retaining Convex metadata with cheaper object storage; do not confuse a development local instance with a production service or assume storage explains 60 GB I/O. Do not deploy, change plans, migrate data or recommend a winner without tradeoffs and decision inputs. Small fixes ownership: deploy and cost/usage helper scripts only; query source findings go to W1-02. Deliver priority measurements for the next live wave, and the few hosting questions that actually require Pablo.

## W1-02 — Storage and unnecessary data access

Report: reports/W1-02.md

Map payload lifecycle from import/native file to canonical artifact, Yjs updates/checkpoints, projection caches, revisions, embeddings/assets, downloads, retention and delete/restore. Inspect convex/spectraArtifacts, replicas, bridgeSync, resources, gateway persistence and consumers. Trace which navigation/list/closed-panel subscriptions load full content and what can be skipped, paginated, projected or coalesced without losing durability, collaboration or security. Identify server scans, fanout and retries, scheduled activity when no users are active, duplicated binary/base64 bodies and unbounded history. Distinguish proven code defects from production usage hypotheses. Own small scoped source fixes to data-access/projection queries and their focused behavioral checks; avoid redesigning schemas, storage or bridge policy. Discuss each fix's caller and authorization implications. Recommend next live workload windows (empty/large library, idle, edit, bridge, AI) and scalable storage options without deciding hosting.

## W1-03 — AI reliability and work quality

Report: reports/W1-03.md

Map the real run lifecycle, targeting, gather/plan/act/verify/report, model and prompt composition, tool discovery, context budgets, retries, cancellation, steering followups, attachments/vision, web research/citations, and result truth. Follow vague references such as 'fix this', 'make it clearer', 'prepare me for next week', 'finish that deck' through ambiguity resolution and selection. Identify why a run can fail to locate a target, stop prematurely, claim success without work, loop on recoverable failures, or ignore steering. Assess whether recovery can re-resolve/replan with bounded costs and respect user stop/permissions. Assess professional document/research, graph, spreadsheet and slide creation beyond self-scored rubrics; explain which capabilities actually exist. Own small fixes to run loop/context/prompt/lifecycle modules only. Do not invent capabilities, hide errors, retry forever or mask quality with permissive tests. Deliver concrete adversarial browser scenarios for the next wave and a small number of coherent implementation seams.

## W1-04 — Universal actions, K-bar and AI follow

Report: reports/W1-04.md

Inventory canonical application actions, capability IR/catalog, dispatchers, preference schema, app registry and all human/AI command paths. Map action parity: navigate, open/close artifacts/threads, continue/stop a thread, folders/move/delete/restore, comments, settings, class sync, bridge setup/permissions and administration. Trace AI viewport/follow-mode choreography, input disengagement, timing/acknowledgement, stale routes and visible UI targets. Inspect existing kbar use before proposing anything new. Design an extension of the existing protocol into universal search/action UI: artifacts/chats/settings/actions, contextual rank and availability, inline parameters and optional immediate/navigation execution, action results/errors and keyboard accessibility. Explicitly cover '/chat must not open a duplicate right-side chat', active vs continued thread ranking, settings-context priority without excluding library search. Do not implement the full K-bar now; own only small obvious action wiring/derivation defects. Exclude live-dock layout (W1-11) and execution loop (W1-03). Give an exact integration plan and catalogue gaps, retaining one authority-aware action model.

## W1-05 — Bridge architecture and desktop setup

Report: reports/W1-05.md

Map Rust bridge, browser client, replica/truth/policy protocol, native/cloud identity, watcher, journal, claims, conflict resolution, clone/direct edit and local/cloud transitions. Analyze OneDrive placeholders/hydration, rename/move/delete outside Spectra, disappearance versus intentional deletion, remount/another device, local clone organization independent of source, and cloud/local structure choices. Separate preservation, native editing, and rendering limitations and connect to Office lenses. Audit install/pair/update/startup/uninstall UX and simple permission presets with expert overrides. Investigate the accompanying terminal and whether release Windows binary/startup configuration can be fixed cleanly now; do not change the user's actual autostart configuration. Map macOS build/sign/notarization/updater/filesystem/platform support from source and state what cannot be verified on Windows. Assess whether connector abstractions can later support Notion; no new integration or architectural rewrite. Own small fixes inside bridge Rust/app packaging and bridge setup client only; preserve shared protocol guarantees. Leave the shared running bridge and its mounts alone: W1-13 owns runtime setup. Deliver hard compatibility/architecture questions plus specific missing tests.

## W1-06 — Document and Word fidelity

Report: reports/W1-06.md

Inspect current document editor, schema, capability commands, DOCX import/export lens, native projection/merge and untouched-part preservation. Check ordinary fonts/family/size/weight, theme fonts, headings/styles, paragraph/page layout, tables, images, comments, equations (OMML/KaTeX), citations/links, references, lists, headers/footers, sections, track changes and embedded objects. Distinguish displayed, editable in Spectra, roundtrip preserved, native-writable, and unsupported: a preserved XML part is not full functional parity. Build an evidence-based compatibility matrix from code plus targeted real/fixture roundtrips; target simple font/equation failures and destructive fallback paths first. Copy fixtures into your own evidence area before changing any data; the video captures originals and school originals are read-only. Own small document-specific editor/lens/command fixes only; shared projection/IR redesign is report-only. Inspect collision presentation for distracting/excessive blocking and actionable language without suppressing truth. Explain missing neighboring checks and exact next browser/native-package scenarios. No claim of Word GUI verification unless performed; no lowlevel MCP.

## W1-07 — Spreadsheet and Excel fidelity

Report: reports/W1-07.md

Inspect sheets editor/model/engine and XLSX lens/commands/native merge. Map formula functions/cached values/recalculation/errors, references after structural edits, dates/locales, formats/fonts, merges, row/column dimensions, selection/clipboard, charts/images, tables/pivots, named ranges, validation, filters/sorts, freeze panes, sheets visibility and package preservation. Distinguish render/edit/preserve/native-write support. Assess large real workbook loading, sparse storage, virtualized rendering and row/column edits, and formula/graph correctness instead of trusting a harness PASS. Run focused fixture/package checks where valuable. Own small sheets-specific lens/model/editor/command defects; don't change shared protocols or broad storage. Record conflict UX traps and one-direction-only behavior. Deliver a ranked matrix with exact source paths, regressions to guard and next browser/native roundtrip scenarios. Use copies of originals and don't manipulate the shared bridge.

## W1-08 — Presentation and PowerPoint fidelity

Report: reports/W1-08.md

Inspect presentation editor/model/layout and PPTX lens/commands/native merges. Map fonts/theme/master/layout inheritance, text metrics/fit/overflow, equations, shapes/groups, tables/charts/images, slide ordering/notes, transitions/animations, media and embeds; distinguish render/edit/preservation/native writes. Investigate whether advanced AI output can produce usable professional decks and editable data charts. Inspect unsupported/no-op tools, content-update timers, selection geometry, undo/durability and conflict presentation. Use representative fixture/package readbacks with actual semantic assertions; do not infer Office parity from untouched XML. Own small presentation-specific source defects only, not cross-format helpers. Deliver compatibility gaps grouped by root cause, required invariants, and exact high-yield browser/roundtrip tests. No shared bridge manipulation or original file edits.

## W1-09 — Onboarding, invitations and roles

Report: reports/W1-09.md

Map genuine first-person signup/join/request access and school onboarding sagas, invitation creation/expiry/revocation/replay/wrong account, session reload/resume, user projection/membership and role redirects. Contrast student/member, teacher if supported, school_admin and membershipless superadmin. Verify class selection happens for the user's own current ManageBac classes during onboarding and remains adjustable later; coordinate dependency findings with W1-10 report rather than modifying integration logic. Audit UI copy, hidden-page implications, double submits and real backend authorization; a superadmin successful journey cannot prove an ordinary user's experience. Own contained onboarding/invitation flow bugs, excluding shared ManageBac modules and role/security policy redesign. Do not send invitations/emails to real people, create production accounts or weaken access controls to make a flow pass. Return concrete local test account/seed requirements, role matrix, and short browser journeys for next wave.

## W1-10 — ManageBac and schoolwork integration

Report: reports/W1-10.md

Trace identity resolution, credential/capability scopes, polling/scheduling, selected classes, materialization, task/calendar updates, attachments, current vs historical class filtering, resync/idempotency/removal and user-visible failure/recovery. Map user routes accessible to ordinary students and teacher/admin/superadmin differences; expose how the AI can retrieve personal data and create/update schoolwork without requiring an admin-only page. Check strict school/person isolation and stale data truth. Investigate additive changes to chosen classes after onboarding and survival of user edits during external resync. Own small ManageBac-specific integration/query/UI fixes only; don't alter invitation or auth policy. This is map/code phase: defer heavy live ManageBac polling to next wave, use existing data read-only and never write to the external school system. Separate source-supported provider behavior from untested hypotheses, verify official provider documentation if necessary. Return exact targeted live scenarios and payload/cost points, not a broad reimplementation proposal.

## W1-11 — Navigation, chat and usable screen space

Report: reports/W1-11.md

Inventory every non-landing product route and top-level surface (library/workspaces, /chat and live dock, school/data/ManageBac, settings, agents/foundry, memory, analytics, timetable/calendar, profile/account/public sharing), their role visibility, navigation paths and error/empty/loading states. Evaluate common tasks as an unfamiliar student, including recovering an idea, locating a file/chat, editing an artifact with folders/comments/thread open, and understanding controls without the future K-bar. Map shell width budgets, collapsibility, stacked sidebars, responsive overflow, focus/keyboard/touch, font/type-token drift and missing/dead buttons. Compare /chat to live thread/dock functionality. Use the established design system; this is experience/functionality first, no cosmetic perfection campaign. Own small shell/layout/chat-surface/copy fixes; avoid generic style sweeps, artifact editor internals and action registry changes. Use the impeccable skill if doing frontend work. Deliver route coverage matrix (including surfaces not observed), main cognitive overload root causes and exact browser scenarios. Leave live baseline browser/session setup to W1-13.

## W1-12 — Collaboration and connected artifacts

Report: reports/W1-12.md

Map real-time/human/AI/native edit paths and acknowledgement, undo/history/restore, offline reconnect, collaborators and self-presence, share/revoke and embeds with cross-artifact authorization. Trace how calendar and tasks/planner/timetable relate, whether repeated sync creates duplicates, and whether referenced/deleted/moved artifacts and embed updates behave coherently. Cover secondary studios (flashcards, quizzes, whiteboard, code/visualizations and other registered types) for reachable real functionality and integration, with Office remaining the priority. Identify hidden stale/expensive subscriptions, loops, broken lifecycle cleanup and cross-artifact event propagation. Own small collaboration/embeds/secondary-studio fixes only; no shared replica/protocol overhaul. Give practical two-session scenarios and clear warnings about same-account testers appearing as self-collaboration; do not use this as a reason to prohibit normal parallel tests. Separate genuine race defects from testing cross-talk.

## W1-13 — Shared local runtime and browser baseline

Report: reports/W1-13.md

You own the shared local testing runtime and a first Playwright CLI smoke tour. Root began local instance 1 using a hidden node process; inspect .spectra-local/launch-audit/stack.stdout.log and stack.stderr.log, verify readiness independently, recover a routine startup issue if needed without cloud fallback or reset. Shared URLs are http://localhost:3000, Convex http://127.0.0.1:3002, gateway 3001. Inspect the existing isolated bridge journal/mounts without logging secrets; start one bridge invisibly against this local instance, preferably current release binary when provenance is adequate, otherwise build with cargo. Ensure no live original school folder is writable. Use your own session launch-w1-13; the previously saved auth source profiles are .playwright-cli/spectra-session and spectra-session-b. Establish reusable private auth snapshots under .spectra-local/launch-audit/auth/ without exposing tokens; don't reset cookies/accounts or close another session. Verify local Convex endpoint in actual browser requests. Tour library/settings/one Office artifact and /chat, snapshot/screenshots, console/network and actual readiness. If possible prepare disposable artifacts prefixed LA-W1-13 and a mounted test root under .spectra-local/launch-audit/fixtures; never mount/edit video capture originals or IBDP1. Publish a sanitized shared runtime handoff at docs/spectra-launch-audit/RUNTIME.md with mode/build/ports/auth paths/account-role availability, bridge health/journal path/mount safety and exact next-wave setup commands. Other tasks may inspect runtime but only you restart it during this wave. You're allowed contained harness fixes in your worktree; live evidence remains root baseline until integrated. Do not send the parent an early wakeup; finish the report. If login requires Pablo, record exact missing step and continue unauthenticated/read-only work.

## W1-14 — Spectra downloads cleanup

Report: reports/W1-14.md

Clean only obsolete Spectra-related folders immediately under <local-workspace> Inventory candidates first; never touch ai-school, Spectra video captures (including contents), non-Spectra folders, or spectra-landing-complete (active landing work is excluded). Inspect whether each candidate is an active git checkout/worktree, currently mounted bridge folder, reparse point, contains unmerged implementation or unique required corpus, or is referenced by active runtime. Reversibly move clearly stale unmounted verification scratch/fixture folders into <local-workspace> leave active/uncertain folders with a specific reason. Check every resolved absolute source is an allowed direct Downloads child with spectra prefix and destination stays inside that archive before any recursive move. Use native PowerShell Move-Item -LiteralPath, one shell throughout; never cross-shell/string-compose destructive commands. Preserve internal structure and record original-to-archive paths for restoration. Do not change active mounts, mutate captured videos, delete user files permanently or move unknown repositories. Write inventory/restore manifest in your report; source cleanup scripts are optional, no application edits. Inspect source code only as needed for active references.

## W1-15 — Recordings: library and editors

Report: reports/W1-15.md

Inspect all the recent video files numbered 01 through 09, including 04b, in <local-workspace> video captures. Originals are read-only. Use ffprobe for duration/metadata and ffmpeg to extract frames/contact sheets into your own .shots/launch-audit/W1-15/ directory; inspect enough sequential frames and targeted intervals to follow actions, waits, navigation, failures and recovery, not one still per video. Tools ffmpeg/ffprobe and view_image are installed; no lowlevel MCP. Evaluate actual user effort, misleading success, fonts/equations, width/controls, import/edit/reload persistence, buttons that appear dead and what the recording genuinely proves. Correlate strong observations to current source/evidence when useful; avoid assuming recorded build equals current main. Cover library list/board, nine types creation, move/rename/share, resource citizens/math EE import, document/sheets/deck editing, non-Office studios and undo/status. Provide per-video timestamped observations, short useful frame links, confidence and follow-up live scenarios. No app edits in this recording-only task and no claim to have watched unexamined intervals. Do not inspect landing video 25.

## W1-16 — Recordings: AI, bridge and school

Report: reports/W1-16.md

Inspect recent video files numbered 10,11,12,13,17,18,19,20,21,22,23,24,26 in <local-workspace> video captures. Exclude 25 landing entirely. Use ffprobe and ffmpeg, preserve originals; extract contact sheets plus dense targeted frame sequences to .shots/launch-audit/W1-16 and inspect them with view_image. Follow AI work timing/targeting/quality and whether app opens the result, library organization, bridge pair/mount/roundtrip/toggles, ManageBac/agents/planner/settings-offline/admin journeys. Evaluate intelligibility, navigation, misleading success, flicker/collisions, manual setup friction, and what videos fail to prove. Correlate important observations with current source without assuming the recording matches current HEAD. Report timestamps, evidence links, confidence, exact frames examined and high-value next live experiments. No app edits or lowlevel MCP. Do not send parent interim wakeups.

## W1-17 — Launch safety and surface completeness

Report: reports/W1-17.md

Perform a targeted educational production audit across authorization/tenant isolation, artifact shares/public/embeds, invitations, attachments/uploads/imports, AI tool authority, privileged APIs, bridge trust boundary and ordinary-vs-superadmin roles. Map deployment prerequisites, runtime secret handling, callback auth, dependency/config risks and missing operational recovery/retention boundaries. Confirm every non-landing route/feature has an audit owner and identify overlooked user-facing functionality (agents/foundry, model/settings/billing if present, attachment vision, steering, legal/account lifecycle). Base findings on concrete exploitable/data-loss or user-blocking paths, not generic checklists. Don't expose keys, send emails, hit production mutations, deploy or change access policies speculatively. Own only clearly safe contained guard/validation fixes in otherwise unowned API paths; shared auth policy or schema changes are report-only. Return ranked verified risks, exact code/negative-check evidence, cross-cutting launch prerequisites and a compact checklist of missing live tests.
