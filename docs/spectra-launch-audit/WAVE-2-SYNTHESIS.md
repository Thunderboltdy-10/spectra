# Wave 2: parent synthesis and next decisions

This synthesis follows reading all 24 full reports, reviewing the source patches, resolving overlapping changes, and testing the combined source. Individual report recommendations are evidence and proposals; they are not automatically the implementation plan. The reports and the original video evidence remain preserved.

## What the evidence establishes

Spectra already has substantial working infrastructure: capability checks, canonical artifact models, Yjs collaboration, retained native packages, a bridge journal, revision checks, shared commands, school integration contracts, and real educational artifact behaviours. The most consequential gaps occur where these systems meet. Replacing them wholesale would create another reform instead of finishing this one.

Several reports describe successful harnesses beside failed live attempts. Many live attempts stopped when local Convex disappeared. Those attempts are **incomplete and must be repeated**, as Pablo explicitly confirmed. An authenticated shell, cached Bridge Connected label, unit test or screenshot of a proposed edit does not prove persistence. The repeat batch must use healthy local Convex and read saved work after reload; native saves additionally require file/package readback. A real second ordinary sign-in is still needed for browser proof of peer authority. The reusable audit sign-in is an operator despite its student label.

## The connections that determine the roadmap

### 1. Office fidelity is a convergence problem

Native linked editing starts with a retained package and a narrow set of lens operations. Ordinary import/export often reconstructs a separate representation. AI and human editors can express another, larger set of changes. A font fix in one writer cannot repair the other exporters, and a chart in editor state does not prove that a native chart part exists in the downloaded workbook or presentation.

W2-07/08/09 show these divergences in DOCX, XLSX and PPTX. W2-10's mismatch harness is useful, but its direct projection edits must also be checked against reachable command gates before calling each case a user-facing no-op. W2-11 shows unused capabilities in the existing Office library. We should exploit those APIs and extend the current adapters before introducing an Office server with another save authority, operating cost and collaboration model.

The target is one operation contract with format-specific writers: resolve a stable target against the retained package; declare the capability at that target; apply an operation; read the resulting semantics; compare preserved parts; bind the proof to the resulting package hash. Keep Yjs, the existing operation ledger and bridge journal as their current authorities. Do not add a second canonical operation journal merely because a report proposes one. The bridge can verify that the bytes it actually wrote have the server-verified hash; it does not need a complete Word/Excel/PowerPoint parser in Rust to repeat the same semantic proof.

Ordinary import, newly created Office artifacts, export copies and linked writeback must share adapter primitives and capability descriptions. They need distinct save destinations and retained-base handling, not unrelated lossy conversions. DOCX rich spans/equations, XLSX non-cell features/formula caches, and PPTX rich text/charts/layout need individual implementation slices under that contract. Broad editing remains the launch goal. Merely hiding unsupported buttons or preserving an uneditable original does not satisfy it. Exact equivalence with every Office application feature cannot honestly be promised by a compact pass; feature-family acceptance must identify native editing, meaningful equivalent, Spectra-only extension, preservation and remaining unsupported cases explicitly.

### 2. AI reliability, K-bar and orchestration share action identity

Clarification presently loses structured candidate identity, follow-ups can lose the uniquely created target, attachment retries lose their inputs, and visible progress can become detached from the durable attempt. Rewording prompts alone will not fix these boundaries. A useful clarification must retain its request/choice/target IDs and revision, and a resumed attempt must retain authorized inputs and its operation identity.

Build the contextual K-bar on the existing Command/capability infrastructure. Human and AI actions should converge on typed parameters, current availability, authority and observable outcomes. Extend that contract rather than creating another registry with a similar action inventory. Browser navigation acknowledgement, data mutation acknowledgement and verified native save are different outcomes. A router push or an event emitted into the bus is not proof that the intended surface mounted.

Ranking should use current route, open work, thread context and availability, while global search remains available. Separate conversational continuation preference from resume-after-input, retry, stop-run and stop-following. `/chat` must retain its intentional restriction against a second right-side chat. Parameterized actions can open a compact input step; immediate toggles should stay immediate. Manual interaction should interrupt follow choreography without cancelling unrelated durable work.

Vague requests require target reasoning, not aggressive guessing or endless retries. Waiting for a meaningful clarification is a legitimate state. Temporary reads should be retried within a budget; permission failures, ambiguous targets and incompatible operations require the appropriate next step. Source-backed research needs retrieved evidence bound to citations and committed content. A progress card or placeholder document cannot count as the finished output.

