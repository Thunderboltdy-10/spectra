# Wave 3: findings, decisions and implementation order

Parent review completed 2026-09-10. All thirteen full W3 reports, their proposed commits, W2's combined findings, and the Office-library investigation were read together. See WAVE-3-REVIEW-NOTES.md for source-level corrections. This document supersedes recommendations in individual reports where they conflict.

## What changes the launch plan

Spectra's core is worth retaining. Linked Word editing, undo and native readback worked; ordinary-user authority, public-link revocation, several educational artifact behaviours, and genuine mid-run steering have useful evidence. These successes do not establish that every visible workflow works: quiz and whiteboard tests sometimes bypassed an occluding dock, and AI previews sometimes reopened as empty artifacts.

The work concentrates into six connected implementation packages, preceded by five bounded repair tasks. They are not six new reforms. Each package has concrete vertical acceptance cases and its own neighbouring verification; there will be no second exhaustive audit at the end.

### Shared persistence before feature-specific work

W3's failed DOCX import is 1,108,195 UTF-8 bytes, including four inline image data URLs totalling 1,023,082 characters. The completion mutation permits 1.4 million JSON characters and stores the converted body on one import-job row. Convex documents must be below 1 MB. This is a strong explanation for that persistence failure, but the final implementation must capture the actual rejected field/error rather than simply label all import failures size errors. The importer separately changes editor content: a job marked complete does not itself prove canonical artifact persistence.

Valid PNG uploads also fail in the shared asset path. The exact integrity mismatch is not yet isolated. Convex storage SHA-256 is hexadecimal; changing it to base64 would be an invented fix. Quarantine/delete followed by throwing in a mutation rolls back those changes. Candidate storage cleanup must prove ownership.

