# Protocol-Level Abstractions — Document, Sheets, Presentation

**Audience:** implementation lead for the Workbar and Artifact Capability pass (post-N8).  
**Sources:** `WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT.md`, `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md`, CANON D33–D34/D41, ARCHITECTURE-COMMANDS/AI/FIDELITY/BRIDGE, N7/N8 briefs, and current code in `src/features/spectra/commands/`, `artifact-workbar.tsx`, the three Office studios, preference store, and fidelity harnesses.  
**Note:** Per-type inventory files (`DOCUMENT-CAPABILITIES.md`, etc.) do not exist yet; inventories below are derived from the live studios, registry, and contract defaults.

---

## Executive summary

The shared protocol is **real and testable** (N2/N8 accepted), but **capability depth and default workbar population are incomplete** for the three Office editors (STATE Field Note 2026-08-22). The correct integration strategy is:

1. **One registry, one renderer, one execute path** — extend `Command` / `CommandBinding` and mount typed handlers in each studio; do not fork workbars, preference stores, or AI mutation paths.
2. **Extract cross-type semantic families** (history, find, export, comments, formatting primitives, structural insert) into shared command modules and shared UI shells; keep format-specific lenses and selection models artifact-local.
3. **Generate and gate a capability matrix** from registry + manifest + harness — not from screenshots.
4. **Treat General as a real favorites surface** with deliberate defaults per contract; many contract-listed defaults are not yet registered commands.

---

## 1. Shared command / workbar protocol patterns

### 1.1 The invariant stack (do not violate)

| Invariant | Where enforced | Implication for Office editors |
|---|---|---|
| **C1** — one `execute` per operation | `commands/types.ts`, studio handlers | Every toolbar button, shortcut, inspector toggle, and AI tool must call the same handler. `RichTextFormatBar` direct TipTap chains are a **C1 defect** until wrapped as registered commands. |
| **C2** — shared availability for UI and AI | `command.availability(ctx)` | `CommandContext` must include `compatibilityProfile`, `fidelity` map, `selection`, and `can()`. AI tool offers must be derived from the same function. |
| **D33** — registry is the product language | `artifacts/registry.ts` operations → namespaced ids | Manifest operations (`document.inspect_outline`, `sheets.set_formula`, …) must map 1:1 to command ids (`document.inspect.outline`, …) with documented aliases during migration. |
| **D34** — one customizable surface per artifact | `ArtifactWorkbar` + `preferences.workbar` | No second format bar, no permanent inspector row that duplicates registry commands. |
| **D41** — one capability, one component | N7 explicit | Find, zoom, undo/redo, export copy, comments panel entry — **write once, mount in all three types**. |

### 1.2 Current pipeline (keep this shape)

```
Studio declares CommandBinding[] 
  → commandForBinding(type, binding) → Command
  → resolveCommandLayout(command, preferences.workbar[type])
  → ArtifactWorkbar filters by tab / availability / priority
  → executeCommand(command, commandContext(...))
```

Key files:

- `src/features/spectra/commands/registry.ts` — tab taxonomy, inference, layout resolution
- `src/features/spectra/commands/types.ts` — `Command`, `CommandBinding`, `CommandLayout`, `CommandContext`
- `src/features/spectra/components/artifact-workbar.tsx` — sole renderer (42px, priority shedding, customization UI)
- `src/features/spectra/settings/preference-store.ts` — account-synced `workbar` section, live propagation via `update("workbar", …)`

### 1.3 Namespacing and id stability

- **Rule:** `stableId(type, id)` → `{type}.{segments}` (e.g. `sheets.freeze.rows`).
- **Never change ids** when moving tabs, renaming labels, or changing density — only `defaultPlacement` and preference overrides change.
- **Manifest alignment:** `command-surface.test.ts` already requires every manifest operation to start with `{type}.`; extend that test to require a registered `Command` record for each operation the AI can invoke.

### 1.4 Priority model (width survival)

Shared across all types in `ArtifactWorkbar`:

