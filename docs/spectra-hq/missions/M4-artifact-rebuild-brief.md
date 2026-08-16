# M4 artifact and product rebuild brief

**Durable coordination file. Re-read this after every compaction, together with
`M4-one-product.md` and `M4-product-convergence-checklist.md` §9.** Conversational
memory is not the coordination mechanism for work of this size.

- `M4-one-product.md` — the mission and its acceptance criteria. Unchanged and
  still mandatory.
- `M4-product-convergence-checklist.md` §9 — the current, superseding product
  direction. §1–§8 of that file are preserved history.
- **This file** — the audit baseline, the architecture constraints that any
  restructure must respect, per-type findings, ownership of shared primitives,
  sub-agent assignments, and iteration status.

Order of authority: `CANON.md` > `M4-one-product.md` > checklist §9 > this file >
older M4 iterations.

---

## 1. Controlled test data

Created 2026-08-16 through the product's own authenticated API
(`POST /api/spectra`, `action: createArtifact`) because the pre-existing
inventory was placeholder shells — "New Sheet", "New Deck", "New Presentation",
"New Code", "New Agent", "New Whiteboard" — which cannot support an editor
audit. Every object below has realistic school content at realistic density.

Workspace **`M4 QA — Artifact Rebuild`** — `r17fn1bpdpb1vjj3s6jda5c8bx8ck1vd`

| Type | Title | Artifact id | Content density |
| --- | --- | --- | --- |
| document | Photosynthesis — Unit 4 study notes | `q579j3nyb7yf682jxms3ev3za58ckmb2` | 15 blocks: headings, paragraphs, list, quote, callout, math |
| flashcard_deck | Biology HL — Photosynthesis recall deck | `q573k3s2q70w4dknxtbr6v64c98ck2tv` | 28 cards, mixed confidence |
| quiz | Photosynthesis — end of unit quiz | `q570dj9wzvk7k491cam0m1tw0n8ckdj2` | 12 questions (MCQ + short answer), explanations, timed, published |
| planner_task | Finish Chemistry IA first draft | `q5743b9pqyjgxqky0t2pv22v1s8ckyw2` | 5 subtasks, due/start dates, reminder, high priority |
| presentation | Rates of reaction — Lesson 3 | `q579z7dd6t8b2jqfjnwf7sbn6n8cjj14` | 8 slides, 2 text objects each, speaker notes |
| sheets | Titration results — class data | `q57b63jvgc0r39ykgbhrkyg7418ckjmx` | 2 sheets, ~70 cells, AVERAGE/MAX/MIN/STDEV formulas, frozen panes, named range |
| code | Projectile motion visualiser | `q572e6f7sq8r1ekhfnvp3345pd8ckabc` | 3 files (html/js/css), canvas visualisation, split open mode |
| whiteboard | Unit 4 concept map | `q577g9ppy8hkqsb45grc68fes58cj97e` | 2 pages, 3 layers, frame + 7 notes + shape + labels, 6 labelled edges |
| agent | IB Biology HL coach | `q57fpxrcqwarp66m8xm2a4smk98ck7q1` | Scope, instructions, 3 skills, routing examples, behaviour, boundaries |

Delete this workspace and its work at mission close. Do not use real user work
for destructive testing.

**Cleanup path, found 2026-08-16 so closeout is not blocked.** No workspace has a
delete or archive affordance in the UI, which is itself an S5 defect. The working
paths are `POST /api/spectra` with `action: "deleteWorkspace"`
(`src/app/api/spectra/route.ts:1263`) and `action: "deleteArtifact"` (`:1511`),
backed by `convex/spectraWorkspaces.ts:576 archive` and
`convex/spectraArtifacts.ts:2847 archive`.

