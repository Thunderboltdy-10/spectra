---
name: code
description: Code projects and runnable browser, React or Python programs and visualisations.
---

# Code

A code artifact is a small project the user can read, run and change. It runs in Spectra's
sandbox: browser (HTML, CSS, JavaScript), React with TypeScript, or Python.

## Choosing the runtime

| Runtime | Use it for |
| --- | --- |
| `browser` | Interactive pages, canvas or SVG visualisations, simulations |
| `react` | Interfaces with state and components |
| `python` | Calculations, data work, algorithms, text output, simple charts |
| `none` | Source the user wants to keep but Spectra cannot run (Java, C, ...) |

## Writing the project

- Start from the entry file (`index.html`, `App.tsx`, `main.py`) and keep the project small:
  a few files with clear names beat one huge file or a deep tree.
- Write working, complete code. No placeholders such as "add logic here".
- No network calls, no secrets, no external CDNs unless Spectra provides them. Everything the
  program needs is in the project.
- Comments explain why, not what.
- For a learning visualisation, load the `frontend-design` skill: one clear idea, a useful
  default state, labelled controls, a reset, and a short explanation of what the learner sees.
- Make it accessible: real buttons and inputs, labels, keyboard use, enough contrast, and no
  meaning carried by colour alone.
- Respect `prefers-reduced-motion` and stop animations that have finished their job.
- In SVG, give every shape an explicit `fill`: a `polygon`, `path` or `circle` without one paints solid black. Use `fill="none"` for lines and curves. If a user reports a black shape, look for the shape that has no fill.
- Size a canvas from its container in script (and on resize), so it draws at the width it is given rather than staying blank.

## Editing

- Change the smallest exact text with `replace`, including indentation.
- Use `write_file` for a new file or a full rewrite of one file the user asked to redo.
- Never collapse a working multi-file project into one file to make editing easier.

## Example of excellent output

Request: "Show me how a pendulum's period depends on its length."

A `browser` project with `index.html` holding a canvas pendulum, a length slider with its value
and unit, a live readout of the period (T = 2π√(L/g)) beside the measured swing time, and a
reset button; `style.css` using calm paper and ink colours; `main.js` with the simulation loop,
which pauses when reduced motion is preferred and the user has not pressed play.

## Check before finishing

- The readback shows the files and no build errors.
- The entry point is set and runs as the user would expect.
- Tell the user what to try first ("drag the slider to 2 m and compare the period").