| Priority | Bar behavior | Contract role |
|---|---|---|
| `essential` | Always in bar on General; max **5** per bar | Undo, Redo, Find, primary type verb |
| `secondary` | In bar until `tight` density | Outline, Sources, mode toggles |
| `advanced` | Always in `⋯` overflow on General | Export copies, destructive structure, import |

**Category-tab rule:** When `activeTab !== "General"`, the bar promotes up to 5 commands from that tab into the row; remainder go to the same `⋯` menu (never duplicated).

### 1.5 Selection → availability

Pattern already used:

- **Document:** `selectionContext` from TipTap (`Table` | `Image` | `Equation`)
- **Sheets:** `Chart` | `Formula` from chart selection / formula bar
- **Presentation:** `Shape` | `Transition` from object / slide transition

**Abstraction:** `selectionContext` is a **string enum per type** declared in `registry.ts` `contextualByType`; studios only emit values from that set. Commands declare `contextualTab` matching the enum.

### 1.6 Cross-type command families (protocol-level)

These should become **shared command modules** (`commands/shared/`) with type-parameterized execute delegates:

| Family | Stable id pattern | Document | Sheets | Presentation |
|---|---|---|---|---|
| History | `{type}.history.undo` / `.redo` | Missing from bindings* | Present | Present |
| Find | `{type}.navigate.find` | Present | Present (inspector) | Defer to shared find shell |
| Replace | `{type}.navigate.replace` | Partial (panel) | Inspector | — |
| Export copy | `{type}.export.{format}` | Present | Present | Via inspector |
| Import copy | `{type}.import.copy` | Present (`strictNative: false`) | Present | File input |
| Print / PDF | `{type}.export.print` | Present | — | Presenter output |
| Comments | `{type}.review.comments` | Panel (not command) | Notes | — |
| Zoom | `{type}.view.zoom.{in,out,reset}` | — | Present | Canvas zoom in studio |
| Outline / structure | `{type}.navigate.outline` | Present | Sheet tabs | Slide rail |

\*Contract General defaults list Undo, Redo, Font, Bold, Italic for Document — **not yet `CommandBinding` entries**; formatting lives only inside `RichTextFormatBar` tab children (C1 gap).

### 1.7 Strict-native gating

`CommandBinding.strictNative?: { available: boolean; reason?: string }` is the per-command gate. Pattern from Document import/templates:

```ts
strictNative: {
  available: false,
  reason: "Import a copy from the Library so the linked Word file is not replaced.",
}
```

**Protocol rule:** Any command that replaces whole package, flattens preserved regions, or literalizes formulas must declare `strictNative.available: false` with a concrete reason. Export-copy commands are non-mutating and stay enabled.

---

## 2. Common UI tab / group abstractions

### 2.1 Tab taxonomies (canonical)

From `COMMAND_TABS` in `registry.ts` (verified by `command-surface.test.ts`):

| Type | Static tabs | Contextual tabs |
|---|---|---|
| Document | General, Insert, Format, Layout, References | Equation, Table, Image |
| Sheets | General, Insert, Format, Data, Formula, Review | Chart, Formula |
| Presentation | General, Insert, Design, Arrange, Animate, Present | Shape, Transition |

**General** is always first; user `tabOrder` in preferences may reorder but cannot remove General.

### 2.2 General = favorites (not empty)

Contract defaults (`WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` §2):

| Type | Contract General defaults | Current studio state |
|---|---|---|
| Document | Find, Undo, Redo, Outline, Comments, Font, Size, Bold, Italic | Find, Outline only in bindings; formatting in tab child only |
| Sheets | Undo, Redo, Find, Format, Formula, Freeze, Chart | Undo, Redo, Format, Chart, Find — **close**; Formula/Freeze in advanced |
| Presentation | Undo, Redo, Add slide, Duplicate, Design, Present | Add slide, Undo; Present is `primary`; Redo secondary; Design in advanced |

**Action:** Add `general: true` on bindings (or post-process defaults) so `commandForBinding` places them in General regardless of inference. Populate on first open via default layout seed in preferences, not empty shell.

### 2.3 Groups within tabs

