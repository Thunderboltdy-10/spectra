# Presentation Capability Inventory

## P12.I7 authoritative post-P3 closure — 2026-08-31

**Named industry leader:** Microsoft PowerPoint for Microsoft 365 (desktop).

**Authority:** the capability IR and PPTX lens schemas on `reform/P12.I7`; this section supersedes every 2026-08-22 status, proposal, priority, and gap statement below.
**Closure rule:** `SHIP` means the operation is reachable through the IR and works in its declared profile; `REFUSE-HONESTLY` means strict-native shows the exact IR-owned sentence to both a person and the AI; `DEFER-WITH-OWNER` names work outside this bounded re-audit. There are no silent rows.

### Standing IR census

| Classification | Rows | Closure |
|---|---:|---|
| SHIP — PPTX lens writer | 16 | Fifteen post-P3 writers plus P12.I7 native hidden-slide state. |
| SHIP — UI/read/export operation | 36 | These operations do not claim a native package write. |
| REFUSE-HONESTLY — no native delta | 66 | One former false refusal became the hidden-slide writer; every remaining reason is exact and actionable. |
| **Total** | **118** | Standing P12.I7 baseline: 16 writers / 66 refusals / 36 UI-only. |

Speaker notes are part of the shipped writer set: the lens creates a valid native notes page and notes master when absent. P12.I7 removes the stale studio gate that could still disable that control. Hidden-slide state now reads and writes PowerPoint's own slide visibility flag and dirties only the selected slide part.

### Microsoft PowerPoint family closure

| Classification | Capability families | IR rows | Product answer |
|---|---|---:|---|
| SHIP | Slide title/text/text-box edits, add/remove/reorder slides, notes, alt text, single-shape geometry, and hidden-slide state | 16 | Writes through the PPTX lens with part-scoped preservation tests. |
| SHIP | History, navigation, inspection/audits, presenter/rehearsal surfaces, views, and copy/export actions | 36 | Works without claiming a native package delta. |
| REFUSE-HONESTLY | Native text/paragraph styling | 13 | Words remain editable; direct font and paragraph styling to PowerPoint. |
| REFUSE-HONESTLY | Import copy and slide duplication | 2 | Offer a separate copy or native duplication in PowerPoint. |
| REFUSE-HONESTLY | New shapes, equations, charts, tables, media, and live embeds/components | 10 | Name the exact unsupported object family and a native or unlinking action. |
| REFUSE-HONESTLY | Layouts/placeholders, themes, backgrounds, slide size/numbers, and sections | 8 | Preserve deck structure; direct each structural change to PowerPoint. |
| REFUSE-HONESTLY | Citations/bibliography | 2 | Offer unlinking or ordinary slide text. |
| REFUSE-HONESTLY | Multi-object geometry, groups, and stacking order | 8 | Keep single-shape movement native; direct compound shape-tree edits to PowerPoint. |
| REFUSE-HONESTLY | Transitions, auto-advance, and object animations | 8 | Preserve timing trees; direct motion authoring to PowerPoint. |
| REFUSE-HONESTLY | Shape styling, lock/visibility, object deletion, crop, and chart data | 15 | Preserve native shape/media/chart machinery and name the PowerPoint action. |

### Deferred leader gaps with owners

| Field Note | Classification | Microsoft PowerPoint gap | Named later owner |
|---|---|---|---|
| P12.I7-PPT-1 | DEFER-WITH-OWNER | Native run/paragraph styling, fills/lines/effects, rich shape/media/chart/table/equation insertion | Orchestrator — future **PowerPoint Rich Objects unit**, after P12.V2 |
| P12.I7-PPT-2 | DEFER-WITH-OWNER | Native transitions, auto-advance, and animation timing authoring | Orchestrator — future **PowerPoint Motion package-writer unit**, after P12.V2 |
| P12.I7-PPT-3 | DEFER-WITH-OWNER | Layout/theme/background/slide-size/section/slide-number editing across masters | Orchestrator — future **PowerPoint Structure & Masters unit**, after P12.V2 |
| P12.I7-PPT-4 | DEFER-WITH-OWNER | Grouping, z-order, native object deletion, crop, and linked-chart data rewrites | Orchestrator — future **PowerPoint Shape Tree unit**, after P12.V2 |
| P12.I7-PPT-5 | DEFER-WITH-OWNER | SmartArt, connectors, custom shows, OLE, and macro authoring beyond safe preservation | Orchestrator — future **PowerPoint Advanced Objects unit**; macro execution remains prohibited |

