# Wave 6 — Workspace Intelligence and Context

Completed on 2026-06-22. Wave 6 adds a reliable, bounded context layer to the hooked-up `/workspace`, `/chat`, `/artifacts`, and Artifact Studio implementation. It does not introduce memory, agents, autonomous orchestration, complex routing, ManageBac, advanced canvas behavior, or a full RAG system.

## Context model

Every page composer sends one explicit `focusMode`:

| Mode | Primary context | Additional context |
| --- | --- | --- |
| Global | Bounded artifact/workspace catalog | Prompt-relevant metadata only |
| Workspace | Current workspace snapshot | Pinned, recent, and prompt-relevant artifacts |
| Artifact | Visibly open artifact snapshot | Its placement, workspace, provenance, and links |
| Selection | Explicitly selected artifacts | Current workspace and visible artifact when relevant |
| Thread | Continued conversation history | Visible artifact/workspace remains additional working focus |

Natural focus is predictable: continued thread, then explicit selection, then open artifact, then selected workspace, then global. The compact composer focus control exposes the effective context and lets the user override it. Choosing Global means the visibly open artifact/workspace is not included in the AI packet. Invalid or unavailable overrides fall back to the current natural focus instead of sending stale IDs.

The continued-thread rule preserves Wave 5.5/5.6 behavior: `/chat` threads remain durable conversation history; a placed thread artifact renders that real thread; temporary runs remain temporary until explicitly kept. Continuing a thread does not turn an open artifact into conversation history—the thread supplies history and the artifact is additional focus.

## Selection model and create from selection

Ordinary clicks still open artifacts. Checkmarks are absent during normal browsing. The user must enter explicit multi-select mode from the workspace composer menu, workspace/library controls, artifact library selection control, or the explicit Add to context action in global search.

Multi-select is capped at 12 artifacts. The selection action bar offers controlled prompts for summary, revision guide, and quiz creation, while the normal page composer accepts any explicit request such as compare, create a task, or make a document. The selected IDs are ownership-resolved again on the server. New AI artifacts use the existing Wave 4 `artifact.create` operation/result-card path. Workspace-scoped selection defaults to the current workspace; global selection defaults to Inbox.

Leaving multi-select hides checkmarks without silently destroying a non-empty context selection. Clear removes the selected bundle. Opening or closing Artifact Studio never enters multi-select.

## Bounded AI context packet

`src/features/spectra/ai/context-builder.ts` is the source of truth. The packet is explicit JSON with:

- effective focus and current view;
- workspace title/description, pinned objects, recent run activity, and top relevant objects;
- open artifact title, type, summary, bounded content excerpt, placements, recent provenance, and links;
- selected-object snapshots with bounded excerpts;
- a small global catalog when Global is active;
- capped recent conversation messages for a continued thread;
- omission metadata so the model knows it did not receive the whole workspace.

Hard rules:

- packet target: 48,000 characters;
- artifact excerpt: 3,200 characters;
- selected objects: 12;
- workspace candidates: 14, with at most 10 relevant excerpts and 6 pinned summaries;
- catalog candidates: 18 globally and 8 on focused surfaces;
- conversation: at most 24 messages and 16,000 characters total;
- links: 8 per focused/selected artifact;
- recent activity: 8 runs.

Selection wins over pinning, recency, and prompt relevance. Workspace candidates are scored with explicit prompt terms, pin state, workspace placement, and recency. Full workspace content is never loaded into the model packet. The `AIRun.contextSnapshot` stores the effective mode, selected object IDs, current view, packet version, and capture time for reconstruction without implementing memory.

## Search

Global search opens with `Cmd/Ctrl+K` and is available from Workspace and Artifacts. Results are grouped into Workspaces and Artifacts. Artifact search covers title, summary, tags/type metadata, workspace placement returned with the object, and stored `textIndex`; new and edited artifacts now include bounded structured content text in that index. Results can open a workspace, open an artifact, or explicitly add/remove an artifact from context.

The query is debounced and bounded to 30 artifacts and 12 workspaces. It uses existing indexed/limited Spectra queries rather than loading every artifact body into the browser or introducing vector retrieval.

## Durable artifact links and related suggestions

`spectraArtifactLinks` is the Wave 6 durable primitive. It stores:

- source and target artifact IDs;
- relation type: `related`, `supports`, `contradicts`, `source_for`, `generated_from`, `follow_up`, or `belongs_with`;
- optional label and explanation;
- provenance source and optional run/reason;
- `createdBy`, optional workspace scope, and timestamps.

Artifact deletion removes incoming and outgoing links. AI create-from-selection writes deterministic `generated_from` links to the source artifacts. Artifact Studio shows durable links lightly and computes restrained suggestions from shared workspace, tags, title/summary terms, type, and recency. Suggestions never mutate data: the user must press Confirm link. Advanced visual relation editing remains Wave 8.

