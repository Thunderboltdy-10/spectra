# E-02 Single-artifact creation battery

Date: 2026-07-25  
Workspace: Spectra Launch Studio (`r179w7bwrwmk1c5b8jjepw3e0d8aataq`)

## Prompting shift
E-02 prompts are brief/vague (real-user style) to probe placement proactivity — e.g. `make me a quick quiz on mitochondria`, `quiz me on glycolysis`, `flashcards for the Krebs cycle`.

## Defects found during battery

1. **Agent auto-route + confirmation apply failure (Alarming for agent path)**  
   First attempt (agent Cell Biology Study Coach) invented a second unrequested document, required confirmation, then `Apply changes` failed with sanitized "could not safely complete". Ops: create E-02 → `failed`; second create stayed `proposed`. Orphan pending shells left in inbox. Run `ps7526c4v2m40vt6ja7sqjgsa58b4pek`.
2. **Workspace placement ignored (earlier doc path)**  
   Even with Launch Studio focused, some creates used `placement: inbox` / `workspaceId: null`. UI offered manual "Add to workspace". Misleading final copy said ready in Launch Studio.
3. **Quiz create Zod on blank MCQ shell (root cause found)**  
   Default pending quiz content used `options: ["","","",""]`. Yjs baseline seeding called `content.parse` on that shell **before** plan content applied → `questions.0.options` ZodError, empty orphan quiz left behind. Runs e.g. `ps7f5t7qtwy530twk3hce0q45x8b4w6n`. Failure was exposed to the user; plan-level encouragement never ran (apply-time miss).
4. **Vague "quiz me on glycolysis" over-create**  
   Shorthand skipped `provisionalSingleCreation` (no create verb) → general agent loop → two quiz creates with empty `requestedArtifactTypes` → `more visible artifacts` intent failure. Run `ps771y5qb2wwm48zd4fhejcz0n8b5f0c`. Partial quiz shell titled from prompt text also appeared.

## Fixes landed (this continuation)

- Progress UI: removed filler **Preparing response / Responding**; keep authored ProgressTrace only.
- Quiz option coercion + blank-MCQ → short_answer fallback in `content-normalization`.
- Default quiz shell in `convex/spectraShared.ts` now schema-valid (`short_answer`).
- Yjs AI apply: normalize baseline + desired content before validate; awareness `name`/`displayName` = `{owner}'s Spectra`.
- `coerceArtifactContent` normalizes via `normalizeArtifactContent` (repairs old blank shells).
- One-shot quiet apply retry (`Taking another careful pass…`) on repairable create/update apply slips.
- `provisionalSingleCreation` shorthand: `quiz me`, `flashcards for`, `notes on`, etc.
- Duplicate same-type creates quietly trimmed to one on intent mismatch.
- `propose_operation` coerces tags/workspaceId/placement + normalizes content before parse.
- `verifyCommittedOutcomes` now throws on failed content validation.
- Plan encouragement repairable set expanded (intent / more-visible-artifacts).

## Per-type results

### Document — Pass (content Excellent; placement Pass with manual add earlier)
- Thread `qs7brbgkwp77pvn8evermjsb598b535p`, artifact `q574d5g4akne0hr54x5h38zk8x8b5cse` (“E-02 IBDP Cell Biology Notes”).
- Rich tables/callouts/IB sections. Manrope confirmed.

### Quiz — Partial → Fixing → Retest needed
- Vague `make me a quick quiz on mitochondria`: placed in Launch Studio (Quizzes+) but content was empty shell after apply Zod (defect 3). Thread `qs7frhsnfh1kx5hmsc3x5gjbv58b5nvb`.
- Vague `quiz me on glycolysis`: intent over-create fail (defect 4). Thread `qs71bh25ckvxb8zrpfn7t52yyd8b4xqm`.
- After Yjs/default/shorthand fixes: retest pending for a clean vague quiz create with real questions.