### Archaeology boundary

Everything below this line is the original 2026-08-22 pre-IR research record. It remains useful for historical evidence and leader-feature discovery, but its statuses, command wiring claims, gaps, and implementation priorities are **superseded and non-authoritative**.

**Scope:** Spectra Nova workbar/artifact capability pass (Phase 5 — Presentation).  
**Evidence date:** 2026-08-22 (N7 accepted; N8 capability contract sealed; codebase at current workspace).  
**Sources:** `CANON.md`, `STATE.md`, `PLAYBOOK.md` §3–7, `ARCHITECTURE-*.md`, N7/N8 mission briefs, `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md`, `WORKBAR-ARTIFACT-CAPABILITY-AGENT-PROMPT.md` Phase 5, and codebase exploration (`presentation-studio.tsx`, `commands/registry.ts`, `lenses/pptx-lens.ts`, `presentation/*`, Office harness fixtures).

---

## 1. Executive summary

Spectra’s Presentation studio is **functionally rich in the inspector and canvas** but **thin on the shared command surface**. Most authoring behavior lives in `presentation-studio.tsx` as local handlers and inspector sections, not as namespaced registry commands with tab placement, AI parity, choreography targets, and native fidelity evidence. The PPTX lens (`pptx-lens.ts`) safely round-trips **slide titles, native shape text (by `cNvPr` id), and basic text-box insertions** while **preserving** transitions, animation timing, masters, media, charts, OLE, and unknown parts — but the UI’s broader edits (layouts, themes, geometry, Spectra-only transitions/animations, new slides on mounted decks) **do not yet map to PresentationML mutations**.

**Current workbar** (`presentation-studio.tsx` `workbarActions`, ~15 bindings): slide rail/inspector toggles, add/undo/redo/duplicate/move/delete slide, group/ungroup, rehearse, design/sources/files inspector shortcuts, primary **Present**. Contract General defaults (`Undo`, `Redo`, `Add slide`, `Duplicate`, `Design`, `Present`) are partially met; **Find**, **outline/slide navigation as a command**, and tab-distributed depth (`Insert`, `Arrange`, `Animate`) are missing from the bar.

**Tier R evidence exists** for native text/shape identity and preservation (`fixtures/office/pptx/*`, `xlsx-pptx-lens.test.ts`, `scripts/fidelity-harness/office.ts`, N5/N7 STATE rows). **Tier P evidence for Present mode** is coded but listed UNKNOWN in STATE §5.

**Highest-risk gap:** Users can change Spectra semantic state (themes, layouts, transitions, object geometry) that **does not materialize** to linked PPTX under strict-native — violating the contract’s “no ghost controls” bar unless availability disables them or lens promotions add fixtures first.

**Recommended sequencing:** (1) Register and tab-place existing studio behaviors as commands without new features; (2) Wire strict-native availability from `pptxLens.capabilities` + per-region fidelity map; (3) Promote PPTX writes in dependency order: notes → slide reorder/add-with-layout → geometry/style on native shapes → exact-transition set → minimal animation set; (4) Harness + AI operation parity per promotion.

---

## 2. Full inventory matrix

Legend for **Status (today):** `WB` = workbar command via `CommandBinding`; `IN` = inspector/canvas only; `—` = not implemented; `AI` = manifest/operation name exists for AI plane.