- `defaultPlacement.group` defaults to tab name; use **semantic groups** for expanded mode: `font`, `paragraph`, `clipboard`, `structure`, `review`, `export`.
- **Expanded mode** (`CommandLayout.expanded`): vertical grouped clusters in workbar — same command ids, richer `presentation.expanded` specs.
- **No global button** across all tabs (agent prompt Phase 2); reset defaults is per-type customization control in workbar settings gear.

### 2.4 Contextual tabs

Activation rules (shared):

1. Studio sets `selectionContext` string matching `contextualByType[type]`
2. `tabsFor(type, selectionContext, layout)` appends contextual tab after static tabs
3. When selection clears, `useEffect` in workbar returns active tab to General (or prior non-contextual tab)
4. Commands with `contextualTab` appear **only** when that tab is active **or** when command is pinned to General

Dismissal: changing selection away from `Table` must not leave user on empty Table tab.

### 2.5 Overflow and density

| Mechanism | Behavior |
|---|---|
| `priority` | Determines bar vs `⋯` on General |
| `contract.density === "tight"` | Sheds `secondary` to menu on General |
| `storedLayout.commands[id].density` | Per-command compact/medium via `resolveCommandLayout` |
| `presentation.compact` / `.medium` | Icon-only vs labeled control |
| Category tab cap | Max 5 in bar, rest in menu — deterministic, no duplicate listing |

**D41 requirement:** Font family/size controls should be one shared `WorkbarFontControl` used by Document and Presentation (Presentation text objects); Sheets uses cell format inspector but number format can share `WorkbarNumericFormat` where semantics align.

### 2.6 Shared shells (implement once)

| Shell | Used by | Mount point |
|---|---|---|
| `FindReplaceShell` | Document, Sheets | Workbar child or inspector panel; command toggles open state |
| `CommentsShell` | Document, Sheets | Review tab + General pin |
| `ExportMenuShell` | All three | Advanced overflow; formats from `WorkInteroperabilityContract.exports` |
| `RichTextFormatBar` | Document (exists) | Format + Insert + contextual Table; **wrap actions as commands** |
| `WorkbarItemSelector` | Sheets, Presentation | Sheet/slide `< n of N >` — already shared |
| `OutlinePanel` | Document | Maps to `document.navigate.outline` |

---

## 3. Shared semantic models

### 3.1 Layering

```
Native package (DOCX/XLSX/PPTX)
  ⇅ lens (part-level mutate + preserved carry)
Semantic model (per-type Zod/Yjs)
  ⇅ typed operations (artifacts/registry operations)
Command registry (human + AI surface)
```

AI **never** skips the semantic model to poke OOXML. Bridge **never** interprets formats — only bytes + revision (ARCHITECTURE-BRIDGE §5, §7).

### 3.2 Cross-type semantic domains

Define **protocol-level operation schemas** (Zod) reused by commands and AI tools:

#### 3.2.1 Text formatting (`TextFormatPatch`)

Shared fields: `fontFamily`, `fontSize`, `bold`, `italic`, `underline`, `strike`, `color`, `highlight`, `alignment`, `lineHeight`, `letterSpacing`.

| Type | Target region | Native mapping |
|---|---|---|
| Document | `stable block` / `text selection` | DOCX runs/styles — NATIVE/EQUIVALENT |
| Presentation | `slide object` text frame | DrawingML — NATIVE/EQUIVALENT |
| Sheets | cell `format` | XLSX `xf` — NATIVE/EQUIVALENT |

**One command schema, three execute adapters** bound by `workType`.

#### 3.2.2 Structural insert (`InsertSpec`)

Union: `paragraph`, `heading`, `list`, `table`, `image`, `equation`, `shape`, `chart`, `slide`, `row`, `column`, `pageBreak`, `sectionBreak`.

Each variant carries `placement` (anchor id, index, before/after) — **never pixel coordinates** (ARCHITECTURE-COMMANDS §7, agent prompt Phase 6).

#### 3.2.3 Find / replace (`FindReplaceQuery`)

```ts
{
  query: string;
  replace?: string;
  scope: "selection" | "sheet" | "document" | "workbook" | "deck";
  matchCase?: boolean;
  wholeCell?: boolean; // sheets
  regex?: boolean;
}
```

