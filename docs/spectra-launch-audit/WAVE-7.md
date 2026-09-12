# Wave 7: finish connected workflows, then integrate and exercise them

2026-09-11. Parent read all ten W6 reports and both S6 reports, inspected their product diffs and traced the important consumer boundaries. No environment work or product patch was performed by parent in this review. Findings below are source evidence, not newly executed failures. Preserve the useful implementation; fix the named gaps rather than restart the architecture or repeat a broad audit.

## Progress that is actually on main

Main product head is bd40997b5d3ea17368e3e7ba35b3d9745812197d. W6-00 integrated W5 history/results, trusted source retrieval, parser bounds/Office/PDF compatibility, Bridge polling/wake, and narrower read corrections. Prior W4 collaboration, Sheets, sharing/navigation fixes and the Clerk factor-route repair 00c6bdc4 remain. W6-00 reports 135 focused tests plus Bridge checks; the shared local Convex functions started, but its browser evidence ends at sign-in. That is not authenticated workflow acceptance.

W6/S6 candidates now contain trusted streaming intake and canonical import checks, deletion workers, shared richer DOCX/XLSX/PPTX writers, native charts, equation generation, selected ManageBac sync, K-bar/readiness, research/attachment retention, browser Bridge presets, hidden startup and Mac packaging configuration. Their focused suites are useful evidence; their counts overlap and must not be summed into a combined pass. Most of this work is still private.

## Exact source lineage

| Source | Product commits / candidate |
| --- | --- |
| W6-01 intake | fe93cfb2 |
| W6-02 lifecycle | 3ad39842, 9bdb332a |
| W6-03 DOCX | 2bc8181f |
| W6-04 XLSX | d6fc5dab, 2cbb5be3 |
| W6-05 PPTX | 0fd8a8db |
| W6-06 ManageBac | a653f0e5, 29cc744a |
| W6-07 actions/viewport | 8de0276e |
| W6-08 AI evidence/inputs | 4b7372b2 |
| W6-09 Bridge setup | c445f57b |
| S6-AI | product a6dddfc7; candidate 51b1c96a5160eb6c5e41fc425a89c7151b790538, branch codex/s6-ai-orchestration, c415 checkout. Contains actual W6 heads but does not descend from accepted bd40997b. |
| S6-OFFICE-BRIDGE | product 6eff07a7; candidate 66f349cd7adb8eeebe137752944129bba21e629d, branch codex/s6-office-bridge, 0f00 checkout. Descends from bd40997b and replays Office/intake/lifecycle/Bridge W6 slices under new hashes. Does not contain W6-06/07/08 or S6-AI. |

The two S6 heads are overlapping source candidates, not two independent feature patches to apply blindly. Integration starts from current main and the Office candidate, then adds missing W6-06/07/08 and a6dddfc7 plus W7 scoped deltas. Preserve bd40997b's newer history/read fixes. Do not reapply the entire raw D02 candidate or duplicate every original W6 commit on top of its rewritten equivalent.

## Parent findings and implementation ownership

| Finding and consequence | Evidence | Owner |
| --- | --- | --- |
| A valid clarification answer loses its asking execution during continuation. Batched choices still trust a flattened title string; duplicate 120-character option keys can make the suffix loop never terminate. | c415 runtime validates body.executionId, creates a NEW execution, stores clarificationId/message/key but drops the asking execution; gather compares old metadata to the new execution. spectraThreads choiceRequest slices the suffixed key to the same maximum. selectMessageChoice parses batch titles globally. | W7-01 |
| Stop can target a newly fetched attempt instead of the attempt the user saw. Generic completed status is labelled canonical_saved even for answers without a save. | c415 use-spectra-run fetches latest run tabs before stop; runtime permits missing attempt/execution to resolve to current; spectraRuns.updateStatus maps every completed run to canonical_saved. | W7-01 |
| Retained version and retained bytes disagree. Pinned images can be released after source tombstoning; releasing one pin can remove a version another tombstoned placement still owns. | processEmbedPage marks source placements removedAt; processVersionPage retains any pin row; artifactIntakeLifecycle.retainedReference only accepts !removedAt; releaseVersionIfUnpinned uses another !removedAt predicate. Last pin release does not schedule intake reconciliation. | W7-02 |
| A caught deletion-page error can commit earlier mutations but retain the old cursor. The report's retry claim is not an atomic rollback guarantee. | spectraArtifactDeletion.process catches errors from page(ctx,job) inside the same mutation, patches retry state and returns. | W7-02 |
| Old native completion can rewrite replica state after a newer write; transitional receipt states collapse failures into pending. | 0f00 completeWrite checks device/authority/hash but has no terminal request/claim-generation guard before replica updates. replicas.transitionStorageStrategy maps every replay state except verified to pending. Rust claims carry no lease token. | W7-03 |
| Uploaded document images have no real export consumer; retained insertion and page editing remain incomplete. | document-studio calls exportDocxCopy(editorJson,{pageSetup}) without resolver. resolveArtifactAssetBytes has no product caller. Retained image insertion/header/footer/section controls remain preservation-only in W6-03/S6 reports. | W7-04 |
| The new equation converter overstates support. Matrix & separators are discarded and atoms become cells; pmatrix/bmatrix lose their delimiters. Delimiter stop compares one character with a multicharacter token. | equation-interchange.ts LatexParser.sequence/command and matrix writer in 0f00; source inspected, not a fresh rendered equation test. | W7-05 |
| Duplicated slides share mutable chart relationships; hyperlinks are carried without native relationships. | pptx-lens.duplicateNativeSlide clones notes specially but reuses chart relation target. W6-05 explicitly leaves hyperlink relationship authoring and chart duplication isolation unproved. | W7-06 |
| Sheets exposes formatting/chart types that the native path cannot author. | xlsx-lens declares conditional rules preserved-only while sheets-studio edits them; combo/histogram controls exist but native writer refuses them. | W7-07 |
| Shared descriptors do not ensure a shared working action. Bridge setup/trust is disabled for humans and prohibited wholesale for AI; off-page dispatch navigates and drops the action, several mutation cases return void/listener counts. | c415 app-registry Bridge availability is always disabled; application-dispatcher sends bridge.setup before navigating when no handler, does not replay it, and select-classes returns void. | W7-08 |
| ManageBac backend progress still needs a complete ordinary-student setup/selection/retention/scheduling journey. | W6-06 report explicitly lacks selection-retention UI and live normal-user evidence; original task's onboarding/calendar acceptance remains unproved. | W7-09 |
| Smaller list responses still read heavy artifact/run rows. The user's database I/O concern is not solved by response projection. | W6-00 reports the remaining row/body coupling. S6-AI did not implement its scoped read-model obligation. | S7-COST manual, after integration |