| Capability name | Semantic model | Proposed command id | UI tab / group | Supported native formats | Fidelity class | Risks and gaps | Proposed fixture assertions |
|---|---|---|---|---|---|---|---|
| **Undo** | Pop undo stack, restore prior `PresentationContent` Yjs snapshot | `presentation.general.undo` | General · History | pptx, pptm, potx, potm, ppsx, ppsm, ppam (spectra-native: all) | NATIVE (Yjs); native materialization follows dirty deltas only | WB today; not namespaced command; undo of native-unsafe ops may leave replica pending | Yjs round-trip; reload preserves stack depth cap (79) |
| **Redo** | Pop redo stack | `presentation.general.redo` | General · History | same | NATIVE (Yjs) | Secondary priority in overflow; same native gap as undo | Same as undo |
| **Add slide** | Insert `PresentationSlide` after active index with default layout objects | `presentation.slide.add` | General · Slides (contract default) | pptx: **blocked** on mount (`PPTX_SLIDE_ADD_REQUIRES_LAYOUT`); spectra-native: NATIVE | EQUIVALENT (born-in-Spectra) / UNSUPPORTED (mounted add without layout pick) | Lens cannot add slides to linked deck; UI allows add always | `transition-law.pptx`: assert add-slide disabled or requires layout command; spectra-native deck: add + export harness |
| **Duplicate slide** | Clone slide + new object ids, insert after active | `presentation.slide.duplicate` | General · Slides | pptx: partial — duplicate not in lens; would need slide part clone | PRESERVED source slides + EQUIVALENT for new slide only in spectra-native | WB; native duplicate not implemented | New fixture: duplicate slide on corpus deck → only new `ppt/slides/slideN.xml` dirty |
| **Delete slide** | Remove slide from `slides[]` | `presentation.slide.delete` | General · Slides | pptx: not in lens (slide delete) | UNSUPPORTED on mount until lens promotion | Disabled when one slide; not a command | Harness: delete middle slide → remaining slides + preserved transition on untouched slide |
| **Move slide earlier / later** | Reorder `slides[]` | `presentation.slide.moveEarlier` / `presentation.slide.moveLater` | General · Slides or Arrange · Order | pptx: `ppt/presentation.xml` sldIdLst order not yet mutated | EQUIVALENT when implemented | WB; drag reorder in rail is IN only | `typical-preservation.pptx`: reorder + reopen order in PowerPoint |
| **Slide picker / outline** | Select active slide by id | `presentation.navigate.slide` | General · Navigate | all | NATIVE | `WorkbarItemSelector` exists; not a registered command | Selection sync after reload |
| **Show / hide slide previews rail** | Toggle slide thumbnail rail | `presentation.view.slidePreviews` | General · View | n/a (chrome) | NATIVE | WB; full-surface only | Tier P screenshot |
| **Show / hide inspector** | Toggle inspector pane | `presentation.view.inspector` | General · View | n/a | NATIVE | WB | Tier P screenshot |
| **Speaker notes page** | Switch surface to notes-only view | `presentation.view.notesPage` | Present · Notes | pptx notes: EQUIVALENT (read); write promotion needed | EQUIVALENT / PRESERVED | WB; notes editing on canvas page IN | `chart-notes-preservation.pptx`: edit notes + preserve chart/timing |
| **Find in deck** | Search slide titles, object text, notes | `presentation.general.find` | General · Navigate | all | NATIVE | **Missing** — contract General default | Search hits across 120-slide harness deck <200ms |
| **Present slideshow** | Fullscreen present from active slide | `presentation.present.start` | Present · Start (primary) | all | NATIVE (runtime) | WB primary; STATE UNKNOWN verification | Tier P: presenter chrome, escape returns to slide |
| **Rehearse timings** | Present with per-slide duration capture | `presentation.present.rehearse` | Present · Rehearse | all (device-local timings) | NATIVE | WB; timings not in PPTX | Rehearsal report non-empty after 3 slides |
| **Stop presenting** | Exit fullscreen, land on current slide | `presentation.present.stop` | Present · (context) | n/a | NATIVE | Keyboard only today | Tier P evidence |
| **Presenter notes visibility** | Device preference for notes panel | `presentation.present.toggleNotes` | Present · Presenter | n/a | NATIVE | localStorage only | Toggle persists reload |
| **Blackout screen** | Hide slide during present | `presentation.present.blackout` | Present · Presenter | n/a | NATIVE | IN present overlay | Tier P |
| **Insert text box** | `createPresentationObject("text")` on active slide | `presentation.insert.textBox` | Insert · Text | pptx: `add-text-box` delta | NATIVE (basic box) | IN inspector; lens supports | `transition-law.pptx` add-text-box mutation row |
| **Insert shape** | `createPresentationObject("shape")` | `presentation.insert.shape` | Insert · Shapes | pptx: not serialized (Spectra shape model) | PRESERVED native shapes; new shapes EXTENSION unless export path | IN | Export copy includes shape; mount unchanged |
| **Insert chart** | Chart object, optional Sheets binding | `presentation.insert.chart` | Insert · Data | pptx: chart parts PRESERVED; new chart needs DrawingML/chart promotion | PRESERVED / EXTENSION | IN; linked range live/pinned IN | `chart-notes-preservation.pptx` title edit preserves chart |
| **Insert table** | Table object on slide | `presentation.insert.table` | Insert · Tables | pptx: graphicFrame table PRESERVED | PRESERVED | IN | Corpus table slide preservation |
| **Insert image / video** | Upload asset, media object | `presentation.insert.media` | Insert · Media | pptx: `pic` PRESERVED; new media needs rels + media part | PRESERVED / EXTENSION | IN; asset pipeline | `media-preservation.pptx` |
| **Insert linked work (embed)** | Embed artifact reference | `presentation.insert.embed` | Insert · Links | pptx: EXTENSION (fallback image + optional custom XML) | EXTENSION | IN | Enhanced profile only in strict-native |
| **Insert equation** | OMML / math object | `presentation.insert.equation` | Insert · Content | pptx: not implemented | UNSUPPORTED → PRESERVED | **Missing** — contract lists equations | Defer or PRESERVED with honest disabled |
| **Apply slide layout** | Set `layoutId`, reposition/create objects per layout recipe | `presentation.design.applyLayout` | Design · Layout | pptx: layout assignment (`slideLayout` rel) not lens-backed | EQUIVALENT (Spectra layouts) / PRESERVED (native layout) | IN; Spectra layout ids ≠ `ppt/slideLayouts` | Fixture: layout change on native deck does not strip `transition` |
| **Apply theme** | Set `deck.theme` tokens/fonts | `presentation.design.applyTheme` | Design · Theme | pptx: `ppt/theme/theme1.xml` PRESERVED | PRESERVED (native theme); EQUIVALENT (Spectra themes on spectra-native) | IN; native theme untouched on mount | `masters-media-preservation.pptx` theme part unchanged after title edit |
| **Slide background** | `slide.background` color/image | `presentation.design.background` | Design · Background | pptx: `p:bg` not modeled | PRESERVED | Partial IN (theme tokens only) | Promotion with fixture |
| **Deck aspect ratio** | `settings.aspectRatio` 16:9 / 4:3 | `presentation.design.aspectRatio` | Design · Format | pptx: `p:sldSz` PRESERVED | PRESERVED | IN | No false write on mount |
| **Default transition** | `settings.defaultTransition` | `presentation.animate.defaultTransition` | Animate · Transitions | pptx: only if exact OOXML equivalent | EQUIVALENT (fade/push subset) / PRESERVED (existing) | IN; strict-native must block non-equivalent | `transition-law.pptx` transition XML byte-identical after unrelated edit |
| **Per-slide transition** | `slide.transition.kind` + duration | `presentation.animate.transition` | Animate · Transitions; contextual **Transition** | pptx: Fade maps; Push/Dissolve need OOXML mapping; other native transitions PRESERVED | PRESERVED (read) / EQUIVALENT (exact set only) | Contextual tab when `nativeCompatibility.transition`; editing native Fade blocked until equivalence proven | Harness `transitionAssertions` (3 mutations) |
| **Object animation** | `object.animation` kind/duration/delay | `presentation.animate.object` | Animate · Emphasis; contextual **Shape** | pptx: `p:timing` PRESERVED | PRESERVED | Spectra-only animations; IN inspector | `animation-timing.pptx` timing tree preserved on title edit |
| **Bold / italic / underline** | `object.style` flags | `presentation.format.bold` etc. | Shape contextual · Font | pptx: `a:rPr` not yet written from style | PRESERVED until promotion | IN `OBJECT_FORMAT_TOOLS`; no native write | Shape text style edit on native shape fixture |
| **Text alignment** | `object.style.align` | `presentation.format.align` | Shape contextual · Paragraph | pptx: `a:pPr` PRESERVED | PRESERVED | IN | Same |
| **Bulleted list** | Prefix lines with `•` in text | `presentation.format.bulletedList` | Shape contextual · Paragraph | pptx: list markup not modeled | EQUIVALENT (plain bullets in text runs) | IN | Text run contains bullet char only |
| **Text preset (title/subtitle/body/caption)** | Apply fontSize/weight/color bundle | `presentation.format.textPreset` | Shape contextual · Styles | pptx: run properties | EQUIVALENT when native write exists | IN | — |
| **Font family / size / color** | `object.style` typography | `presentation.format.font` | Shape contextual · Font | pptx: `a:rPr` / theme fonts | PRESERVED | **Missing** dedicated controls (only presets) | — |
| **Fill / border / line** | `object.style` shape styling | `presentation.format.fill` / `.border` | Shape contextual · Shape | pptx: `a:solidFill`, `a:ln` | PRESERVED | Partial shape content in model | — |
| **Align left/center/right/top/middle/bottom** | `arrangeSelection` on selection | `presentation.arrange.align` | Arrange · Align | pptx: `a:xfrm` EMU geometry | EQUIVALENT (N7 projection reads EMU); write not implemented | IN inspector | N7: layout-inherited placeholder geometry in projection |
| **Distribute horizontally / vertically** | Space objects evenly | `presentation.arrange.distribute` | Arrange · Align | pptx: geometry | EQUIVALENT when write exists | IN | — |
| **Group objects** | Create `group` object with children | `presentation.arrange.group` | Arrange · Group | pptx: `p:grpSp` PRESERVED | PRESERVED | WB; native group not authored | README: grouped shapes unpromoted |
| **Ungroup** | Dissolve group | `presentation.arrange.ungroup` | Arrange · Group | pptx: PRESERVED | PRESERVED | WB | — |
| **Z-order / reading order** | `readingOrder`, layer list reorder | `presentation.arrange.order` | Arrange · Order | pptx: z-order in `spTree` | EQUIVALENT | IN | — |
| **Position / size / rotation** | `x,y,width,height,rotation` | `presentation.arrange.geometry` | Shape contextual · Geometry | pptx: `a:xfrm` | EQUIVALENT (projection); write gap | IN `PresentationObjectInspector` | `office-route-projection.test.ts` keeps x/y on edit |
| **Lock / unlock object** | `object.locked` | `presentation.arrange.lock` | Shape contextual · Geometry | n/a | NATIVE | IN format tools | — |
| **Smart guides / snap** | `smartGuide` during drag | `presentation.arrange.snap` | Arrange · Guides | n/a | NATIVE | IN canvas behavior; not a command | — |
| **Delete object** | Remove from `objects[]` | `presentation.arrange.delete` | Shape contextual · Edit | pptx: remove shape node | UNSUPPORTED on native until lens | IN | — |
| **Edit slide title** | `slide.title` string | `presentation.slide.setTitle` | General or slide inspector | pptx: `set-title` | NATIVE | IN + lens | Harness title mutation |
| **Edit shape text** | `presentationObjectText` / content.text | `presentation.object.setText` | Shape contextual · Text | pptx: `set-text` by `nativeShapeId` | NATIVE | N7 fixed identity | `xlsx-pptx-lens.test.ts` shape round-trip |
| **Speaker notes (per slide)** | `slide.speakerNotes` | `presentation.notes.set` | Present · Notes | pptx: `ppt/notesSlides` EQUIVALENT class in lens map | EQUIVALENT (read); write promotion | IN rail + notes page | `chart-notes-preservation.pptx` |
| **Sections** | `deck.sections`, `slide.sectionId` | `presentation.slide.section` | Design · Structure | pptx: `p14:section` / extension parts PRESERVED | PRESERVED | IN | — |
| **Citations / sources** | `slide.citations[]` | `presentation.sources.addCitation` | General → Sources inspector (contract: sources) | pptx: not in OOXML standard | EXTENSION | IN; bibliography slide generation | Bibliography unit tests in `work-type-passes.test.ts` |
| **Build bibliography slides** | `applyBibliographySlides` | `presentation.sources.buildBibliography` | Sources · Generate | export/pptx fallback | EXTENSION | IN | `presentation/bibliography.ts` tests |
| **Reusable components** | `deck.components` library | `presentation.insert.component` | Insert · Components | spectra-native | NATIVE | IN | — |
| **Save selection as component** | Push object to components | `presentation.design.saveComponent` | Design · Components | spectra-native | NATIVE | IN | — |
| **Import presentation** | `importPresentationFile` (pptx/odp) | `presentation.file.import` | General · Files (inspector) | pptx: lens open; odp: ADAPTED lossy | ADAPTED (odp) / NATIVE partial (pptx) | IN; explicit import not sync | Import quarantine + fidelity report |
| **Export PPTX** | `buildPresentationPptx` (pptxgenjs path) | `presentation.file.exportPptx` | General · Files | pptx export | ADAPTED (explicit export) | IN; **not** lens materialize | Label “Export a copy”; not mounted write |
| **Export PDF / PNG / ODP** | io builders | `presentation.file.exportPdf` etc. | General · Files | ADAPTED | ADAPTED | IN | — |
| **Linked chart data refresh** | `sourceBinding` live Sheets range | `presentation.data.refreshChart` | Shape contextual · Data | pptx chart PRESERVED | PRESERVED native chart; live data EXTENSION | IN | — |
| **Accessibility: slide label** | `slide.accessibility.label` | `presentation.accessibility.slideLabel` | Design · Accessibility | pptx: not standard | EXTENSION | IN | — |
| **Accessibility: alt text** | `object.altText` | `presentation.accessibility.altText` | Shape contextual · Accessibility | pptx: `descr` attr promotion | EQUIVALENT | IN | — |
| **Accessibility: reading order** | `readingOrder` + list UI | `presentation.accessibility.readingOrder` | Arrange · Order | pptx: z-order related | EQUIVALENT | IN | AI op `check_reading_order` |
| **AI: inspect deck** | Read-only plan | `presentation.inspect.deck` | AI only | all | NATIVE | AI manifest op | AI executor test |
| **AI: add slide / layout / theme** | Manifest ops | `presentation.add.slide` / `.apply.layout` / `.apply.theme` | AI only | depends on lens | mixed | Ops named in registry; **no command execute parity** | Wire to same handlers as human |
| **AI: set_slide_title / set_slide_text / add_text_box** | Lens deltas | map to `presentation.slide.setTitle` etc. | AI only | pptx per lens | NATIVE | `pptxLens.capabilities.aiOperations` | Existing harness |