Document already has `documentFindPattern` / `FindOptions` in `editor/document-navigation.ts` — **promote to shared module**.

#### 3.2.4 Comments / review (`CommentAnchor`)

Shared anchor kinds from work contracts: block, range, cell, slide. Operations: `add`, `reply`, `resolve`, `delete`. Document comments map to Word comment parts where safe (N4 PRESERVED/NATIVE promotion path).

#### 3.2.5 Export / import boundary (`CopyExportSpec`)

```ts
{
  kind: "export-copy" | "import-copy";
  format: string; // docx, pdf, xlsx, csv, pptx, ...
  lossy: boolean; // always true for import-copy; explicit for export-copy
}
```

**Never** on sync path (ARCHITECTURE-FIDELITY §9). Commands must set `risk: "confirm"` when overwriting user files on disk via Bridge.

#### 3.2.6 Sheet-specific shared with Presentation

- **Charts:** `ChartSpec` owned by Sheets; Presentation `generate_chart` binds to range — reuse chart command implementation (N7 W4).
- **Tables:** Document table commands and slide table objects share table mutation helpers where OMML/DrawingML allows.

### 3.3 Manifest operations → command mapping

Operations in `artifacts/registry.ts` are the **AI semantic vocabulary**. Each needs:

| Manifest op | Proposed command id | Workbar tab (default) |
|---|---|---|
| `format_blocks` | `document.format.selection` | Format |
| `insert_equation` | `document.insert.equation` | Insert / Equation |
| `set_formula` | `sheets.formula.set` | Formula |
| `sort_filter` | `sheets.data.sortFilter` | Data |
| `add_slide` | `presentation.slide.add` | General (pinned) |
| `apply_theme` | `presentation.design.theme` | Design |
| `rewrite_object` | `presentation.object.rewrite` | Shape |

Generate this table mechanically in Phase 1 audit (§6).

---

## 4. Unified fidelity classification patterns

### 4.1 Vocabulary (per feature, never per file)

From ARCHITECTURE-FIDELITY §2 and CONTRACT §3:

| Class | Meaning | Command behavior in `strict-native` |
|---|---|---|
| **NATIVE** | Modeled + round-trip asserted | Enabled |
| **EQUIVALENT** | Different representation, same user result | Enabled |
| **PRESERVED** | Not editable; survives unrelated edits | Read-only UI or disabled with reason |
| **ADAPTED** | Explicit lossy import/export only | Enabled only on import/export-copy commands |
| **UNSUPPORTED** | Refused; bytes untouched | Hidden or disabled |

Contract also uses **EXTENSION** (ARCHITECTURE-FIDELITY) for Spectra-only features with native fallback — map to `enhanced` profile gate.

### 4.2 Fidelity map shape (extend `CommandContext.fidelity`)

Today: `Record<string, FidelityClass>`. Standardize keys:

```ts
type FidelityRegionKey =
  | "body" | "styles" | "lists" | "tables" | "images" | "equations"
  | "headersFooters" | "footnotes" | "fields" | "trackedChanges" | "sections"
  | "comments" | "macros" | "customXml" | "smartArt" | "ole"
  | "cells" | "formulas" | "charts" | "pivotTables" | "validation" | "conditionalFormat"
  | "slides" | "masters" | "transitions" | "animations" | "media" | "speakerNotes";
```

**Per-command declaration:** each command lists `touches: FidelityRegionKey[]` and `requiredClass: FidelityClass` for enablement. Availability checks:

```ts
if (ctx.compatibilityProfile === "strict-native") {
  for (const region of command.touches) {
    if (ctx.fidelity[region] === "PRESERVED" && command.mutates(region))
      return disabled("…");
  }
}
```

### 4.3 Format-specific baselines (from N4/N5 STATE)

| Region | DOCX (N4) | XLSX (N5) | PPTX (N5) |
|---|---|---|---|
| Core content edits | NATIVE | NATIVE | NATIVE |
| Lists / basic tables | EQUIVALENT | EQUIVALENT | EQUIVALENT |
| Formulas (unrecognized) | — | PRESERVED (no literalize) | — |
| Tracked changes | PRESERVED | — | — |
| Transitions / animations | — | — | PRESERVED |
| Macros | PRESERVED (never execute) | PRESERVED | — |