Repairing this path lets Office images, AI attachments and generated media share authorized asset references instead of inflating hot database rows. Store immutable bytes using the existing Convex file-storage path first; no bucket vendor or hosting migration is selected. [Convex value limits](https://docs.convex.dev/database/types), [storage metadata](https://docs.convex.dev/file-storage/file-metadata).

### Cost and reliability: change specific reads, then measure

The shared testing windows are not a per-user bill. Existing org-tree summaries already avoid some full content hydration. The concrete priority is `spectraThreads:list/get`: lists fan out through runs and artifacts, and detail reads collect large operation/card/event histories for many messages. Separate a thin thread list, an initial visible conversation page, explicit older history, and the currently observed run. Reuse existing summaries and indexes; introduce a new split only where measurements establish that a hot row remains large.

Bridge polling must return claim metadata until actual work is claimed. Projection checkpoints must retain their sequence/race guards. Deletion must converge on the owner object's bounded, resumable cleanup, distinguish placement removal, and prevent an offline replica from resurrecting deleted cloud work. These changes reduce repeated reads, abandoned payloads and confusing retry failures together.

Pablo confirmed that stack shutdowns happen when he closes the app. Treat reopening as a routine restart, not a new crash investigation. The separately observed one-second query timeouts remain cases for the read-path implementation to reproduce and measure.

### Office needs one set of semantics across four entry points

Linked editing retains the native package; ordinary import, generated copies and export often rebuild a different representation. Word generated copies lost tables, hyperlinks, equations, rich spans and media. A PowerPoint export used a CSS fallback list as a native typeface and represented charts as geometry. XLSX retained formulas but exported stale cached values. These are different symptoms of conversion paths with different capabilities.

Keep existing lenses, commands, Yjs, operation ledger and Bridge journal. Share format-specific conversion/writer primitives between ordinary import, new artifacts, export copies and linked saves. A supported operation needs a stable target, revision precondition, capability, resulting semantic readback, and preserved-package comparison bound to the bytes actually written. Use retained originals where available and a complete package scaffold for new work. Do not add another authoritative document model or operation journal.

Native editing of rich text, equations, tables, real charts, layouts and workbook structures must expand. Merely preserving these features while disabling editing does not satisfy the launch goal. The Office prompt specifies concrete feature families and asks for an explicit coverage ledger. It does not equate an OOXML package assertion with native Office or Mac execution, nor promise the entire Office product suite from one patch. Any remaining family that materially limits the user's broad-editing goal must come back as an explicit scope decision; it cannot silently become a permanent disabled button.

The current Office library has useful unexploited APIs. Extend it and the existing lenses first. A hosted Office engine would introduce another authority, licensing/deployment choices and cost. It remains a discussion option if the bounded architecture trial proves necessary, not a selected dependency.

### AI completion, clarification and K-bar need the same action contract

The W3 clarification patch is held: invalid continuation binding falls through to ordinary targeting, and a numeric choice index is not durable target identity. The research wiring patch is held: its fetcher can call a failed-fetch snippet verified, catches cancellation, and lacks complete destination/deadline protections.

Use exact request, offered choice, target, revision, attempt and input identities. Invalid or stale choices must remain a meaningful wait or error, with no fallback edit on the currently open artifact. Retry recoverable work within a budget and preserve attachments; permission failures and ambiguity need the right next action. A visible preview or created blank shell is not a committed result.

Extend the existing action registry for AI, normal controls and K-bar. Mutation success, a mounted viewport and a verified native save are distinct receipts. K-bar should search all authorized work and expose context-ranked actions with optional parameter entry. Opening an artifact, continuing a thread, toggling a setting, syncing selected classes and initiating Bridge setup should reuse those same actions. `/chat` must not create a second right chat panel. A user's manual navigation should interrupt following without silently cancelling the durable operation.

### Educational sync must preserve both source facts and personal work

Selected classes must gate actual polling, not merely shelf creation. Identity must include account, integration and academic period where provided, with an explicit migration from legacy keys. Timetable refresh currently confuses a calendarItems identifier with a legacy embedded event identifier; that repair is bounded and assigned now.

Official source deadlines and personal completion, notes, reminders and scheduling are separate data. A source refresh must preserve personal intent. Removing a source, deselecting a class, changing a period and disconnecting an integration need truthful, consistent outcomes. A local HTTP provider fixture through the real route and Convex can prove deterministic populated cases without pretending the existing no-match account has live provider data.

Students and teachers are peers. Agent owners already have publish authority; disabled publishing needs its actual prerequisite/blocker fixed or explained. Domain-restricted share links must use a verified signed-in identity, never a browser domain parameter. These are product-flow corrections, not permission expansion.

### Bridge safety and usable workspace composition remain first-class

Mac packaging is prepared, not verified on a Mac. Unix file stability, write races, provider placeholders, moves, deletion and reconnection need protocol tests before the final friend-device run. Keep source identity, Spectra's working copy and cloud placement distinct. Existing linked files must never silently switch from clone to direct-write behaviour. Browser-first setup should offer understandable policy presets with optional detail. No Actions runs or signing claims now.

The dock blocking ordinary pointer interaction is a functional defect. A 248-pixel library rail leaving 48 pixels for the main content at 320 pixels is likewise a functional failure. Repair shared allocation and hit testing, preserve desktop side-by-side non-modal work, and use appropriate narrow-screen overlays with focus return. Keep current Spectra styling; do not turn this into a redesign or pixel-perfect polish campaign.

## Every W3 contribution has an owner

| W3 | Parent disposition | Next owner |
| --- | --- | --- |
| 01 runtime | Preserve evidence; operator configuration restored; routine restart only | Parent runtime handoff |
| 02 Word | Linked success retained; lossy copy/import failures remain open | M02 intake, M03 Office |
| 03 Sheets `6f725ac2` | Amend full-workbook hashing/equality before integration | W4-02 |
| 04 PPTX `39a78a2d` | Keep diagnostic helper; repair native font mapping; chart semantics remain open | W4-02, M03 |
| 05 AI `62728bec` | Hold whole patch; selectively reuse exact-execution forwarding in corrected design | M04 |
| 06 research `f6653cc3` | Hold unsafe/provenance-overstating activation | M02 safe evidence, M04 consumption |
| 07 sync/invite `79e036b1` | Accept direction; correct cloud/source copy and retry state | W4-04 |
| 08 authority `7d204447` | Accept tests; implement trusted-domain route and actual publish journey | W4-05 |
| 09 chat `5ae95020` | Complete stale-route/retry/not-found handling; repair ineffective compact selector | W4-03 |
| 10 checkpoint `51158d8e` | Accept sequence/CAS repair with neighbouring checks | W4-01 |
| 11 education `32ff7fb8` | Integrate useful quiz clearance as part of real pointer repair | W4-03 |
| 12 hydration `f4e7f063` | Accept same-transaction reuse with authority regressions | W4-01; M01 broader work |
| 13 deps `68b5ea2c` | Integrate tested framework/backend alignment privately; remaining reachable advisories stay open | W4-01; M02/M03/M04 consumers |

No W3 product-source commit had been applied to primary when this synthesis was written. W4 tasks return reviewable commits; a report's private tests are not claims about the shared production runtime.

## Execution

See IMPLEMENTATION-ROADMAP.md, WAVE-4.md and the six complete manual prompts in `prompts/`. Only the five bounded Luna tasks are auto-created. The parent reviews their combined results and integrates them before manual implementation begins. Manual tasks are staged so they do not independently invent incompatible contracts. All implementation includes small verification steps; final verification is a short integrated smoke and the reserved Mac run.
