---
name: frontend-design
description: Building widgets, embeds and code visualisations that look intentional and teach one idea.
---

# Frontend design

Use this for anything you build in HTML, CSS, SVG or JavaScript: a `show_widget` visual, a code
artifact's interface, an embed. Adapted from Anthropic's frontend-design skill (see NOTICE.md
beside this file).

## Start from the subject

Before drawing anything, name three things: what the visual is about, who looks at it, and the
one thing it must make clear. Distinctive design comes from the subject itself (its materials,
its diagrams, its vocabulary), not from a generic dashboard kit. A widget about the water cycle
should look like water moving, not like a stats card.

## Principles

- **One clear idea.** The first thing the eye lands on is the point. Everything else is
  quieter.
- **Structure carries information.** Borders, numbers, labels and dividers each say something
  about the content. A numbered marker is for a real sequence; a border separates things that
  are really separate.
- **Typography carries personality.** One or two families, a clear scale, line length under
  80 characters. Avoid the common tells of generated pages: one word in a headline coloured
  for emphasis, all-caps labels above everything, decorative eyebrows.
- **Motion answers people.** Animate what changed when someone acts (dragging a slider,
  pressing play). Avoid entrance animations on every element; one deliberate moment is enough.
  Respect `prefers-reduced-motion`.
- **Restraint.** Spend boldness in one place. Before finishing, remove one decoration.
- **Words are design.** Plain verbs, sentence case, labels that say what a control does
  ("Show forces", not "Toggle"), units on every number.

## Inside Spectra

Spectra's own visual language comes first. Load `spectra-design` for the palette and type. In a
`show_widget` visual:

- Use the theme variables, never hard-coded colours: `background: var(--paper-0)`,
  `color: var(--ink-1)`, a highlighted series in `var(--blue)`. They follow light and dark mode.
- Fonts: `var(--font-ui)` for labels, `var(--font-reading)` for prose, `var(--font-mono)` for
  numbers and code.
- The widget runs in a sandbox with no network: no external scripts, fonts, images or fetch
  calls. Inline everything. Draw with SVG, canvas or CSS.
- Keep it small: the whole document must fit the size limit, so prefer simple shapes and short
  labels to long path dumps.
- Size to content: the frame grows to fit the document height up to a limit, so avoid
  `height: 100vh` layouts.

## Interaction

- Use real `<button>`, `<input type="range">` and `<label>` elements so keyboard and screen
  readers work.
- Give an informative default state, so the widget teaches before anyone touches it.
- Offer a reset when the state can wander far.
- Show the current value of every control next to it.
- Never rely on colour alone: add labels, patterns or position.

## Process

1. Sketch the plan in a few lines: palette roles, type, layout, the one interaction.
2. Check the plan against the subject: if it would fit any topic, make it more specific.
3. Build it, then review: legible at small sizes, works in dark mode, nothing overflows, the
   main idea is obvious in two seconds.

## Example

Request: "Show me how changing the angle changes a projectile's range."

A widget with an SVG trajectory over a ground line, an angle slider (0°–90°, value shown), a
speed slider (m/s), the computed range and flight time in `--font-mono`, the 45° trajectory
drawn faintly as a reference, and a one-sentence caption: "Range is greatest at 45° when
launch and landing heights are equal." Colours: ink for axes and text, `--blue` for the current
path, `--ink-3` for the reference path.