---

## 3. PowerPoint PresentationML research notes

### 3.1 Package structure (OPC)

A PPTX is an OPC zip. Spectra’s lens and harness focus on:

| Part pattern | Role | Spectra lens handling |
|---|---|---|
| `ppt/presentation.xml` | Slide list (`p:sldIdLst`), slide size, notes size | Read; reorder/add not yet mutated |
| `ppt/slides/slide{N}.xml` | Slide content: `p:cSld` / `p:spTree` | Title/text edits, add `p:sp` text box |
| `ppt/slideLayouts/*.xml` | Placeholder geometry (`p:ph`), inherited `a:xfrm` | Read for projection (N7); edits PRESERVED |
| `ppt/slideMasters/*.xml` | Master shapes, placeholders | PRESERVED (`masters-media-preservation.pptx`) |
| `ppt/theme/theme*.xml` | Color/font scheme (DrawingML) | PRESERVED |
| `ppt/notesSlides/*.xml` | Speaker notes | Classified EQUIVALENT; write not promoted |
| `ppt/media/*` | Binary media | PRESERVED |
| `ppt/charts/*`, `ppt/embeddings/*` | Chart sheets, embedded workbooks | PRESERVED |
| `ppt/diagrams/*` | SmartArt | PRESERVED |
| `ppt/tags/*`, customXml | Extensions | PRESERVED / unknown |

