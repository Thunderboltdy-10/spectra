# Wave 4 — AI Run / Operation Engine Plan

Generated on 2026-06-19 before Wave 4 implementation.

## Position

Wave 4 makes the existing Spectra command surfaces perform real, controlled AI work. It builds on the approved Wave 2B workspace/artifact visual foundation and the Wave 3B Artifact Studio. It must not redesign their rails, tabs, split panels, inspectors, blueprint editors, or command dock placement.

The shared backbone is:

```txt
prompt → durable AIRun + running ResultCard → surface-aware context
→ fixed OpenRouter structured plan → strict validation and policy
→ proposed Operation rows → confirmation when required
→ server-owned execution → synchronized objects → clean final summary
```

The model never receives a generic mutation tool and the browser never executes model-authored database writes directly.

## Surface Contracts

### `/chat`

- Conversational and allowed to return a fuller assistant answer.
- Every submitted user message is associated with an AIRun.
- Existing chat/thread presentation remains intact in Wave 4; full Thread/Message convergence remains Wave 5.
- Artifact creation uses the validated engine and creates an unplaced library/inbox artifact unless placement is explicitly requested.

### `/workspace`

- Action-oriented; simple commands do not create visible threads.
- Current workspace and optional focused artifact are context hints, not mandatory targets.
- An artifact created while operating in a workspace is placed there by default unless the prompt explicitly says otherwise.
- Final output is normally one compact sentence in a ResultCard.
- Workspace creation is never autonomous and always requires confirmation.

### `/artifacts`

- Library/object-management oriented.
- Commands may summarize library context, create inbox artifacts, update a specifically requested object, or change placement.
- A general library command does not silently pick an artifact merely because one was recently focused.
- New artifacts remain unplaced unless the user explicitly requests a workspace.

### Artifact Studio

- Uses the artifact surface and the open artifact as a strong context hint.
- Focus is defeasible: if the user names another object or asks for general work, do not mutate the open artifact.
- Safe updates may patch the open artifact; generated quizzes/decks are separate artifacts unless the user asks to update a compatible open artifact.
- Completed changes refresh canonical data so workspace, artifacts, split Studio, and full tabs converge.

## Structured Planning Contract

The fixed model returns one strict JSON object:

```ts
type SpectraPlan = {
  finalResponse: string;
  operations: Array<
    | { type: "artifact.create"; input: ArtifactCreateInput }
    | { type: "artifact.update"; input: ArtifactUpdateInput }
    | { type: "workspaceItem.add"; input: PlacementAddInput }
    | { type: "workspaceItem.hide"; input: PlacementHideInput }
    | { type: "workspace.create"; input: WorkspaceCreateInput }
  >;
};
```

Supported blueprint content is constrained to `document`, `flashcard_deck`, `quiz`, `planner_task`, and `thread_reference`. Flashcard/question sets are arrays inside one artifact; their item count is not a visible-object bulk count.

Unsupported operations, unknown fields, invalid IDs, wrong blueprint content, excessive text/array sizes, and cross-owner objects fail before execution.

## Safety and Confirmation Policy

Direct execution is allowed for one explicitly requested artifact creation, a validated update to one owned artifact, one placement add/remove, and result-card/status updates.

Confirmation is required for every `workspace.create`, more than one visible-object creation, more than three mutations, bulk placement/reorganization, and destructive/sharing/publishing/custom-blueprint work. The latter categories are not model-executable in this wave.

Hard limits reject pathological plans: no run may create more than five artifacts or execute more than eight operations. Confirmation revalidates stored operations and ownership before execution.

## Streaming Progress Protocol

The run endpoint returns newline-delimited JSON (`application/x-ndjson`). Each line is one independently parseable event:

```ts
type SpectraStreamEvent =
  | { type: "run_created"; run: AIRunView; card: ResultCardView }
  | { type: "status"; runId: string; message: string }
  | { type: "operation_preview"; runId: string; operationId: string; operation: SafeOperationPreview }
  | { type: "operation_commit"; runId: string; operationId: string }
  | { type: "operation_result"; runId: string; operationId: string; affected: AffectedObject[] }
  | { type: "confirmation_required"; runId: string; card: ResultCardView }
  | { type: "result_card"; runId: string; card: ResultCardView }
  | { type: "final"; runId: string; summary: string; card: ResultCardView }
  | { type: "error"; runId?: string; message: string; card?: ResultCardView };
```