### 4.4 Evidence bar (no screenshot-native claims)

For each command that mutates native bytes:

1. Fixture in `fixtures/office/{docx,xlsx,pptx}/`
2. Sidecar `.fixture.json` with `expected` regions (see `tracked-changes.fixture.json`)
3. Harness assertion: untouched parts byte-identical + XPath spot-check for preserved feature
4. Reload in Spectra + Bridge materialize + Office reopen where possible

---

## 5. Shared AI / Bridge / dispatcher requirements

### 5.1 AI capability surface

**Bounded tool set** — not 300 raw commands (N8 W1). Pattern from `app-registry.ts`:

- `APPLICATION_CAPABILITY_AUDIT` enumerates every tool → command id
- Prohibited actions registered with `aiAuthority: "prohibited"` — absence is never the mechanism
- Artifact tools map manifest operations → executor with Zod params

**For Office editors:** add `ARTIFACT_OFFICE_CAPABILITY_AUDIT` parallel to app audit:

```ts
{ action: "set_formula", commandId: "sheets.formula.set", status: "registered" | "prohibited" | "deferred", reason?: string }
```

AI receives **grouped capabilities** per domain (formatting, structure, data, design) with parameterized commands.

### 5.2 Authority (D37)

`risk` on every command feeds `authority-policy.ts`:

| Risk | Default policy |
|---|---|
| `safe` | proceed |
| `confirm` | confirm (destructive content) |
| `always-confirm` | settings/workbar/layout changes |
| `destructive` | always confirm + concrete consequence |

**Workbar customization** by AI: `app.settings.change` patching `preferences.workbar` — **always-confirm**, live propagate (N8 W7).

**Local file effects:** Bridge mutations name file count and path class; never bypass server executor (A2).

### 5.3 Dispatcher paths

| Domain | Path |
|---|---|
| Artifact commands | `executeCommand` → studio handler → Yjs typed op → lens materialization queue |
| App commands | `executeApplicationCommand` → `createApplicationCommandDispatcher` → bus/host |
| AI artifact mutations | `propose_operation` → `applyAiArtifactMutation` (claims-checked) — same semantic ops as registry |

**Choreography never mutates:** `interaction-choreography.ts` / `app-choreography.ts` project gestures only. Test: operation succeeds with choreography disabled (`interaction-choreography.test.ts` pattern).

### 5.4 Choreography resolution

Commands carry:

```ts
choreography: { target: "workbar-command", region: command.id }
```

Performer resolves **current** tab, density, overflow via `resolveCommandLayout` + live preferences — **never hardcoded coordinates** (ARCHITECTURE-COMMANDS §7).

Shared targets to implement:

| target | Surface |
|---|---|
| `workbar-command` | Artifact workbar button |
| `workbar-tab` | Category tab switch |
| `workbar-field` | Dropdown/color/numeric in bar |
| `inspector-panel` | Sheets/Presentation side inspector |
| `canvas-selection` | Object/cell/range selection |

### 5.5 Bridge integration

Sequence for native-writing commands:

1. Semantic op commits to Yjs
2. Lens computes part-level dirty set + preserved carry
3. Materialization job produces bytes
4. Bridge `file.write` with `baseRevision` + idempotency key
5. Journal verifies hash; replica state updates

Commands that cannot complete this pipeline must not claim success in UI or Live Dock.

---

## 6. Capability matrix generation (Phase 1 audit)

### 6.1 Goal

A **generated, testable matrix** proving every visible action satisfies WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT Phase 1:

- Stable namespaced id
- One semantic execute path (human, menu, shortcut, AI)
- Typed params + shared availability
- Risk, undo, choreography, fidelity class
- Mounted handler + test + fixture assertion (if native write)

### 6.2 Inputs (automated)