### 3.2 Slide content XML (PresentationML + DrawingML)

- **Shape tree:** `p:spTree` contains `p:sp` (shapes), `p:pic` (images), `p:graphicFrame` (tables/charts), `p:grpSp` (groups).
- **Identity:** `p:nvSpPr/p:cNvPr@id` is the stable shape id (N7/N8: **`cNvPr` is PML**, geometry is DrawingML `a:xfrm`).
- **Text:** `p:txBody/a:p/a:r/a:t` — lens `set-text` replaces run text; multi-paragraph uses paragraph index.
- **Placeholders:** `p:nvPr/p:ph@type` (`title`, `ctrTitle`, `body`, …) — title shapes often `locked` in projection when placeholder type is title.
- **Transitions:** `p:transition` on slide root — often wrapped in `mc:AlternateContent` (Choice/Fallback). Harness serializes and compares full subtree (`transition-law.pptx`).
- **Animations:** `p:timing` tree — preserved on unrelated edits (`animation-timing.pptx`).
- **Slide transition types:** Spectra model uses `none | fade | push | dissolve`; PowerPoint Fade maps to OOXML; others require explicit mapping tables before strict-native authoring.

### 3.3 Engine and materialization boundary

- **Engine:** `@ariadng/office` `Presentation` class (N4 gate winner), same family as DOCX lens.
- **Semantic deltas today:** `set-title`, `set-text` (optional `shapeId`), `add-text-box`, batched `ai-edit`.
- **Materialize:** Diff projection vs carry; **refuses new slides** on mounted decks (`PPTX_SLIDE_ADD_REQUIRES_LAYOUT`).
- **Route boundary:** `contentToPptx` in `app/api/spectra/lenses/office/route.ts` merges Yjs content back into projection without dropping `nativeShapeId` / geometry (`office-route-projection.test.ts`).