### 3. ManageBac and Calendar need stable source identity plus personal intent

Provider identifiers are reused across accounts, integrations and academic periods. Personal source rows and derived projections must preserve those scopes. The W2-16 guards close several boundaries, but the raw route key still requires a migration design; a test that pre-scopes its own fixture keys does not prove that route is fixed.

Class selection must control actual detail polling and materialization, not merely the creation of workspace shelves. Start with the minimum membership/class catalogue, let the student select classes, and fetch/update the selected scope thereafter. Changing selection and academic period must preserve deliberately retained work and clearly stop unwanted polling. Unknown provider period information should be visible rather than guessed from a class title.

Source facts and personal work need separate ownership. Official deadlines remain source-controlled; completion, notes, reminders and personal scheduling survive provider refresh. A completed plan task should retain scheduled blocks as understandable history with completion derived from the task, rather than resurrecting active work or silently deleting the history. The implementation must use the existing collaboration writer for plan content. Class resources should import through an authorized, on-demand path, not automatically turn every external attachment into cloud storage.

Normal students need discoverable ManageBac access, readable sync progress/errors and recovery actions appropriate to each conflict kind. School setup remains necessary; broad admin polish and a teacher-supervision hierarchy are outside scope.

### 4. Cost, loading and deletion share data ownership

The measured shared deployment windows contain many simultaneous testers and bridge calls. They cannot be converted into a per-user cost forecast. However, the call attribution clearly prioritizes large thread reads, board-column hydration, run event appends, bridge payload metadata and projection checkpoints. Response allowlists save transfer but do not stop Convex from reading a large row. Slim indexed metadata, bounded history, coalesced reads, selective hydration and smaller frequently updated records come first.

Deletion currently has multiple entry points with different descendant cleanup. Orphan replicas/requests can retain payloads; large histories can exceed a single transaction. A resumable owner-object deletion operation should close claims and pending work, page through descendants, and release storage only after proving references are gone. Removing a collaborator's placement must remain separate. Physical local-file deletion remains an explicit Bridge policy; cloud deletion must not silently recreate work when an offline replica reconnects.

Upload finalization belongs to the same ownership model. The held W2-21 patch usefully checks size/digest/type, but `patch/delete; throw` inside a Convex mutation rolls those effects back. Candidate cleanup also must not allow a caller to delete somebody else's stored object by supplying its ID. Declared ZIP sizes are only a preflight, not an enforced bound on actual decompression. These issues need a transactionally sound upload receipt and bounded parsing path before the intake audit can be called closed.

No storage or hosting migration has been selected. Current published prices distinguish database I/O from file storage and egress; moving large immutable native packages/assets may help, but moving the same chatty database to Fly does not remove its reads or operational obligations. Compare optimized managed Convex with a concrete self-hosted deployment (persistent data, backups, restore, memory, monitoring and availability) before deciding. A local development backend process is not by itself a production self-hosting plan.

### 5. Bridge trust and platform safety are separate from packaging

The Windows console subsystem fix and manual Windows/Apple Silicon/Intel packaging workflow are accepted preparation. The retired Intel runner label was corrected using GitHub's current runner inventory. No Actions workflow was executed. A friend-test unsigned package is not proof of public Mac distribution or native-save safety.

The Unix implementation still needs careful stable-file reading and write-race handling; Windows sharing locks do not transfer directly to macOS. Use the existing grant, provider, filesystem identity, journal and revision contracts. Source copies, clone folders, linked originals and cloud placement must retain separate identity even when a user chooses synchronized organization. Provider moves, hydration, deletion, offline reconnect and a source changing during queued write need targeted cases. Prefer understandable policy presets with advanced overrides and browser-first setup; keep one shared bridge for live testing.

### 6. Panel density is a shared allocation problem

The existing local workbench allocator is a useful base, but route-side panels and global surfaces can escape its width budget. Extend ownership across the shell: primary content must remain usable, expensive secondary panels need a clear priority, and narrow screens need one appropriate modal surface with focus return. Desktop docked chat remains non-modal so a user can work in the artifact beside it. Do not impose a desktop focus trap as an accessibility fix. Keep ordinary navigation and visible retrieval useful without requiring knowledge of the K-bar.

