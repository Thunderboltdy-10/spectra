# Icons

Spectra draws its own icons. Generic line icons make an app feel assembled rather than made, so they are used in
exactly one place: editor workbars, where commands must be instantly familiar (bold, align, undo).

## Two families

| Family | Where | Source |
| --- | --- | --- |
| **Spectra glyphs** | Everything outside editor workbars: navigation, artifact types, page and panel headers, rows, menus, status, empty states, the island and the composer | `src/components/icons/` (our own SVG components) |
| **Workbar symbols** | Editor workbars and their menus only | `lucide-react`, at one stroke width |

## The Spectra glyph style

### Grid

- Glyphs are drawn on a 20 px grid with 2 px of padding.
- They render at 16 and 20 px (24 px in a few places).
- They are optically balanced, not mechanically centred.

### Layers

Each glyph has up to three layers:

1. **Ink line.** A 1.5 px stroke in `currentColor`, with round joins and slightly rounded caps.
2. **Paper fill.** Soft planes in `currentColor` at about 10% opacity. They give volume (a page's body, a card's
   face) without weight.
3. **Accent.** One small detail that carries meaning, and the glyph's only colour:
   - the artifact type's hue on type glyphs;
   - the state hue on status glyphs;
   - the spectrum only for Spectra itself.

   Without a colour context, the accent is `currentColor`.

### Telling detail

Every glyph shows what makes its thing recognisable, not a generic shape:

- a document has its title line, uneven text lines and a margin mark;
- a quiz has an option ticked;
- a calendar has today marked.

The detail must still read at 16 px. If it does not, simplify it rather than drop it.

### Character

- Warm, slightly hand-made: small optical tapers, no perfectly uniform geometry.
- No sparkles, no robots and no magic wands.

### Motion

A glyph may have one micro animation, used on hover or for a state change, built into the component:

- a page corner lifts;
- the calendar's today mark slides;
- sync arrows turn;
- a lock shackle closes.

## The set

### Artifact types

Each type uses its hue on the accent.

| Glyph | Telling detail |
| --- | --- |
| Document | A page with a folded corner, a title bar, uneven lines and a margin mark |
| Slides | A slide with a title bar and a small picture block, with a second slide peeking behind |
| Sheet | A grid with one selected cell outlined in the accent and a header row |
| Quiz | A card with a question line and two answer pills, one ticked |
| Flashcards | Two offset cards with a small turn arrow at the corner |
| Whiteboard | A board with a sticky note and a connector curving to a shape |
| Code | A window with `{ }` and a blinking caret |
| Planner and Task | A checkbox ticked in the accent, plus a due flag |
| Timetable | A grid with two blocks of different heights |
| PDF | A page with a band across the corner |
| Folder | A folder with a document peeking out of it |
| Agent | A small figure built from a rounded square head and a spectral visor slit |

### Navigation

| Glyph | Telling detail |
| --- | --- |
| Home | A house with a lit window |
| Library | Three books on a shelf, one leaning |
| Calendar | A binding ring and today's square marked |
| Conversations | Two overlapping bubbles, the front one with three soft dots |
| School | A building with a pediment and a flag |
| Agents | Two agent heads, one in front |
| Devices | A laptop with a small link arc to a cloud |
| Settings | Three sliders at different positions (not a gear) |

### Status

Each status glyph uses its state hue on the accent.

| Glyph | Telling detail |
| --- | --- |
| Saved | A cloud with a small tick |
| Saving | A cloud filling from the bottom |
| Offline | A cloud with a slash, and a small laptop for "on this device" |
| Syncing | Two arrows turning around a laptop |
| Waiting for Office | A page with a padlock |
| Read only | A padlock with an open eye |
| Two versions | A path splitting into two |
| Problem | A soft triangle with a short line |

### Actions outside workbars

New, Share, Filter, Sort, Search, Attach, Send, More, Close, Collapse, Pin, Undo Spectra's changes, Open in side, Open
full. These stay simple, but they are drawn in the house style so they sit with the rest.

### Spectra

The prism mark comes from the prism renderer (see [LIFE.md](LIFE.md#the-prism)). It is not an SVG icon.

## Using icons

- **The component.** Import `<Icon name="document" />` from `src/components/icons`. It sets the size, the stroke
  width and the accent from props (`size`, `accent`, `animate`).
- **Names.** The set is typed, so an unknown name is a type error.
- **Enforcement.** `check:design-tokens` bans `lucide-react` imports outside editor workbar code and
  `src/components/icons/`.
- **New glyphs** follow this document and are added to the icon lab page (`/dev/icons`). It shows every glyph at 16
  and 20 px, on both themes, at rest and in its animation.