| Source | Extract |
|---|---|
| `CommandBinding[]` in each studio | ids, labels, tabs, priorities, strictNative |
| `commandForBinding` output | full Command record |
| `artifacts/registry.ts` `operations[type]` | AI operation coverage |
| `artifacts/skills/{document,sheets,presentation}.ts` | semantic regions |
| `WORK_DEFINITION` per type | exports, modes, capabilities |
| Contract §2 General defaults | default placement expectations |
| `fixtures/office/**` | harness coverage map |

### 6.3 Matrix row schema

```ts
type CapabilityMatrixRow = {
  commandId: string;
  workType: "document" | "sheets" | "presentation";
  title: string;
  semanticModel: string;        // e.g. "TextFormatPatch"
  manifestOps: string[];        // linked AI operations
  tab: string;
  group: string;
  contextualTab?: string;
  generalDefault: boolean;
  nativeFormats: ("docx"|"xlsx"|"pptx"|"odt"|"pdf"|"csv")[];
  fidelityClass: FidelityClass;
  fidelityRegions: string[];
  risk: Command["risk"];
  undo: Command["undo"];
  choreographyTarget?: string;
  handler: "mounted" | "missing" | "inspector-only" | "ghost";
  tests: string[];              // vitest file paths
  fixtureAssertion?: string;    // harness case id
  risks: string[];
};
```

### 6.4 Generation approach

1. **Static extractor** (`scripts/generate-capability-matrix.ts` or vitest snapshot):
   - Import studio binding arrays (refactor bindings to exported `documentCommands`, `sheetsCommands`, `presentationCommands` constants first — minimal churn)
   - Run `commandForBinding` for each
   - Merge manifest operations; flag orphans in either direction

2. **CI test** `capability-matrix.test.ts`:
   - Fail on `handler: "ghost"` (visible control, no execute)
   - Fail on manifest op without command
   - Fail on native-writing command without `fixtureAssertion`
   - Fail on C1 violation (grep for `editor.chain()` in workbar children without command wrapper)

3. **Human review output** → `workbar-artifact-capability/CAPABILITY-MATRIX.json` (generated artifact, committed)

### 6.5 Derived gap summary (current build)

| Area | Document | Sheets | Presentation |
|---|---|---|---|
| Registry bindings count | ~15 (+ format bar) | ~25 | ~20 |
| Contract General defaults | 2/9 in bindings | 6/7 | 5/6 |
| Undo/redo in registry | Missing | Present | Present |
| Formatting via commands | No (TipTap direct) | Inspector | Inspector |
| Comments command | No | Partial (notes) | No |
| Native strictNative flags | Import/templates | Sparse | Sparse |
| Manifest ops covered | Low | Medium | Low |

Use matrix generation to turn this into an exact checklist with owners.

---

## 7. Protocol-level fixture / harness patterns

### 7.1 Corpus layout (extend, do not fork)

```
fixtures/office/
  docx/   *.docx + *.fixture.json + harness-report.json
  xlsx/   *.xlsx + *.fixture.json
  pptx/   *.pptx + *.fixture.json
```

Sidecar schema (standardize):

```json
{
  "source": "provenance",
  "contains": ["feature bullets"],
  "expected": {
    "region-or-feature": "NATIVE | EQUIVALENT | PRESERVED | unsupported-read-only"
  },
  "mutations": [
    {
      "commandId": "document.format.selection",
      "touch": "word/document.xml",
      "preserve": ["word/comments.xml", "w:ins", "w:del"]
    }
  ]
}
```

### 7.2 Harness mutation scripts (per command family)

| Script | Assert |
|---|---|
| `no-op open-save` | All untouched parts byte-identical |
| `unrelated edit` | Preserved feature XPath still present |
| `targeted command` | Only expected parts dirty; semantic digest matches |
| `reload round-trip` | Spectra → Bridge → file hash → Spectra reconcile |
| `formula no-literalize` | Formula text unchanged when evaluator lacks function |
| `transition law` | PPTX transition XML untouched after title edit |

Reuse `npm run fidelity:docx` and `fidelity:office`; add **command-id-indexed** rows to harness report JSON.

### 7.3 Test layers

