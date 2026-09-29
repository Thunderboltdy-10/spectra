# P3 — UI system

Branch `p3/ui-system`, forked from main before the Bridge/Lens merge (1f9f1594); no rebase, per coordinator.
Scope: `src/styles/**` (not the landing page), `src/components/ui/**`, `src/features/spectra/motion/**`, and presentation in feature UI.
Editor behaviour belongs to the Editors agent (p3/editors); the studio diffs here are presentation-only, except where noted.

Net diff: about 42 files, +1.9k / −6.2k lines. Most of the removal is dead CSS.

## 1. The Spectra visual language (canonical)

This is the contract. A new surface uses these tokens and components and nothing else. `check:design-tokens` enforces the literal bans.

### Colour roles (`:root` in `spectra-app.css`, with `.dark` overrides)

| Role | Tokens | Use |
|---|---|---|
| Page and surfaces | `--bg-primary` (page), `--bg-secondary` (recessed/wells), `--bg-tertiary` (pressed/selected), `--bg-elevated` (cards, dialogs, menus), `--bg-hover`, `--bg-overlay` (the one modal veil) | Warm neutrals. No feature defines its own surface grey. |
| Ink | `--text-primary`, `--text-secondary`, `--text-tertiary` | Three steps only. Hierarchy comes from weight and size, not extra greys. |
| Lines | `--border-subtle` (inner dividers), `--border-default` (containers), `--border-strong` (inputs, emphasis) | |
| Brand | `--brand-primary` (#6a4de8, dark #9a87ff), `--brand-ink` (brand mixed 80% into text: violet text and links), `--brand-wash` (8% into the elevated surface: violet tints) | Violet means "Spectra did this". It is not the primary action colour. |
| Actors | `--ownership-ai` (= brand), `--ownership-human`, `--presence-1…8` (= `PRESENCE_PALETTE`) | A person's colour comes from `presenceColor(actor)`, hashed from their account. One colour per person everywhere: avatar, cursor, selection, flag. |
| State | `--success`, `--warning`, `--danger`, `--focus-ring-color` | State is signalled locally. Danger stays a rose discontinuity; it is never used for a whole surface. |

Tinted literals are allowed only for authored content (slide themes, whiteboard nodes, document "paper") and print.

### Type (Manrope for UI, IBM Plex Mono for code)

- Scale: `text-micro` 11, `text-caption` 12, `text-ui` 13, `text-body` 14, `text-subhead` 16, `text-title` 18, `text-heading` 20, `text-metric` 26, `text-display` 32.
- `--text-editor` is 16 and follows the user's editor-size setting.
- `data-spectra-interface-text="large"` scales the whole ramp, so a `text-[Npx]` literal is an accessibility bug, not a style choice. The gate bans it.

### Spacing

Tailwind's 4px grid:
- Controls: `min-h-8` (sm), `min-h-9` (md), `min-h-10` (lg).
- Padding: cards `p-3`/`p-4`, dialogs `p-6`, sheet headers `px-5 py-5`.
- Gaps: tight 1.5–2, standard 3, sections 5.

### Radius (radius scales with the surface; five steps)

- `rounded-chip` 6: badges, tags, menu items.
- `rounded-control` 8: buttons, inputs, selects, icon buttons.
- `rounded-card` 10: cards, panels, popovers, menus, rows.
- `rounded-surface` 14: dialogs, sheets.
- `rounded-pill` 999: pills and avatars only.

The per-feature `--card-radius` overrides (board, canvas, timeline, result, side, wave-y) are gone.

### Elevation

- `--shadow-card`: resting cards.
- `--shadow-soft`: floating chrome, toasts.
- `--shadow-hover`: lift on hover.
- `--shadow-lg`: dialogs, sheets, menus.

Hierarchy is carried first by surface tone and border, and only then by shadow.

### Layers (`ui/layers.ts`, `z-*` utilities)

`base 0 < chrome 40 < dropdown 60 < panel 80 < modal 100 < composer-dock 120 < toast 140`.
- A value between layers is written as `calc(var(--z-layer) ± n)`, never as a number.
- A floating control opens at the higher of its host's layer and `dropdown` (host-layer context, §2). Only an explicit `layer` overrides that.

### Motion

- Durations:
  - `--motion-instant` 80ms: cursor follow, pointer tracking.
  - `--motion-fast` 120ms: hover, colour, press.
  - `--motion-base` 220ms: entrances, veil in.
  - `--motion-slow` 360ms: sheets, AI pointer travel, departures.
- Easings:
  - `--ease-standard` (0.22, 1, 0.36, 1): default for everything.
  - `--ease-out-expo`: arrivals.
  - `--ease-in-out`: symmetric loops.
- Tailwind usage: `duration-[var(--motion-X)] ease-standard`. Transitions list their properties; `transition-all` is not allowed.
- Only compositor properties (transform, opacity) are animated. Layout is never animated. Presence cursors move by `translate3d`.
- Reduced motion: one contract for three sources.
  - **CSS:** the Spectra preference (`html[data-spectra-motion]`) and the OS query both collapse keyframes to one near-instant iteration and transitions to about 0.
  - **Hand-written JS:** uses `useSpectraMotion()` / `getSpectraMotionSnapshot()`, never `matchMedia` alone.
  - **framer-motion:** gets the level through `SpectraMotionConfig` at the root.
  - "Reduced" keeps opacity fades but removes travel. "None" removes animation entirely.
- Named entrances:
  - `spectra-float`: menus, popovers, selects, dialog content; origin-aware.
  - `spectra-veil`: overlay fade.
  - `spectra-sheet`: edge travel.
  - `animate-surface-in`, `animate-fade-in`.

### Component families (`src/components/ui`)

- **Button:** `primary` (near-black fill, not violet), `secondary`, `ghost`, `destructive`, in sizes `sm`/`md`/`lg`/`icon`. It carries one hover lift, press, focus ring and disabled treatment. A raw `<button>` is only for bespoke controls such as tabs, rows and canvas tools.
- **Badge / StatusBadge**, **TruthfulState** (`ProductEmptyState`, `ProductErrorState`), **Skeleton**, **Tooltip**, **Switch**, **Field/Input/Textarea**.
- **Overlays:**
  - `Dialog`: modal, aria-modal, one veil, focus returns to the opener.
  - `Sheet`: edge panel.
  - `ConfirmDialog`: every yes/no confirmation. It is an alertdialog, focus starts on Cancel, and it has a pending state.
  - `Popover`, `DropdownMenu`/`OverflowMenu`, `Select`/`SelectField`.
  - All of them portal, take the host layer, and use `spectra-float`.
- **Editor chrome:** `ArtifactWorkbar` (a native select only where noted), the studio shell `StudioTabRail` (activate and close are sibling buttons), and `StudioItemRail` (`aria-current`).
- **Presence:** identity is `presenceColor()`. `CollaborationPresence` shows avatars and a "People here" popover. `InteractionLayer` renders cursors, AI pointer and flags. Follow mode never moves focus or scrolls the viewport.

## 2. Findings ledger

Severity: H = broken for users, M = wrong or inconsistent, L = debt.

### Fixed

| Sev | Finding | Where | Commit |
|---|---|---|---|
| H | Framer-motion animations (command bar, context picker, embeds panel, live dock, progress trace) ignored the Spectra reduced-motion preference, and in part the OS setting too, because no MotionConfig was mounted. | `motion/motion-primitives.tsx` `SpectraMotionConfig`, `components/providers.tsx` | 9f9b4ec2 |
| H | Menus, popovers and select lists inside dialogs opened at `dropdown` (60), behind modal (100) and composer-dock (120) veils. The admin invite "School profile" select could not be used. | `ui/layer-context.tsx`, `select.tsx`, `popover.tsx`, `dropdown-menu.tsx` | a13d6e32 |
| H | Controlled (trigger-less) Dialog and Sheet dropped focus on `<body>` when they closed. This affected every ConfirmDialog, trash purge and artifact delete. | `ui/layer-context.tsx` `useFocusReturn`, `dialog.tsx`, `sheet.tsx` | a13d6e32 |
| H | The live dock was not muted under shared dialogs: the CSS keys on `aria-modal="true"`, which Radix never sets. | `ui/dialog.tsx:88`, `ui/sheet.tsx:52` | b3be89c0 |
| H | Dark mode made timetable and whiteboard chrome unreadable. Event-editor inputs showed #34413a text on a dark surface. | `spectra-app.css` `.timetable-*`, `.whiteboard-*` | 20bf207f |
| H | The code-studio delete-file confirmation could not be cancelled when only one file existed (one `disabled` flag covered both answers). | `code-studio.tsx` → `ConfirmDialog` | 52f93894 |
| H | The reduced-motion preference had three paths that disagreed. The OS setting reached only about 25 hand gates. The "reduce" switch could raise "none" to "reduced". | `spectra-app.css`, `settings/preference-store.ts` | 56c56196 |
| M | Humans showed as grey (#6f7b72) in presence, because no client publishes an awareness colour. The avatar and cursor could differ. | `collaboration-presence.tsx` `presenceColor` | 3e9ee91e |
| M | Presence cursors animated `left`/`top`, causing layout and paint on every awareness tick. | `collaboration-presence.tsx`, `presence/interaction-layer.tsx` | 3e9ee91e, 116d6e3c |
| M | The "People here" list was a hand-rolled menu with no Escape, outside-click or focus handling. | `collaboration-presence.tsx` → `Popover` | 3e9ee91e |
| M | The interaction layer and grain field read only the OS query, not the Spectra preference. | `presence/interaction-layer.tsx`, `field/surface-field.tsx` | 116d6e3c |
| M | The tab-rail close was a `role=button` span nested in the tab `<button>` (invalid nesting, unreliable keyboard behaviour). | `artifact-studio-shell.tsx` StudioTabRail | 8661419d |
| M | Menus, popovers and selects used undefined tw-animate classes, so they popped in. Dialogs and sheets had no entrance. | `dropdown-menu.tsx`, `popover.tsx`, `select.tsx`, `dialog.tsx`, `sheet.tsx`, CSS | 56c56196, 52f93894, 2d5509e6 |
| M | There were four confirmation implementations: two focus traps, a pane-pinned plan confirm with its own z-index, and three button styles. | `ui/confirm-dialog.tsx`; code, plan and shell dialogs | 52f93894 |
| M | AdminDialog was a hand-rolled portal and focus trap. | `administration/shared.tsx` → shared `Dialog` | a13d6e32 |
| M | The Bridge linked-file surface hand-rolled six buttons. The protected-change actions had no disabled state, and the close button was a literal "×" glyph. | `bridge/resource-surface.tsx` | 8c7bdce4 |
| M | Seven violets and four washes had drifted. Radii, durations and easings were literals, and z-index used 40, 50, 64, 70, 90, 120, 125, 200, 220, 1000 and 2147483000. | `spectra-*.css` | a0ddc194 |
| M | The result-card fade used an arbitrary animation with an unescaped, never-matching reduced-motion gate. | `result-card.tsx` | 21cf6bd5 |
| L | Mojibake (cp1252 double-encoding) appeared across spectra-app.css, including the task-list checkbox glyph. | `spectra-app.css` | a0ddc194 |
| L | Component transitions used Tailwind default durations and `transition-all`, and the inspector had a raw `#a96816`. | app-shell, artifact-card, progress-trace, quiz, result-card, sandbox runtime, organizer rail, agent library, inspector tabs | 9171a369 |
| L | There were about 4.8k lines of orphan CSS (classes nothing renders, dead keyframes, data attributes nothing sets), plus write-only flashcard state. | `spectra-app.css`, `spectra-field.css`, `flashcard-studio.tsx` | 21cf6bd5, b18ef89b, 56c56196 |
| L | The studio item rail's active row was not announced. | `studio-item-rail.tsx` `aria-current` | a13d6e32 |

### Reported, not fixed

| Sev | Finding | Where | Why not |
|---|---|---|---|
| M | Hand-rolled modals remain; each has its own trap, veil and z-index. | `calendar-application.tsx:1820`, `artifact-blueprint-sheet.tsx:390`, `artifact-comments-panel.tsx:366`, `artifact-embeds-panel.tsx:388`, `context-controls.tsx:369/833`, `universal-kbar.tsx:405`, `agent-library-shell.tsx:1044/1128` | Each conversion needs behaviour testing in a browser. The editor-adjacent ones belong to the Editors agent. ManageBac is out of scope. |
| M | Native `<select>` elements in editors. | `timetable-studio.tsx:1694/1724/1742/1758/1978` (empty-string values that Radix rejects), `document-studio.tsx:3527/3528`, `artifact-blueprint-sheet.tsx:859`, `universal-kbar.tsx:441` | Behaviour change in editor files, which the Editors agent owns. |
| L | Native selects kept on purpose. | `artifact-workbar.tsx:925` (Radix focus-loop rationale in its comment), `plan-studio.tsx:820` (per-row cost) | Rejected: the rationale holds. |
| M | The context-continuation toast uses raw buttons, and "Keep current" or a timeout makes no explicit choice. | `context-controls.tsx:52-69` | Needs a product decision on what "keep" means. |
| L | The live dock's controls are raw `<button>`s, not `Button`. | `live-dock.tsx:863/896/978` | These are bespoke dock tabs. Restyling needs a live look. |
| L | The app shell animates `padding` (a layout property) when the rail opens. | `components/layout/app-shell.tsx:1150` | Replacing it with a transform needs the rail reworked and a live check. |
| L | About 91 `box-shadow` literals remain in CSS, and 758 raw `<button>`s remain in TSX. | `src/styles/*.css`, `src/**/*.tsx` | Mechanical migration with a wide visual blast radius. It should be done surface by surface with screenshots. |
| L | Document studio paper tones (about 49 literals) and the sage block at `spectra-app.css:~193-210`. | `spectra-document.css` | Rejected: these are deliberate paper and print intent, not chrome. |
| L | Fullscreen presenters stay custom. | `presentation-studio.tsx:4884/4963`, `whiteboard-studio.tsx:3733`, `flashcard-studio.tsx:3182` | Rejected: they are legitimately bespoke fullscreen surfaces. |
| L | `.agent-library-overlay` sits at the composer-dock layer. | `spectra-app.css:77` | Probably intended (it has to cover the dock), but it should be confirmed live. |
| L | The whiteboard node `z-index: 1000 !important` remains. | `spectra-app.css` whiteboard | Rejected: React Flow's internal stacking. |

The choreography audit found no focus or viewport stealing. The presence, follow, live-dock and progress-trace code makes no `scrollIntoView`, `focus()` or `scrollTo` calls. The one `autoFocus` in the live dock follows a user action.

## 3. Needs live verification (no browser was available)

1. Menu, popover and select open/close: `spectra-float` origin and exit (workbar ⋯ menu, SelectField).
2. Dialog veil fade and sheet slide: library trash purge, shell artifact delete, library folder sheet on a narrow screen.
3. ConfirmDialog in code studio (delete file, revoke asset) and plan studio (bulk delete): Cancel is focused, and the pending spinner shows.
4. After closing any ConfirmDialog or AdminDialog, focus returns to the control that opened it, and the page does not scroll.
5. With a dialog open, the live dock does not respond to pointer events.
6. Admin invite dialog: the "School profile" list opens above the dialog.
7. Reduced motion, both OS and Spectra "Reduce" / "None":
   - loops, cursor glide and grain stop;
   - the command bar, context picker and embeds panel do not slide or scale;
   - the presence flag stays visible.
8. Dark mode: the timetable event editor inputs are readable, and whiteboard chrome follows the theme.
9. Radius and violet convergence across studios looks consistent, with no surprising square or pill corners.
10. Presence: a human's avatar and cursor share one colour; cursors glide smoothly; the "People here" popover closes with Escape and outside click.
11. Studio tab rail: close buttons are keyboard-reachable, and closing does not activate the tab.
12. Result-card fade, and the task-list checkbox tick glyph.
13. Bridge file surface: the buttons match the rest of the product, and the protected-change actions dim while an action runs.

## 4. Verification

- Targeted vitest runs for each commit.
- One full run: 441 files passed and 2 failed.
  - `action-protocol` expects `high`; main's 1f9f1594 already updates this, so it is not from this branch.
  - `design-layers` failed on the AdminDialog source assertion. That was fixed in b3be89c0, and 114 dialog-related files were then re-run, all passing.
- Later runs:
  - Motion-config and framer-component tests: 20 files, 129 tests.
- `tsc --noEmit` is clean. eslint is clean on every touched file.
- Gates passed: `check:architecture`, `check:copy`, `check:design-tokens` (0 warnings), `check:capabilities`, `check:secrets`.

Shared files touched: `src/styles/*`, `src/components/ui/*`, `src/components/providers.tsx`, `code-studio.tsx`, `plan-studio.tsx`, `flashcard-studio.tsx`, `quiz-studio.tsx` (one class), `shell-dialogs.tsx`, `artifact-studio-shell.tsx`, `studio-item-rail.tsx`, `collaboration-presence.tsx`, `presence/interaction-layer.tsx`, `field/surface-field.tsx`, `layout/app-shell.tsx`, `artifact-card.tsx`, `progress-trace.tsx`, `result-card.tsx`, `sandboxed-artifact-runtime.tsx`, `workbench-inspector-tabs.tsx`, `organizer-rail.tsx`, `agent-library-shell.tsx`, `administration/shared.tsx`, `settings/preference-store.ts`, `bridge/resource-surface.tsx`, and tests.
