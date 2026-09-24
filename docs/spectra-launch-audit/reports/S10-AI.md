# S10-AI — workspace assistant and live acceptance

2026-09-24, Europe/Madrid. Existing primary checkout and inherited S9/W9 changes preserved. **Current status: stable source checkpoint; configured application live acceptance pending.** No staging, commits, branch changes, extra application runtime, database reset, original IBDP1 edits, production changes, billing changes or external messages.

The coordinator owns publication, model environment refresh, integrated build and live slots. At this checkpoint the initial frozen backend was published to the same saved local instance; the web runtime was still being restored. No new AI-created artifact has yet been saved through the application in this lane. The existing `launch-s10-ai` Profile A browser shows an admin/operator session; it is not proof of an ordinary student journey.

## Scope and actual changes

- Primary model requested by the user: `.env.local` uses `openai/gpt-6-luna`; fallback and vision stay `z-ai/glm-5.3-flash`. Coordinator refreshes generated instance config. Served model identity remains a live gate.
- Shared workspace assistant prompt and eight artifact skills emphasize natural conversation, useful defaults, material clarification, complete requests, editable work, substantive teaching content and truthful saved/native claims. Public OpenAI model/prompt guidance, Anthropic prompting/skill guidance and Anthropic's published Claude application prompts were read. No private ChatGPT system prompt access is claimed.
- Attachment evidence uses stable handles, exact excerpts, checked hashes and extractor page offsets. A PDF fixture includes a blank page and misleading literal “Page 99”; text cannot invent a PDF page number. Numeric source requirements reject decorative substitutes for editable data.
- General agent work must finish with a whole-request plan. A focused operation no longer terminates the run by itself, and focus does not narrow the available operation schema for remaining outcomes. Terminal wrapper/transport JSON salvage is retained. Intent validation rejects an extra creation, omitted requested types and missing/wrong explicit destinations. Typed dependency mapping includes linked artifact arrays and indexed/appended paths.
- Clarification orientation retains the authoritative unresolved `activeGoal` and selected answer. REVIEW-AI reproduced that it had been omitted despite remaining present in the gathered context. Generated native citations now refresh when structural evidence refs select another passage; an old generated field does not add its stale passage back into the selection. Both ordinary paragraphs and adjacent table attribution retain the new page after DOCX export/reopen.
- `spectraApplicationWrites.execute` accepts run, execution, operation and exact semantic command/input only. Its fixed internal dispatch cannot be replaced by a caller-chosen function. It checks active ownership, same attempt, executing status, exact scope and same-attempt executed creation dependencies. Required approval is independently enforced for consequential commands and bound to the stored scope. Library/sync local-file consequence is re-read transactionally. Existing domain mutations retain their permission and revision checks.
- The application effect and `applicationWriteReceipt` commit in the same Convex mutation transaction through `MutationCtx.runMutation`. A matching receipt returns the existing result. Both `markExecuted` and `markFailed` preserve the receipt; the latter previously reproduced a real duplicate-folder retry. Settings, Library, memory, sharing, ManageBac and all four enabled Calendar writes use this gateway in journaled execution. Non-journaled legacy Calendar dispatch remains separate.
- Source refs become native Word citations or editable slide citations using server-owned metadata and exact evidence. Bare source handles never choose an arbitrary first passage. Stored source bundles merge previous and current evidence. `spectraArtifacts.attachResearchEvidence` is now an **action**: inline content is inspected inside an internal mutation; offloaded content is read from its authoritative stored object, checked for SHA-256 and size, then its exact content ref is checked again before metadata persistence. The client cannot submit trusted extracted refs to a public mutation.
- PPTX copy export adds editable citation footers and full citations to existing notes, retaining notes and safe HTTP(S) links. This does not establish linked native PowerPoint save parity. Native DOCX copy roundtrip preserves title, page, exact passage and evidence handle.
- Explicit navigation dispatches when Follow is off, including the shell guard. Incidental follow behavior remains governed by Follow. The receipt says navigation was requested, not that the viewport is ready. LiveDock polling depends on the primitive run/thread/status key.

## Current deterministic evidence

These are local source tests, not a served acceptance run. Group counts overlap; they are not a combined independent case total. Commands limit workers and exclude ignored local snapshot copies.

