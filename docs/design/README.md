# Spectra design

These documents are the source of truth for how Spectra looks, moves and behaves. Read them before you build or
change any UI, then follow them, even where existing code does something else. Existing code is being migrated to
them.

| Document | Covers |
| --- | --- |
| [LANGUAGE.md](LANGUAGE.md) | The core idea, colour, type, surfaces, the component kit, adaptive commands and words |
| [SHELL.md](SHELL.md) | Regions, closable and collapsible panels, fullscreen, the companion, the threads view, the rail and page anatomy |
| [ISLAND.md](ISLAND.md) | The Spectra island: states, tabs, questions, the thread hover view and morphs |
| [LIFE.md](LIFE.md) | The field (the living dot lattice), its physics and events, and the prism drawn from it |
| [MOTION.md](MOTION.md) | How interface elements move: tokens, controls, drag and drop, panels, AI light, captions |
| [ICONS.md](ICONS.md) | Spectra's own glyphs, and the one place generic workbar symbols are allowed |
| [EDITORS.md](EDITORS.md) | Editor workbars, the artifact status control, shared rich content, embeds and per-artifact notes |
| [../ai/HARNESS.md](../ai/HARNESS.md) | How Spectra's AI works, which shapes the thread, the island and every AI-facing surface |
| [../product/](../product/README.md) | Product specs for Devices (Bridge) and School (ManageBac) |

## The idea in one paragraph

Spectra is a prism. Plain light goes in (a person's intent) and a full spectrum comes out: documents, decks, plans,
answers, and the people and AI making them.

- **At rest, Spectra is paper and ink.** It is calm, warm and editorial, so the user's own work is the most colourful
  thing on screen.
- **Colour arrives as light, and only where something is alive:**
  - the AI writing;
  - a person editing;
  - something waiting for the user.
- **Life is made of one material.** A field of fine dots wakes where something happens: it ripples, flows, gathers
  and condenses. It is invisible at rest.
- **The light fades when the work is done.**
- **The prism is the source of that light.** It is the mark and the AI's presence, and it is made of the same dots
  as the field.

## Three questions for every piece of UI

1. **Is it paper, ink or light?**
   - Surfaces are paper.
   - What you read and press is ink.
   - Only living things are light.
   - Anything coloured while nothing is happening is wrong.
2. **Does it move like a physical thing?** It comes from where it came from, goes where it is going, and can be
   interrupted at any moment.
3. **Could a nine-year-old understand the words?** No ids, no jargon. A visual cue is better than a sentence.

## Taste references

These are references to learn from, not to copy:

- Anthropic's warmth and restraint;
- Apple's continuity of motion and the Dynamic Island's morphs;
- Office's ribbon scaling (how commands give up space with judgement);
- the calm of a good notebook.

Avoid the 2025–26 AI look:

- violet gradients;
- glowing orbs;
- glass panels everywhere;
- sparkle icons;
- cards inside cards.
