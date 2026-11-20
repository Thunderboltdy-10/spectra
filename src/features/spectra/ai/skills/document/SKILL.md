---
name: document
description: Notes, essays, guides, reports, letters and handouts written in Markdown.
---

# Documents

A Spectra document is structured prose that people read, revise, print and cite. Write the
document the reader needs, not the longest one you can produce.

## Decide the shape first

- **Who reads it, and for what?** A revision guide is scanned; an essay is read straight
  through; a lab report follows its genre (aim, method, results, discussion).
- **How long?** Honour any length the user gives. Otherwise match the job: a definition is a
  paragraph, a topic summary is a page, a guide is several sections.
- **What structure is real?** Use headings only for real sections. A short memo or letter needs
  none. Never add a heading for every paragraph.

## Choose the look

Give `look` when you create a document, so it opens on the page, prints and exports to Word with
real Word styles (Title, Heading 1–3, Quote, Caption) instead of the plain screen style:

- `essay`: essays, reports, letters and anything handed in. A 12-point serif at 1.5 lines.
- `notes`: revision notes, guides and summaries. A compact sans with coloured headings.
- `worksheet`: handouts and practice sheets to print and write on. Plain, large and evenly spaced.

Leave it out only for scratch notes the user keeps on screen.

## Craft

- Open with the point. The first paragraph says what the document is for or answers the
  question; detail follows.
- One idea per paragraph, three to six sentences. Prefer concrete examples to adjectives.
- Use a table when the reader compares items across the same attributes. Give it a header row
  that labels every column, then one row per record. Five records requested means five data
  rows. Keep values and units in separate, named columns ("Mass (g)").
- Use a numbered list for a sequence, bullets for parallel items, prose for reasoning.
  Arguments belong in paragraphs, not bullet fragments.
- Use `$...$` for inline maths and `$$...$$` for display equations, in LaTeX. Every equation
  becomes a real Word equation the reader can edit. Fractions, roots, scripts, sums,
  integrals, limits, `\binom`, accents (`\hat`, `\vec`, `\bar`, `\dot`), `\overbrace`,
  `\boxed`, `\mathbb{R}`, matrices (`pmatrix`, `bmatrix`, `vmatrix`), `cases` and `aligned` all
  come through. Use `\text{...}` for words inside an equation. Use code blocks only for code.
- Use `> ` quotes for quotations and callouts that matter. Do not decorate with rules, emoji
  or colour.

## Word features in Markdown

Everything a writer can do from the bar has a Markdown form. Use a feature when the document
calls for it, never for decoration.

| Feature | Write |
| --- | --- |
| Table look | A line straight after the table: `{style=banded}`. Styles: `grid`, `header` (shaded header), `banded`, `rows` (horizontal lines only), `outside`, `plain` (no lines). Or set it yourself: `{lines=horizontal line-color=#1F4E79 header-fill=#D9E2F3 band-fill=#F2F2F2}`, where lines is `grid`, `horizontal`, `outer` or `none`. |
| Column alignment | In the rule under the header: `:---:` centres a column, `---:` right-aligns it. Right-align numbers. |
| Caption | A paragraph ending `{.caption}`, right after its table or figure: `Table 1: Rate at each temperature {.caption}`. |
| Footnote | `^[The note's words.]` where the reference goes. |
| Page break | `[[page-break]]` on its own line, before a part that must start on a new page. |
| Contents | `[[toc]]` on its own line, near the top of a long report. It lists the headings after it. |
| Alignment | A paragraph or heading ending `{.center}`, `{.right}` or `{.justify}`. |
| Scripts | `H<sub>2</sub>O`, `m<sup>2</sup>`. Use `$...$` instead when it is maths. |
| Text colour | `<span style="color: #C00000">text</span>`, only when colour carries meaning. |

A report for school, for example, might be written like this:

```markdown
# The effect of temperature on catalase {.center}

[[toc]]

## Results

| Temperature (°C) | Mean time (s) |
| --- | ---: |
| 20 | 41.2 |
| 40 | 18.6 |
{style=header}

Table 1: Mean time to collect 10 cm³ of oxygen {.caption}

The rate peaks near 40 °C.^[Each mean is of three trials.]
```
- For study material, teach: a worked example for a procedure, a contrast for a subtle
  distinction, a short self-check at the end only when the learner wants practice. Load the
  `teaching` skill for anything longer than a page.
- When the artifact rests on sources, load the `research` skill. Cite only real sources you read;
  never invent a reference.

## Editing

- Change the smallest part that does the job. A typo is a `replace`; a new section is an
  `insert` after the right heading; restructuring is `move_section`.
- Rewrite a section's body without touching its heading or its neighbours.
- `rewrite` replaces the whole document. Use it only when the user asks for a fresh version.
- Keep the user's voice, terminology and citation style unless they ask you to change them.

## Example of excellent output

Request: "Make me notes on osmosis for my Year 10 test."

```markdown
# Osmosis

Osmosis is the movement of water across a partially permeable membrane, from a dilute
solution to a more concentrated one. It is a special case of diffusion: only water moves.

## Why water moves

Water molecules move randomly in both directions. More of them cross from the side where
water is more concentrated (the dilute solution), so the net flow is towards the
concentrated side until the concentrations even out.

## Osmosis in cells

| Solution outside the cell | Animal cell | Plant cell |
| --- | --- | --- |
| More dilute than the cytoplasm | Swells and may burst | Becomes turgid; the wall stops it bursting |
| Same concentration | No net change | No net change |
| More concentrated | Shrinks | Plasmolysed: the membrane pulls away from the wall |

## Required practical: potato cylinders

1. Cut equal cylinders and weigh each one.
2. Leave them in sugar solutions from 0.0 to 1.0 mol/dm³ for 30 minutes.
3. Blot dry, reweigh, and calculate the percentage change in mass.
4. Plot percentage change against concentration; where the line crosses zero, the
   potato's cytoplasm has the same concentration as the solution.

> Common mistake: water moves *towards* the more concentrated solution, not away from it.
```

Why it works: it opens with a definition, uses a table where the reader compares cases, a
numbered list for a real procedure, and one targeted warning.

## Check before finishing

- The readback has every section and record the user asked for, in a sensible order.
- Headings form a clean outline; no empty sections, no repeated headings.
- Tables have a header row and every requested data row.
- No invented citations, statistics or quotations.
