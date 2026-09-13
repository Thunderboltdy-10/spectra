# Spectra launch roadmap

Updated 2026-09-14. WAVE-9.md contains the parent source review; RUN-NEXT-W9.md contains exact manual prompts.

## Current parallel Luna batch

| Task | Result required | Runtime |
|---|---|---|
| W9-00 | Consolidate missing S8 and complete V8 source/tests; fix Word compaction-induced no-op edits | Sole primary mutator |
| W9-01 | On-demand school resource import shared by student UI/K-bar/AI; reversible local student rehearsal | Private implementation |
| W9-02 | Bounded Calendar reads and no unnecessary heartbeat tab/card work; measured database operations | Private implementation |

Parent stops after dispatch. Housekeeping cleanup is separate.

## Manual sequence after the batch

1. V9-00, Luna xhigh: integrate school/cost changes, migrate local state, complete ordinary-student resource/planning/invitation return and live cost-path evidence.
2. S9-DURABLE, stronger: repair large-file persistence across import, collaboration, checkpoint, replay and native saving; verify dense workbook and formal paper.
3. S9-OFFICE, stronger: implement both user-selected academic Word families in the existing protocol, verifying notes/citations/bibliography/comments/tracked changes slice by slice.
4. S9-AI, stronger: complete mixed user requests, preserve source/target/destination intent, unify actions/acknowledgements/recovery and produce source-backed educational output with real editable charts.
5. V9-NATIVE, Luna xhigh: finish actual browser Word download and live Sheets-to-PowerPoint refresh/pin/revoke/cleanup. A finite acceptance task, not a global audit.

No private-code localhost proof and no accepted label for an incomplete prerequisite. Each task checks its changed boundary and direct neighbors; another full suite needs an integration or failure reason.

## Release decisions after evidence

Friend-Mac installation, pairing, edit/reconnect and native Office checks remain required. Public distribution/signing and hosted configuration need a concrete release decision. Actual database I/O, storage and egress evidence must guide the separate hosting/bucket/self-hosting discussion; provider changes remain unapproved.

Progress is substantial and remaining work is concentrated, but large-file durability, academic Word and AI completion are still real implementation. Do not promise all Office functionality or a final wave before those results exist. No cosmetic perfection gate, landing-page/admin redesign or Notion work.