## Connections that guide these fixes

Keep one operation and authority path for human, K-bar and AI. Capability availability must mean that the actual command works from the relevant screen, with durable result and visible readiness. AI may initiate normal setup/retry/navigation; local grants, pairing credentials and write-enabling consent remain explicit human handoffs under the existing policy. Do not ban an entire useful workflow merely because one step needs a person.

Canonical content, retained Office bytes, local write acknowledgement and mounted viewport are different facts. The same operation identity connects them, but none proves the next automatically. A native receipt is evidence about a validated operation, not a new authority system or a reason to duplicate semantic parsing in Rust. Reuse SafeWriter's actual readback and conditional-write protection.

Artifact identity must outlive location changes. Managed-copy isolation remains the default; migration previews and verified transitions handle later trust changes. A missing file, an offline device and a OneDrive placeholder must not be treated as user deletion. The current protocol can support this; no wholesale rewrite is justified by this review.

Data retention and cost are connected: forgetting an owner loses work, and never releasing the last owner's bytes leaks cost. Establish one actual ownership predicate and release trigger. Listing/searching/sync-status should read compact authoritative metadata; selected editing may hydrate content. Do not force users into local-only mode to hide database rereads. Hosting/self-hosting/bucket decisions remain a discussion with Pablo, not part of these changes.

Office breadth grows through the shared model and writers: ordinary create/import/export and linked editing must run the same meaningful operation corpus. Each format task must use its actual materialization/export route with controlled transport, because lens-only success missed consumer gaps. Unsupported advanced constructs remain preserved with truthful local feedback; marking a common exposed feature read-only is not completion of its requested editing task.

## Execution order

1. Nine Luna xhigh implementation tasks W7-01..09 run privately in parallel. No shared browser/runtime testing. Each implements the named repair and adjacent supported feature path with a small behavior check. No new global audit.
2. STOP after dispatch. Pablo returns when all finish. Do not poll or wake for individual completions.
3. Pablo may manually run V7-00-integrate-and-local-acceptance.md with Luna xhigh AFTER all nine reports exist. It combines the actual scoped deltas, fixes integration, lands a working candidate and runs a short authenticated real-local-Convex acceptance on the only stack. It must also replace the known broken source-string/matchMedia test fixtures with behavior-appropriate coverage or document exact remaining real failures; do not disable checks.
4. S7-COST-read-model.md is the ONE stronger manual implementation released now, AFTER V7-00 has integrated the candidate. It addresses actual database read cost with coherent authoritative small records and its own measured local acceptance. No vendor or billing change.
5. Parent reviews these results and releases a few sequential educational journeys for browser/native/model verification, with fixes in the same task. Do not restart all earlier audits. Real Windows Office and friend-Mac installation/pair/edit/reconnect evidence remain required; no Actions yet.

The remaining work is substantial but specific. This plan makes no full-Office-compatibility, real-model-quality, signed Mac-release or launch-ready claim. It does not make cosmetic perfection a gate. Subsequent tasks depend on observed results, not a predetermined giant verification campaign.