**Pre-existing data notes.** The rest of the inventory is 76 Library-visible
objects, mostly quizzes and tasks, plus automated-test debris that is visible to
the user in Recent activity ("Update Open Quiz Match" ×6, "Round One Durable
Sync", "M1 edit evidence — 2026-08-12", "New Document" ×3). Seven legacy
timetable objects exist (4 unplaced, 3 in Spectra Launch Studio); they are
editable but not creatable and are invisible to Library filters.

---

## 2. Screenshot index

Baseline evidence lives in `.shots/missions/M4/audit/`. Mission evidence for
Golden Flows goes to `.shots/missions/M4/` per PLAYBOOK.

| Shot | Surface | What it proves |
| --- | --- | --- |
| `110_document_split_library_open.png` | Document in split from Library, 1440 | Header description sliced mid-glyph; no formatting toolbar; Library rail degraded to icons+counts |
| `111_document_split_more_menu.png` | Document split, More menu open | Menu covers the whole identity row; Comments is a top-level icon while its four peers hide in a menu; composer covers a list row |
| `112_document_fullscreen_1440.png` | Document fullscreen, 1440 | Still no toolbar at full width; ~700 px of empty canvas with no writing affordance; "Reconnecting" transport state |
| `113_library_after_close.png` | Library List, 1440 | 7 rows per viewport, ~990 px gap between title and metadata |
| `114_library_type_selector_open.png` | Library type filter open | The 9 creatable types confirmed from the product; third active-state treatment (green check); "Select objects for AI" inside a type filter |
| `120_sheets_split_1440.png` | Sheets in split (682 px) | 25 of 30 toolbar controls hidden; `Æ'x` mojibake; sheet tabs buried by the composer; two visibly different Library row designs in one list |
| `121_sheets_fullscreen_1440.png` | Sheets fullscreen, 1440 | The best current workbar — one row, real menus, a working ellipsis overflow. Also: `numberFormat`/`decimals` ignored, ragged grid, duplicate `A1`, status bar + tabs under the composer |
| `122_sheets_fullscreen_850.png` | Sheets fullscreen, 850 | The whole 19-control format bar vanishes with no overflow; an orphan `·` separator is left behind; static "100 rows · 26 columns" survives while controls do not |
| `123_deck_fullscreen_1440.png` | Deck fullscreen, 1440 | `Study · 28` and `Hide cards` physically overlap at 1440; metrics strip is a summary-card row inside an editor; 228 px of chrome before content |
| `124_after_restart.png` | Deck fullscreen after the dev-server restart | "Reconnecting", the unsynced-edit notice and "Synchronize before closing" were **environmental** (stale dev server), not product defects. The `Study · 28` / `Hide cards` overlap survived the restart, so that one is real. |
| `125_quiz_fullscreen_1440.png` | Quiz fullscreen, 1440 | The reference workbar: one 46 px row, 8 controls, all visible, real `…` overflow. Also the three-column authoring body and the tag-chip fourth header row (133 px identity block) |
| `126_quiz_fullscreen_1024.png` | Quiz fullscreen, 1024 | Three columns survive at 1024, but the composer slices Explanation and `Advanced placement` mid-glyph; the question list truncates every row at ~250 px; `1/12` + `QUESTION 1 OF 12` + `Question 1 of 12` on screen at once |
| `127_quiz_long_question_workbar_1440.png` | Quiz fullscreen, 1440, 240-char question | The workbar holds at 46 px and truncates with an ellipsis — the reference behaviour. Also reveals `ArtifactRichTextEditor`'s contextual inline toolbar and its amber-plus-teal focus state |
| `128_planner_split_1440.png` | Planner in split (682 px), invalid content | A raw Zod message printed across the product UI, clipping the header description; five subtasks silently dropped; `1 of 1 tasks` beside a `0/5` badge; the Export control clipped by the panel edge |
| `129_planner_split_1440_valid.png` | Planner in split (682 px), valid content | `2/5` is now truthful, but the editor is one row and ~740 px of empty space. Also the Library rail at 608 px: labels deleted, a native `<select>` as the overflow |
| `130_planner_fullscreen_1440.png` | Planner fullscreen, 1440 | The whole editor for a task with 5 subtasks, 2 reminders and a 240-minute estimate is one row and ~770 px of white. `+ New chat` violet vs quiz `Publish` black — two primary treatments |
| `131_planner_fullscreen_850.png` | Planner fullscreen, 850 | Sidebar stays 240 px wide (28 % of viewport); the toolbar overflows to a horizontal scrollbar with 6 of 11 controls reachable and `Import` cut to "In" |
| `132_presentation_fullscreen_1440.png` | Presentation fullscreen, 1440 | Two stacked bars (44 + 42) under a 115 px header; a `Slides/Settings/Theme/Preview` tab row inside the editor; the slide-number badge cutting through every thumbnail title |
| `133_presentation_fullscreen_850.png` | Presentation fullscreen, 850 | The thumbnail rail correctly becomes a `‹ 1 · Title ⌄ 1 of 8 ›` selector and speaker notes become a proper disclosure — but `Rehearse` is clipped, `Title & content` overlaps the chart/image icons, and the toolbar gets a scrollbar |
| `134_presentation_present_1440.png` | Present mode, 1440 | The best-executed surface in the product: themed slide, deck typography, elapsed timer, one-click `✕ Exit`, real speaker note. Also the editor's slide-number badge leaking into the audience view |
| `135_code_fullscreen_1440.png` | Code fullscreen, 1440 | One 44 px workbar with modes left and actions right; a working sandboxed visualisation with live slider values; a truthful sandbox status line |
| `136_code_fullscreen_850.png` | Code fullscreen, 850 | Icon actions correctly shed labels, `Both` becomes a tab pair — then `Publish` is cut in half and the `⋯` overflow is pushed out of the bar entirely |
| `137_whiteboard_fullscreen_1440.png` | Whiteboard fullscreen, 1440 | The leanest workbar (34 px, no overflow at any width). Also: connector labels floating away from their lines and clipped to single characters; detached 3-dot handles in empty canvas |
| `138_whiteboard_fullscreen_850.png` | Whiteboard, 850, both menus open | `More tools` holds real breadth (pages & layers, templates, accessible outline, four export formats) without growing the bar — but two menus stay open at once, the menu is centre-aligned with a ragged icon column, and it covers the header description |
| `139_agent_fullscreen_1440.png` | Agent foundation screen, 1440 | The foundation screen: `NEW SPECIALIST` on an existing agent, the title twice, placeholders about marking history essays inside a biology agent, `Set the foundation` in a fourth primary treatment that fails contrast |
| `140_agent_foundation_submitting_1440.png` | Agent build screen, 1440 | The Foundry's real value: an AI-compiled mission with extracted entity chips, mission-specific weighted competence facets, a HOLDINGS count and an honest CAN'T DO YET ledger. Also `COMPETENCE 0%` above bars filled 30–75 % |
| `141_agent_build_850.png` | Agent build screen, 850 | The entire authoring surface — workbar, mission, generated question, textarea, `Save and continue` — is gone. Only the status panel remains, sliced by the composer |
| `142_library_1440_sidebar_expanded.png` | Library, 1440, sidebar expanded | Confirms the agent build screen's `CAN'T DO YET` ledger is sliced by the composer even at 1440 with the sidebar expanded |
| `143_library_search_timetable_1440.png` | Library search, type scope `Agents` | `No work matches` — but the type scope was still pinned to Agents from earlier testing. **Not a defect; my own test-state error.** The empty state is good: it names all three scopes ("Adjust the search, type, or workspace scope") |
| `144_library_search_timetable_all_1440.png` | Library search, type `All`, `All workspaces` | Same query at the **widest possible scope** still returns `No work matches` for an artifact that provably exists. This is the real reachability defect (§5.3 timetable) |
| `145_timetable_legacy_fullscreen_1440.png` | `/library/<timetable-id>`, 1440 | A deep link to a real owned artifact renders the **plain Library index** — no editor, no error, no redirect, no console message. Also visible: a whiteboard a user named `Latest AI Models & Labs — Timetable`, i.e. someone has already hand-rolled a replacement for the retired type |
| `146_workspace_home_1440.png` | Workspace home, 1440 | The D7 target: `.spectra-mission-control-rail` with Recent activity / Tags / Quick actions, every timestamp overflowing the viewport by 8 px |
| `147_workspace_home_inventory_1440.png` | Workspace home, scrolled, 1440 | The bottom inventory is a full global work table (incl. conversations) with `You You` on every row, inverted column priority and no sticky header |
| `148_workspace_home_1024.png` | Workspace home, 1024 | The rail is banished to `top: 14278` — below the entire inventory |
| `149_workspace_home_850.png` | Workspace home, 850 | Single-column cards; the four decorative background tints are unmissable; sidebar still 240 px |
| `150_workspace_specific_1440.png` | Workspace + agent split, 1440 | The artifact panel description clipped to 15 px against 81 px of 22 px text; the left inventory clipped at the split boundary rather than adapting |
| `151_workspace_m4qa_1440.png` | Specific workspace, 1440 | `Library \| People \| Settings` nav, the permanent right details column, inert type-group headers, three levels of nested border |
| `152_workspace_people_1440.png` | Share modal, 1440 | Reference-quality permission surface: role, note, honest empty state, `Public access [Explicit]` with a precise capability boundary and expiry |
| `153_workspace_settings_1440.png` | Edit workspace modal, 1440 | Duplicates the pencil action; unlabelled name/description fields; 8 + 1 ragged icon grid |
| `154_calendar_1440.png` | Calendar, 1440 | The rail worth keeping (`Unscheduled work · 183`, real drag source) on the darkest surface of the route; `Needs refresh` an inert `<span>`; no view switcher |
| `155_calendar_850.png` | Calendar, 850 | `10 Aug – 16 Aug 2026` collapsed to a vertical stack of two-character fragments; the weekend off-screen behind a horizontal scrollbar |
| `156_agents_1440.png` | Agent library, 1440 | Two identical empty sections open the route; `Open agent` in three identity colours, one of them rose |
| `157_agent_detail_1440.png` | Agent library + split, 1440 | No separate `/agents/[id]` — the shared studio panel. The card grid keeps 3 columns and clips labels to under half |
| `158_school_1440.png` | School Overview, 1440 | `At a glance` says `Classes 16` while the body says "No school records have arrived yet" |
| `159_school_classes_1440.png` | School Classes, 1440 | 16 real workspace-linked classes — proving the Overview empty state false; 97 px rows for a course code and the constant `Class source` |
| `160_managebac_1440.png` | `/managebac`, 1440 | Renders `/school` without redirecting; live `Timetable for my classes` capability; a raw stack trace leaked into the UI |
| `161_analytics_1440.png` | Analytics, 1440 | The product's best honesty copy; nine arbitrary bar hues; 63 failed runs with no drill-down |
| `162_admin_1440.png` | Admin Overview, 1440 | Every tile has a real drill-down (the pattern to promote); `Connected` in amber; a rail that is navigation, not summary |
| `163_superadmin_1440.png` | Superadmin Overview, 1440 | Best epistemic labelling; `Collaboration — Unknown` done right; a chart with no axis whose series are silently normalised |
| `164_chat_1440.png` | Chat empty thread, 1440 | The best-composed surface in the product, and the only one where the composer does not occlude content |
| `165_settings_1440.png` | Settings, 1440 | Reference framing copy; the "blank monotone page" overcorrection; four more native `<select>`s |

Screenshots are diagnostic evidence, not completion evidence. A screenshot is
not evidence merely because it exists — it counts only once it has been inspected
and what it shows is written down.

---

## 3. Artifact system architecture — what a restructure must not break

### 3.1 Files and sizes

| File | Lines | Role |
| --- | --- | --- |
| `components/artifact-studio.tsx` | 6,769 | `ArtifactStudio` :2767, `ArtifactStudioEditor` :3032–5700, shell header :5169–5351, `<main>` :5460, per-type dispatch :5484–5633, `StudioDetails` :6007–6590, shared UI kit exports :6609+ |
| `components/artifact-studio-shell.tsx` | 594 | `useArtifactStudioState` :23, `StudioSplitShell` :215 (`containerType: inline-size` :375, min 560 px, fair-share :245–308), `StudioTabRail` :396 portaled to `#spectra-shell-tab-slot` |
| `components/artifact-workbar.tsx` | 186 | `ArtifactWorkbar` / `WorkbarRail` / `WorkbarAction` / `WorkbarSelect` / `WorkbarMenu` / `WorkbarMore`. **Only `agent-foundry.tsx:1108` consumes it** |
| `artifacts/types.ts` | — | `ARTIFACT_TYPE_KEYS` :3 (10), `WORK_TYPE_KEYS` :22 (9), `CREATABLE_ARTIFACT_TYPE_KEYS` :35 |
| `artifacts/registry.ts` | 1,405 | `regionAdapters` :40–998, `operations` :1010–1209, manifests :1361, `enumerateArtifactRegions` :1388 |
| `work/registry/registry.ts` | 431 | modes :38–97, `permissionsFor` :255, `responsive` :99–110 (**declared, never enforced**), `workCapabilities` :395, `workCan` :403, `availableWorkModes` :416, timetable escape hatch :383–389 |
| `components/artifact-card.tsx` | — | `blueprintMeta` :75–145 — a **third** divergent registry with label mismatches (Deck/Sheet/Board/Task/Timetable) and manifest icon strings that are never resolved |

### 3.2 Per-type editor modules and their second navbar

Every studio renders its own `.spectra-editor-workbar` **under** the shared
`.spectra-artifact-header`. This is the "two navbars" defect, and it is worse
than one extra row:

| Module | Second bar | Extra rows |
| --- | --- | --- |
| `document-studio` | :1060 | — (but see §5.1: the bar is destroyed) |
| `flashcard-studio` | :1904 | metrics strip :1850 → 3 rows |
| `quiz-studio` | :1285 | native `<details>` overflow :1369 |
| `plan-studio` | :349 | — |
| `sheets-studio` | :2112 | **6 bars**: menu :2114, format :2469, formula :2689, named-range :2763, status :3623, tabs :3645 |
| `code-studio` | :2263 | `.code-mobile-switch` :2658 |
| `presentation-studio` | :2449 | second row :2540 |
| `whiteboard-studio` | :1853 | — (reference for menu choreography) |
| `timetable-studio` | :1204 | — (legacy type) |
| `agent-foundry` | :1108 | the only consumer of the shared workbar |

Duplication to collapse: sync status appears in the shell header **and** in
presentation, whiteboard and sheets. Three independent undo/redo
implementations. Three separate History surfaces. The Comments panel is an
in-studio overlay clipped by the studio box rather than portaled.

### 3.3 The DOM contract the AI and collaboration layers depend on

Any editor restructure must preserve these or migrate them deliberately in the
same change. Breaking one of them silently disables AI editing or presence for
that type.

- Surface and targeting attributes: `data-spectra-surface`, `data-spectra-target`,
  `data-spectra-part`, `data-spectra-primitive`, `data-spectra-line`,
  `data-spectra-hidden-target`, `data-spectra-region`, `data-region-id`,
  `data-block-id`, `data-address`, `data-ai-path`, `data-ai-region`,
  `data-spectra-held` / `-held-by`, `.spectra-presence-layer`,
  `.spectra-artifact-main`, `data-ai-preview` / `-effect-count` / `-activity`.
- `InteractionLayer` **must remain the first child** of the
  `data-spectra-surface` scroll container (`artifact-studio.tsx:5478`, with the
  reason in the comment at :5475–5477).
- `useInteractionPresence` (11 listeners, `PUBLISH_INTERVAL_MS = 45`) and
  `interaction-geometry.ts` selector precedence (:26–33, :114–201). Awareness
  field literal is `"user"`.
- Region model: `regionAdapters` + `SemanticTarget` + RFC-6901 canonical paths.
  `enumerateArtifactRegions` **hard-fails on duplicate ids** — a copy-pasted
  region id crashes the type.
- Action layer: `spectraToolRegistry`, `application-tools.ts` tool ids,
  `operations/schema.ts` typed operation union, `RecoverableAction` /
  `performRecoverableAction`, `collaborationPolicyRegistry`
  (mergeable / interaction_lease / structural_claim) with a module-load
  assertion.
- Choreography: client `planChoreography` switches on `target.primitive`, **not
  on artifact type** — this is why a new control must declare a primitive rather
  than a type special case. `AiPerformer` + `validateEnvelope`; server
  `buildArtifactLivePreviewBeats` / `AiStreamBeat`; `DURABLE_GRACE_MS = 4000`,
  `APPROACH_MS = 180`, `SETTLE_MS = 260`.
- Transport: Yjs / Hocuspocus. `Y.XmlFragment` for document, `Y.Text` for code,
  structured adapters for the other eight. `WorkTransactionOrigin` object
  identity drives attribution; `Y.UndoManager` is origin-scoped.
- CANON D20 path: editor → `transport.transact` → Yjs update → async projection
  (`SNAPSHOT_PROJECTION_DELAY_MS = 120`) + debounced IndexedDB (140 ms). Nothing
  synchronous may be inserted between keystroke and pixel.
- `region-controller.ts:50–74` — the human path deliberately does **not** await a
  claim. Do not "fix" this into an await.

**Known gaps in the contract:** `document-studio.tsx` and `plan-studio.tsx` have
zero `targetAttrs` / `data-ai-region` / `data-block-id`. Document leans on
TipTap `stable-block-id.ts:45–48`; plan has no AI targeting at all. Closing
these is in scope and must go through the shared typed system, not a type-local
shortcut.

### 3.4 Responsive machinery

- Proper container queries exist only in `code-studio` (container :13766,
  queries :14235/:14292) and `presentation-studio` (container :7370, queries
  :8929/:8954, plus a JS `ResizeObserver` threshold at 880 in :1116–1124).
- `whiteboard-studio` (:2759/:2778) and `timetable-studio` (:4056/:4080) use
  **viewport** media queries, so they respond to the browser window rather than
  to the panel. Both are wrong in split view. `agent-foundry` has no responsive
  handling.
- There is **no shell container query in the 600–900 px band**, which is exactly
  the split-panel range.
- `@container artifact-workbar` rules at `spectra-app.css:18573` (max-width 720)
  and :18593 (max-width 500) are effectively dead because only `agent-foundry`
  uses the container.
- `work/registry/registry.ts:99–110` declares a `responsive` contract per type
  that nothing enforces.

### 3.5 Session and persistence keys

`useSpectraContextStore` (`spectra.context.v2`, `skipHydration`, `openObjects`
keyed `type:id`, slot rules :126–142, `reconcile` :185–203) ·
`SharedWorkbenchSession` (`spectra:shared-workbench:v2`, read/write at
`artifacts-shell:209–211` and `workspace-shell:3273–3275`,
`transferSideSessionToLibrary` :128) · `RouteSideSession` :80–126 · separate hub
tab keys `spectra.workspace.hubTabs.v1` vs `spectra.artifacts.hubTabs.v1` ·
`spectra.home.activityRail.collapsed` · `spectra.workspace.inspector.collapsed` ·
`spectra:sidebar-collapsed`.

---

## 4. Shared product rules for every editor

1. One artifact identity row. One adaptive control surface. No second navbar.
2. Menus overlay; they never change the height of the bar or introduce
   `overflow-y`.
3. Every visible control is real, and every essential control survives 850 px.
4. Icons over redundant labels where meaning stays unambiguous; polished
   tooltips; one hover/focus/active treatment.
5. Spacing and composition before borders, dividers and background boxes — and
   no overcorrection into blank monotone pages. Quiet hierarchy, restrained
   colour, strong typography, fine icons, purposeful motion, immediate feedback.
6. One semantic radius hierarchy, one font scale, one truncation policy, one
   empty/error/loading grammar. `--card-radius: 10px` exists
   (`spectra-tokens.css`) but 18 CSS values and 17 arbitrary TSX values bypass
   it; ~800 `text-[Npx]` literals bypass the type scale **and** the
   `data-spectra-interface-text="large"` accessibility override — so token
   adoption is a functional fix, not cosmetics.
7. CANON D1/D3/D4: owners always edit; Attempt / Present / Study / Preview are
   activities with an obvious exit; compact and split are never read-only.
8. No `v2` files. Search before creating. Replacing an implementation deletes or
   migrates the old path in the same change.

### 4.1 The references already in the product — converge on these, do not reinvent

The baseline found working answers to most of the shared problems. Every artifact
owner adopts these rather than designing a new one.

| Problem | Existing reference | Where |
| --- | --- | --- |
| Adaptive workbar that never wraps or overflows | **Quiz**: 8 controls, one 46 px row, holds at 682 / 1024 / 1363, ellipsis-truncates its long label, real `…` | `quiz-studio.tsx` |
| Control grammar inside the bar | **Code**: modes left → context chip → actions right → `⋯` last | `code-studio` / `.code-workbar` |
| Label shedding under pressure | **Code at 850**: icon actions drop labels, mode labels and the primary verb survive. The Library rail's label *deletion* is the anti-pattern | `.code-workbar` vs `nav[aria-label="Library collections"]` |
| Overflow menu with real breadth that does not grow the bar | **Whiteboard `More tools`**: 14 items incl. pages & layers, templates, accessible outline, four exports; bar stays 34 px | `whiteboard-studio.tsx` |
| Long list → narrow width | **Presentation at 850** and **Quiz at every width**: `‹ n · Title ⌄  n of N  ›` selector. Two types already agree; make it one primitive | `presentation-studio.tsx`, `quiz-studio.tsx` |
| Contextual formatting without a second navbar | **`ArtifactRichTextEditor`**: a 38 px inline toolbar inside the field, `variant: planner \| compact \| card` | `artifact-studio.tsx:5723` |
| A real second experience with an obvious exit | **Present mode**: dark chrome, content typography, timer, `✕ Exit`, real speaker notes, composer hidden | `presentation-studio.tsx` |
| Truthful capability statement | **Code preview**: `● Preview is running in an isolated Spectra sandbox.` | `code-studio` |
| Honest incapability ledger | **Agent Foundry**: `CAN'T DO YET`, and "Not pursued for this mission: …" | `agent-foundry.tsx` |

Anti-patterns found, and the type that shows each: growing taller (`deck`,
`flex-wrap`), deleting whole control groups (`sheets` at 682), a horizontal
scrollbar inside the bar (`planner`, `presentation`), no bar at all (`planner`,
`agent` foundation screen), two stacked bars (`presentation`, and `code` at 850),
and losing the authoring surface entirely (`agent` at 850).


---

## 5. Confirmed defects

### 5.1 Document — the toolbar does not exist at any width `P0`

`.spectra-document-toolbar` contains **15 buttons** and computes to
`width: 24px; order: 2; overflow-x: auto`, landing at the *bottom* of the editor
body. Measured in split (panel 682 px) and in fullscreen (studio 1353 px):
identical 24 px stub. The Document editor therefore has no reachable formatting
controls anywhere.

Cause: `.spectra-editor-workbar { container-name: artifact-workbar;
container-type: inline-size; min-width: 0 }` (`spectra-app.css:18456–18459`) was
added for the M4 adaptive workbar, while `.spectra-document-toolbar { order: 2;
width: auto; margin-top: 0 }` (`:11530–11532`) still opts the document bar into
shrink-to-fit. `container-type: inline-size` applies inline-axis containment, so
the bar's contents no longer contribute to its intrinsic width and `width: auto`
collapses to padding. The same element is also styled at `:243`, `:291`,
`:11511`, `:12067`, `:12110`, `:14606`, `:14635`, `:14675`, `:14682` — nine
competing rule blocks for one toolbar, several with `!important`.

Also on Document: header 87 px tall in split with the description **sliced
horizontally through the glyphs**; no title field in the canvas; ~700 px of empty
canvas with no writing affordance or placeholder; More menu covers the whole
identity row; Comments sits as a top-level icon while References, Details,
History and Share hide in the menu.

### 5.2 Product-wide, already evidenced

- **Workspace home** main scroller is 14,100 px tall at 1440 (17 viewports)
  because the global inventory is dumped into it. Right rail is sticky and does
  not scroll with content; Quick actions is clipped; the rail has its own
  horizontal scrollbar; workspace cards have unequal heights; card 1 shows an
  orphan leading bullet "· Source-linked from ManageBac".
- **Workspace cards are non-semantic `div`s** with an absolutely-positioned inner
  `button[aria-label="Open X workspace"]` and no `<a href>` — no deep linking, no
  middle-click, poor a11y. Library List rows have the same problem
  (`<button class="grid min-h-[64px] …">`).
- **"Open work" does not open the editor on the workspace route.** Clicking a
  work chip only selects it into the Inspector; the `Open work` button is below
  the fold (rail `scrollHeight` 1150 vs viewport ~1000, composer covering the
  bottom). Pressing it writes `openObjects: [{type:"artifact", id:…,
  presentation:"split"}]` and `activeOpenObjectKey` to `spectra.context.v2` but
  no `[data-studio-panel]` renders. `P0` functional.
- **Reload does not restore open work.** With `presentation:"split"` persisted,
  the workspace renders the workspace-details inspector instead of the studio.
  CANON D7 / Flow 10. `P0`
- **`/library/<workId>` deep link does not open the work** — Library's
  `artifacts` list does not contain workspace-placed ids, so `initialArtifactId`
  never resolves.
- **Library inventory is incomplete.** Library reports All work 76 / Unplaced 74
  / 2 placed, while the single Spectra Launch Studio workspace reports Work 78
  and its bundle returns 262 items / 78 artifacts. The 78 workspace artifacts do
  not appear in Library. CANON D14 and D7. `P0`
- **Composer / Live Dock covers list rows** on Workspace and Library (D8), and
  its `+` button is visually detached from the pill.
- **Library List**: 7 rows per 900 px viewport, ~94 px pitch for three data
  points, metadata ~990 px from the title; two different row implementations in
  one view, one of which **nests** the More button inside the row button
  (invalid HTML); nested `<main>` elements; a stray
  `button "Choose file"` exposed in the header region.
- **Workspace detail** shows three chrome rows before content (shell tab rail as
  a second application header, header with large title + hardcoded `Sprout` icon
  tile, section nav); Pinned cards clip "In workspace" mid-line; every type-group
  chip truncates; the right details column repeats the header description
  verbatim and clips "People and access"; toolbar right-aligned against
  left-aligned content.
- **`ProductSectionNav`** has `overflow-hidden` (:29–32) that clips unreachable
  items, hides labels below 520 px (:53), and always overflows past
  `primaryCount = 5` regardless of available width (:22–23). Library's own rail
  does not consume it.
- **Dead code in `workspace-shell.tsx`**: `metricCards` always `[]` (:658) inside
  a `hidden` wrapper (:690–725); `CardsView` :1644; `CompactShelf` :1752;
  `_TimelineView` :1824; `_PinnedArtifactShelf` :3207.
- **Five independent List/Board/Canvas implementations** — Canvas ~95 %
  copy-paste (`artifacts-shell:2973` vs `workspace-shell:2498`, identical zoom
  clamps 0.65–1.35 step 0.1, identical 18 px dot grid); Board three ways
  (`artifacts-shell:2863`, `workspace-shell:2242`, `object-library:1163`); List
  sharing nothing across four renderers; three sort enums; three
  `useOutsideClick` copies; two type-filter lists. `ObjectLibrary` is the most
  complete generic browser and has one importer — the natural convergence
  target.
- **Realtime shows "Reconnecting"** in the artifact header after idle. Needs a
  truthfulness check: recover, or state the real state.
- **The Library rail degrades by deleting labels and opening a native
  `<select>`.** At 608 px (the width the Library column takes when a split editor
  is open at 1440) `nav[aria-label="Library collections"]` keeps only
  `All work 76` labelled; Threads becomes `200`, Unplaced becomes `64`,
  Shared-with-me becomes an **18 px icon with no accessible name at all**, Recent
  becomes `76`. The overflow that looks like a three-dot control is a real
  **native `<select>`** holding `More collections / Favorites / Collections (35) /
  Invitations`. This is exactly the regression §9.3 forbids — labels deleted
  rather than prioritised, and a generic dropdown instead of a genuine overflow
  menu. Evidence: `129_planner_split_1440_valid.png`.
- **Native `<select>` elements are used throughout the product** — the Library
  rail overflow, the planner row status and both planner filters, quiz Type /
  Difficulty / Bloom's taxonomy. An OS dropdown cannot match Spectra's menu
  grammar, hover, focus ring or radius scale, so every one of these is a D16
  break. One shared `Select` primitive is an S1 deliverable.
- **Library rows and cards are `<button>`s, not links.** The a11y tree shows
  `button "Study Physics Task 4d ago"`. No middle-click, no open-in-new-tab, no
  copy-link, no deep link — S6.
- **The Library toolbar exposes a raw file input.** An `input[type=file]` with
  `class="sr-only"` but a live 240 × 1 px box appears in the accessibility tree as
  `button "Choose file" value="No file chosen"` — browser-default chrome inside
  the product (D13).
- **Rail counts ignore the active type filter while section counts respect it.**
  With the Tasks filter on, the rail reads `Unplaced 64` and the body heading
  reads `Unplaced work 44`. Both are labelled "Unplaced" with nothing to explain
  the difference (D14). The absolute numbers also drift as work is added because
  of the 80-row `list` cap.
- **`Threads 200`** is a suspiciously round number presented as a count. Verify
  against a real total before trusting it.
- **The sidebar does not adapt to narrow viewports.** At 850 px it stays fully
  expanded at 240 px — 28 % of the viewport — leaving the editor 610 px
  (`131_planner_fullscreen_850.png`). It also **grows items after hydration**: two
  destinations and the account row appear a beat after first paint, so the rail
  visibly reflows on every load.
- **The account name renders as `P MD`** above "School Admin" in the sidebar
  footer. Verify against the real profile record; a mangled display name in the
  persistent chrome is the first thing a user sees.
- **Escape closes the artifact instead of dismissing an open menu.** The handler
  at `artifact-studio.tsx:4599` guards only for inputs and for
  `historyOpen`/`commentsOpen`/`embedsOpen`; an open dropdown is not checked, so
  pressing Escape with a menu open closes the whole editor. Verified in the
  browser: two menus open → Escape → `data-studio-mode` went to closed and the
  work was gone.
- **Two menus can be open at once.** Opening the header's `More work actions` and
  then the whiteboard's `More tools` left both popovers on screen; neither
  dismissed the other, and together they covered ~70 % of the canvas at 850 px.
  One menu-manager primitive is needed (S2).
- **Four different primary-action treatments are in use.** Filled violet
  (`+ New chat`, `▶ Present`, `▶ Run`), filled black (quiz `Publish`, agent
  `Compile skills`), pale lavender with white text (agent `Set the foundation`,
  `Save and continue` — and this one fails WCAG AA contrast), and outline violet
  (code `Publish`). The *same verb* `Publish` is filled black in quiz and outline
  violet in code. D16.
- **Nine distinct artifact header heights measured**: 74 (agent), 87 (document),
  92 (code, whiteboard), 109 (sheets), 110/112 (deck), 115 (presentation), 127/133
  (quiz). Description type sizes also differ per type: ~11 px (quiz, planner),
  18 px (presentation), 19 px (code, whiteboard). The shared header is shared in
  code only, not in effect.
- **The composer occludes real content in six of nine editors** — sheets (status
  bar and sheet tabs), quiz (Explanation and `Advanced placement`), planner
  (nothing left to cover, but it clips the invalid-content banner), presentation
  (the speaker-notes chip at 1440), code (the status bar), agent (the CAN'T DO YET
  ledger). The pattern is the same everywhere: the scroll container has no
  composer-height bottom padding. One fix in the shared shell resolves all of
  them (D8, S2).
- **Header descriptions truncate without an ellipsis** in document, presentation
  and code — the text simply stops mid-sentence. One truncation policy is required
  (D16).
- **A deep link to any artifact outside the loaded set is a silent no-op.**
  `artifacts-shell.tsx:898-910` resolves `requestedArtifactId` with
  `allArtifacts.find(...)` and bails on `if (!artifact) return;` — no error state,
  no toast, no redirect, no console message. The URL keeps asserting that work is
  open while the Library index renders. Reproduced with a legacy timetable
  (`145_timetable_legacy_fullscreen_1440.png`), but it applies equally to deleted,
  unshared or not-yet-loaded work. An inert affordance is a defect (M4). S6.
- **The Library "Select objects for AI" button lives inside the type-filter
  menu's accessibility tree.** Snapshot shows `button "Select objects for AI"` as
  the last child of `menu "Filter by work type"`, after ten `menuitemradio`s — a
  non-menuitem inside a `menu` role. Either it belongs in that menu (then it needs
  a menuitem role and a separator) or it has leaked into the wrong container. S4.

### 5.3 Per-type findings

Filled in during the baseline. Each entry records: split behaviour, fullscreen
behaviour, constrained-width behaviour, menus/inspectors, real editing, and the
functional gap against the competitor bar.

- **document** — see §5.1.
- **flashcard_deck** — header 110 px in split / 112 px fullscreen. `.spectra-deck-toolbar`
  uses `flex-wrap`: at 682 px it is **65 px tall (two rows)** and at 1363 px it is
  46 px. It has **no overflow control at all** (11 controls, 0 `More`), so its
  only adaptive strategy is growing taller — the exact behaviour §9.1 forbids.
  At 1440 fullscreen `Study · 28` and `Hide cards` **physically overlap**. Three
  rows of chrome (identity 112 + metrics strip ~70 + toolbar 46 = ~228 px)
  before the first card. The metrics strip is a five-cell bordered summary row
  inside an editor — the pattern M4 removed from routes — and reads
  "1 Sections" and "Active / Ready" (state twice in one cell). Card list rows
  are 28 individually bordered pills (border wall) in a fixed-width column that
  truncates titles at ~340 px while the right pane has spare width. Confidence
  dots render identically for cards stored as high/medium/low — verify whether
  stored confidence is being read at all. The flip control between FRONT and
  BACK is an unlabelled circle. Body scrolls (`sh 830` vs `ch 714`) while the
  card list has its own scroller — nested scrollers.
  Functional bar (Quizlet/Anki): no study scheduling visible in authoring, no
  card reordering affordance found yet, import present.
- **sheets** — the strongest editor and the reference for the shared workbar.
  Fullscreen 1440: one 52 px `sheets-top-bars` row holding a real menu bar
  (File/Edit/View/Insert/Format/Data), undo/redo, currency/percent/decimals,
  B/I/U, text colour, fill, three alignments, Σ, filter, **a working `…`
  overflow**, then name box + `fx` + formula input. 25 of 30 controls visible.
  Formulas evaluate correctly (AVERAGE/MAX/MIN/STDEV, named range, frozen
  panes). Defects: at 682 px **only 5 of 30 controls survive** — the format bar
  is deleted rather than collapsed; at 850 px the same, leaving an orphan `·`
  separator; `format.numberFormat` and `format.decimals` are **ignored** in
  rendering (3-decimal cells render as `24.1`) while `bold` and `fillColor`
  apply; the `fx` glyph renders as **`Æ'x`** (encoding bug, D13); static
  "100 rows · 26 columns" occupies toolbar space that real controls lose;
  `A1` is shown twice (name box and status bar); the grid draws cell borders
  only where cells exist, so it looks ragged past column F; frozen-pane
  dividers use the brand accent and compete with selection; the bottom status
  bar (28 px) and sheet tab bar (43 px) are **covered by the composer** at 1440
  and completely buried at 850, where the add-sheet `+` and the composer `+`
  physically overlap; the header description is clipped without an ellipsis;
  column widths stay 122 px regardless of pane width, so a 682 px panel shows
  5 of 6 columns.
- **quiz** — **the reference for workbar discipline, and the model the other
  eight should converge on.** One 46 px bar at every width: `‹` · question
  selector with the question text and a `⌄` picker · `1/12` · `›` · preview eye ·
  real `…` overflow · `Publish`. 8 controls, **8 visible, no wrap, no overflow-x,
  no overflow-y at 682 / 1024 / 1363**. Body is a genuine three-column authoring
  layout — question list (numbered rows, MCQ/Short-answer chips, drag handles,
  `Add question` at both ends), question editor (Type select, Question, Answer
  options with radio→green-check correct markers and per-option remove,
  `Add option`, `Shuffle options`, helper copy "Select the correct option using
  its marker.", Explanation), and a type inspector (Difficulty, Points, Time,
  Bloom's taxonomy, Standards, Media drop zone, `Advanced placement`
  disclosure). Stored data renders truthfully (Easy / 1 / 60 / Remember match
  the seeded question). Bloom's taxonomy and Standards are real pedagogical
  depth Quizizz and Kahoot do not have — keep them.
  **Editing verified live at 1440**: typing in the Question field propagates in
  the same frame to the workbar label, the list row and the editor heading, and
  the workbar label truncates with an ellipsis while the bar stays exactly 46 px
  with `flex-wrap: nowrap`, no overflow-x and no overflow-y even with a 240-char
  question. The workbar is the one control surface in the product that already
  satisfies §9.1.
  **Discovery — `ArtifactRichTextEditor` (`artifact-studio.tsx:5723`).** Focusing
  the Question field reveals a *contextual inline toolbar* (Bold, Italic,
  Underline, Strikethrough, bullet list, numbered list, Quote, Inline code,
  Link, Inline equation, Block equation) at 38 px, rendered inside the field, not
  bolted to the workbar. It has `variant: planner | compact | card` and a
  `collapsible` flag, and is consumed by `quiz-studio.tsx:3053` and
  `flashcard-studio.tsx:3850`. **`document-studio` does not use it** — it has its
  own `.spectra-document-toolbar`, which is the one that collapses to 24 px. So
  the product already contains two rich-text authoring implementations, one
  working and one broken (D21). This primitive, not a repaired workbar toolbar,
  is the likely convergence target for §5.1 — see S2.
  Defects: header is a **four-element stack** (eyebrow, title, description, tag
  chips) at **127 px split / 133 px fullscreen** — the tallest identity block in
  the product and a fourth row no other type has, so the "shared" header is not
  shared in effect (six distinct header heights now measured: 87 / 109 / 110 /
  112 / 127 / 133). The composer **slices the Explanation label and field
  horizontally mid-glyph at 1440 and 1024** — same D8 violation as sheets' status
  bar; the scroll container has no composer-height bottom padding. The Question
  field's focus state paints an **amber border plus a teal 2 px toolbar
  underline** — two accent colours that exist nowhere else against a violet
  product accent. Its wrapper class is `spectra-planner-description` even inside
  a quiz, so a shared primitive is named after one consumer. The field keeps a
  fixed ~250 px min-height that does not shrink at constrained widths, which is
  what pushes Explanation under the composer. At 1024 the question list is
  ~250 px and truncates every row to uselessness ("Which molecule is split d…",
  "At very high light intensit…") with its own nested scroller showing 8 of 12,
  while the editor column has spare width — the same fixed-column bug as the
  deck. The same fact is stated **three times simultaneously**: workbar
  `1 · <question>` + `1/12`, list header `QUESTION 1 OF 12`, editor heading
  `Question 1 of 12`. `Publish` is a **filled black** button while the product's
  primary is violet — two primary treatments (D16); it also reads `Publish` on an
  already-published quiz, so it does not reflect state (D14). Tag chips are
  **mint green** and `Browse` is a **green underlined link** — two greens used as
  accent inside one editor. Option remove controls are bare `−` glyphs outside
  the input edge while the question uses a trash icon — two delete grammars. The
  panel-collapse `⊟` left of the list header is an unlabelled bare icon.
  Inspector labels are body-sized with full-height inputs, so the panel reads as
  a form page rather than a properties inspector.
  `fx` renders correctly here, which confirms sheets' `Æ'x` is a local encoding
  bug in the sheets label rather than a font problem.
  Not defects — verified as tooling artifacts: `<input type="number">` ignores
  CDP `Input.insertText` and bare `dispatchKeyEvent` without `text`, so the
  Points/Time fields only appeared unresponsive to the harness. They accept real
  input and persist.
  Functional bar (Quizizz/Kahoot): authoring is ahead; verify Attempt, timing
  enforcement, shuffle actually persisting, and per-question media upload.
- **planner_task** — **the most structurally broken editor in the product `P0`.**
  Two content models exist for one type. `blueprints/planner-task.ts:4`
  (`plannerTaskContentSchema`, registered in `artifactContentSchemas.planner_task`)
  describes **one task**: `taskTitle`, `subtasks[{id,title,done}]`,
  `status: todo|doing|done`, `timezone`, `recurrence`, `reminders`, `priority`,
  `estimateMinutes`, `progressNote`, `assignees`, `watchers`, `attachments`.
  `plan/model.ts:1` describes **a plan of many tasks**: `tasks[]`, `sections`,
  `milestones`, `views`, `dependencyIds`, `status: backlog|todo|doing|blocked|done`.
  `plan-studio.tsx` renders the second model, bridged by an adapter at
  `plan/model.ts:111-139` that folds a single task into a one-task plan and maps
  `subtasks` → `tasks[0].checklist`.
  **Consequence, verified in the browser at 1440 fullscreen:** the editor for a
  task is a *task-list manager containing exactly one row*. Header, one toolbar,
  `1 of 1 tasks`, `NOT IN A SECTION 1`, one row, `+ Add a task`, then **~770 px of
  empty white**. The task's description, five subtasks, `priority: high`, two
  reminders, 240-minute estimate, progress note, start date and recurrence are
  **all absent from the editor**, reachable only behind a `›`. Against Todoist or
  Notion tasks this is not a contest.
  **Write path measured, not assumed.** `plan-studio.tsx:197` commits
  `onChange({ ...content, ...next })`, so model-1 fields survive — no data loss.
  But the artifact then carries **both models at once**, and the fields diverge.
  Setting the row's status to `Blocked` and re-reading the stored content gave
  `status: "doing"` (model 1, stale) alongside `tasks[0].status: "blocked"`
  (model 2, current), plus `subtasks: 5` and `tasks[0].checklist: 5` as two
  copies of the same list. **The field the schema validates, and that Library and
  Calendar read, is not what the user just set** (D14), and one type has two
  models (D21). The UI also offers five statuses where the registered schema
  allows three, so choosing `Backlog` or `Blocked` writes content that fails its
  own validation.
  **Invalid content is surfaced as a raw Zod string.** `artifact-studio.tsx:5428`
  renders `live.modelSnapshot.error` verbatim; a task whose `subtasks` lacked
  `done` and whose `reminders` lacked `minutesBefore`/`enabled` produced the
  banner `Invalid input: expected number, received undefined; Invalid input:
  expected boolean, received undefined` across the top of the editor, clipping
  the header description, while the subtasks silently vanished and the list read
  `1 of 1 tasks` beside a `0/5` badge (`128_planner_split_1440.png`). The
  fallback copy one line below ("The live artifact state needs recovery before
  editing can continue.") is correct and never wins. D13 and D14.
  **The write path does not validate.** `spectraArtifacts:create` takes
  `content: v.any()` and never checks `artifactContentSchemas`, so invalid
  content persists silently and only fails at read time. Pre-existing product
  data is already invalid: the legacy `Study Physics` task stores `dueDate`,
  `estimate` and `reminder` where the schema expects `dueAt`, `estimateMinutes`
  and `reminders`.
  **Chrome and responsive.** There is **no artifact workbar at all** — the type
  toolbar is the only bar, the opposite failure to the deck's two. At 682 px split
  the toolbar overflows (`scrollWidth 689` vs `clientWidth 630`) and clips the
  Export control against the panel edge. At 850 px it overflows to
  `scrollWidth 683` vs `clientWidth 558` with **6 of 11 controls reachable and a
  visible horizontal scrollbar inside the toolbar** — a scrollbar is not an
  adaptive strategy (§9.1). The header exposes four controls (Comments, Open as
  tab, More work actions, Close) where quiz exposes three.
  **Native `<select>` elements**: the row status control and both filters are OS
  selects (`all,backlog,todo,doing,blocked,done`), as are quiz's Type /
  Difficulty / Bloom's controls and the Library rail overflow. Native selects are
  a product-wide grammar break — see S1.
  Smaller defects: the task title truncates while a `08/21/2026` US-format date
  is preserved beside a relative `5d` and a relative `3d ago` elsewhere — three
  date formats, and priority inverted so the date outranks the task's own name. A
  near-invisible ghost calendar glyph sits between the date and `5d`. `+ Section`
  and `+ Add a task` are two competing empty-state affordances. A select-all
  checkbox is offered for a one-item list.
- **presentation** — **the canonical "second navbar" case.** Two stacked bars at
  1440: `.presentation-primary-bar` (44 px — `Slides | Settings | Theme |
  Preview` tabs plus `▶ Present` violet and `Rehearse` outline) and
  `.presentation-toolbar` (42 px — 23 controls: `+ Slide`, layout, undo, redo,
  `Title & content ⌄`, text, shape, image, chart, table, link, group, ungroup,
  B/I/U, three aligns, list, lock, delete). 86 px of bars under a 115 px header.
  Neither overflows at 1440. `Slides | Settings | Theme | Preview` is a
  persistent tab row inside the editor and `Preview` is a peer tab beside
  authoring — D2. `Settings` and `Theme` as tabs means leaving the slides to
  change a theme.
  **Present mode is the best-executed surface in the product** and should be the
  bar the other activities are held to (`134_presentation_present_1440.png`):
  full-bleed dark chrome, the slide on its themed card with the botanical
  gradient actually rendering, the deck's own serif display type (content
  typography, not product typography), `🕐 0:23` elapsed timer, slide name
  centred, `✕ Exit` — one obvious click out, per D3 — and `‹ 1 / 8 ›` with the
  real speaker note rendered beneath. Composer and Live Dock correctly hidden.
  Two issues: the editor's slide-number badge **leaks into Present**, and speaker
  notes are shown in the audience view (verify whether a presenter view is
  intended).
  **The slide-number badge occludes every thumbnail.** A large grey `1`–`8` is
  drawn on top of each thumbnail's own content, cutting through the slide title
  in all eight (`Ra1es of reaction`, `W2e already know`, `C3on theory`).
  **At 850 px the adaptation is half right.** The thumbnail rail correctly
  collapses to a `‹ 1 · Title ⌄  1 of 8  ›  Show previews` selector — structurally
  the same pattern as the quiz question selector, so **two types already converge
  on it**; make it the shared primitive. `Speaker notes  Notes added ›` also
  improves, becoming a full-width disclosure under the canvas instead of a
  floating corner chip the composer overlaps at 1440. But `Rehearse` is clipped
  mid-word by the panel edge; `Title & content ⌄` **overlaps the chart and image
  icons**; the toolbar overflows to `scrollWidth 674` vs `clientWidth 560` with a
  visible horizontal scrollbar and 18 of 23 controls reachable; and the header
  description truncates with no ellipsis ("Eight-slide lesson deck with").
  Methodological note: the automated overflow probe reported `ovX: false` for the
  primary bar while `Rehearse` was visibly clipped — the button box fits, its text
  does not. Visual inspection is required; measurement alone under-reports.
- **code** — **the best artifact editor in the product and the model for S2.**
  One 44 px `code-workbar`, 13 controls, no wrap, no overflow at 1440, with the
  correct grammar: modes left (`👁 Visualisation | </> Code | ⊟ Both`), then
  `Settings`, `Controls`, the `index.html ENTRY` file chip, then right-aligned
  `Files`, `Find`, `Format`, `▶ Run`, `Publish`, `⋯`. Real syntax highlighting,
  line numbers, fold arrows, soft wrap with continuation indent. **The
  visualisation genuinely runs**: the projectile parabola draws on canvas, the
  Angle/Speed range inputs show live values, and the preview states
  `● Preview is running in an isolated Spectra sandbox.` — a truthful capability
  statement and the D14 pattern other surfaces should copy. Preview has its own
  reload and expand. `Visualisation | Code | Both` is a legitimate dual
  experience under D3.
  **At 850 px it adapts the right way and then breaks at the last step.** Icon
  actions correctly drop their labels while the mode labels and `Run` survive —
  prioritisation, not deletion, the opposite of the Library rail. `Both` collapses
  into a `</> Code | 👁 Visualisation` tab pair, a truthful narrow-width
  translation of a split. But `Publish` is cut in half by the bar's right edge and
  the `⋯` overflow is pushed out entirely (9 of 13 reachable, `scrollWidth 661`
  vs `clientWidth 558`) — **the overflow control is the thing that overflows**.
  The tab pair also adds a second 56 px bar exactly where space is scarcest.
  The composer buries a code status bar (a `⚠` and `ms` fragments are visible
  around its edges) and the header description truncates without an ellipsis.
  Functional bar (VS Code/Replit): file tree only behind a button at 1440 where
  there is room; verify Find, Format, multi-file editing and Publish.
- **whiteboard** — **the best-adapting editor.** One 34 px `whiteboard-core-tools`
  row in a 44 px wrapper: Select, Pan, Text, Sticky, Shape, Connector on the left,
  then `⋯ More tools`, undo, redo, zoom out, `80%`, zoom in, fit. **No overflow at
  1440 or 850, and the wrapper stays 44 px in both.** `More tools` is a real
  overflow with genuine breadth — Frame, Card, Table, Embed artifact, Add image,
  Import board, Pages & layers, Templates, Search board, **Accessible outline**,
  and export as PNG / Editable SVG / PDF / Portable board. Opening it does not
  grow the bar (34 → 34, wrapper 44 → 44), so the §9.1 menu rule is already met
  here. Content renders well: the frame as a dashed container, sticky notes as
  soft cards, a green selection outline on the active node.
  Defects: **connector labels are broken.** `limits`, `drives` and `organises`
  float in empty space away from their lines, and two more labels render as
  single-character fragments (`s`, a partial glyph) clipped behind node cards —
  labels are being placed at a bounding-box midpoint rather than on the line.
  Two vertical 3-dot handles float detached in empty canvas above `Producers` and
  `Consumers`. Child cards overlap those group headings' underline rules. An
  unlabelled violet-bordered floating panel sits bottom-right, clipped by the
  viewport. Pages and layers are only reachable through `More tools` even though
  the description says the board has two pages and three layers, so a two-page
  board has no visible page affordance. The `More tools` menu is **centre-aligned**,
  giving a ragged icon column, while every other Spectra menu is left-aligned with
  a fixed icon column — two menu layouts (D16). The `overflow: visible !important`
  at `spectra-app.css:18525` is what keeps the menu from being clipped; a
  portalled menu primitive should replace the hack (S2).
- **agent** — **the Agent Foundry, and the most conceptually distinctive thing in
  Spectra.** Discovery first, per the mission brief: `agent-foundry.tsx` plus
  `agents/foundry/{foundry-document,mission,sections,evidence,skills}.ts`. The
  intent is not a settings form — it is a *conversational compiler*. Two opening
  free-text answers ("What should this agent do?", "How should it feel to work
  with?") are compiled by the AI into a formal **MISSION** with extracted entity
  chips, after which every following question is generated from what the mission
  still lacks rather than from a fixed wizard. `foundry-document.ts:5-8` states the
  design plainly: the Foundry is the new source and the legacy `AgentContent`
  fields remain the compiled projection the runtime reads. `foundationEstablished`
  (`foundry-document.ts:47`) gates the foundation screen from the build screen.
  Verified live: my two answers compiled into a five-clause mission with the
  chips `IB Biology HL`, `Data-based questions`, `IB Biology command terms`,
  `IB assessment objectives` and the scope `for IB Biology HL students`
  (`140_agent_foundation_submitting_1440.png`). Alongside it: a **COMPETENCE**
  panel with mission-specific weighted facets (Objective 120, Manner 110,
  Judgement 100, Source material 95, Limits 85, Worked example 85, Correct result
  70, Checks 55, Given material 50) and an explicit "Not pursued for this mission:
  Method, Capabilities"; a **HOLDINGS** count (Skills/Sources/Criteria/Rules); and
  a **CAN'T DO YET** ledger naming each unestablished facet. Nothing in GPTs, Poe
  or Copilot Studio models which facets matter *for this mission* or publishes an
  honest can't-do list. This is the asset to protect.
  **Not a defect — my test-data error, recorded so it is not re-reported:** the
  agent I seeded used a plausible but wrong content shape (`profile`, `behavior`,
  `instructions`, `modelPolicy`, `routing`, …) rather than the Foundry shape, so
  `foundationEstablished` was false and the editor correctly showed the foundation
  screen. It **did** expose a real defect, though: `agentContentSchema`
  (`schemas.ts:151`) is `.strict()`, yet content with entirely foreign top-level
  keys persisted through `create` with no error and no banner — the third
  independent confirmation that the write path never validates.
  Defects: **the competence panel contradicts itself.** `COMPETENCE 0%` sits above
  nine bars filled 30–75 %, whose lengths track the weight numbers, while
  CAN'T DO YET says all nine facets are unestablished. A teacher reads the bars as
  progress; the truth is zero. Encode weight and achievement differently, or do
  not draw a bar. `Source mater…` and `Worked exam…` truncate inside a 296 px
  panel. **At 850 px the entire authoring surface disappears**: the workbar, the
  MISSION block, the generated question, its textarea and `Save and continue` are
  all gone, leaving only the status panel and a composer slicing "Judgement is not
  established." mid-glyph (`141_agent_build_850.png`). The agent editor cannot be
  used at all at 850. `Build | Continue | Compile skills` mixes two modes and a
  verb in one segmented control, with the verb styled as the active tab. The body
  then repeats `Continue building` and `Compile skills` as buttons — the same two
  actions twice on one screen. The foundation screen's placeholders describe
  *marking Year 11 history essays* inside an agent titled "IB Biology HL coach",
  the eyebrow reads `NEW SPECIALIST` for an existing agent, and the title renders
  twice (header and body). There is no `Auto-saved` indicator, unlike presentation
  and whiteboard.
- **timetable (legacy) — reconciliation COMPLETE. Retirement was implemented as
  concealment, not migration. `P0` (data loss, not cosmetics).**
  The brief's instruction was to reconcile route, legacy objects and registry
  before assuming anything, and product truth won on every point:
  1. **Route retired, correctly.** `src/app/timetable/page.tsx` is a clean
     server-side `redirect("/calendar")`. Calendar is the declared successor.
  2. **Creation blocked, correctly.** `convex/spectraArtifacts.ts:1627` rejects
     `blueprintKey: "timetable"` server-side. `CREATABLE_ARTIFACT_TYPE_KEYS`
     (`artifacts/types.ts:35`) excludes it. This must stay.
  3. **The type is absent from Library's filter**, consistently:
     `artifacts-shell.tsx:1731` and `:2330` both exclude `filter.key !== "timetable"`.
     The live menu offers All / Documents / Decks / Quizzes / Tasks / Agents /
     Presentations / Sheets / Code / Whiteboards — no Timetable.
  4. **`artifacts-shell.tsx:693-695` hard-filters every timetable row out of the
     whole Library dataset at load time:**
     `artifactResult.artifacts.filter((a) => a.blueprintKey !== "timetable")`,
     and that filtered array becomes `allArtifacts` (`:697`). So the objects are
     invisible in every collection, every view (List/Board/Canvas), every type
     scope, every workspace scope, and unfindable by search. Counts reconcile
     exactly: `action=artifacts&placement=all` returns **80**; Library's rail says
     **All work 76** = 80 − 4.
  5. **The data is real and it is the user's.** Four objects, all
     `workspaceId: null` (unplaced), all `content` keyed `{events, layers, timezone}`:
     `Glycolysis Revision — This Week` (**12 events**),
     `Weekly Study Timetable` (**7 events**),
     `Enzyme Revision — This Week` (**2 events**),
     `New Timetable` (0 events).
     **21 real events the user authored are currently unreachable by any UI path.**
  6. **Deep links to them fail silently.** `/library/q5723m2fsm2kvwavr49rdd46758b6wqe`
     renders the plain Library index — no editor, no error, no toast, no redirect,
     no console message (`145_timetable_legacy_fullscreen_1440.png`). Cause:
     `artifacts-shell.tsx:898-910` does
     `const artifact = allArtifacts.find((i) => i._id === requestedArtifactId); if (!artifact) return;`
     against the already-filtered list. **This is broader than timetables** — any
     deep link to an artifact outside the loaded set (deleted, unshared, or beyond
     a page limit) is a silent no-op while the URL keeps claiming work is open.
     Owned by **S6**, and it is an M4 "inert affordance" defect in its own right.
  7. **The machinery still treats timetable as fully first-class**, and that is
     correct — it is what makes a migration possible: region adapters
     (`registry.ts:464`), semantic regions (`:946`), `ics`/`csv` import (`:990`),
     `ics`/`csv`/`pdf` export (`:1003`), skills loader (`:1227-1229`),
     `canEmbedInteractively` (`:1320-1333`), plus the escape hatch at
     `work/registry/registry.ts:383-389`.
  8. A user has already hand-rolled a replacement: a **whiteboard** titled
     `Latest AI Models & Labs — Timetable` sits in Unplaced work
     (`145_timetable_legacy_fullscreen_1440.png`). Evidence the capability is missed.

  **Resolution — binding, and it is not "bring Timetable back".** The brief is
  explicit: *do not reintroduce a creatable legacy Timetable artifact.* So:
  - Do **not** restore creation, do **not** add a Timetable type filter, do
    **not** build or restyle a Timetable editor. Points 1–3 stay exactly as they are.
  - Replace the concealment at `:693-695` with honest handling. Retired work the
    user owns must be **visible, openable read-only, and exportable** (the `ics`/
    `csv`/`pdf` exporters already exist), and must offer a **real migration into
    Calendar** — the successor the route already names, whose shape is exactly the
    stored `{events, layers, timezone}`. A migration that moves 21 events into
    Calendar and leaves the legacy object archived is the correct end state; after
    it runs, concealment becomes truthful because nothing is left to conceal.
  - Until the migration exists, silent hiding is the worse of the two options: it
    is indistinguishable from data loss.
  - Fix the silent deep-link no-op regardless (S6), because it is not
    timetable-specific.
  Owners: **S5** (Library dataset + retired-work surface), **S6** (deep link),
  **S7** (migration into Calendar via the existing adapters). Not an artifact-owner
  task — there is no timetable editor to own.

### 5.4 Route findings

Every section, not only Overview. Recorded per route with the widths tested.

#### `/workspace?home=1` — Workspace home `1440 / 1024 / 850`

`146_workspace_home_1440.png`, `147_workspace_home_inventory_1440.png`,
`148_workspace_home_1024.png`, `149_workspace_home_850.png`

The route is exactly the D7 target, and the measurements make the case
stronger than the prose did:

- **The right column is `.spectra-mission-control-rail`** holding Recent activity
  (+ `View all` + a collapse button), Tags (+ `Manage`) and Quick actions
  (New document / deck / quiz / task / presentation …). D7 dissolves it.
- **It overflows the viewport at the default desktop width.** Measured at 1440:
  rail `left 1120, right 1440, width 320`, padding `20px` each side — yet every
  timestamp inside sits at `right: 1448`, i.e. **8 px past the viewport edge**.
  All six Recent-activity timestamps render as `37m ag`, `1h ag`, `2h ag`,
  `3h ag`… The rail is not merely unnecessary; it does not fit.
- **Two independent scroll regions side by side.** Main content
  `scrollHeight 14234 / clientHeight 782`; the rail `925 / 782`. Two scrollbars,
  two scroll positions, one page.
- **At 1024 the rail is banished below the inventory.** Measured
  `rail.top = 14278` — to reach Recent activity, Tags or Quick actions the user
  must scroll past the entire ~80-row table. The stacked fallback is nominal, not
  usable. This is the strongest argument that relocation is not the answer:
  the content has already been relocated once, into unreachability.
- **The bottom inventory is a full global work table** — columns
  `☐ / icon / Name / tags / Type / Workspace / Updated / actor`, listing work from
  *every* workspace (`M4 QA…`, `General`, `Spectra Launch S…`) **and conversations
  as rows**. This is Library, rebuilt. D7: delete it; Library owns global inventory.
- **Column priority is inverted.** The Name column truncates to `Photosy…`,
  `Unit 4 conc…`, `Projectil…`, `Titration res…`, `Rates of r…`,
  `Finish Chemis…`, `Biology HL …`, `Photosynthe…` while two full-width tag chips
  sit beside them. Row identity is sacrificed for tags.
- **`You You` on every row** — an avatar chip labelled "You" beside a text cell
  reading "You". It is in the accessible name too:
  `button "IB Biology HL coach biology agent Agent M4 QA — Artifact Rebuild 42m ago You You"`.
- **No sticky header.** After one scroll, ~80 truncated rows have no column labels
  (`147_…`).
- **Workspace cards are `<button>`s with no `href`** (S6), and carry four
  decorative background tints + four icon tints (green / lavender / blue / cream)
  with no semantic meaning (D16/D17).
- `· Source-linked from ManageBac` renders with an **orphan leading `·`** — a
  separator with nothing before it.
- The `New workspace` tile sits alone on row 3 of a 2-column grid, leaving a
  half-row void. The `‹ ›` carousel above paginates 4 cards in a 2×2 grid.
- **The composer occludes the table header at 1440 and the `Search objects` +
  `View` controls at 1024** — same missing bottom padding as the editors (§5.2).
- **The sidebar does not adapt**: ~240 px at 1024 (23 %) and at 850 (28 %).

#### `/workspace/[id]` — a specific workspace `1440`

`150_workspace_specific_1440.png`, `151_workspace_m4qa_1440.png`,
`152_workspace_people_1440.png`, `153_workspace_settings_1440.png`

**D7's "People and Settings become compact disclosing actions" is already
substantially implemented — the real defect is different from the assumption.**
Both `People` and `Settings` open modals, not routes. So the fix is not "make them
compact"; it is that **two dialog triggers are dressed as navigation tabs**:

- `navigation "Workspace sections"` = `Library | People | Settings`. Two of the
  three open dialogs, and the active underline stays on `Library` when they do, so
  the tab row can never reflect state. The workspace's horizontal nav therefore has
  **exactly one real destination, and it is named `Library`** — colliding head-on
  with the global `Library` sidebar destination. That name collision is the IA
  problem; per the brief, standardize the grammar, not the information architecture.
- **The same action exists twice.** `button "Workspace settings"` (the pencil, next
  to `+ New`) and `button "Settings"` (the tab) open the same `Edit workspace`
  modal, ~300 px apart.
- **A workspace cannot be deleted or archived from its own page.** The complete
  control set is `Favorite workspace`, `New`, `Workspace settings`, and the three
  tabs. There is no `⋯`. Functional gap.
- **`button "Favorite workspace"` is drawn as a ✦ sparkle** — the glyph Spectra
  uses for AI everywhere else. Icon-language collision (D16).
- **A second raw `input[type=file]`**: `button "Import a Spectra workspace manifest" value="No file chosen"`, matching the Library one in §5.2.
- **The type group headers are inert `StaticText`,** not controls: `Documents 1`,
  `Flashcard Decks 1`, … cannot be clicked to scope the view. Only the `›`
  (`Expand Documents`) is interactive. The compact icon-driven type selector the
  brief praises in Library has no counterpart here.
- **Three levels of nested border** per group row: a bordered row containing a
  bordered chip container containing bordered chips, with ~600 px of empty box when
  a type holds one item. Spacing and composition before borders (§4).
- `button "Search work and workspaces"` is an **expandable disclosure** here while
  Library exposes an always-visible input — same concept, two affordances (S4).
- The **permanent right details column** (`details`, Created / Work / Active runs,
  Recent activity ×5, People and access) is the D7 target. `Private` renders as a
  right-aligned value with no left label. The composer occludes its last rows.
- **Reference quality to preserve:** the `Share <workspace>` modal is the best
  permission surface in the product — `INVITE SOMEONE` + member search + role +
  optional note, `People with access — 0 people` with an honest empty state, and a
  `Public access [Explicit]` block that states the capability boundary precisely
  ("They cannot edit, comment, collaborate, or see private context." / "Public
  access is off. This item remains private unless you explicitly create a link.")
  plus `Expiry`. Add to §4.1 as the reference for sharing and permission surfaces.
  Its two dropdowns (`Invitation permission`, expiry) are **native `<select>`s**.
- `Edit workspace`'s name input and description textarea are **unlabelled**; only
  `ICON` has a label. The 9-icon picker wraps 8 + 1, leaving a ragged final row.

#### Type vocabulary — four names for one type `P1`

Confirmed by reading all four surfaces live. This is the sharpest D16/S1 violation
in the product:

| Surface | Deck | Task | Code | Scope label |
| --- | --- | --- | --- | --- |
| Library type menu | `Decks` | `Tasks` | `Code` | `All` |
| Workspace-home `<select>` | `Flashcards` | `Tasks` | `Code & visualisations` | `All work` |
| Workspace-specific groups | `Flashcard Decks` | `Planner Tasks` | `Code & Visualisations` | `All work` |
| Row type cell | `Deck` | `Task` | `Code` | — |

Plus `artifact-card.tsx:75-145` as a fifth divergent registry. Note also
`visualisations` vs `Visualisations` casing, and that the workspace `<select>`
includes `Threads` as a *type* while Library models Threads as a *collection*.
One vocabulary, one source, one selector component (S1 + S4).

#### `/calendar` `1440 / 850`

`154_calendar_1440.png`, `155_calendar_850.png`

The mission keeps this right column and fixes its tone. Both halves are now precise.

- **Keeping it is correct — it is a genuine working surface**, not a summary rail:
  `Unscheduled work · 183`, a `Find a task` filter, and a drag-handle list that is a
  real drag source. Its copy is truthful and specific: *"Drag a task into the week.
  Its official deadline stays fixed."* It is also collapsible
  (`button "Hide Unscheduled work · 183"`). Preserve all of this.
- **The tone defect, measured.** Page body `rgb(251, 250, 248)`; the week grid
  `var(--bg-elevated)` = `rgb(255, 254, 253)`; the rail
  `var(--bg-secondary)` = `rgb(246, 244, 240)` with a 1 px
  `--border-subtle` left edge. So the rail is the **darkest** surface on the route
  while the grid is the brightest — the composition reads inverted, and a recessed
  grey panel clamped to the viewport edge reads as chrome or a disabled region
  rather than a peer working surface. Fix: bring the rail onto the page plane
  (or the elevated plane with the grid) and let separation come from spacing and
  the hairline, not from a darker fill.
  Class: `aside.h-full.min-h-full.w-full.overflow-hidden.border-l.bg-[var(--bg-secondary)].lg:w-[300px]`.
  (`order-2 lg:order-2` is a redundant duplicate declaration.)
- **`Needs refresh` is an inert `<span>`** — `role: null`, `cursor: auto`, not
  inside any button. An amber badge reports a problem the user cannot act on, while
  the actual `Refresh calendar` control is an unlabelled icon button ~700 px away at
  the other end of the header. The badge should *be* the button. M4: an inert
  affordance is a defect — and an inert *problem report* is worse.
- **There is no view switcher.** The only navigation is `Previous week` / `Today` /
  `Next week`; no Day / Week / Month / Agenda control exists anywhere on the route.
  Against the stated bar (Google / Notion Calendar) a week-only calendar is a
  functional gap, not a styling one.
- The grid renders a fixed 07:00–20:00 window; with one event in the week that is
  ~13 empty hours and no scroll-to-first-event or fit-to-content.
- The event block truncates its title to `Complete Spec…` on one line inside a
  155 × 148 px block with room for three wrapped lines.
- The composer occludes the 19:00 row and the rail's last item.
- **At 850 the header collapses catastrophically.** `10 Aug – 16 Aug 2026` becomes a
  vertical stack of two-character fragments — `1.. / A.. / - / 1.. / A.. / 2..` —
  each token individually wrapped and ellipsised in a ~20 px box, pushing the header
  to ~320 px tall. Unreadable. The date label sits in a flex row that is allowed to
  shrink to zero.
- **At 850 the weekend is off-screen.** The grid is
  `grid-cols-[54px_repeat(7,minmax(96px,1fr))]` — a 726 px floor — inside a 610 px
  content area, so it overflows into a horizontal scrollbar with `SAT` clipped to
  `SA` and `SUN` to `1`. A week view that hides the weekend.
- At 850 the rail stacks at `top: 688` (height 632) — below the fold but reachable,
  unlike the workspace rail's 14278. Its lede and `Find a task` are occluded by the
  composer.

#### `/agents` — Agent library `1440` + split-pane width

`156_agents_1440.png`, `157_agent_detail_1440.png`

- **There is no separate `/agents/[id]` experience, and that is correct.**
  `Open agent` opens the agent in the **shared artifact studio split panel** over the
  library. One implementation, not two (D19/D21). Preserve this; the agent editor
  work in §5.3 is therefore the agent detail work.
- **Reference-quality copy, again.** "Published agents whose owners opened them to
  your school. Installing references their release; it does not copy the agent." /
  "They stay on the release their owner published, and you can uninstall at any
  time." / "Agents you built. Their skills, evidence and releases live in Agent
  Foundry." Precise, states the capability boundary. Add to §4.1 alongside the Share
  modal as the copy standard for capability and permission explanations.
- **The same action renders in three identity colours.** `Open agent` text colour is
  `rgb(22, 139, 197)` cyan on one card, **`rgb(191, 92, 126)` rose** on the next, and
  `rgb(109, 85, 234)` Spectra violet on the last two — the tint simply follows each
  card's icon colour. A rose primary action reads as destructive. Per the Designer
  charter, actor colours belong only where actors act and coral/rose is reserved for
  failure; this is decorative tint applied to a primary control. `P1`, D16.
  All four are `<button>` with `href: null` (S6).
- **Two identical empty sections open the route.** `Discover` and `Installed` both
  render "No agents in this collection yet." — ~290 px of vertical space delivering
  the same non-information twice before the user's own agents appear, and neither
  offers a next action. An empty screen is an invitation to act.
- Two agents are both titled `New Agent` with identical descriptions and identical
  `Specialist` tags. Truthful data, but the card gives no disambiguator.
- **In the split pane the card grid does not reduce its column count** — it keeps
  three columns in ~730 px and clips instead. Measured `scrollWidth → clientWidth`:
  `Data question coaching` 136→56, `Command term drilling` 130→56,
  `Misconception repair` 123→56, `Specialist` 66→56, title 132→82,
  `P MD` 26→10 (renders `P.`). Under half of most labels is visible, and none of it
  ellipsises.
- **`+ New agent` relocates rather than adapts** — top-right corner at 1440, then
  inline between the lede and the search field at split width (measured
  `left: 288, top: 120`). The primary action jumps position instead of shrinking.
- The unlabelled filter icon button beside the search input has no accessible name.
- The composer occludes the first card's `Open agent` and the fourth card's title.
- **The artifact-panel description clipping reproduces here** — `A configured agent
  with scope` sliced mid-glyph, the same 22 px text in a 15 px `overflow: hidden`
  box holding 81 px of content that was measured on `/workspace`. Two routes, one
  defect (S2).

#### `/school` — every section `1440`

`158_school_1440.png`, `159_school_classes_1440.png`

Eight sections, all visited. The route has the product's **best admin content and its
worst prioritisation of it.**

- **The nav is the good pattern, with one fake member.** `Overview | Classes |
  Tasks & deadlines | Calendar | Resources` + a real `⋯` overflow — icons, labels,
  genuine overflow, exactly the Library-rail character the brief wants preserved.
  But **`Calendar` is not a section**: clicking it navigates the user out of
  `/school` to the top-level `/calendar` route. A cross-route link disguised as a
  section tab. `P1`.
- **The overflow is a native `<select>`** — `aria-label="More School sections"`,
  options `More sections / Discussions & news / Feedback & results / CAS /
  Sync status`. This is the same implementation as Library's
  `More Library collections`, i.e. **the forbidden dropdown-when-space-tightens
  pattern is a shared component**, not a one-off. Good news for the fix: one owner
  (`product-section-nav.tsx`, S4) resolves both.
- **The Overview's empty state is false. Traced, not assumed.** Overview renders
  *"No school records have arrived yet / Run a sync or review provider coverage to
  bring verified classes and deadlines into Spectra."* while `At a glance` in the
  same viewport says **Classes 16**. The Classes section then lists real
  workspace-linked classes — `27CSHL`, `27EconSL`, `27EngASL2`, `27FreBSL2`,
  `27MAAHL3`, `27PhysHL1`, `27TOK6`, … each `✓ Workspace linked`. **The rail is
  truthful and the Overview is lying.** `P0` — a false empty state on the landing
  section of the route tells an admin their integration is dead when it is working.
- **Four sections are honestly unsupported, and that copy is correct.**
  `Resources`, `Discussions & news`, `Feedback & results` and `CAS` each render
  `<Section>: Not supported / The connected provider does not expose this
  capability.` This is a genuine capability state, not a regression — verified by
  visiting all four. Do **not** delete them. The defect is that the nav announces
  nothing until after the click, and that **`Resources` occupies the primary bar
  while supported sections sit in the overflow.** Unavailability belongs in the nav
  (dimmed / badged / grouped as "Not available from ManageBac").
- **`Sync status` is the most valuable section in the route and it is hidden in the
  `⋯`.** It carries a `Capability ledger` with per-capability SLA and freshness:
  `List classes — class · SLA 120 min · last success 14 Aug, 2:18 · Current`,
  `Resolve signed-in student — person · SLA 60 min · last success 14 Aug…`. This is
  precisely the "meaningful sections, disclosed detail, drill-downs" the mission asks
  for — it already exists and is buried. Promote it.
- **`Tasks & deadlines` gets staleness right where `/calendar` gets it wrong.**
  Here: *"Tasks & deadlines: Needs refresh / Cached records remain visible while a
  refresh is due."* with a working **`Retry`** control. On `/calendar` the same
  condition is an inert `<span>` badge. Converge on this one.
- **The same sentence reports different numbers per section.** Overview and
  Sync status: *"**5** verified routes are available; 1 changed provider route is
  quarantined."* Classes: *"**2** verified routes are available; …"*. Identical
  wording, section-scoped in one place and global in another, with no indication which.
- **`At a glance` is a route-level summary rail and a removal candidate** —
  `Classes 16 ›`, `Upcoming 0 ›`, `Resources 0 ›`, `Sync issues 0 ›`. It is not a
  working surface; the four counts are the section names and the four `›` are the
  sections themselves. Move the counts into the nav as badges — which also makes the
  nav truthful about what holds data — and delete the rail. It also only renders on
  Overview, so the route's content width changes between sections.
- **Class rows waste vertical space worse than Library List** — 97 px per row to
  show a course code and the constant string `Class source` (repeated verbatim on
  every row, conveying nothing), with ~1,100 px of dead space before
  `✓ Workspace linked` on the right.
- `NEXT FROM SCHOOL` is the eyebrow above the heading `Recently synchronized` — the
  eyebrow says next, the heading says recent.
- Unlabelled icon buttons: the shield beside `Sync now`, the book beside
  `Current classes`.
- Good copy to keep: *"Creating a workspace is explicit, stable by source course ID,
  and safe across renames."*
- **On `/calendar`, `Unscheduled work · 0` renders while the list still says
  `Loading tasks…`** — a count of 0 presented as fact when the real value is unknown
  (it resolves to 183). Loading states must not publish a number they do not have.

#### `/managebac` — an unredirected alias `1440`

`160_managebac_1440.png`

`/managebac` **renders the `/school` route verbatim** — same `School` H1, same section
nav, landing on `Sync status` — without redirecting the URL. The address bar says
`/managebac` while the page says `School`. Product hygiene / wire-or-delete: either
`redirect("/school")` like `/timetable → /calendar` does, or delete the route. It
must not silently render another route's UI.

Its `Sync status` content is the strongest admin surface in the product:

- **Capability ledger** with per-capability kind, SLA and freshness:
  `List classes` (class · SLA 120 min · Current), `Resolve signed-in student`
  (person · SLA 60 min · Current), `My class memberships` (class · SLA 60 min ·
  Current), `Tasks for my classes` (assignment · SLA 60 min · Current),
  **`Timetable for my classes` (timetable · SLA 60 min · Current)**, and
  `Details for my classes` (class · SLA 60 min) badged **`⚠ Schema changed`**.
- **`Timetable for my classes` is a live, Current, 60-minute-SLA capability.** The
  provider pipeline still delivers timetable data while the product has retired the
  artifact type and hidden the four legacy objects (§5.3 timetable). The data path is
  alive; only the surface was removed. This strengthens the migration conclusion:
  there is an active source, so archiving the legacy objects into Calendar is
  coherent rather than a one-off rescue.
- **Recent syncs** with real counters — `508 received · 211 projected · 0 quarantined
  · 0 errors → completed`, `206 received · 0 projected · 1 quarantined · 1 errors →
  partial`, and a `failed` row.
- **A raw stack trace is leaked into the admin UI** on the failed row:
  `INTEGRATION_IDENTITY_INVALID: Exact match needs an id. at handler
  (../convex/managebac.ts:1491:21)`, in red. Internal file paths and line numbers
  must not reach users. This is the same defect class as the editors' raw Zod message
  (§5.2) — second location, one policy needed.
- `complete` (left, bold) beside `completed` (right) reads as a duplicated word; the
  left value is the sync *kind* and the right its *outcome*, and nothing says so.

#### `/analytics` `1440`

`161_analytics_1440.png`

One of the better routes. Its honesty copy is the product's high-water mark and
should become the standard:

- *"A date-bounded view of your work and AI activity, derived without reading private
  content."*
- **"Zero is shown only when metering rows exist; missing instrumentation is partial,
  not zero."** — an explicit statement of what a `0` means. This is the exact
  principle `/calendar` violates with `Unscheduled work · 0` during loading.
- `Privacy and source boundary`: *"Only the signed-in account's metadata and
  aggregate usage meters are queried. Prompt text, thread transcripts, memory claims,
  and work content are excluded."* + an explicit indexed-sources list.
- `2026-07-17 → 2026-08-16 · computed 16 Aug 2026, 10:22` — truthful provenance.
- `Recent AI runs` — *"Titles and status only; prompts are not queried."*

Defects:

- **Six metric tiles with no drill-down.** `Work created 244`, `Active workspaces 3`,
  `AI runs 279`, `Completion rate 72%`, `Model tokens 301.2k`, `Collaboration traffic
  0 B`. `/admin` already does this better — every one of its tiles carries a
  task-oriented link (`Manage members`, `Review invites`, `Review governance`,
  `View all`). Analytics should adopt Admin's pattern.
- **`FAILED 63` of 279 AI runs — a 23 % failure rate — with no way to see them.**
  And in `Recent AI runs`, every completed run has a meaningful title while both
  failed runs are titled literally `AI run`. The only rows an admin needs to
  diagnose are the only rows with no information. `P1` — real functional gap.
- `CANCELLED 15` is rendered in a heavier navy than `FAILED 63`'s coral, inverting
  severity.
- **`Work created by type` draws nine bars in nine arbitrary hues** with no legend
  and no semantic mapping, and `Document` and `Deck` share the same green. Colour is
  carrying no information (D16/D17).
- **The type vocabulary mixes within a single list.** `Recent work` rows read
  `Planner Task · Active`, `Sheets · Active`, `Whiteboard · Active`, `Code · Active`
  — plural and prefixed forms beside bare singulars, in one column. The clearest
  single demonstration of the vocabulary problem above.
- The tile layout (icon, label, large number, no card) is the right materiality and
  should be the reference for metric display product-wide.

#### `/admin` — School administration, every section `1440`

`162_admin_1440.png`

Eleven sections: `Overview | People | Groups | Communication | Usage` plus
`Agents & resources / Integrations / Governance / Feedback / School profile / Audit`
in a `More School administration` native `<select>` (third instance of that
component — School, Library, Admin).

Real substance, and the drill-down pattern the mission asks for already exists here:

- **Every Overview tile has a task-oriented next step** — `Members 3 / 1 active in
  30 days / Manage members`, `Invitations 0 / 0 awaiting response / Review invites`,
  `Pending approvals 0 / Review governance`, `Class workspaces 1 / View all`.
  Promote this to the product standard.
- **`People` has genuine control**, not a summary: a `Member | Role | Status | Last
  active | Joined` table over three real members with inline editable
  role (`Student / Teacher / School admin`) and status (`Active / Suspended /
  Ended`), plus `Invite member`. The safety invariant is stated in the UI —
  `Administrators 1 / **Last active admin is protected**` — and the role model is
  explained: *"Roles only add management surfaces; students and teachers retain the
  same ordinary Spectra capabilities."* Keep all of it. **But the role and status
  controls are native `<select>`s** — six more, inside a table.
- `Groups` and `Communication` are honest empty states with real primary actions
  (`Create group`, `New announcement`) and precise copy — *"Audience membership is
  snapshotted at send time. Delivery, reads, failures, edits, cancellation, and rate
  limits are audited."* That is a strong claim: **verify announcements actually send
  and audit before M4 closeout** (wire-or-delete).
- `Usage` shows six meters each stamped `Complete through 2026-08-16`, with good
  copy — *"Missing meters remain unknown rather than being inferred from private
  records"* and *"Commercial enforcement is disabled. Superadmin can define and
  simulate per-school limits without changing this product surface."*
- **Cross-route contradiction, now provable.** Admin → Usage reports
  `Collaboration 0 B` stamped `Complete through 2026-08-16`, while
  `/superadmin` → `Service health` reports `Collaboration — **Unknown**`. One surface
  claims a complete zero for a meter the other says is not instrumented. Per
  Analytics' own rule, this must render as unknown. `Storage 0 B` for an account
  holding 80 artifacts is suspect on the same grounds. `SUSPECT` → verify.
- **The right rail `School context` is navigation, not summary** — `Usage` +
  `ManageBac connection` + a `School settings` list (`General settings / Member roles
  / Security / Integrations …`). So the route runs **two navigation systems at once**:
  a horizontal section nav and a vertical settings list in a rail. Merge the rail's
  destinations into the section nav and its overflow, then remove the rail (S5).
- **`Connected` is rendered in amber** — the warning tone — for a healthy connection,
  while School uses green for `Current` and rose for `Schema changed`. Amber means
  "good" here and "attention" everywhere else (D16).
- **`View usage` wraps to two lines** ("View / usage") inside the 300 px rail. CTA
  text must not wrap.
- `View all ↗`, `View audit log ↗`, `View status ↗`, `Review feedback ↗` use the
  **external-link arrow for internal navigation** — wrong affordance semantics.
- **The audit feed's top entries are the admin viewing the admin page** —
  `Admin · Overview · Viewed / Just now`, `Admin · Overview · Viewed / 6 hr ago`.
  Truthful, but page views crowd out real privileged events.
- Good privacy copy to keep: *"Source-linked class workspaces only; ordinary private
  workspaces are never inspected here."* The `Workspace overview` sparkline is real.

#### `/superadmin` — Platform administration `1440`

`163_superadmin_1440.png`

Sections: `Overview | Schools | Operations | Usage & finance | Requests & support` + `⋯`.

- **The best epistemic labelling in the product.** Each tile states what its number
  does and does not mean: `Active schools 2 / Current operational tenants`;
  `Artifacts created 98 / Unknown until metadata counters are complete`;
  `Chat messages 509 / Never inferred by reading private threads`;
  `30-day activity 20% / Account activity, not private content`.
- **`Service health` renders unknown as unknown.** `Model metering Operational`,
  `ManageBac Operational`, `Storage metering Operational`, and
  `Collaboration — Unknown` as plain grey text rather than a green badge. This is the
  reference for status display, and the evidence behind the Admin contradiction above.
- **`Platform usage` is a real chart that cannot be read.** No y-axis, no gridlines,
  no value labels; `Model input 279.3k` and `Model output 21.9k` differ 12× yet reach
  similar amplitude, so the series are independently normalised without saying so —
  which makes the chart actively misleading. `Collaboration 0` and `Bandwidth 0` are
  two indistinguishable flat lines, and the `Model input` / `Bandwidth` legend
  swatches are two near-identical violets in a four-series chart.
- `Artifacts created 98` is displayed as a plain figure while its own caption says it
  is "Unknown until metadata counters are complete" — the same overclaim the caption
  warns about.
- The right rail `Platform context` mixes status with navigation, exactly like
  Admin's `School context` (S5).

#### `/chat` — empty thread `1440`

`164_chat_1440.png`

**The best-composed surface in the product.** A logo tile, a time-aware greeting
("Good morning. What shall we make easier?"), a lede that invites work rather than
describing features (*"Bring a half-formed question, a difficult topic, or a whole
workspace. Spectra can explain, build, and revise alongside you."*), and four
workspace entry cards with `Start here · N objects →`. This is what an empty screen
as an invitation to act looks like; use it as the reference for every other empty
state, starting with `/agents`' two "No agents in this collection yet."

It is also the **only route where the composer does not occlude content** — because
there is no scrollable content behind it. That is the shape the shared shell needs
everywhere (S2/S3).

Defects:
- The lede breaks awkwardly — line 1 ends `Spectra can explain,` and line 2 is
  `build, and revise alongside you.` — a break mid-clause after a comma, with two
  very unequal line lengths.
- **The same four workspaces render with four distinct icons on `/workspace` and one
  identical folder icon here.** Identity should not change per route.
- `· Source-linked from ManageBac` carries the **orphan leading `·`** again — third
  occurrence (workspace home cards, workspace grid, chat cards). One string, one fix.
- All four cards use the action text `Start here`, so the workspace actually *named*
  "Start here" reads `Start here` / `Start here · 0 objects`.
- The eyebrow reads `THREAD · SHARED SPECTRA CONVERSATION` on a brand-new empty
  conversation — "SHARED" with nobody.

#### `/settings` — every section `1440`

`165_settings_1440.png`

Four sections, all real, none inert: `Conversations | Writing | Appearance |
Privacy and data`. `/memory` redirects to `?section=privacy`.

- **Reference-quality framing copy**: *"Only controls that change Spectra appear here.
  Changes save on this device and take effect immediately."* — states both scope and
  persistence semantics. Toggle sub-copy is equally good: *"When off, an unassigned
  send begins a new conversation. Explicitly selected conversations still continue."*,
  *"Suggestions stay on this device and never insert text until you accept them."*,
  *"Removes decorative transitions while preserving state changes."*,
  *"Remove retrieval evidence without deleting your work."*
- The two-column pattern (left: section name + purpose; right: controls) is sound and
  worth keeping.
- **The layout is the "blank monotone page" overcorrection the mission warns about.**
  On `Conversations`, the left column's text ends at ~y 430 and occupies nothing for
  the remaining ~600 px, with a ~500 px gutter to the control column and five rows
  spread over the full height.
- **Inconsistent row anatomy**: three toggles carry explanatory sub-copy and two do
  not (`Show progress in Live Dock`, `Keep completed runs nearby`) — and "nearby" is
  the one row that most needs explaining.
- `Privacy and data` claims *"Inspectable controls for the private context Spectra can
  use across conversations"* but offers only `Export` (download JSON) and
  `Clear context` — **there is no in-product inspection**, and this is where `/memory`
  now lands. Gap against the route's own claim.
- The unlabelled `↺` icon button in the header has no accessible name.
- **Native `<select>`s: 4 more** — `Keep completed runs for`, plus `Theme`,
  `Editor text`, `Interface text`.

#### Native `<select>` census — S1's highest-value seam

Counted live across the sweep: Library `More Library collections`; School
`More School sections`; Admin `More School administration`; workspace-home type
filter; Share modal (`Invitation permission`, expiry); Admin → People role + status
(2 per member × 3 members); Settings (`Keep completed runs for`, `Theme`,
`Editor text`, `Interface text`) — all three section-nav overflows included, which
is the specific pattern the mission forbids.

**Then counted statically, which is much worse: 82 native `<select>` elements in
21 files.** 56 of the 82 are inside artifact studios — `quiz-studio` 11,
`plan-studio` 10, `presentation-studio` 9, `flashcard-studio` 9,
`timetable-studio` 6, `code-studio` 6, `sheets-studio` 3, `whiteboard-studio` 2 —
so this is an *editor* defect at least as much as a route defect, and it is a large
part of why no two editors share a control grammar.

**And the primitive already exists and is unused.** `src/components/ui/select.tsx`
is a complete Radix `@radix-ui/react-select` implementation already styled with
Spectra tokens (`--border-default`, `--bg-hover`, `--text-tertiary`, a
`brand-primary` focus mix, `rounded-[8px]`, `h-10`, `text-[13px]`) and it has
**zero importers anywhere in `src/`**. `src/components/ui/dropdown-menu.tsx` has
exactly one (`notification-bell.tsx`). So the forbidden dropdown regression is not
a missing primitive; it is 82 hand-rolled bypasses of a primitive that was already
built. Same story for status: `administration/shared.tsx` exports a whole parallel
kit (`StatusBadge`, `AdminButton`, `SelectField`, `MetricCard`, `LoadingPanel`,
`EmptyPanel`, `ErrorPanel`) scoped to `administration/` while
`src/components/status-badges.tsx` exports a third (`ConnectionStatus`,
`EnvironmentBadge`, `ErrorToast`).

This makes S1 an adopt-and-delete seam, not a build seam, and it should come out
net-negative in LOC.

---

## 6. Cross-cutting seams — one owner each

Ten artifact agents must not independently invent ten shells, workbars, menus,
responsive rules or editor primitives. These seams are assigned **before**
delegation. An artifact owner consumes them; it does not fork them.

| # | Seam | Files | Owner |
| --- | --- | --- | --- |
| S1 | Design tokens: radius hierarchy, type scale, removal of arbitrary `text-[Npx]` and radius literals. **Also owns the shared `Select` / overflow-menu primitive** — and this is an *adopt-and-delete* job, not a build job: `src/components/ui/select.tsx` is a complete token-styled Radix Select with **zero importers**, while **82 native `<select>`s in 21 files** hand-roll around it (56 of them inside artifact studios), including all three section-nav overflows — the specific pattern the mission forbids. **One status-badge vocabulary** (green = healthy, amber = attention, rose = failure, grey text = unknown — resolving `Connected` in amber, rose `Open agent`, `CANCELLED` heavier than `FAILED`) reconciling the three parallel kits (`administration/shared.tsx`, `src/components/status-badges.tsx`, `ui/badge.tsx`), **one primary-action treatment** (four in use, `Publish` styled two ways), and **one truncation + CTA-no-wrap policy** | `spectra-tokens.css`, `src/components/ui/**`, `administration/shared.tsx`, product-wide TSX | Foundation owner |
| S2 | Shared editor shell: identity row, one adaptive workbar, menu/overflow behaviour, inspector docking, sync status, undo/redo, History/Comments/References/Details. **Also owns resolving the two rich-text implementations** — `ArtifactRichTextEditor` (`artifact-studio.tsx:5723`, working inline toolbar, consumed by quiz + deck + planner) vs `document-studio`'s `.spectra-document-toolbar` (collapsed to 24 px). Converge on one (D21). The quiz workbar is the reference for adaptive behaviour. | `artifact-studio.tsx`, `artifact-studio-shell.tsx`, `artifact-workbar.tsx`, `document-studio.tsx` | Editor-shell owner |
| S3 | Responsive contract: container queries in the 600–900 px band, enforcement of `work/registry` `responsive`, removal of viewport media queries inside studios | `artifact-studio-shell.tsx`, `spectra-app.css`, per-type CSS | Editor-shell owner |
| S4 | Shared List/Board/Canvas + section rail + type selector + sort/filter/search. **Also owns the single type vocabulary** (§5.4 records four names for one type across five registries — `Decks`/`Flashcards`/`Flashcard Decks`/`Deck` — plus `artifact-card.tsx:75-145`), **one section-nav component** with a real overflow (School / Library / Admin all use the same native `<select>` today), and **row density** — Library List too sparse, School class rows 97 px for two strings, workspace inventory column priority inverted (Name truncates while tags get full width) | `object-library.tsx`, `product-section-nav.tsx`, `artifacts-shell.tsx`, `workspace-shell.tsx`, `artifact-card.tsx` | Navigation owner |
| S5 | Route convergence: Workspace IA (D7), right-rail removal, `AuxiliaryRail` resolution, Library density. **Also owns:** moving `People`/`Settings` out of the workspace tab row so its nav navigates work; the `Library` name collision in that tab row; deduplicating the pencil vs `Settings` action; a workspace delete/archive path; **promoting Admin's tile→drill-down pattern to Analytics** and merging Admin/Superadmin rail navigation into the section nav. **Corrections 2026-08-16, both verified in code:** (a) the timetable concealment at `artifacts-shell.tsx:693-695` is **already fixed by the main agent** — timetables now load, so counts, search and deep links are truthful, and a `Timetables (retired)` type filter exists; only read-only mode and the Calendar migration remain, and those sit with S7. (b) **`/managebac` is NOT an alias — do not redirect or delete it.** It is a live route backed by `managebac-integration-shell.tsx` (1,771 lines) and linked from five places in School and Admin. Develop it | `workspace-shell.tsx`, `artifacts-shell.tsx`, `auxiliary-rail.tsx`, `route-side-panel-host.tsx` | Navigation owner |
| S6 | Session continuity: open work across Library ⇄ Workspace, reload restore, deep links, real `<a href>` rows and cards. **Also owns the silent deep-link no-op** (`artifacts-shell.tsx:898-910` — `if (!artifact) return;` with no error state, reproduced with a legacy timetable and applying equally to deleted/unshared/unloaded work), the nested `button`-inside-`button` workspace tabs (`"Home Close Home"`), `You You` on every inventory row, and the two raw `input[type=file]` controls exposed as `button … value="No file chosen"` | `spectra-context-store.ts`, `shared-workbench-session.ts`, both shells | Session owner |
| S7 | AI/collaboration contract: region adapters, target attributes, choreography primitives, closing the document/plan targeting gaps. **Also owns:** the unvalidated write path — **verified precisely 2026-08-16**: `convex/spectraArtifacts.ts` contains **zero** `zod` / `safeParse` / `.parse(` calls anywhere. `create` (`:1608`) declares `content: v.optional(v.any())` and its handler only *shapes* the value (`contentForArtifactStorage(… args.content ?? defaultArtifactContent(…))`); `patchPendingContent` (`:2028`) declares `content: v.any()`. The blueprint Zod schemas exist but are **client-side only** (`artifacts/schemas.ts:1323`, consumed once at `artifacts/registry.ts:1281`), and there is no technical barrier to server-side validation — `convex/collaborationGatewayStore.ts:8-9` already imports from `../src/features/spectra/**`. That is why invalid content persists silently. **Also owns:** the raw-error leak policy (Zod message in the editor banner, `INTEGRATION_IDENTITY_INVALID … convex/managebac.ts:1491:21` in the admin UI); the `planner_task` two-model reconciliation — `blueprints/planner-task.ts` (182 lines: `plannerTaskContentSchema` + `plannerTaskBlueprint`) versus `plan/model.ts` (213 lines: an independent `PlanContent`/`PlanTask` model with its own `normalizePlanContent` and `validatePlanDependencies`), two full models of one type; and the legacy-timetable → Calendar migration using the existing `ics`/`csv` adapters | `artifacts/registry.ts`, `artifacts/schemas.ts`, `blueprints/**`, `plan/model.ts`, `collaboration/*`, `operations/schema.ts`, `convex/spectraArtifacts.ts` | AI-contract owner |
| S8 | **Truthfulness of reported state** — one policy for numbers and status the product does not know. Analytics already states the rule ("Zero is shown only when metering rows exist; missing instrumentation is partial, not zero") and Superadmin already implements it (`Collaboration — Unknown`); Admin, Calendar and School violate it. Owns: School Overview's false empty state (`P0`, contradicted by 16 real classes), `Unscheduled work · 0` during loading, `Collaboration 0 B / Complete through …` vs `Unknown`, `Artifacts created 98` under an "unknown" caption, the section-scoped "N verified routes" sentence reporting 5 and 2 on one route, and the `COMPETENCE 0%` vs 30–75 % bars contradiction | `school-*`, `admin-*`, `superadmin-*`, `analytics-*`, `calendar-*`, `agent-foundry.tsx` | Truthfulness owner |

Every artifact owner must report: what changed, what real capability was added or
fixed, what needs browser verification, and which shared assumption it relied
on. "Done" claims are unverified until the main agent has inspected the diff and
used the browser.

---

## 7. Sub-agent assignments

Grouping is chosen from coupling and workload, not from an arbitrary count.
Recorded here at delegation time, with round number.

### Why this grouping

The baseline produced three facts that decide the shape:

1. **Most per-type "editor defects" are one shared-shell defect seen nine times.**
   The composer occludes content in six of nine editors for the same missing bottom
   padding; nine header heights come from one shared header; two rich-text
   implementations explain the Document `P0`. Fixing these per type would produce nine
   divergent fixes for one cause. → **The shell lands before any artifact owner
   starts.**
2. **The forbidden dropdown regression is a shared component, not a Library bug.**
   The same native `<select>` overflow is used by Library collections, School sections
   and Admin sections. → **One primitive owner fixes all three at once.**
3. **The type vocabulary has five divergent registries.** Any artifact owner touching
   a type label would fork a sixth. → **Vocabulary is locked before delegation.**

So: **round 1 is foundations only, and it is not parallel with artifact work.**
Artifact owners in round 2 consume a settled shell, token set, responsive contract and
vocabulary. This is the brief's instruction — identify cross-cutting seams before
delegation, and give one explicit owner per shared primitive — applied literally.

### Round 1 — foundations (no artifact-type work)

Two agents, deliberately, with **disjoint file ownership** so neither can be
blocked by the other's edits.

| Agent | Seams | Owns these files exclusively | Deliverable |
| --- | --- | --- | --- |
| `A1 foundation` | **S1** + the **S8 policy** | `src/styles/spectra-tokens.css`, `src/components/ui/**`, `src/components/status-badges.tsx`, `src/features/spectra/administration/shared.tsx`, `product-section-nav.tsx` | One token set: radius hierarchy, type scale, no arbitrary `text-[Npx]`/radius literals (the literals also bypass the `data-spectra-interface-text="large"` accessibility override, so this is functional). Adopt `ui/select.tsx` + `ui/dropdown-menu.tsx` as *the* Select and overflow primitives and delete the forks; convert `product-section-nav.tsx` off its native `<select>` so all three section-nav overflows are fixed at once. Reconcile the three status kits into one badge vocabulary including an explicit **unknown** state. One primary-action treatment. One truncation + CTA-no-wrap policy. Write the **unknown-state policy** (copy + component) that round 2 applies. |
| `A2 editor-shell` | **S2 + S3** | `artifact-studio.tsx`, `artifact-studio-shell.tsx`, `artifact-workbar.tsx`, `document-studio.tsx`, `src/styles/spectra-app.css` | One artifact shell: single identity row (one header height, one description size, no clipping), one adaptive workbar with menus that overlay and never grow the bar, inspector docking, sync status, undo/redo. Converge the two rich-text implementations on `ArtifactRichTextEditor` (D21). Composer-height bottom padding in the shared scroll container. Container-query responsive contract for the 600–900 px band; enforce `work/registry` `responsive`; remove viewport media queries inside studios. |

Neither round-1 agent edits a per-type studio file. `A1` does not edit
`spectra-app.css`; `A2` does not edit `spectra-tokens.css`. Anything either one
needs on the other's side is reported to the main agent, not edited.

**S8 splits deliberately.** Its shared part (the policy for state the product does
not know) is a foundation primitive and lands with `A1`. Its ~6 violations live in
route files owned by `C4`, `C1` and `B6`, so they are fixed in round 2 by those
file owners applying `A1`'s policy. This avoids two agents editing
`admin-*`/`school-*` concurrently, which `Edit`'s exact-match requirement would
turn into thrash.

Round 1 gate: main agent inspects the diff and verifies in the browser at
1440 / 1024 / 850 before round 2 is dispatched. No round-2 agent starts against an
unsettled shell.

### Round 2 — artifacts and routes (parallel, on settled foundations)

| Agent | Scope | Competitor bar |
| --- | --- | --- |
| `B1 prose` | document + flashcard_deck | Notion / Google Docs; Quizlet / Anki |
| `B2 assessment` | quiz authoring + Attempt activity | Quizizz / Kahoot |
| `B3 slides-sheets` | presentation + Present activity, sheets | PowerPoint / Slides; Excel / Sheets |
| `B4 canvas-code` | whiteboard, code + Preview/Split activity | Miro / FigJam; VS Code / Replit |
| `B5 planner` | planner_task — **including the two-model reconciliation with S7** | Todoist / Notion tasks |
| `B6 agent` | agent Foundry authoring / configuration / runtime, **+ S8 in `agent-foundry.tsx`** | serious modern agent builders; discover intent from §5.3 first, do not invent a feature set |
| `C1 navigation` | **S4 + S5**, **+ S8 in `calendar-*`** | Library rail character preserved, no dropdown regression; D7 Workspace IA; retired-work surface; route rail removal |
| `C2 session` | **S6** | Real links, deep-link failure states, session continuity across Library ⇄ Workspace |
| `C3 ai-contract` | **S7** | Validated writes, region/target coverage, choreography, timetable → Calendar migration |
| `C4 admin-depth` | Admin, Superadmin, School, Analytics, Usage section depth, **+ S8 in those files** | Promote Admin's tile→drill-down pattern; surface the buried `Sync status` capability ledger; make the 63 failed AI runs reachable |
| `C5 settings` | Settings, all four sections, **+ E8 wire-or-delete** | Task-oriented sections and disclosed detail, not a preference wall; every field either drives runtime behaviour or goes |
| `C6 app-shell` | `AppShell` chrome: Live Dock, sidebar collapsed/loading, the persistent composer + artifact chip + error-toast stack, **+ STATE D1/D2** | Live Dock centred, compact, non-obstructive; nothing permanently overlays content; no global badge on every route |

Each round-2 agent also converts the native `<select>`s in *its own* files to
`A1`'s primitive — 56 of the 82 are inside artifact studios, so this cannot be
done centrally without file conflicts.

Calendar's week-only gap, the 850 header collapse and the rail tone belong to
`C1 navigation` jointly with `A1` (tone) — assigned there because the fix is
route-level composition, not an artifact editor concern.

### 7.1 STATE.md §2.E resolution — every row assigned, no deferrals

Audited statically on 2026-08-16. Five rows are already resolved by M1–M4 work
and only need STATE.md updating; the rest have an owner.

| Row | Verified state today | Resolution | Owner |
| --- | --- | --- | --- |
| E1 `SpectraMigrationFlags` | `migrations/flags.ts` does not exist; zero references in `src/` or `convex/` | **deleted** | closed |
| E2 Steering queue | no `steering-queue*` file, zero references | **deleted** | closed |
| E3 `CollaborationCoordinationController` | zero references anywhere | **deleted** | closed |
| E4 Work-kernel session controllers | **Verified wired.** `projectLegacyWorkSession` is imported at `artifact-studio-shell.tsx:16` and **called** at `:122` — a real production consumer, not an unused import | **wired** | closed |
| E5 `workCan` / `availableWorkModes` / `workCapabilities` | **partially wired.** Consumed by `artifact-studio.tsx`, `document-studio.tsx`, `flashcard-studio.tsx`, `quiz-studio.tsx` — 4 of 10 types. `presentation`, `sheets`, `code`, `whiteboard`, `planner_task`, `agent` still ignore the capability model | **wire the remaining six.** `A2` makes capability consumption part of the shell contract so a studio cannot opt out; each type owner supplies its declarations | `A2` + `B1`–`B6` |
| E6 `legacy-window-bridge.ts` | file gone, zero references | **deleted** | closed |
| E7 `memory-shell.tsx`, `timetable-page-shell.tsx` | both files gone | **deleted** | closed |
| E8 ~115 of ~130 Settings fields with no runtime consumer | open | **wire or delete each field.** No third option, and no fake controls | `C5` |
| E9 Agent Foundry publish gate | client now validates at `agent-foundry.tsx:971` (`instructions.text` trimmed length ≥ 40, matching `convex/spectraArtifacts.ts:888 publishAgent`). Unverified whether the UI actually **populates** that field | **verify the field is authorable and the gate is reachable**, then wire | `B6` |
| E10 Triple work-type registry | now **two and a half**: `artifacts/registry.ts` (1,405) + `work/registry/registry.ts` (431), plus a surviving partial third — `blueprints/registry.ts` is gone but `blueprints/index.ts`, `document.ts`, `flashcard-deck.ts`, `planner-task.ts`, `quiz.ts` remain, covering 4 of 10 types. `blueprints/planner-task.ts` also diverges from `plan/model.ts` (§5.3) | **converge to one source of truth**; the planner two-model split is the concrete instance | `C3` + `B5` |
| E11 Timetable creatable / `DurableRunTabs` alias / `/memory` mismatch | `durable-run-tabs.tsx` gone. `/memory` mismatch **resolved** — `migrations/compatibility.ts:18-19` and `src/app/memory/page.tsx` both target `/settings?section=privacy`. `work/registry/registry.ts:384-387` now marks timetable compatibility-only in an explicit comment | remaining piece is the §5.3 concealment resolution, already assigned | `C1` + `C3` |
| E12 Compute broker | no `*compute-broker*` file, zero references | **deleted** | closed |
| E13 Plaintext API keys in git history | **CONFIRMED AND OPEN.** HEAD is clean: `opencode.json`, `opencode1.json`, `opencode2.json` all use `{env:...}` references. But four literal keys are recoverable from history: `sk-4w3aKiuk…` (TokenRouter) in `e435d7e`; `wk-aOp0x8NW…` (Modal) in `e435d7e` and `2b5c6f0`; `wk-HuOEDx9v…` (Modal) in `2b5c6f0`. All three files are still **tracked and not gitignored**, and this repo has GitHub remotes (PR #95 is in the log), so the keys must be assumed disclosed | **rotation is the only real fix** and it is the user's action, not an agent's. History rewriting is destructive and rewrites pushed commits, so it needs explicit approval. Not an agent task | main agent → user |

`C5` and `C6` exist because the first pass of §7 had no owner for Settings, and
none for the `AppShell` chrome that STATE D1/D2 records as permanently overlaying
content on every route. Both are mission scope; neither belongs to an artifact
owner.

### Every round-2 agent receives, without exception

- The CANON decisions it touches (D7, D8, D16–D19, D21) and the M4 rule that an inert
  affordance is a defect.
- Its own §5.3 / §5.4 findings verbatim, and its own screenshot filenames.
- §4 shared rules and **§4.1 — the references already in the product**, with the
  instruction to converge on them rather than invent: the quiz workbar for adaptive
  behaviour, code's control grammar and label shedding, whiteboard `More tools` for
  breadth without growth, the presentation/quiz item selector, `ArtifactRichTextEditor`,
  Present mode, the code sandbox status line, the Foundry `CAN'T DO YET` ledger, the
  `Share <workspace>` modal for permission surfaces, `/chat`'s empty state, Analytics'
  and Superadmin's honesty copy, Admin's tile→drill-down.
- Its competitor bar, and the constraint that functionality must be real from UI
  through persistence and collaboration — if a control cannot be made real, it is not
  created.
- **No v2 files. Search before creating. If an implementation is replaced, delete or
  migrate the old path in the same work.** Preferably net-neutral or negative
  non-test LOC.
- **Sub-agents must never drive Chrome.** Browser verification is the main agent's job.
- The instruction to use `/frontend-design` and `/design-taste-frontend`.

"Done" is unverified until the main agent has inspected the diff and used the browser.

---

## 8. Iteration status

| Round | Scope | State |
| --- | --- | --- |
| 0 | Context stack read; architecture mapped; route baseline started; artifact system mapped | done |
| 0 | Checklist §9 superseding direction recorded | done |
| 0 | M4 QA workspace seeded with 9 populated types | done |
| 0 | Document baseline (split, fullscreen, More menu, root cause) | done |
| 0 | Sheets, deck, quiz, planner, presentation, code, whiteboard, agent baselines at 1440 / 1024 / 850 with menus, secondary modes and real editing | done |
| 0 | Legacy timetable reconciliation (route, 4 legacy objects, registry, deep-link probe) | **done** — retirement is concealment, not migration; 21 owned events unreachable; see §5.3 |
| 0 | Remaining 8 types + legacy timetable baseline | superseded by the two rows above |
| 0 | Remaining route baseline (chat, calendar, agents, school, analytics, admin, superadmin, managebac, settings) at 1440/1024/850 | **done** — §5.4; every section visited, not only Overview |
| 0 | Workspace home + specific workspace baseline (D7 target) | **done** — §5.4 |
| 1 | Foundations: `A1` (S1 + S8 policy), `A2` (S2 + S3) | **dispatched** — disjoint file ownership per §7 |
| 1 | STATE.md §2.E audit — every row resolved or owned | **done** — §7.1. E1/E2/E3/E6/E7/E12 deleted; E11's `/memory` mismatch resolved; E13 confirmed open and escalated to the user |
| 2 | Artifact editors `B1`–`B6` | pending round-1 gate |
| 2 | Route convergence `C1`–`C6` (S4–S7, S8 application, Settings, `AppShell` chrome) | pending round-1 gate |
| 3 | AI artifact pass, Golden Flows 0–12, final gate | pending |
