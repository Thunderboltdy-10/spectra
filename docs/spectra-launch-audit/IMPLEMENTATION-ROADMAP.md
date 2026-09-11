# Spectra launch implementation roadmap

Status 2026-09-11: W4 reliability and the Clerk factor-state fix are integrated. W5, D01 and D02 produced substantial candidates, but their source review identified unfinished boundaries. WAVE-6.md records the exact findings, acceptance limits and resulting architecture decisions.

The pace changes now: resolve named foundational defects alongside independent user workflows. Do not repeat broad foundation completion prompts or wait for every edge case before starting Office, AI, integrations and navigation.

## Current parallel implementation wave

Ten actual Luna xhigh tasks, with full prompts under prompts/W6-*.md:

| Task | Deliver |
| --- | --- |
| 00 | Land independently useful W5 history/source/parser/Bridge changes on main, with scoped corrections and a small real shared-runtime check |
| 01 | Trusted streaming uploads, usable media formats, replay/authority and causal canonical import saves |
| 02 | Finite cleanup, actual retained-reference lifetime and canonical embed confirmation |
| 03 | Shared rich Word editing/import/export path |
| 04 | Shared workbook structure/formulas/styles and genuine editable charts |
| 05 | Shared rich presentation objects/notes and genuine native chart output |
| 06 | Selected-class ManageBac, account sync leases and personal task/calendar planning |
| 07 | Universal contextual K-bar, shared actions/parameters and mounted-target navigation acknowledgements |
| 08 | Actual research evidence in useful saved AI deliverables and durable input references |
| 09 | Browser-first Bridge trust/setup, no startup terminal and Windows/macOS packaging configuration |

W6-COMMON.md defines the exact candidate, file ownership and report handoff. Only 00 integrates into main and uses the shared runtime; others use private logic/component/parser/transport tests. No extra Convex instances.

## Two manual hard integrations

After all Luna tasks finish, Pablo can run these in parallel in separate worktrees:

- prompts/S6-AI-orchestration.md: durable clarification/target identity, steering/stop/retry, meaningful recovery, shared actions and readiness-driven follow choreography.
- prompts/S6-OFFICE-BRIDGE-convergence.md: structured editable equations, remaining material native fidelity, semantic writer/native receipts and stable-file/local-cloud/trust transition correctness.

Both consume exact W6 product heads, preserve the current accepted main, implement coherent slices and return reviewable code. Parent combines their results. Their scope is functional completion, not a new architecture inventory or endless UI polish.

## Verification and launch

Keep meaningful regressions with each implementation and check direct neighbors. After integration, run browser/real-local-Convex/native Bridge checks sequentially on the single served checkout. Reuse the existing linked corpus: actual sign-in/invitation/selected sync; rich Office import/edit/export/reopen; pinned/unreferenced deletion and offline replay; a vague AI follow-up with steering and a useful source-backed deliverable; crowded normal navigation/K-bar. Fix small reproduced defects within the verifier task and repeat that case plus its neighbor.

Do not substitute a mock, package hash, success toast or old served source for the user's saved outcome. Mac package/start/pair/edit/reconnect remains a final real-device check on the friend's Mac, with no Actions execution now. No new global audit or cosmetic perfection gate.

## Decisions retained

Keep Yjs/ledger/lenses/Bridge and one human/AI command path. Preserve distinct uploaded/canonical-saved/native-verified/viewport-ready outcomes. Treat database I/O, response bytes, stored files and idle polling as separate costs; no hosting or storage migration is chosen. Students and teachers are peers. School setup/sharing/ManageBac matter; landing, broad admin polish and Notion are excluded. Original school files and external services remain untouched.
