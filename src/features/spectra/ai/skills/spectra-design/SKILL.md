---
name: spectra-design
description: Spectra's visual language (paper, ink and light) for anything visual you make.
---

# Spectra design

Use this when you choose colours, type or layout for anything visual: a deck theme, a widget, a
diagram, a code visualisation. The user's own instructions and an existing artifact's style
always win over these defaults.

## Paper, ink and light

- **Paper** is every surface: warm neutrals, told apart by tone rather than borders.
- **Ink** is what people read and press: near-black on light, warm off-white on dark.
- **Light** is colour, and it means something is alive or important. Use it sparingly: a
  marker, a thin band, a dot, one highlighted series. Never colour a whole panel.

Anything coloured that carries no meaning is wrong. Gradients are not used for decoration.

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Background (paper-0) | `#FBFAF7` | `#121116` |
| Panel (paper-1) | `#F6F4EF` | `#18171D` |
| Raised (paper-2) | `#EFECE5` | `#201F26` |
| Selected (paper-3) | `#E6E2D9` | `#2A2931` |
| Text (ink-1) | `#141318` | `#F3F1EC` |
| Secondary text (ink-2) | `#4A4852` | `#C4C1C9` |
| Tertiary text (ink-3) | `#7A7782` | `#8E8B95` |

The six spectrum hues, in order: red `#ff647f`, orange `#ffab4a`, yellow `#f6d75d`, green
`#48c997`, blue `#4f9fe6`, violet `#9176e8`. They are bright: use them for marks, lines and
small fills, and use ink for text on top of them.

Meaning, by default: green is done or good, orange needs attention, red is a problem. For
categories in a chart, take hues in spectrum order and keep each category's hue the same
everywhere.

Inside a widget these are CSS variables (see the `frontend-design` skill): `--paper-0` to
`--paper-3`, `--ink-1` to `--ink-3`, `--hairline`, and `--red`, `--orange`, `--yellow`,
`--green`, `--blue`, `--violet`, each with a `-tint` (soft fill) and `-ink` (text-safe) shade.
They switch for light and dark automatically.

## Type

- Interface text: Figtree (`--font-ui`). Reading and display: Newsreader (`--font-reading`).
  Numbers and code: IBM Plex Mono (`--font-mono`).
- Scale: 12, 13, 14 (base), 16, 20, 24, 32, 44. Weights 400, 500 and 600.
- Sentence case everywhere. Tabular numerals for times, dates and figures.

## Layout and depth

- Hierarchy comes from size, weight, spacing and alignment before colour.
- Radii: 6 for controls, 10 for rows and inputs, 14 for cards.
- One soft shadow, only for things that float. No cards inside cards.
- Generous space around the main idea; secondary detail stays quiet.

## Avoid

Violet gradients, glowing orbs, glass panels, sparkle icons, emoji as decoration, cards inside
cards, and colour used where nothing is happening.

## Words

Short, direct, sentence case. No ids or internal names on screen. Buttons are verbs.
