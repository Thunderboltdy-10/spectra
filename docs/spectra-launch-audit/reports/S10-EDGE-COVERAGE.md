# S10 edge-health coverage map

Isolated checkout: `<local-workspace>`
Branch: `cursor/s10-edge-health`
Checkpoint: `eac1567b` (`eac1567be6feea64870bfb49258daa21909f9d75`)
Primary checkout `<local-workspace>` is not edited.

Explorer model: Composer 2.5. Eight explorers launched before that correction are still on Grok 4.7 and are left running. The implementation brief for another agent is `S10-EDGE-IMPLEMENTATION-HANDOFF.md`. E01–E80 are recorded there. Do not start deep implementation agents in this session. Local cap is 16 concurrent explorers. Do not batch-launch past the cap.

Status values: `running` means the agent was started. `queued` means the assignment is fixed and not yet started. `done` is filled only after the explorer returns. Inspection is not claimed until `done`.

## Running

| Id | Area | Model | Agent |
| --- | --- | --- | --- |
| E01 | Identity and authority — done | Grok 4.7 | [Identity authority edges](5aebc64e-763f-4c2e-9454-66244ec2d7ce) |
| E02 | Invitations and membership accept/revoke — done | Grok 4.7 | [Invites and membership](2d710d59-5c23-4c87-9633-98f6f6015dde) |
| E03 | School onboarding and local student rehearsal — done | Grok 4.7 | [School onboarding data](d0629f4a-f6fb-4aaf-bd79-d1034f551d84) |
| E04 | ManageBac sync and reminder source — done | Grok 4.7 | [ManageBac sync edges](65364279-453d-4bb2-8a2a-e0b801181cb4) |
| E05 | Library catalog list/search authority — done | Grok 4.7 | [Library catalog reads](2b2cd843-b42b-4f78-b3ca-6cca99bbae1b) |
| E06 | Workspaces and org-tree move/copy/delete — done | Grok 4.7 | [Workspaces and org tree](3fd6ac3f-c5d2-411e-bae7-f84a009439c2) |
| E07 | K-bar registry and command dispatch — done | Grok 4.7 | [K-bar command dispatch](d2f2451e-5c56-4ea7-a65a-350b6f3ad877) |
| E08 | Document editor mount, hydrate, save, unmount — done | Grok 4.7 | [Document editor mount](1017d8b9-67f4-4a3b-a37d-01655de1bb76) |
| E09 | Academic Word notes and citations — done | Composer 2.5 | [Academic Word commands](180c5f39-3b56-4cc5-998a-5bca840373b8) |
| E10 | Sheets editor and sheet commands — done | Composer 2.5 | [Sheets editor commands](c354d7ad-140d-4890-a515-3cb6a6c65d3f) |
| E11 | Presentation editor and deck commands — done | Composer 2.5 | [Presentation editor commands](2dcf3836-b999-4e4a-ba4d-8fd91f5a1c0a) |
| E12 | Quiz privacy, practice, and attempts — done | Composer 2.5 | [Quiz privacy practice](f1459ea6-6072-4990-82d3-4784170b191d) |
| E13 | Flashcard study and spaced repetition — done | Composer 2.5 | [Flashcard study sessions](0a8b19f6-cd65-43e3-9056-81c6c9feefc3) |
| E14 | Code artifact editor — done | Composer 2.5 | [Code artifact editor](1c5884b3-a7cc-4ba0-b1e1-a7232c2d0f79) |
| E15 | Whiteboard editor and content patch apply — done | Composer 2.5 | [Whiteboard editor state](a8573f90-f1a1-4a49-9a83-f4f9e1dcc514) |
| E16 | Pages, workbench, and artifact shell mount — done | Composer 2.5 | [Pages and workbench](faccddd0-5741-4cb4-834d-909726c1affb) |

## Queued — launch on Composer 2.5 as slots free