### 3.4 Corpus fixtures (`fixtures/office/pptx/`)

| Fixture | Proves |
|---|---|
| `transition-law.pptx` | Real PowerPoint Fade + `mc:AlternateContent`; title/text/add-object mutations preserve transition XML |
| `animation-timing.pptx` | `p:timing` survives title edit |
| `masters-media-preservation.pptx` | Masters, layouts, theme, media, SmartArt |
| `media-preservation.pptx` | Embedded WAV + images |
| `chart-notes-preservation.pptx` | Chart, embedding, notes, timing |
| `typical-preservation.pptx` | 15 slides, notes, media, OLE |
| Generated 120-slide deck | Performance (~78ms open/edit in N7 log) |

**Deliberately unpromoted** (per `fixtures/office/pptx/README.md`): sections, custom shows, grouped shapes/connectors, hyperlinks, unknown extensions — need real fixtures before commands ship.

### 3.5 Format variants

| Format | Notes |
|---|---|
| **pptx** | Primary strict-native target |
| **pptm** | Macro-enabled; macros PRESERVED / never executed (parallel XLSM pattern) |
| **potx/potm** | Template variants; same lens `nativeBinding.format` |
| **ppsx/ppsm** | Show variants |
| **ppam** | Add-in container — treat as UNSUPPORTED open or resource fallback |
| **odp** | Import/export via `presentation/io.ts` — **ADAPTED**, not sync |
| **pdf/png** | Rasterized export — **ADAPTED** |