### Flashcard deck — Pass (vague prompt)
- Prompt: `flashcards for the Krebs cycle` with Launch Studio focus.
- Thread `qs7d3tg3k156pscje8p9h9m09n8b5e92`.
- Plan: `flashcard_deck`, placement context / workspace-aware; 10 active-recall cards; progress bars authored-only (no Preparing/Responding).
- Yjs connect succeeded without options Zod.

### Remaining types
planner_task, agent, timetable, presentation, sheets, code, whiteboard — pending vague creates.

## Workspace QC edit note
Vague `tighten the intro a bit` with doc open but Krebs thread focus → plan `decision=answer` / zero ops (no edit). Focus hygiene matters for E-03; retest with document-only focus + new chat.

## Live AI / QC UI (workspace) — 2026-07-25 late

Verified in Launch Studio quick chat (not /chat):

- Run strip stays after output (completed tabs retained ~30m + continued/open thread).
- Live thread panel opens on `thread_ready` (reconcile no longer drops brand-new thread-panels).
- Progress traces sticky at top of assistant turn; no repeated Done result cards in QC.
- List chips get `data-card-state=creating|updating` pulse during apply.
- Context focus button: numeric badge instead of purple dot; no continued/working highlight.
- Views: Timeline removed; List / Board / Canvas only. Artifacts grid removed (List+Board).
- Workspace board uses type-column ArtifactCards (artifacts-board language).
- Details collapse frees full width (overlay reopen control).

### Quiz retest (workspace QC vague)
- Prompt: `quiz me on enzyme inhibitors`
- Quizzes 14→15; live strip + live thread + creating pulse observed mid-run.
- Title “Enzyme Inhibitors Quiz”; authored progress only; no Done card spam.

## Reliability repairs — 2026-07-25

Root causes behind recent “failed” QC tabs (not just missing quiet retry):

1. **False fail after successful create** — `verifyCommittedOutcomes` re-validated raw Yjs/storage content and threw Zod even when the artifact was saved. Strip showed `failed` while the library already had a usable object (sheets/code).
   - Fix: normalize via `normalizeArtifactContent` before verify; accept if either normalized or raw validates.
2. **Incomplete response plan** — empty `conversationTitle`/`conversationSummary`/`finalResponse` strings and missing `intent`/`decision` failed Zod after both repair+encouragement.
   - Fix: `coerceCommonPlanSchemaSlips` now nulls blank titles/summaries, synthesizes finalResponse, infers decision/intent defaults.
3. **Whiteboard stall on “Loading the current artifact”** — progress label is from a completed `read_artifact` tool; hang was on subsequent model/tool turns. Hung Convex reads could also block the loop.
   - Fix: agent-loop 20s tool timeout returns `tool_timeout` to the model instead of hanging forever.

Quiet one-shot retry remains the backup; these raise first-pass success so retry is rarely needed.

## Whiteboard retest — 2026-07-25 ~02:10

Vague prompt: `make a whiteboard map of enzyme inhibition types` (new chat, Launch Studio focus).

- **No stall** on “Loading the current artifact” / hung `read_artifact` (creation path now strips discovery tools unless prompt needs a source).
- Mid-create: studio opened with live nodes forming (title, hub, REVERSIBLE/IRREVERSIBLE labels, kinetic legend); progress showed `16 nodes formed`.
- Settled ~1–2 min: strip **Completed** (not Failed). Artifact `Enzyme Inhibition Types — Concept Map` in Whiteboards.
- Thread `qs7f48jrc7texwvkgjqjmmfnps8b6zav`.
- Soft: four inhibitor cards looked sparse in a11y tree; field-level `data-ai-region` probe mid-open was 0 (path plumbing follow-up). Overall **Pass** for create reliability.

## Presentation retest — 2026-07-25 ~02:11

Vague prompt: `slides introducing enzyme inhibitors`.

