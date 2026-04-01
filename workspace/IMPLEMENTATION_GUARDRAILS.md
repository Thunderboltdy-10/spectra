# Implementation Guardrails

This file is not the build plan in code-level detail. It is the product guardrail document that should constrain the implementation.

## 1. Shared Engine First

Do not implement three separate products.

Build:

- one canvas data model,
- one camera model,
- one widget/artifact renderer pipeline,
- one utility hub system,
- one push-panel system,
- one command-surface component,
- one preview toggle framework for shells.

Then apply shell-specific presentation and interaction layers.

## 2. Preserve and Restore

Things to preserve:

- infinite canvas foundation,
- right push-panel concept,
- artifact versioning direction,
- workspace shortcuts,
- timer utility,
- AI-driven creation and editing.

Things to restore or improve:

- cleaner spotlight command surface instead of the current dense hub-strip input,
- stronger panel handoff animation,
- better timer configuration access,
- fit-to-bounds entry framing,
- no accidental zoom commitment.

## 3. Hard Preview Toggles

The preview system should expose hard switches between the three primary shells.

Example:

```text
[A Constellations] [B Magnetic Surface] [C Focal Lenses]
```

Why:

- direct comparison,
- easier decision-making,
- less ambiguity than mix-and-match design labs,
- still allows shared internals underneath.

## 4. Safe Customization Model

Customization should be enabled but bounded.

Allowed:

- drag widgets,
- resize widgets,
- pin and reposition compatible utilities,
- adjust workspace colors,
- ask AI to reorganize or improve a workspace.

Not allowed:

- placing the command bar in impossible orientations,
- arbitrary free placement of every utility everywhere,
- layouts that hide core controls completely with no recovery path.

## 5. AI Safety and Clarity

Never let AI feel magical in the bad sense.

Required:

- provenance on every material mutation,
- revert and restore actions,
- clarification chips when scope is ambiguous,
- no casual spontaneous workspace creation,
- error boundaries for custom widgets,
- `Fix with AI` affordance on broken generated widgets.

## 6. UX Metrics the Redesign Should Optimize

The redesign should visibly improve:

- first-use comprehension,
- time-to-open-thread,
- time-to-open-document,
- time-to-enter-workspace,
- number of accidental state changes,
- number of camera surprises,
- speed of recovering from AI mistakes.

## 7. Visual Bar

The redesign should feel:

- calm,
- rich,
- spatially legible,
- premium,
- not ornamental for its own sake.

Avoid:

- generic productivity SaaS layouts,
- repeated rounded cards everywhere,
- heavy persistent bars that crush the viewport,
- over-animated chrome.

## 8. Current Codebase Notes

The current implementation already contains useful primitives, but they are misassembled.

Observed issues from the current code:

- the hub is currently too monolithic,
- zoom-band assumptions still shape behavior and terminology,
- internal workstream rendering is canvas-native but visually too list/card-like,
- the spotlight command surface has been diluted by the newer hub treatment,
- state and panel logic still assume a more rigid committed-workstream model than the new UX wants.

This means the redesign should mostly be a disciplined re-architecture of interaction and rendering, not a blind rewrite of every primitive.

## 8A. Current Codebase Conclusions

After deeper inspection, these are the practical conclusions:

- `workstreamMemory` and clarification interrupts are stronger than the current workspace UX suggests and should be explicitly integrated into the redesign.
- ManageBac already creates subject workstreams and CAS, so default creation should build on that instead of replacing it.
- The backend lacks a first-class widget instance model, which is the biggest structural gap between the current app and the target product.
- The artifact type system is too narrow for whiteboards and richer visual widgets.
- The current shell builders in the frontend are useful prototypes, not final abstractions.

## 9. What Must Be Demo-Ready Before Wider Refactor

Before deep implementation, the team should be able to demo:

1. shell toggle between A, B, and C,
2. explicit click-only workspace enter / exit,
3. improved command surface,
4. right-panel handoff animation,
5. one AI-created widget with revert / restore,
6. one whiteboard artifact in the panel,
7. one hidden-edge utility reveal flow.

If those seven things do not feel coherent, the redesign is not ready for broader migration.