| Id | Area | Boundary |
| --- | --- | --- |
| E17 | Import intake — done | [Import intake lifecycle](bdbc9fa0-4ad0-4dbb-9233-56491a27e242) |
| E18 | Attachments and assets — done | [Attachments and assets](0500e6a0-43ad-4372-9ab4-b46517953dc5) |
| E19 | AI run loop — done | [AI run loop control](ef644c06-8fd4-49fb-99ba-83013b8047ca) |
| E20 | AI authority writes — done | [AI authority application writes](99795b3b-f433-43bf-8c7f-c18558844c60) |
| E21 | AI content patches — done | [AI content patch verify](e5d7e817-4a3e-47a1-bb2c-8e01b6882d79) |
| E22 | Calendar and timezones — done | [Calendar timezone paging](56475cff-68ab-45bc-8cb9-759f8c80ea65) |
| E23 | Tasks and reminders — done | [Tasks and reminders](3234e2e2-8110-4ed4-befe-1b31340ab2b7) |
| E24 | Sharing and access — done | [Sharing and access requests](2f98189f-4b68-492f-89cd-bfb1f1ca94f8) |
| E25 | Word lens fidelity — done | [Word lens projection fidelity](d814c89f-77a3-4904-bec7-9115a4888e70) |
| E26 | XLSX lens — done | [XLSX lens formula cache](5f70871c-c459-466c-9745-05afb261834c) |
| E27 | PPTX and package — done | [PPTX package and media](eef4ea52-cdea-4682-9be7-f0fa46fc35d9) |
| E28 | Native reconciliation — done | [Native reconciliation merge](13124c75-4ff2-4505-9135-c253c4a5a3b9) |
| E29 | Bridge Rust core — done | [Bridge Rust core](aef6b6cf-ddbf-48db-9e46-2ccac7e4d6ba) |
| E30 | Bridge Convex queues — done | [Bridge Convex queues](0cbc462b-5fb7-438b-971a-e228284f3028) |
| E31 | Bridge client and replicas — done | [Bridge client and replicas](52068937-e997-4422-a427-e731fe15d801) |
| E32 | Collaboration client — done | [Collaboration client reconnect](c92ad338-f753-43e4-8e08-ee7235e03189) |
| E33 | Collaboration gateway — done | [Collaboration gateway worker](8d5d84fb-543a-4367-b991-9548bd5c20ae) |
| E34 | Collaboration Convex — done | [Collaboration Convex rooms](75265244-c98e-4523-9bf4-5fd8972a5162) |
| E35 | Region claims and sync — done | [Region claims and sync](df8e32a5-ae00-4e1e-95f7-4118b064bf96) |
| E36 | Retention and deletion — done | [Retention and deletion](93164578-91c7-4206-85a8-1673a0ed91c5) |
| E37 | Durable ownership — done | [Durable payload ownership](08dec98c-3f11-4035-baac-1e6231775315) |
| E38 | Settings — done | [Settings and preferences](b7c1118b-6672-4e55-8ffc-7bfe477438b1) |
| E39 | Public and legal routes — done | [Public and legal routes](5b226d4d-f75b-489f-ae2d-6c57ad61d1dd) |
| E40 | Schema, migrations, crons — done | [Schema migrations and crons](5ee6c464-9736-4fda-90e1-9c64aa06bbe9) |
| E41 | Release and test runner — done | [Release and test runner](d24646c8-ef95-49f8-aa4e-bced08037383) |
| E42 | Human vs AI actions — done | [Human versus AI actions](304c7020-90f6-49d1-b3d1-680859e5ea6b) |
| E43 | Open and readiness — done | [Open and viewport readiness](9b768546-9293-4492-85cf-fabad4fec727) |
| E44 | Comments — done | [Comments lifecycle](a8194235-9501-49f6-bd83-158c456647d9) |
| E45 | Embeds — done | [Embed ownership](8746b7c0-4b8d-4ba6-8bcb-860cf4ef0f7f) |
| E46 | Agents — done | [Agents publish](fe15c7c1-a48a-4324-8ccb-e76d410c980c) |
| E47 | Runs and threads — done | [Runs and threads](3151d444-d1cf-47cd-b00e-b4a1da217b93) |
| E48 | Sources and references — done | [Sources and references](cbc1e424-d7c7-4681-ba66-548a7b84de57) |
| E49 | Offline drafts — done | [Offline drafts](01beb238-ff55-46ce-b832-82316133ab6e) |
| E50 | Notifications and audit — done | [Notifications and audit](ec03a18a-de1b-4ac0-8a0d-a6232bbb57bd) |
| E51 | Memory — done | [Memory embeddings](09f89a65-42d7-437f-a6c0-4fc97ce3a04f) |
| E52 | Analytics semantics — done | [Analytics correctness](cd2e2dc9-043a-4782-80a6-d43e47163bea) |
| E53 | Admin boundaries — done | [Admin boundaries](2f462baa-7ebe-4cbb-80b0-cfba131f51ce) |
| E54 | Find, history, export — done | [Find history export](58daec19-3ef2-41bd-b800-a0044786759e) |
| E55 | API run routes — done | [API run receipts](6d1aa214-0d31-4791-b7fb-eb9ed8404fdb) |
| E56 | API content and native — done | [API content and native](661e3eef-3899-4456-84cd-754bc8eec926) |
| E57 | Presence and follow — done | [Presence and follow](ebf6972c-32c0-401b-8939-1195267b7835) |
| E58 | Artifact user state — done | [Artifact user state](2f3138cc-4161-4f2f-99ba-96741a40c014) |
| E59 | Operations and capabilities — done | [Operations and capabilities](4eceff6d-7415-4a8a-bdf0-98457ce37c14) |
| E60 | Shell UI vs durable ops — done | [Shell saved versus durable](319b86cf-310d-4c31-9001-bb257e4f7545) |
| E61 | Anchors, events, context — done | [Anchors events context](a312878f-8d12-4b6c-b4a4-4ba72e2366f2) |
| E62 | Data and compute features — done | [Data and compute features](0fa15732-af19-420d-89ec-5bdde134c983) |
| E63 | Realtime and tools — done | [Realtime tools quality](488201dd-2eee-4403-9820-b5dd257973e2) |
| E64 | Rich content — done | [Rich content join](bbc4a118-e04b-4ac5-b59b-625980ec1a48) |
| E65 | Webhooks and health — done | [Webhooks and health](2c189d5f-4067-4fc9-bd63-b754e5e8cf2a) |
| E66 | Secrets and bridge trust — done | [Secrets and bridge trust](dfcaaa5d-f94e-4751-b3cb-32326c7f3630) |
| E67 | Test gap census — done | [Test gap census](979a9f1d-7fbe-4187-a632-023ae635ace8) |
| E68 | Change groups — done | [Change group commits](1f2ba768-a177-4063-b81f-f532ddc48730) |
| E69 | Collaboration snapshot verify — done | [Snapshot verify handoff](00b766e7-a1df-4a44-9d0f-176d02029133) |
| E70 | Membership cleanup — done | [Membership cleanup after leave](729d9acf-317e-4b11-868b-69f19c99481f) |
| E71 | Duplicate artifact action — done | [Duplicate artifact outside tree](50ed620c-f789-479a-a4e9-b2ec3d74159a) |
| E72 | Office fonts and slash commands — done | [Office fonts and slash](ebb393f6-f009-4eb5-9966-74eaac579ee5) |
| E73 | Study timer and achievements — done | [Study timer achievements](7932e2ff-7704-44a4-b15c-14729194807a) |
| E74 | Consent and cookies — done | [Consent and cookies](e465ea0a-a71f-46c4-bb60-5b5d8f8d6023) |
| E75 | Proxy and auth server — done | [Proxy and auth server](b8d13f0c-6c16-43b2-8239-5e0b51492859) |
| E76 | Workers package contract — done | [Workers package contract](96aa952a-d3d9-49a2-84f6-3f71d73a3ac9) |
| E77 | Spectra shared helpers — done | [Spectra shared helpers](387db2ee-e145-4479-a121-fef5ff691e7a) |
| E78 | Links after move — done | [Links after move](a55fa0c3-c91f-4bd7-a5e4-a13f95b3b49e) |
| E79 | Action registry — done | [Action registry versus commands](96b54d5d-0c38-4a40-82c6-6651e371a53e) |
| E80 | Integrations besides ManageBac — done | [Non-ManageBac integrations](eabb3a72-2671-4a9f-8cda-c04fb2eddaea) |

