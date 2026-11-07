---
name: presentation
description: Slide decks with a clear narrative, varied layouts, real charts and speaker notes.
---

# Presentations

A deck is a paced visual argument for an audience. Each slide makes one point the audience can
grasp in a few seconds; the speaker notes carry what the presenter says.

## Plan, then write the whole deck at once

1. Name the objective (what the audience should know or do afterwards), the audience and the
   time available. Ten minutes is roughly 8–12 slides.
2. Sketch the arc: an opening question or claim, three to five sections, and a close that
   answers the opening.
3. Write the whole deck in one create_artifact call: the theme, every slide and each slide's
   notes. Use edit_artifact afterwards only for changes the user asks for, or to fix every
   problem the readback lists in one call.

Honour the requested slide count exactly. A references slide counts towards it, and is added
only when the user asks or the brief's citation convention needs one.

## Layouts

Spectra places and sizes everything from the layout you choose. You choose the layout and write
the words.

| Layout | Use it for |
| --- | --- |
| `title-only` | Section openers |
| `statement` | One memorable claim or question |
| `title-content` | A conventional explanation with a few bullets |
| `two-column` | A comparison: before and after, for and against |
| `three-ideas` | Three parallel points (a body array of three entries) |
| `title-visual-text` | Evidence: a chart or table with a short reading of it |
| `visual-story` | A dominant visual with one line of support |
| `full-bleed` | Only when the visual carries the slide alone |

A layout that wants a visual needs one. Vary layouts when the content changes; keep them the
same when slides are compared side by side.

## Designer

Designer is the studio's finishing pass: it lays each slide out again in the deck's own colours,
with a flat accent (a rule, a band, a side panel, a dark ground) and pictures given room. It runs
by itself at the end of every new deck in the look `design` names: `rule` (quiet, the default),
`band`, `panel` or `night`. Give `"design": "none"` only when the user asks for plain slides or
their own layout. Afterwards, `design {look}` re-finishes the whole deck, and
`design {slide, look?}` gives one slide a different look (`cards` for points, `half`, `framed` or
`stage` for a picture, `row` or `mosaic` for several). A designed slide keeps its look through
later edits, and a slide the readback flags is left alone until its problem is fixed.

## Writing slides

- Titles say the point, not the topic: "Renewables overtook coal in 2024", not "Energy data".
- Body copy is short: at most four bullets of a few words, or two short sentences.
- If a slide is too full, split it rather than cramming it.
- Draw diagrams with code: a `diagram` visual holds the SVG that draws it, right on the slide.
  Never type a diagram in characters. Cycles, flows, labelled structures and timelines all belong
  here. Keep it simple enough to read from the back of the room, and describe it in `alt`. When the
  diagram is the point of the slide, leave `body` out so it gets the whole slide. Use a `viewBox`
  about 960 wide, labels of 24 or more and a few words per box. A row of five boxes rarely fits at
  that size: wrap it, or use a loop.
- Numbers from a source go in a real chart (`chartType`, `categories`, named `series` with
  units in the names) or a table, with values checked against the source. Never draw data as
  labelled shapes. Say what the chart shows without claiming causes the data does not
  establish.
- Speaker notes are two to five sentences of what the presenter adds: the story, the example,
  the transition to the next slide. Never repeat the slide text.
- Name sources on the slide or in its notes when claims rest on them. Never invent citations;
  creative work and ordinary explanations need none.

## Theme

Pick a theme that fits the subject and audience: calm and legible for a lesson, bolder for a
pitch. Keep strong contrast between text and background. Load `spectra-design` for colour and
type judgement.

## Example of excellent output

Request: "5 slides on why the Roman Republic fell, for my history class."

```json
{
  "theme": { "name": "Forum", "background": "#FBFAF7", "heading": "#141318", "body": "#4A4852", "accent": "#B4532A" },
  "slides": [
    { "title": "How does a republic end without a single coup?", "layout": "statement",
      "notes": "Open with the puzzle: Rome kept its institutions on paper for decades while power drained away. Ask the class when they think it ended." },
    { "title": "Three pressures broke the Republic", "layout": "three-ideas",
      "body": ["Land and inequality", "Armies loyal to generals", "Political norms abandoned"],
      "notes": "Preview the three causes; each gets its own slide." },
    { "title": "Conquest made the rich richer", "layout": "title-content",
      "body": "- Enslaved people worked huge estates\n- Small farmers lost their land\n- The Gracchi tried reform and were killed",
      "notes": "Link the land crisis to the first political killings in 133 and 121 BC." },
    { "title": "Soldiers followed whoever paid them", "layout": "two-column",
      "body": ["Before Marius: citizen farmers who went home", "After Marius: professionals who depended on their general"],
      "notes": "The reforms made armies personal. Sulla then marched on Rome itself." },
    { "title": "By 27 BC the Republic was a name, not a system", "layout": "statement",
      "notes": "Augustus kept the Senate and the titles. Ask: was this the fall, or the moment everyone admitted it?" }
  ]
}
```

Why it works: the titles carry the argument on their own, the layouts follow the content, and
the notes give the teacher something to say.

## Check before finishing

- The readback lists no problems: nothing overflows and every visual layout has its visual.
- The slide count matches the request.
- Read only the titles in order: they should tell the story.
