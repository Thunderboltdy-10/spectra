# Workbar and Artifact Capability Contract

This document is the durable technical contract for extending Spectra's editor capabilities after N8. It describes the protocol boundary that must remain stable while Document, Sheets, and Presentation features grow.

## 1. Shared semantic model

The command record in `src/features/spectra/commands/` is the sole vocabulary shared by humans, AI, choreography, settings, and native materialization:

```ts
type Command = {
  id: string;
  domain: `artifact:${WorkType}` | `app:${string}`;
  title: string;
  params?: ZodSchema;
  execute: (ctx: CommandContext, params: unknown) => Promise<unknown> | unknown;
  availability: (ctx: CommandContext) => Availability;
  presentation: { kind: ControlKind; compact: ControlSpec; medium: ControlSpec; expanded?: ControlSpec };
  defaultPlacement: { tab: string; group: string; order: number };
  contextualTab?: string;
  risk: Risk;
  undo: UndoModel;
  choreography?: ChoreographyHint;
};
```

The exact local types may evolve, but the invariants do not:

- One command id, one execute implementation.
- Human controls, keyboard shortcuts, menus, context actions, and AI all dispatch the same semantic operation.
- Availability is shared between UI and AI.
- Authority is evaluated server-side before execution.
- Every mutation is attributable, reversible where promised, and reflected in live surfaces.
- Choreography is a projection of a committed semantic operation, never the mechanism that makes it happen.

## 2. Workbar taxonomy and defaults

The default layouts should be capable on first open while remaining compact. `General` is a real favorites surface, not a placeholder.

| Artifact | Tabs | General defaults | Contextual tabs |
|---|---|---|---|
| Document | General, Insert, Format, Layout, References | Find, Undo, Redo, Outline, Comments, Font, Size, Bold, Italic | Equation, Table, Image |
| Sheets | General, Insert, Format, Data, Formula, Review | Undo, Redo, Find, Format, Formula, Freeze, Chart | Chart, Formula |
| Presentation | General, Insert, Design, Arrange, Animate, Present | Undo, Redo, Add slide, Duplicate, Design, Present | Shape, Transition |

Defaults are a starting point, not a second hard-coded system. The registry owns default placement and the preference layer owns user/AI overrides: pinning, tab movement, ordering, label, density, visibility, expanded mode, and tab order.

## 3. Capability classifications

Every feature is classified per native format:

- `NATIVE`: semantic structure and round-trip are directly modeled and asserted.
- `EQUIVALENT`: the user-visible result is equivalent but represented differently in the native package.
- `PRESERVED`: the feature is not editable in Spectra but its native parts survive unrelated edits byte/structure-safely.
- `ADAPTED`: import/export conversion is explicit and lossy in a documented boundary; it is not a live sync promise.
- `UNSUPPORTED`: the product refuses the operation truthfully and leaves source bytes untouched.

Never claim `NATIVE` from a screenshot. Native claims require a fixture, a part-level assertion, a reopen check, and a conflict/reload case where relevant.

## 4. Document feature map

Document commands must cover the semantic model needed for serious writing: styles/headings, font and text marks, colors, alignment, spacing, lists, quotes, links, comments, find/replace, page and section layout, headers/footers, breaks, tables, images/captions, equations, footnotes/endnotes, references/bibliography, TOC/fields, review/tracked-change views, and safe import/export.

DOCX mutation remains OPC-part-level. Preserve fields, tracked changes, sections, text boxes, SmartArt, OLE, custom XML, macros, and unknown parts. If a capability cannot be safely expressed, expose it as preserved/read-only or unsupported rather than flattening it.

## 5. Sheets feature map

Sheets commands must cover range/cell formatting, number formats, borders/fills, alignment/wrap, row/column structural operations, freeze/hide/resize, sort/filter, tables, named ranges, validation, conditional formatting, formula insertion and formula-bar editing, charts, comments/notes, find/replace, sheet lifecycle, view/zoom, import/export, and truthful formula compatibility.

An unknown formula is never rewritten or replaced with a cached literal. XLSX parts for formulas, charts, tables, comments, custom XML, macros, and ActiveX must be preserved or mutated independently according to their classification.

## 6. Presentation feature map

Presentation commands must cover slide lifecycle and order, layouts/placeholders, text styling, fills/borders, images, shapes, grouping, alignment/distribution, z-order, guides/grid, themes/backgrounds, transitions, animation timing, speaker notes, sources/links, charts/tables/equations, import/export, Present, and Rehearse.

PresentationML masters, transitions, animation timing, media, OLE, charts, and unknown parts survive unrelated edits. A generated approximation is never an acceptable fallback for a linked deck.

## 7. AI, Bridge, and provider extension

New commands are automatically eligible for AI only after registry registration, authority mapping, typed parameters, and availability parity. Settings/workbar changes remain always-confirm. Local filesystem effects name the concrete consequence and require confirmation. Prohibited security and account actions remain server-refused.

Native materialization consumes semantic operations and the format-specific lens contract. The Bridge transports and journals writes; it must not interpret office formats. Future Google and Notion providers should implement the same semantic command and fidelity contracts behind provider adapters rather than adding UI-local exceptions.

## 8. Required evidence per capability

For every command, record:

1. Registry id and owning studio.
2. Human and AI execution test.
3. Availability/authority result.
4. Undo/recovery behavior.
5. Choreography target and no-choreography semantic result.
6. Native format classification.
7. Fixture/harness assertion when a native package is affected.
8. Reload and Bridge round-trip result.
9. Unsupported/preserved feature proof.
10. Chrome screenshot at realistic density when user-facing.

The acceptance report should be generated from this table where practical so a future agent can see omissions immediately.

## 9. Explicit cut line

Do not broaden into N9 embeds, N10 convergence, identity work, or multiplayer finalization while this contract is incomplete. If a feature cannot clear the evidence bar, ship it as preserved/read-only or defer it with a reason. Reliability and truthful state outrank breadth.