## Wave 2 — editor actions, choreography, multiplayer, load

E01–E80 are done. This wave looks for gaps those passes did not own: each editor action against its lens and sync, AI versus human handling, choreography races, multiplayer, duplicated UI, and load or sync paths that can stall. Launch at most 16 at a time.

| Id | Area | Status |
| --- | --- | --- |
| E81 | Document actions against the Word lens and native sync | running — [Document action lens sync](97e5e986-24d4-46e1-ad64-f02856443054) |
| E82 | Sheet actions against the XLSX lens and formulas | running — [Sheet action lens formula](a9b56af4-15a7-4fcb-814e-d9a0a993f673) |
| E83 | Deck actions against the PPTX lens | running — [Deck action lens sync](32df3743-b84c-4b0e-92cd-3f03dcd97d8c) |
| E84 | Quiz, flashcard, and code actions versus AI tools | running — [Quiz code AI parity](8c59a4ce-fb6b-4c9e-8d86-f57edb3b2e90) |
| E85 | Whiteboard and page actions versus content patches — done | [Whiteboard page patches](c6e39468-8bfb-4384-b948-0821bf2bc8f3) |
| E86 | Human choreography races with AI | running — [Human choreography races](5fbb11dc-0d04-4442-9681-1b25e65e50ae) |
| E87 | Multiplayer cursors, selection, and undo | running — [Multiplayer cursor undo](61d23aa8-fc0d-450f-a85b-d0f503e92179) |
| E88 | Collaboration sync stall and update size | running — [Collab sync stall size](f1e07091-5a07-4635-a33d-4b35765fc15e) |
| E89 | Convex reads on artifact open | running — [Convex open read path](ce56c061-1d0b-48c1-89fb-00f9b691fab5) |
| E90 | Studio first-open cost | running — [Studio first open cost](9d09f137-14e5-453a-903d-43c066c4dd6d) |
| E91 | Commands with no handler | running — [Commands missing handlers](4d1d422d-ee55-4fe5-8288-9c832b45a140) |
| E92 | Studio UI inconsistencies | running — [Studio UI inconsistencies](2c455d98-f910-453d-b88f-dc029df54908) |
| E93 | Undo that reverts another person | running — [Undo other person edit](f054a102-8bcc-40b6-b3dc-ca28e4e443c4) |
| E94 | Paste and drop across artifact types | running — [Paste drop fidelity](7486f9de-3a9b-4b9f-81ec-157cd958ebd4) |
| E95 | Export while the editor is dirty | running — [Dirty export matrix](fa87be67-8e6b-499d-9f73-44b2cac80afa) |
| E96 | Double submit and idempotency | running — [Double submit idempotency](2c1c2312-878d-4f6e-8c46-34616da66600) |
| E97 | Keyboard shortcut collisions | running — [Keyboard shortcut collisions](19e6f33c-4d17-4884-bc69-6fabdb7d53ff) |
| E98 | AI tool leaves a half-applied edit | queued |
| E99 | Media insert orphan files | queued |
| E100 | Comment anchors after a concurrent edit | queued |
| E101 | Find and replace per editor | queued |
| E102 | Studio render crash from one bad node | queued |
| E103 | Background jobs versus an open editor | queued |
| E104 | Large document and Yjs growth | queued |
| E105 | Shared toolbar and status chip drift | queued |
| E106 | Selection-only export and print | queued |
| E107 | Version write without a revision check | queued |
| E108 | Presence payload and awareness storms | queued |
| E109 | Disabled command still bound to a key | queued |
| E110 | Native sync queue stuck behind one failure | queued |
| E111 | Formula spill and circular refs | queued |
| E112 | Slide notes, masters, and animations | queued |
| E113 | Document comments and tracked changes round-trip | queued |
| E114 | Sheet charts and named ranges | queued |
| E115 | Code run versus saved file | queued |
| E116 | Quiz attempt concurrency | queued |
| E117 | Flashcard review versus deck edit | queued |
| E118 | Whiteboard multiplayer object locks | queued |
| E119 | Page block reorder versus collaboration | queued |
| E120 | Convex collect and unbounded queries | queued |
| E121 | Editor route code splitting | queued |
| E122 | Retry storms on sync disconnect | queued |
| E123 | Title and rename divergence across studios | queued |
| E124 | Empty and error states across studios | queued |
| E125 | AI choreography viewport move during typing | queued |
| E126 | Human command during an AI region claim | queued |
| E127 | Image crop and unsupported media | queued |
| E128 | Table edits in Word and PowerPoint | queued |
| E129 | Header, footer, and section breaks | queued |
| E130 | Speaker notes and hidden slides | queued |