---

## 4. Gap analysis vs contract

Reference: `WORKBAR-ARTIFACT-CAPABILITY-CONTRACT.md` §2, §6, §8, §9 and agent prompt Phase 5.

| Contract requirement | Current state | Gap severity |
|---|---|---|
| **One command id, one execute path (C1)** | Presentation features use `CommandBinding.onSelect` closures; vast behavior only in inspector | **Critical** |
| **Tab taxonomy:** General, Insert, Design, Arrange, Animate, Present | Tabs defined in `COMMAND_TABS`; workbar actions mostly infer `General` or overflow; no Insert/Arrange/Animate commands | **Critical** |
| **General defaults:** Undo, Redo, Add slide, Duplicate, Design, Present | Partially on bar; Find missing; Duplicate not in General by placement inference | **High** |
| **Contextual tabs:** Shape, Transition | Selection context passed to `ArtifactWorkbar`; no Shape/Transition **commands** on those tabs | **High** |
| **Strict-native availability (C2, D36)** | `commandForBinding` supports `strictNative`; presentation bindings do not set it; lens capabilities not consumed in studio | **Critical** |
| **Fidelity class per feature** | Lens map at open; studio does not gate transitions/themes/layouts on mounted decks | **Critical** |
| **Native write = fixture + harness** | Only title/text/add-text-box have Tier R proof | **High** |
| **No ghost controls** | Transitions, layouts, themes, animations editable in UI without PPTX write | **Critical** |
| **AI same semantics (A1)** | Manifest lists `presentation.*` ops; human paths not unified; lens AI ops partially wired | **High** |
| **Evidence table §8 (10 rows per command)** | Not started for presentation | **High** |
| **Import/export as ADAPTED boundary** | Implemented with user messaging; must stay off sync/materialize path | **Medium** (guardrails) |
| **Present / Rehearse** | Implemented; STATE UNKNOWN — needs Tier P pass | **Medium** |
| **Reuse D41** | Object format tools local to presentation — acceptable if later shared with Document rich text where equivalent | **Low** |

**STATE field note (2026-08-22):** “Document/Sheets/Presentation capability depth and default Workbar population still need a dedicated implementation pass” — this inventory is the presentation slice of that pass.

---

## 5. Implementation priorities

Ordered for **user pain × fidelity risk × dependency**. Each item should land with: registered command, tab/group placement, strict-native availability, focused test, and (if native-writing) harness row.

### P0 — Protocol honesty (1–2 days)