## Provenance

Artifacts created by AI can store source artifact IDs, source thread IDs, attachment names, run/thread/workspace IDs, and a compact context summary. Result cards store the matching structured provenance and show a compact expandable “Based on …” line. Artifact Studio shows creation provenance in its details column. This is data, not scraped UI copy, so later context/memory work can rely on it.

Manual artifact versions retain their existing source/run provenance. AI updates remain versioned and reversible through the Wave 5.5 history UI.

## UI direction

Wave 6 keeps the refined editorial-minimal Spectra language: warm paper surfaces, low-contrast dividers, compact borderless actions, and restrained cyan for operational focus. Focus menus, search, selection bars, checkmarks, and provenance details use short spring/fade transitions. Search uses a stable centered command palette; the page-level quick composer remains centered and is never replaced by panel composers.

## Deferred

- long-term/user/workspace memory and automatic memory extraction;
- agents, sub-agents, autonomous orchestration, and complex routing;
- embeddings/vector retrieval, source chunking, OCR, permanent raw-file storage, and full RAG;
- autonomous link creation beyond deterministic create-from-selection provenance;
- advanced canvas relation editing, lasso, semantic zoom, and focus spaces;
- ManageBac and the full study-object quality wave;
- legacy disconnected seeded thread-reference migration.

## Recovery pass — 2026-06-24

Manual testing exposed that the first hooked-up pass did not make several Wave 6 paths usable. Workspace selection existed only in the composer menu, temporary conversation mini-tabs duplicated the real result rows, open conversations were not the natural page-composer target, dismissed rows could return from stale state, search lost the global shortcut conflict, and timeline event cards had weak hierarchy. The recovery pass adds visible **Select objects** controls to Biology/workspace and Artifacts toolbars; keeps normal clicks free of checkmarks; moves **Continue chat** onto the normal result row beside Close; automatically continues the open saved or temporary conversation unless another conversation is explicitly selected; adds a labeled **Save conversation / Save to workspace** action; tombstones dismissed rows; captures `Cmd/Ctrl+K` before the legacy command handler; and makes search available in the workspace and artifact toolbars with open/add-context actions. A new result row now animates in optimistically as soon as a prompt is submitted, and the composer retains its Send action so additional prompts can be submitted while earlier runs are active.

OpenRouter routing was also wrong in practice even though the model id and `provider.order` looked correct. The native DeepSeek endpoint currently rejects OpenRouter's strict `json_schema` response mode; `require_parameters: true` therefore filtered DeepSeek out and consistently selected another host. Spectra now sends a provider-locked primary request with `order` and `only` set to `deepseek`, validates the returned JSON itself, logs the requested and returned provider, and uses a separate explicit structured-output fallback request only after a real native-provider failure. A live request returned provider `DeepSeek`, model `deepseek/deepseek-v4-pro-20260423`, and valid JSON.

Timeline remains date-grouped and tiled, but created artifacts, edits, saved conversations, ordinary runs, and important/failed/active runs now have different density, color, span, and icon hierarchy. Run cards always open run conversation detail; artifact/edit/thread cards open their corresponding artifact surface.

## Manual acceptance tests

1. In Workspace List, click an artifact normally: it opens and no checkmark appears. Close it and confirm selection mode did not start.
2. Enter Select objects, choose 2–4 artifacts, switch the focus chooser between Selection, Workspace, Open artifact, and Global, and verify the label before sending.
3. With a continued thread active, open a normal artifact. Confirm the chooser says the thread continues with the artifact as additional focus, then send and refresh the durable thread.
4. Use Summarise, Revision guide, and Make quiz from a workspace selection. Confirm one controlled result card appears and the artifact lands in that workspace.
5. Repeat from global Artifacts with no workspace scope. Confirm the created artifact lands in Inbox and its result card expands to the correct sources.
6. Press `Cmd/Ctrl+K`. Search a title, stored content phrase, type, and workspace name. Open results and add an artifact to context from the result action.
7. Open an artifact as a full tab. Inspect Placement, Linked artifacts, Related suggestions, Provenance, Tags, and Activity. Confirming a link should persist after reopening.
8. Delete a linked artifact and confirm the peer artifact still opens without a broken relation.
9. Continue a real thread artifact and verify it remains the same conversation; keep a temporary run and verify persistence changes only after the explicit action.
10. Send a broad workspace prompt and inspect run behavior: it should use summaries/pinned/recent/relevant objects, not every artifact in full.

## Automated verification

Completed on 2026-06-22 with the repository Linux Node 24 runtime:

```bash
npx convex codegen
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```

Convex function upload/code generation and validation passed. TypeScript and ESLint passed with zero warnings. Vitest passed 70 files and 371 tests, with 3 live tests skipped. The Next.js production build compiled, type-checked, and generated 107 routes successfully.