## Returned notes

### E13 flashcards — [Flashcard study sessions](0a8b19f6-cd65-43e3-9056-81c6c9feefc3)

Hold for phase 2, not yet a fix:

- Study reconciliation in `study-separation.ts` is not called from production. Convex approximates rewrite by rescheduling on the next review only.
- `checkDeckWrite` is unused, so deck cards can keep a `review` payload the skill says is private.
- Server `deckCardIndex` accepts empty or broken cloze cards that the studio study queue drops.
- `clientReviewId` is a new token per click, so a retry can schedule twice. A retry that reuses an id after the review-row insert failed can return `reused` and skip the audit row.
- Mid-session card deletion leaves the studio queue pointing at a missing card. That UI file was outside this scope.

### E09 academic Word — [Academic Word commands](180c5f39-3b56-4cc5-998a-5bca840373b8)

- Human footnote insert validates through the reducer but inserts the editor node directly, without `nativeBinding`, so an orphan Word note id can be reused.
- `delete-note` does not prune `nativeBinding.wordNotes`.
- `edit-word-citation` drops `sourceRef` when source JSON changes. That one is a reducer-level defect.
- Bibliography `sources` refresh on citation insert; formatted bibliography text does not, until regenerate. Treat as a declared limit unless the UI claims the text updated.