## Accepted changes and integration adjustments

| Source task | Disposition |
| --- | --- |
| W2-02 | Workspace summary responses and duplicate native-read removal accepted; parent additionally skips last-run fetch for summary reads. Database row splitting remains open. |
| W2-03/04 | Honest read failures, attachment retry guard and exchange-specific stop cleanup accepted. Durable attachment replay and target identity remain open. |
| W2-06 | Shared dispatcher wiring and awaitable command entry accepted; complete viewport acknowledgement remains open. |
| W2-07/08/09 | DOCX Unicode script fonts, Sheets formula caches/lookup modes/merged height, and presentation font propagation accepted. Broader conversion and rich editing remain open. |
| W2-12/13 | Recycle replay and desktop packaging preparation accepted. Mac safety/runtime/signing are not claimed passed. |
| W2-14/15 | Invitation auth return/expiry handling and role-appropriate ManageBac copy accepted. Preview retry and connected onboarding need live repeat. |
| W2-16 | Account/integration guards accepted; parent keeps personal reads indexed by account to avoid taking a school-wide page before filtering. Canonical source-key migration remains open. |
| W2-17/22 | Shared native authority, private owner-local path filtering, deletion/revocation guards and Trash embed tombstones accepted together. Deletion wins before revoked-access terminalization, clearing stale payload references. Full lifecycle remains open. |
| W2-18 | Selective native restore accepted. The diagnostic test asserting the known stale-checkpoint bug is held as evidence rather than an acceptance assertion; a repair task follows. |
| W2-19 | Responsive navigation and chat-browser truthful errors accepted; the repeated live narrow-layout test must verify actual fit. |
| W2-20 | Calendar caller-key replay accepted; parent scopes AI keys to a model execution so later identical user intents do not dedupe accidentally. Plan/Calendar completion remains open. |
| W2-21 | Entire commit held for bounded-intake and transactional cleanup repair. Production advisories are unresolved. |
| W2-23 | Explicit XLSX fixture environment path accepted. Reversible Downloads archive already completed. |
| W2-24 | Generic browser errors already covered by W2-19. `/chat` error changes require selective integration; unconditional desktop modal/focus changes held. |
| W2-01/05/10/11 | Reports and diagnostic evidence retained; no product-source commit to integrate. |

Combined validation so far: 242 focused tests across 20 suites pass (one integration query adjustment was corrected and its four-test suite rerun); changed-file ESLint, architecture, capability and copy checks pass. Production build and live runtime handoff are recorded separately after completion. No production deployment or cloud billing change has been made.

## What happens next

1. Establish healthy local Convex, build the combined source and complete a parent browser persistence check. A running CLI PID is insufficient. Preserve the existing database.
2. Repeat **every** interrupted live workflow, grouped into a bounded batch rather than another general source audit. Include actual saved results, native file evidence, vague AI tasks, mid-run steering, uploads, normal-user access where a real sign-in exists, secondary educational workflows and panel overload. Tasks may implement small fixes in owned areas and must distinguish worktree code from the shared runtime.
3. Repair the remaining clearly bounded issues: Sheets non-cell persistence, projection checkpoint recovery, selective chat error handling/narrow layout, simple ManageBac presentation failures and dependency patch alignment. Hold new protocol/identity/storage designs for manual complex tasks.
4. Read that entire batch together. Then issue a small number of exact manual implementation prompts, with concrete files, contracts, failure cases, dependencies and acceptance checks. Likely packages are Office operation/conversion convergence followed by format slices; AI/action/K-bar orchestration; ManageBac identity/selected sync/personal overlays; and data cost/lifecycle/intake. These are a dependency map, not permission to auto-launch complex changes now.

The extra live evidence is necessary before freezing those prompts. Each implementation slice should include its own neighbouring checks and short browser/native readback. The final pre-deployment check should be a compact integrated smoke plus the reserved friend's Mac run, not a new reformation or an unlimited polishing phase.

## Current external references

Verified 2026-09-09: [Convex pricing](https://www.convex.dev/pricing), [Convex limits and I/O definition](https://docs.convex.dev/production/state/limits), [Fly resource pricing](https://fly.io/docs/about/pricing/), and [GitHub runner image inventory](https://github.com/actions/runner-images). Prices and runner availability are time-sensitive; recheck before release decisions. No per-user bill or production capacity number is inferred from the local test database.