- Mid-open showed **5** `data-ai-region="true"` while building (AI collab effect working for presentation).
- First apply slipped → strip showed **Taking another careful pass** (quiet retry; no Failed bubble on first miss).
- Settled ~5 min: strip **Ready To Continue**, `Present (8)`, title/summary filled, slides cover competitive/non/uncompetitive/irreversible + summary.
- Thread `qs7107hy8srnzm2b5gbmt16nxd8b605d`.
- Soft: mid-open studio lagged on placeholder “Add a clear idea” / 1 slide until settle; latency Pass-not-Excellent. Create reliability **Pass** (retry backup fired once, then succeeded).

## Sheets retest — 2026-07-25 ~02:20

1. First vague prompt `small sheet comparing enzyme Km and Vmax` **Failed** with intent mismatch (shorthand required `sheet of/for…`; bare `small sheet comparing…` skipped single-create path).
2. Fixes: expand sheets shorthand; align intent to matching single create in `resolveAndValidatePlan`.
3. Retest same prompt: strip **Ready To Continue**, Sheets count 2→3, artifact `Enzyme Km & Vmax Comparison`, `1 actioncompleted`, no `Cannot set properties of undefined`. Thread `qs75hzqxkvz5pb5xzxpn1mkx3h8b6tby`. **Pass**.

## Code retest — 2026-07-25 ~02:23 — Alarming (hollow + fallback rebuild)

Vague prompt: `code a tiny carbon cycle sketch`.

- Mid-open lit **4** `data-ai-region` while building (field effects OK).
- Progress streamed create → `Validating` → `Creating Tiny Carbon Cycle Sketch` → **`Rebuilding the requested code`** (provider fallback path; `SPECTRA_ALLOW_PROVIDER_FALLBACKS` was true).
- Confirmation UI (`Apply changes`) appeared; run cancelled mid-rebuild.
- Library artifact count Code 2→4, but opened source was hollow `<main></main>` / summary “Spectra is building New code.”
- False stop copy risk: “Stopped before the response began” despite visible progress/actions.
- Thread `qs7a9dc8sr4vx22m3ks58mykex8b6r1y`.
- Repairs started: disable provider fallbacks in `.env.local`; cancel copy uses `commitStarted`; hollow-code assert in `assertRequestedArtifactContent`; settle/reliability subagents in flight.
- **Grade: Alarming** until retest produces real SVG/HTML and settles without fallback rebuild.

## Timetable create — 2026-07-25 ~02:33 — Alarming (false success / empty events)

Vague prompt: `make a timetable for enzyme revision this week`.

- Strip **Ready To Continue**, Timetable Items 1→2, chat narrated full Mon–Sat schedule with times. Thread `qs7a9w58p21f18x5qjb99hvb0h8b7mfd`.
- Opened studio: Agenda **“No upcoming events”**, FOCUS TIME 0h. API content: `{ events: [], layers: [school/class/tasks/external], timezone: "America/Chicago" }`.
- Root cause: `sharedTimetableContent` stripped all events placed on private `study`/`personal` layers, finalizing an empty shared calendar while prose claimed success.
- Fixes: promote occupied private layers to workspace-shared when they would otherwise empty the artifact; reject empty `events` on timetable create; unit test `timetable-shared-content.test.ts`.
- Soft: default week window not scrolled to first event week; catch-up AI regions 0 on open.
- **Retest required** before Pass.

## Timetable retest — 2026-07-25 ~02:37 — Pass

Vague prompt: `timetable for glycolysis revision this week`.

- Strip **Ready To Continue**; Timetable Items 2→3; artifact `Glycolysis Revision — This Week`.
- API: **11 events**; study layer retained as `lyr-study-glyc:study:workspace` (promotion fix).
- Studio: range Jul 27–Aug 2, FOCUS TIME **75% / 9h scheduled**, agenda lists glycolysis blocks (Overview, Flashcard Review, Active Recall…).
- Soft: mid-open/catch-up `data-ai-region` still 0 (AI collab depth follow-up).
- **Pass** for create reliability + content.