### E10 sheets — [Sheets editor commands](c354d7ad-140d-4890-a515-3cb6a6c65d3f)

- Cached-only formulas keep showing the old numeric value after `cachedValueStale` is set. Export omits that result. Display honesty is the defect candidate.
- Commit, cancel, and formula-literalization gates live in `sheets-studio.tsx`, outside this pass.

### E11 presentation — [Presentation editor commands](2dcf3836-b999-4e4a-ba4d-8fd91f5a1c0a)

- `buildBibliographySlide` assigns `draft.slides` from the bibliography plan’s slide list, which can replace the deck with only the references slide. The inspector button uses the in-place API. Strongest fix candidate so far.
- Deleting a slide leaves internal hyperlinks; PPTX export then throws.
- Collaboration travel paths are `/slides/{index}`, so reorder points them at a different slide.

### E12 quiz — [Quiz privacy practice](f1459ea6-6072-4990-82d3-4784170b191d)

- Server attempt projection redacts answers. Author preview and `revealAnswers: "immediate"` are separate.
- `persistence: "ephemeral"` still writes `quizPracticeAttempts`.
- `allowResume: false` hides an in-progress attempt but still counts it toward the attempt limit, so the learner can be stuck.
- `experience.identity: "assigned"` is not checked on start or submit.

### E15 whiteboard — [Whiteboard editor state](a8573f90-f1a1-4a49-9a83-f4f9e1dcc514)

- A patch that replaces `/nodes` or a whole `/nodes/N` object can drop siblings or fields, and subset verify can still mark `/nodes/N` complete.
- Recolor remap can send every color change in the batch to one title match.
- Duplicate node ids are renamed on normalize and then edges that still use the old id are dropped.

### E16 pages and shell — [Pages and workbench](faccddd0-5741-4cb4-834d-909726c1affb)

- Artifact `requestViewportAction` is never acknowledged in the page shells, so readiness can time out while the editor is already open.
- `openArtifactById` and summary hydration are not tied to a navigation generation, so a late response can open the previous artifact.
- Clearing the artifact from the URL calls `closeStudio` with no dirty check. Chat’s `ArtifactStudio` also has no remount key.

## Known gaps before follow-up

Landing-page cosmetics are out of scope per the launch charter. macOS runtime, live Office, live AI corpus, and production services are not inspected here.

Cross-boundary flows that still need their own explorer once the module owners return: revocation after a mounted editor; import then first save; AI stop versus a human command in flight; offline draft versus eviction; delete/move versus retention. Those are E42–E43, E49, E36–E37, E19, and a dedicated cross-check after module reports, not a substitute for them.
