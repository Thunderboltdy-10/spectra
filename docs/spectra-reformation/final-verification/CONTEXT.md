# P8.V1 context and current truth

## Product reading

Reading this as a preserved redesign of a dense realtime student workspace for
school users, with Spectra's calm, spatial, warm-paper language and a restrained
alive quality. Keep the existing token, component, type, radius, layer, and
motion systems. The design dials are **variance: existing**, **motion:
existing + 1 only where state becomes clearer**, and **density: existing**.

`design-taste-frontend` explicitly excludes dashboards, realtime collaboration,
and multi-step forms. Use its audit and copy preflight only where relevant;
Spectra's shared product components and PRODUCT.md control the product UI.
`frontend-design` controls implementation quality. Onboarding is a product flow,
not a marketing page: it should feel light because it asks for few decisions,
not because it hides consequences.

## Current architecture map

| Concern | Existing source of truth | P8.V1 must not create |
| --- | --- | --- |
| ManageBac candidates | `convex/managebac.ts::listMyClassCandidates` and `GET /api/spectra/managebac?action=myClasses` | A second class cache or client-owned provider IDs |
| Create selected shelves | `materializeClassWorkspaces` / `materializeClasses` | Raw workspace inserts or an auto-create-all path |
| Remove generated shelves | `purgeAutoCreatedClassWorkspaces`; contents dissolve to General | Work deletion disguised as deselection |
| Preferences | `settings/schema/preferences.ts`, the canonical resolver, `accountPreferences` | Onboarding-only settings storage |
| Follow | `collaboration/follow.ts` and `follow-ai.ts` | A second follow toggle or viewport controller |
| Status | the shared sync presenter | Page-local invented sync wording |
| Artifact capability | operation IR and shared workbar | UI-only or AI-only capability twins |
| Evidence | `.shots/reformation/P8.V1/manifest.json` plus `run-state.json` | A private chat-only checklist |

The current Settings UI renders Conversations, Writing, Appearance, Workbars,
Devices, and Privacy, while the schema also contains general, AI,
collaboration, compute, notifications, integrations, accessibility, and other
fields. P8.V1 first decides which settings are real launch choices; dead choices
are removed, and real onboarding choices get one editable home.

## Attached 2026-09-03 viewport findings

Pablo's latest screenshots are initial P8.V1 evidence, not isolated styling
requests. They establish six owned hypotheses that the live verifier must
reproduce and either close or disprove:

1. **Bottom occlusion is a shared safe-area failure.** The Dock/composer covers
   the final document lines and the surface cannot scroll them clear. The
   likely class includes `composer-safe-area`, every scroll-owning studio, and
   every supported artifact type. Lowering z-index would only hide the Dock;
   the content viewport needs real trailing space derived from the published
   band.
2. **Comments and embeds are not participating in workbench geometry.** The
   comments pane covers and blurs the document rather than taking a readable
   sibling allocation. Inspect `resolveWorkbenchPanes`,
   `allocateWorkbenchPanes`, `artifact-studio-shell`, panel ownership, and
   sibling insets together. A local width or blur tweak is insufficient.
3. **Top-right action hierarchy is competing with itself.** Two visually equal
   icon clusters make ownership and the primary exit unclear. Count actions by
   corner and intent across shell, artifact header, panel header, and browser-
   like tab chrome; do not merely remove one icon from one screenshot.
4. **The Workspace secondary row lacks a common axis and pressure behavior.**
   View switcher, breadcrumb, search, filters, sort, create, and selection
   actions must share intentional baselines and an explicit overflow order at
   every supported desktop width.
5. **Gate/claim/conflict effects may paint far beyond their subject.** Any
   highlight that floods a large work area is a state-effect geometry defect.
   Its bounds must derive from the claimed region/object, with a restrained
   fallback when exact geometry is unavailable.
6. **Simple Office style fidelity is not established by showing controls.**
   Font family, size, weight, italic, decoration, and selected-state controls
   must agree with the semantic projection and rendered content after reload.
   A wrong bold or 11-point value makes complex formatting unproved, not
   cosmetically imperfect.

Use the screenshot reasoning chain for every visual finding:
`observation -> user consequence -> owning geometry/state engine -> sibling
consumers -> class-wide repair -> before/after sequence at all affected
surfaces`. Code search starts only after the person-shaped observation has been
recorded. The repair is not complete while another consumer of the same engine
can still recreate the failure.

## Onboarding contract

A first signed-in school user should reach useful work without understanding
Spectra's architecture. The flow has three jobs:

1. Explain the workspace in one screen-length moment and let the person
   continue. No feature tour carousel.
2. After ManageBac identity is verified and the personal bootstrap data exists,
   ask which classes should appear. Show human class names, allow search, make
   selection explicit, and allow Skip for now. Never infer relevance from a
   provider record merely because ManageBac retained it.
3. Ask only preferences that materially change the first session. Each one
   names where it can be changed later. Do not collect settings for their own
   sake.

The result is resumable after refresh, idempotent after double submit, and safe
when ManageBac is disconnected, stale, empty, partially synced, or returns many
old classes. A failed integration does not block the core workspace. Selection
can always be revisited from School or ManageBac; preference choices can always
be revisited in Settings.

Current launch gap: the backend class path exists but no first-run UI or later
selection UI calls it. That is a SYSTEMIC missing-entry-flow class owned by
P8.V1.

## RC.V1 deduplication map

Do not repeat the following unless a P8 repair touches their implementation:

- real EE rendering, OMML/table inventory, Keep Word adoption, DOCX workbar
  coverage, and package preservation;
- Physics IA initial rendering, React cell commit, formula inventory, Keep
  Excel semantic durability, XLSX workbar refusals, and package comparison;
- Econ deck slide walk, notes/AI exercise, native PowerPoint round trip, and
  PPTX workbar inventory.

Only the three carryovers in README remain. Evidence comes from
`.shots/reformation/RC.V1/` and the RC closeout note. The stale `blocked` field
in RC's old JSON manifest is historical drift; STATE and the dated closeout
note are the authoritative closure record.

## Finding families P8 composes

Read these compendium entries before their cards:

- truth and recovery: SYS-1 through SYS-4, BR-3 through BR-6, CS-1 through
  CS-3, ST-1/ST-2;
- AI and multi-actor: AI-1 through AI-13, UX-5, UX-12, PERF-3;
- controls and discoverability: CMD-1 through CMD-6, UX-1/UX-2, UX-6 through
  UX-11, UX-13/UX-14;
- persistence/preferences: PREF-1 through PREF-3, PKG-2/PKG-3;
- security/privacy: SEC-1 through SEC-8 and SBX-1 through SBX-5;
- visual/accessibility: DS-1 through DS-6 and PERF-1 through PERF-6;
- evidence integrity: TEST-1 through TEST-3 and GOV-1/GOV-2.

Most were repaired by earlier units. P8 uses them as adversarial shapes, not as
proof that current code is still broken.

## Convex cost truth

Pablo's 2026-09-03 dashboard evidence showed 1M function calls, 1 GB database
I/O, and 1 GB data egress. Historical concentration included:

| Function | Evidence |
| --- | ---: |
| `identity.me` | 197K calls |
| `collaborationGatewayBridge.exchange` | 113K calls; 1.1 GB-hours; 343.11 MB egress |
| `spectraRuns.listTabs` | 54K calls; 5.11 GB database I/O |
| `plannerReminders.dispatchDue` | 12.81 GB database I/O |
| `spectraArtifacts.list` | 12.51 GB database I/O |
| `replicas.sweepReplicaTruth` | 10.34 GB database I/O |
| `spectraRuns.reconcileStaleRuns` | 6.08 GB database I/O |
| `bridgeSync.claimPendingPayloadUpload` | 4.96 GB database I/O |

Some implementations have since changed, so these numbers are a lead, not a
current verdict. Current local logs already expose exact `usageStats` for every
function. Use `scripts/convex-window.mjs` to establish action, idle, and cron
windows on the candidate. It records call counts, database documents and bytes,
storage, network egress, return bytes, execution time, caller, and environment
without recording arguments or user content.

## Actors and environments

- **A:** signed-in school administrator, ManageBac-compatible, default profile
  `.playwright-cli/spectra-session`.
- **B:** second signed-in human for collaboration, profile
  `.playwright-cli/spectra-session-b`. B currently has no compatible ManageBac
  classes; do not use B to grade class selection.
- **AI-1 and AI-2:** distinct durable runs with distinct run/actor IDs. They are
  not simulated cursors.
- **Bridge:** one disposable data directory pointed at the selected local
  Convex instance and a sacrificial mounted copy only.
- **Office:** hidden desktop/COM only when browser evidence cannot prove native
  readback. The desktop is cleaned up after every card.

The local Hocuspocus gateway is the composition under test. Fly.io remains an
operational risk until its real deployment is performed; local evidence must
not claim otherwise.
