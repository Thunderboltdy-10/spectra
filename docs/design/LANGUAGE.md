# Design language

## Paper, ink and light

| Material | What it is | Rules |
| --- | --- | --- |
| Paper | Every surface: the app background, panels, cards and menus | Warm neutrals. Layers are told apart by tone, not borders. Never coloured. |
| Ink | Text, icons, primary buttons, focus rings and selection | Near-black on light, warm off-white on dark. The primary button is ink, not a hue. |
| Light | The spectrum, shown only where something is happening | It appears with activity, follows it, and fades after it (about 1.2 s). Never decorative and never at rest. |

## Colour

The values below are starting points. The visual spec locks the final ones in `src/styles/spectra-tokens.css`.
Components only ever use tokens: no hex values, no Tailwind palette colours.

### Neutrals

| Token | Light | Dark |
| --- | --- | --- |
| `paper-0`: app background | `#FBFAF7` | `#121116` |
| `paper-1`: panels | `#F6F4EF` | `#18171D` |
| `paper-2`: raised, hover | `#EFECE5` | `#201F26` |
| `paper-3`: pressed, selected rows | `#E6E2D9` | `#2A2931` |
| `ink-1`: primary text, primary button | `#141318` | `#F3F1EC` |
| `ink-2`: secondary text | `#4A4852` | `#C4C1C9` |
| `ink-3`: tertiary, placeholders | `#7A7782` | `#8E8B95` |
| `hairline`: used rarely | ink-1 at 8% | ink-1 at 10% |

### The spectrum

These are the prism's six wavelengths, in brand order:

| Name | Base |
| --- | --- |
| red | `#ff647f` |
| orange | `#ffab4a` |
| yellow | `#f6d75d` |
| green | `#48c997` |
| blue | `#4f9fe6` |
| violet | `#9176e8` |

Each hue also gets:

- a `tint`, a soft fill for small areas;
- an `ink`, a text-safe shade at 4.5:1 or better on paper, in light and dark.

### What colour means

These are the defaults. The user can remap them in Settings → Appearance → Colour.

| Role | Default | User can change |
| --- | --- | --- |
| Spectra AI | The full spectrum, as a sweep or band, never a single hue | No (it is the brand) |
| People | Each collaborator gets one hue: cursors, presence, comment marks | Their own hue |
| Artifact types | One hue per type, used only on small glyphs and markers | Yes, per type |
| Needs you | orange | Yes |
| Done | green | Yes |
| Problem | red, shown as a cue and never as a wall of text | Yes |
| Focus and selection | ink | Ink or any hue |

### Rules

- Gradients are allowed only for AI light.
- Panels are never coloured. The beige ManageBac sidebar is the counter-example.
- A coloured area is small: a glyph, a marker, a thin band or a dot.
- Text on a tint uses that hue's `ink`.

## Type

Only free fonts are used (OFL), self-hosted through `next/font`.

| Use | Default | Why |
| --- | --- | --- |
| Interface | **Figtree** | Clean but friendly; reads warmly at 13–14 px |
| Display and reading | **Newsreader** | Editorial serif with optical sizes, for page titles, empty states, the AI's greeting and long-form reading |
| Mono | **IBM Plex Mono** | Kept; pairs well and is already in the product |

Settings → Appearance → Font offers:

- **Interface:** Spectra (Figtree), System, or High legibility (Atkinson Hyperlegible Next).
- **Reading** (AI replies and long text in panels): Serif (Newsreader) or Sans (the interface font).

Artifact content fonts belong to the artifact, not to these settings.

The scale:

- 12 / 13 / 14 (base) / 16 / 20 / 24 / 32 / 44.
- Weights are 400, 500 and 600. 700 is used only for display serif moments.
- Sentence case everywhere.
- Tabular numerals for times, dates, counts and sheets.

## Surfaces and depth

- **Tone separates layers.** A hairline is used only where tone cannot do it.
- **Radius scale:** 6 (controls), 10 (rows, inputs), 14 (cards, panels), 20 (sheets), pill.
- **Shadow:** one soft elevation, used only for things that float (the island, menus, popovers, dialogs, overlaid
  panels). Docked panels have no shadow.
- **Texture:** the dot field is the paper's grain (see [MOTION.md](MOTION.md)).

## The component kit

All UI is built from `src/components/ui/`. Every component has rest, hover, press, focus, disabled and loading states,
with motion built in. Its states are not added per page.

**Actions.**

- Button: primary (ink), secondary (paper), ghost, and danger (only inside a confirmation);
- IconButton;
- Toggle;
- Segmented;
- Tabs.

**Overlays.**

- Menu;
- Popover;
- Tooltip, which always shows the shortcut when there is one;
- Dialog and ConfirmDialog.

**Inputs.**

- Field, Input, Select and Combobox;
- Search, with semantic results.

**Structure.**

- Row: a list item with a leading glyph, title, meta and trailing actions;
- PanelHeader;
- Panel: closable or collapsible (see [SHELL.md](SHELL.md));
- Card.

**Feedback.**

- Status cue: a glyph and light, not a badge with text;
- Progress, which uses the prism when it means "Spectra is working";
- Skeleton;
- Empty state.

**Sizes.**

- Control heights: 28 (compact), 32 (default) and 40 (large).
- Icons: 16 and 20, from one icon set (`lucide-react`) with one stroke width.

**Enforcement.** Lint and `check:design-tokens` ban all of these outside `src/components/ui/`:

- hand-rolled `<button>` elements;
- raw colours;
- ad-hoc font sizes and radii;
- one-off shadows.

## Adaptive commands, across the whole app

Every group of actions anywhere in Spectra adapts to its space with human judgement, not by wrapping or overflowing. That
covers page headers, panel headers, the library toolbar, row actions and dialogs.

- **Where commands live.** A row of commands is an `AdaptiveBar`. It measures its own container (a container query or
  ResizeObserver), not the window, so it behaves correctly beside any number of panes.
- **What each command declares.**
  - icon;
  - label;
  - shortcut;
  - `labelPolicy`:
    - `always`: words carry the meaning;
    - `never`: a universal symbol such as undo, redo, close, more or add;
    - `whenRoom`.
- **The collapse plan.** Each bar has an authored `collapsePlan`: an ordered list of steps such as `hideLabel(share)`,
  `hideLabel(filter)`, `toMenu(group:sort)`, `toMenu(export)`.
  - The bar applies the steps in order until it fits.
  - A person writes the plan, deciding what matters on that surface.
  - Moving a whole secondary group into a menu is often better than shrinking an important command to an ambiguous
    icon.
- **Never** wrap a bar to a second row, clip a label mid-word, or squeeze controls below their size.
- **Overflow.** The overflow menu lists each command with its icon, label and shortcut.
- **Review.** Each plan is checked with screenshots at the widths its surface really meets: Side open and closed, rail
  expanded and collapsed.

Editor workbars use the same engine, with one addition: the user can reorder commands (see
[EDITORS.md](EDITORS.md)).

## Words

- **No ids, internal names or error codes on screen, ever.**
  - Not "Approve calendar.schedule", but "Schedule *Revise chemistry* for Thursday at 16:00?".
- **Short, direct, sentence case.** Buttons are verbs.
- **A visual cue beats a sentence.**
  - State is shown by the prism, a light, a glyph or a position.
  - Words appear only when the user must decide something or learn something new.
- **Problems** take one plain line: what happened and what to do. Technical detail sits behind "Details", for support
  only.
- **Enforcement.** `check:copy` enforces the wording rules. Extend it as patterns come up.