1. **Register existing workbar bindings** as stable ids (`presentation.add.slide`, …) without behavior change.
2. **Feed `CommandContext`** with `nativeBinding` + fidelity map from replica when mounted.
3. **Disable with reason** on strict-native: Spectra-only transitions/animations, theme swap on native deck, layout recipes that mutate structure, add/delete/reorder slide until lens supports or op is spectra-native only.
4. **Populate General defaults** per contract: pin Undo, Redo, Add slide, Duplicate slide, Design (open inspector), Present; add Find stub or real search command.

### P1 — Tab distribution without new native scope (2–4 days)

5. **Insert tab:** text box, shape, chart, table, media, embed — move from inspector-only to commands (inspector can remain alternate host).
6. **Arrange tab:** group, ungroup, align*, distribute*, lock — from inspector + workbar.
7. **Animate tab:** transition + object animation controls with contextual Transition tab when selection/nativeCompatibility demands read-only preserved state.
8. **Design tab:** theme, aspect ratio, background — with native gating.
9. **Shape contextual tab:** geometry, format tools, alt text, chart binding.

### P2 — Native promotions with fixtures (Tier R, ordered)

10. **Speaker notes write** → `ppt/notesSlides` part-level mutation (`chart-notes-preservation.pptx`).
11. **Slide order** → `ppt/presentation.xml` sldIdLst + rels.
12. **Add slide with layout pick** → clone layout rel, new `slideN.xml`, harness for `typical-preservation.pptx`.
13. **Native shape geometry + text run properties** → `a:xfrm`, `a:rPr` for recognized shapes only.
14. **Exact transition set** — map Spectra fade/push/dissolve to OOXML; prove on `transition-law.pptx`; block replacement of non-equivalent native transitions.
15. **Minimal entrance animations** — only if 1:1 with OOXML timing entries; else keep PRESERVED.

### P3 — AI and evidence completeness

16. Map manifest operations (`presentation.add.slide`, `rewrite.object`, …) to command ids; executor tests mirroring human dispatch.
17. Generate **capability acceptance table** (contract §8) from registry + harness JSON.
18. Tier P pass: Present, Rehearse, contextual tabs, customization persist, second-profile live update (D40).

### Explicit deferrals (honest PRESERVED)

- Master editing, SmartArt authoring, OLE insert, macro editing, custom shows, sections OOXML extension, hyperlink authoring, connector geometry, equation OMML on slides — remain read-only/preserved until fixtures exist (N7 brief cut line).

---

## Appendix A — Code locations

| Area | Path |
|---|---|
| Studio + workbar bindings | `src/features/spectra/components/presentation-studio.tsx` |
| Semantic model | `src/features/spectra/presentation/model.ts` |
| Import/export (ADAPTED) | `src/features/spectra/presentation/io.ts` |
| PPTX lens | `src/features/spectra/lenses/pptx-lens.ts` |
| Projection → artifact content | `src/features/spectra/lenses/office-content.ts` |
| Command tab taxonomy | `src/features/spectra/commands/registry.ts` |
| Workbar renderer | `src/features/spectra/components/artifact-workbar.tsx` |
| Lens tests | `src/features/spectra/__tests__/xlsx-pptx-lens.test.ts` |
| Route projection test | `src/features/spectra/__tests__/office-route-projection.test.ts` |
| Office harness | `scripts/fidelity-harness/office.ts` |
| Fixtures | `fixtures/office/pptx/` |
| Manifest AI operations | `src/features/spectra/artifacts/registry.ts` (`presentation: [...]`) |

## Appendix B — Proposed default workbar layout (target)

| Tab | Default groups (starter) |
|---|---|
| **General** | Undo, Redo, Add slide, Duplicate slide, Find, Design (opens Design tab/inspector), Present |
| **Insert** | Text box, Shape, Image, Chart, Table, Embed |
| **Design** | Theme, Layout, Background, Aspect ratio |
| **Arrange** | Align, Distribute, Group, Order forward/back |
| **Animate** | Slide transition, Object animation |
| **Present** | Start, Rehearse, Notes page |
| **Shape** (contextual) | Font, Align, Geometry, Animation, Alt text |
| **Transition** (contextual) | Transition kind, Duration (disabled when preserved) |

---

*End of inventory. Single deliverable for Presentation capability research; implementation agent should treat rows as the acceptance checklist.*