| Current check | Result |
| --- | --- |
| `run-route`, independent `s10-review-ai-mixed-request`, SECURITY `ai-operation-scope-security` | 3 files, 61/61 pass at 14:40 |
| New `ai-application-integration`, lifecycle, source-evidence native DOCX, PPTX citation export, application action contract | 5 files, 84/84 pass at 14:44 |
| Independent continuation/citation tests plus source evidence, context builder and route neighbors | 4 files, 54/54 pass at 14:53 |
| Final citation refresh/native export and independent continuation cases | 2 files, 8/8 pass at 14:54; scoped lint pass |
| REVIEW-AI independent final current-source run | Owner reported 14 files, 91/91 pass at 14:54, including all six independent review files and backend integration/scope neighbors; see `S10-REVIEW-AI.md` |
| Scoped ESLint on plan, act, dock, artifact persistence, gateway/scope, source-evidence and new/main route tests | Pass, no warnings |
| Coordinator's integrated TypeScript before the final stored-citation action change | Coordinator reported pass; final changed-action typecheck belongs to coordinator |
| Earlier attachment evidence fixtures | 7/7 pass, including real PDF page offsets |
| Earlier source/presentation/quality neighbors | 28/28 pass |
| Earlier explicit-navigation/app matrix | 64/64 pass |

The new Calendar test invokes all four real nested handlers, checks Europe/Madrid wall time, replays every receipt, observes one personal event and one work block, retains linked artifact IDs and leaves the source task revision unchanged. Invalid intervals leave neither calendar rows nor a receipt. These are sequential disposable test transactions; they do not establish served concurrent Stop/steer races.

The stored-citation regression initially failed because the offloaded case persisted `citations: []`. It now passes for inline and actual stored JSON bytes, retains old and new evidence, selects the exact native evidence handle and rejects a stale content-ref continuation. Bare source selection still yields no invented citation. The initial Calendar fixture also needed correction to assert links on stored rows and use the domain wire's `id` field; those were test assumptions, not product defects.

SECURITY independently reproduced and owns `convex/ai-operation-scope-security.test.ts`; REVIEW-AI owns the `s10-review-ai-*` tests. Their tests were not weakened or edited by this lane. Current SECURITY cases cover exact and changed scopes, missing/pending/rejected/wrong-attempt/unbound approval, a false confirmation flag, target ownership changes, stale/valid creation dependencies, foreign actor, stopped/superseded/unclaimed runs, and receipt recovery including one actual folder after retry.

## Provider evidence, kept separate from application saves

An earlier direct GPT-6 Luna/OpenAI tool preflight returned HTTP 200 in 1,506 ms with valid arguments. A direct document evaluation using the then-current runtime prompt returned HTTP 200 in 32,979 ms: 2,865 prompt tokens, 3,754 completion tokens and 1,547 reasoning tokens. Its urban-heat content was substantive and the checked differences were correct. It predates the final citation prompt and was **not an application save**. No provider evaluation was repeated during the coordinator's runtime hold.

## Live acceptance still required

Private fixtures and evidence: `.spectra-local/launch-audit/fixtures/S10-AI/` and `.spectra-local/launch-campaign-20260924/S10-AI/`. Runtime slot required before application mutation.

1. Uploaded urban-heat reading + CSV + brief: vaguely request revision material and a short presentation, then inspect both saved editable artifacts, source pages/passages, chart/table values, persisted IDs/versions and reload/native exports. Expected extreme differences: canopy 44 percentage points, surface 7.4°C, air 1.7°C; observational data cannot prove causation.
2. Held-out cooling wording/topic: two editable series; A and B average cooling rates 2.15 and 1.35°C/min; final difference 16°C. Temperature and thermal energy remain distinct; synthetic example stays explicit.
3. Creation, vague edit, duplicate-target choice, changed focus and explicit destination. Mixed task-edit/Calendar requests, two blocks, exact timezone and source deadline. Explicit navigation with Follow off and actual mounted viewport.
4. Reversible approvals, rejection and undo on disposable fixtures; reference insertion with editor unmounted; chat/dock continuation. Exercise enabled application commands within the coordinator's fixture/authority limits.
5. Served Stop, steering and lost-reply recovery with persisted receipt inspection, plus native/visual readback. Distinguish canonical saved, native queued, native verified and viewport ready.

No claim of complete live educational quality, end-to-end acceptance, ordinary-student coverage or production readiness is made at this checkpoint. This task remains active pending the integrated build and finite live corpus.
