# W5 implementation contract

This is actual implementation, not another audit. Use the exact assigned scope and finish connected simple repairs. Leave unrelated architectural expansion to its named owner. No subagents, extra tasks, automatic monitoring or production deployment.

## Candidate setup and ownership

Your automatic task starts in a private git worktree from main. Read WAVE-5.md and your assignment. Merge **c832d8f3fe6c5019044bec9f4a08f6fe89d52d66** into your own branch before editing; this commit combines the held M01/M02 candidates and narrow parent safeguards. Do not cherry-pick this merge onto main. If task startup predates these docs, read them in <local-workspace> and merge the latest main documentation/auth commits without undoing unrelated work.

The remediation base is not accepted production code. Inspect relevant actual paths and port counterexamples from review-cases/parent-foundation-depth.test.ts.txt. Do not weaken a regression to get green output. In particular the inherited Bridge cleanup fixture was weakened; D02 restores it.

Own only assigned files, focused tests and your report. Shared schema/API changes must be additive and documented; preserve other owners' definitions on integration. W5-01 owns thread query/UI consumers; W5-02 owns research/source-record code; W5-03 owns shared parser helpers, parser call sites except research transport, and parser-related package/lock changes; W5-04 owns Bridge poll scheduling. D01 owns intake routes/backend, media receipts and canonical import coupling; D02 owns deletion/lifecycle/embeds. No foundation owner changes auth/providers.

Use private dependencies. Never junction private node_modules into primary, replace primary dependencies, or run another dev/Convex stack. Do not run backend deploy/codegen against the shared runtime. Pure local type generation is fine if supported and does not push. Avoid unsafe casts to conceal missing types. One relevant typecheck, changed-file lint and focused tests are sufficient; no repeated full builds without a reason.

## Evidence and delivery

Private tests can establish logic and controlled transport behavior. Browser visits to localhost serve main, not your unmerged worktree; don't call that changed-code evidence. The stack is already up and needs no health polling. Only the AUTH task is authorized to integrate its small auth fix now. Future starts use npm run local:start:all.

Use disposable fixtures. No real school writes, invitations/email sends, original synced-file mutations, vendor migrations, paid operations, Actions runs or fabricated provider identity. Temporary LOCAL ordinary-student configuration is authorized only when verification needs it, must affect web and backend consistently, and must be restored. It is not a substitute for actual identity.

Finish with a private product commit and reports/W5-0N.md containing exact HEAD and product commit(s), base, source changes, useful passing regressions, unresolved material limits, runtime evidence category and a short post-integration check. Commit your report in your branch. Copy only that report to <local-workspace> (replace your own prior report only). Do not commit or stage primary files. This report mirror lets the manual follow-on agents consume exact hashes without polling tasks. End; do not wait for other tasks.

Manual D01 consumes these finished reports and scoped product commits; D02 consumes D01. Parent accepts and integrates the resulting candidate once, then user launches the two sequential verification tasks. All new API/schema paths receive real shared-backend checks at that point; fixture passes are never relabelled as those checks.