| Layer | File pattern | Tier |
|---|---|---|
| Command unit | `commands/**/*.test.ts` | R |
| Matrix parity | `capability-matrix.test.ts` | R |
| Studio integration | `{document,sheets,presentation}-commands.test.ts` | P |
| Lens round-trip | `*-lens.test.ts`, `office-route-projection.test.ts` | R |
| AI path | extend `ai-command-registry.test.ts` | R |
| Choreography | `interaction-choreography.test.ts`, `app-choreography.test.ts` | P |

### 7.4 Acceptance evidence bundle (per capability)

From CONTRACT §8 — automate where possible:

1. Registry id + studio owner  
2. Human + AI execution test  
3. Availability/authority case  
4. Undo behavior  
5. Choreography target (+ disabled correctness)  
6. Fidelity classification  
7. Fixture assertion  
8. Reload + Bridge round-trip  
9. Preserved-feature proof  
10. Screenshot at realistic density (mission close-out only)

---

## 8. Recommended shared interfaces / types / registry extensions

### 8.1 Extend `Command` (`commands/types.ts`)

```ts
type Command<P = unknown> = {
  // ... existing ...
  /** Regions this command may mutate — drives strict-native gating */
  touches?: readonly FidelityRegionKey[];
  /** Maps to manifest/AI operation names */
  manifestOps?: readonly string[];
  /** Parameter schema also exposed to AI tools */
  params: z.ZodType<P>;  // make required when AI-eligible
  /** Export/import copy semantics */
  exportBoundary?: "none" | "lossy-copy" | "native-sync";
  generalDefault?: boolean;
};
```

### 8.2 New shared modules

| Module | Responsibility |
|---|---|
| `commands/shared/history.ts` | undo/redo commands |
| `commands/shared/find-replace.ts` | shared schema + UI shell |
| `commands/shared/export-import.ts` | copy export/import with ADAPTED classification |
| `commands/shared/text-format.ts` | TextFormatPatch + presenters |
| `commands/office/command-matrix.ts` | matrix types + generator |
| `commands/office/bindings/document.ts` | exported `documentCommands` array |
| `commands/office/bindings/sheets.ts` | exported `sheetsCommands` array |
| `commands/office/bindings/presentation.ts` | exported `presentationCommands` array |

Studios import bindings from these modules — **thin mount** only (wire `onSelect` to local handlers).

### 8.3 `CommandContext` extensions

```ts
type CommandContext = {
  // ... existing ...
  artifactId: string;
  nativeFormat?: "docx" | "xlsx" | "pptx" | null;
  selection: {
    kind?: string;
    ids: readonly string[];
    /** Type-specific payload — range A1, block ids, object ids */
    payload?: unknown;
  };
};
```

### 8.4 Registry exports

Add to `commands/index.ts`:

- `OFFICE_COMMAND_BINDINGS` — merged map for matrix generation
- `commandById(id: string): Command | undefined` — global lookup for AI/choreography
- `manifestToCommandId(type, op: string): string` — canonical mapping function tested in CI

### 8.5 Preference defaults

Seed `DEFAULT_SPECTRA_PREFERENCES.workbar.document|sheets|presentation` with contract General pins (order + density), so first open is capable without user customization.

### 8.6 Workbar renderer extensions

Minor `ArtifactWorkbar` additions (protocol-complete Phase 2):

- Render `presentation.kind` variants: `dropdown`, `color`, `numeric`, `segmented` (types exist; ensure all three studios use them for font/size/color)
- Expanded mode groups from `defaultPlacement.group`
- Reset-to-defaults button (per-type, in customization gear)
- Live preference subscription already works — verify no remount on `update("workbar")` (D40)

---

## 9. Artifact-specific vs abstractable

### 9.1 Must stay artifact-specific