## Code retest — 2026-07-25 ~02:39 — Pass (latency Soft)

Vague prompt: `code a tiny mitosis phases sketch`.

- Strip **Ready To Continue**; artifact `Tiny Mitosis Phases Sketch`; real HTML+SVG (~8KB) with interphase/prophase/metaphase/anaphase/telophase.
- No `Rebuilding the requested code` (provider fallbacks off); no hollow `<main></main>`.
- Soft: ~7 min to settle while streaming SVG; mid-open `data-ai-region` 0 when studio opened on truncated “Tiny” card; summary lagged on “Spectra is building New code.” until settle.
- **Pass** create reliability; Soft latency / AI-region feel.

## Agent create — 2026-07-25 ~02:49 — Pass

Vague prompt: `draft a tutor agent for cell biology`.

- Strip **Ready To Continue**; `1 actioncompleted`; artifact `Cell Biology Study Coach` (`q573dgw0de4nzxpp74555ex5e18b61z7`).
- Rich profile (audience/inScope/outOfScope/outcomes), routing with examples + negativeExamples, 10 evals, 1 skill; live progress Creating New agent → Building → Validating → Creating.
- Soft: auto-routed chip also appeared on the result card (routing UX overlap with create); instructions field serializes oddly as object in some reads.
- **Pass**.

## E-02 battery status
All 10 types have a Pass create in this campaign arc (doc/deck/quiz/planner/whiteboard/presentation/sheets/timetable/code/agent). Soft leftovers: AI region depth on whiteboard/timetable/code; code SVG latency; older hollow shells left in library.

## Next
E-03 focused edits per type; deepen AI collab effects; then E-04+.



Fixes landed for screenshot defects:

1. **Stuck blue edited/creating traces**
   - Workspace list chips now honour `aiStateExpiresAt` via `useLiveAiExpiryClock`.
   - Artifact cards self-expire edited flash (with `updatedAt` fallback).
   - Conversation result cards no longer permanently use `data-card-state=edited`.
   - Merge prefers cleared server snapshots (incl. interrupted-draft summary) and terminal run status force-clears local chrome.
2. **Side panels adapt in width**
   - `StudioSplitShell` fits against `.spectra-wave-y` peers (not only direct siblings).
   - Dual-open fair-share cap (~52%); removed hard 720/560 clamps when both panels open.
3. **Field-level streaming / catch-up**
   - Mid-open presentation create lit **18** `data-ai-region` controls with `studioAi=creating`.
   - Shared `ai-region-path` helpers wired across quiz/deck/doc/planner/presentation/sheets/code/whiteboard/timetable/agent.
   - Catch-up: `data-ai-catchup` + edited one-shot CSS when opening after settle.

### Presentation create (vague QC)
- Prompt: `create a presentation with 5 slides introducing enzyme inhibitors`
- Presentations 1→2 (“Enzyme Inhibitors: An Introduction”); live regions mid-stream.
- Quiet retry then failed (`incomplete response plan`) — shell preserved as incomplete draft; chrome clear path hardened after fail.

### Sheets create (vague QC)
- Prompt: `make a small sheet of enzyme Km and Vmax comparison data`
- Sheets 1→2 (“Enzyme Km & V…”); mid-open lit regions (initially over-flooded all cells via parent `/sheets/N` matching — tightened to cell-exact paths).
- Dual panels stayed fair (720/480). Failed run cleared creating chrome immediately (terminal-status clear path).

### Code create (vague QC)
- Prompt: `code a tiny carbon cycle diagram sketch`
- Code & Visualisations 1→2 (“Tiny Carbon Cycle Sketch”); mid-open showed **4** field regions with `studioAi=creating`.
- Strip briefly marked failed while draft settled; after overview refresh, AI chrome cleared and summary is a real SVG carbon-cycle diagram.

### Remaining E-02
whiteboard, timetable, agent — still pending clean vague creates. Presentation/sheets soft (created; some quiet-retry/plan fails; drafts kept).