Statuses are derived from the real request context and validated operation, for example “Reviewing Biology context”, “Validating 6 cards”, and “Saving deck to Biology”. Generic filler such as “Planning safe operations” is prohibited. Statuses render only in the activity tray and are never concatenated into assistant content.

No model-emitted progress tags are used. Accidental tag injection is therefore impossible, and saved `finalSummary` contains only the clean result. The stream pauses only for the model, real commits, confirmation, or retry.

## Result Cards

- Persist until explicitly hidden; hiding patches `hiddenAt` and never deletes the run.
- Render queued/running/completed/failed/confirmation states in the existing compact tray.
- Confirmation cards expose Confirm and Cancel actions.
- Completed artifact operations expose Open when an affected artifact exists.
- Hidden-card history remains a Wave 5 right-hub responsibility, but persistence ships now.

## Implementation Packages

1. Harden Zod plan/operation schemas, blueprint validation, limits, and confirmation policy.
2. Add Convex operation persistence, result-card listing/patching, and AI provenance.
3. Add `/api/spectra/run` NDJSON endpoint with fixed OpenRouter structured output, context builder, execution, and confirmation.
4. Add a shared client run hook for strict NDJSON parsing, live cards, confirm/cancel/hide, and canonical refresh.
5. Connect `/workspace`, `/artifacts`, and Artifact Studio through existing command docks.
6. Associate `/chat` submissions with the AIRun lifecycle while preserving conversational rendering.
7. Add policy/schema/protocol tests and update future-wave docs only where scope moved.

## Non-Goals

- complex routing, agents, multi-agent orchestration, ManageBac, or admin analytics;
- full chat/thread convergence;
- advanced canvas intelligence or autonomous relation generation;
- custom blueprints, sharing/publishing, or autonomous deletion;
- private reasoning, thinking traces, or model-authored progress tags.

## Manual Completion Test

- Create a document, deck, quiz, and task from workspace; verify placement.
- Create from `/artifacts`; verify inbox placement.
- Update an open split/full-tab artifact; verify all surfaces refresh.
- Ask a general question while focused; verify focus does not force mutation.
- Request a workspace or multiple artifacts; verify nothing changes before Confirm.
- Hide a result card; verify its run persists.
- Trigger a model/config failure; verify one clean failed card.
- Verify `/chat` remains unchanged; shared Thread/Message/AIRun convergence is a Wave 5 manual test.

## Stabilization outcome (2026-06-20)

The first implementation attempt was audited in `WAVE_4_STABILIZATION_AUDIT.md` and then stabilized. Schema-shape drift, confirmation misfires, operation relevance, real Convex id boundaries, same-run retry lifecycle, stale card restoration, the compact unified active-run tray, temporary run details, and operation-derived progress copy are now implemented and covered by focused tests.

Focus remains a visible hint in Wave 4. Manually selectable focus belongs to the later workspace intelligence/context wave. Full persistent thread artifact UI and `/chat` convergence remain Wave 5.

## Implemented outcome

Implemented in Wave 4:

- fixed-model OpenRouter structured planning endpoint;
- strict server-owned operation schemas, blueprint validation, ownership checks, explicit-intent policy, hard object limits, and durable operation logs;
- persisted AIRun/ResultCard lifecycle with a distinct awaiting-confirmation state, hide/keep, same-run retry, confirm/cancel, affected-object actions, and AI creation provenance;
- structured NDJSON progress events with no model-emitted status tags;
- one compact two-row activity tray plus a temporary right run-detail panel on workspace, artifacts, and Artifact Studio command docks;
- direct artifact create/update and placement add/remove operations;
- workspace and multi-object confirmation gates with confirm-time intent, ownership, and real-id revalidation;
- canonical refresh across workspace, artifacts, and Studio, including a guard against overwriting unsaved Studio edits;
- operation-derived progress such as card/question validation and the real workspace destination;
- bounded page-per-invocation repair for the separate `refreshPlatformStats` Convex pagination bug.

Still deferred by design:

- full `/chat` Thread/Message convergence and inline operation/result-card presentation;
- hidden-card browser/right run-thread hub;
- manually switchable focus chips and multi-selection;
- destructive, sharing, publishing, custom-blueprint, relation-generation, agent, ManageBac, and advanced canvas operations;
- richer study engines and quiz grading.

The existing `/chat` route still uses the pre-rebuild pipeline until Wave 5, but no new Spectra engine module imports or delegates to it. Wave 4's attempted chat wrapper was removed to keep the boundary honest.