| Concern | Why |
|---|---|
| Lens / OPC part mapping | DOCX vs XLSX vs PPTX engines and preservation rules differ |
| Selection model | TipTap doc vs grid range vs canvas object graph |
| Semantic Yjs schema | Per-type models (`document/model`, `sheets/model`, presentation deck) |
| Formula evaluation | Sheets only; honesty contract for unrecognized functions |
| Slide layout / master logic | Presentation-only; masters often PRESERVED |
| Section/page layout | Document-only (sections, headers/footers) |
| Present / Rehearse mode | Presentation `present` capability + fullscreen shell |
| Cell reference / A1 notation | Sheets addressing and dependency graph |
| OMML equations | Document-primary; reuse insert path in slides where OMML embedded |
| Tab taxonomies beyond shared families | References tab (doc), Data/Formula (sheets), Animate/Present (deck) |

### 9.2 Must be abstracted (D41 / C1)

| Concern | Shared owner |
|---|---|
| Command record + workbar renderer | `commands/` + `ArtifactWorkbar` |
| Tab/order/pin/density preferences | `preference-store` + schema |
| Undo/redo | `commands/shared/history.ts` |
| Find/replace UI + schema | `commands/shared/find-replace.ts` |
| Export/import copy + strictNative | `commands/shared/export-import.ts` |
| Font/color/alignment controls | `RichTextFormatBar` + `WorkbarFontControl` |
| Item selector (slides/sheets) | `WorkbarItemSelector` |
| Zoom controls | `commands/shared/view.ts` |
| Comments panel entry | `CommentsShell` |
| AI authority + dispatcher | `authority-policy.ts`, `application-dispatcher.ts` |
| Choreography resolution | `app-choreography.ts` + performer |
| Fidelity class vocabulary | `ARCHITECTURE-FIDELITY` + `CommandContext.fidelity` |
| Capability matrix + harness | `fixtures/office` + generator script |

### 9.3 Hybrid (shared interface, type-specific execute)

- **Charts** — Sheets authors; Presentation embeds (shared `ChartSpec`)
- **Tables** — shared table tools interface; cell vs slide placement differs
- **Images/media** — shared insert spec; wrapping differs (doc vs slide)
- **Citations/sources** — shared bibliography model; slide auto-references generation is presentation-specific
- **Themes** — presentation-native; document styles are analogous but not identical

---

## 10. Implementation sequence (for lead)

1. **Export binding arrays** from three studios into `commands/office/bindings/*` (no behavior change).
2. **Run matrix generator**; commit `CAPABILITY-MATRIX.json`; fix `ghost` and orphan manifest ops.
3. **Shared history + find + export commands** — mount in all three studios; seed General defaults.
4. **Wrap `RichTextFormatBar` actions** as registered commands (C1); same for Sheets format inspector toggles.
5. **Add `touches` + fidelity gating** per native-writing command.
6. **Extend harness** with command-id-indexed mutations for top 20 native-writing commands per type.
7. **Wire AI tools** to new command ids; extend `ARTIFACT_OFFICE_CAPABILITY_AUDIT`.
8. **Phase 2 workbar** — expanded mode, control kinds, reset defaults, live second-editor verification.
9. **Mission evidence** — realistic density screenshots + matrix green + harness green.

---

## 11. Related paths

| Artifact | Path |
|---|---|
| This document | `docs/spectra-nova/workbar-artifact-capability/PROTOCOL-LEVEL-ABSTRACTIONS.md` |
| Agent prompt | `docs/spectra-nova/workbar-artifact-capability/WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT.md` |
| Contract | `docs/spectra-nova/workbar-artifact-capability/WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` |
| Command types | `src/features/spectra/commands/types.ts` |
| Registry inference | `src/features/spectra/commands/registry.ts` |
| Workbar renderer | `src/features/spectra/components/artifact-workbar.tsx` |
| Preferences | `src/features/spectra/settings/preference-store.ts` |
| Command surface tests | `src/features/spectra/__tests__/command-surface.test.ts` |
| Fidelity harness | `fixtures/office/`, `npm run fidelity:docx`, `npm run fidelity:office` |

---

*Generated by Composer 2.5 Explorer comparison pass. Per-type inventories (`DOCUMENT-`, `SHEETS-`, `PRESENTATION-CAPABILITY-INVENTORY.md`) are the authoritative capability briefs; generated `CAPABILITY-MATRIX.json` remains the runtime audit source of truth.*
