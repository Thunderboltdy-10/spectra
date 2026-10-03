# The Spectra island

The island replaces the live dock, the floating run cards, the floating approval panels and the always-visible
composer. It is one living object at the top centre of the stage.

At rest it is just the prism. It shows only what matters right now and reveals more when the user reaches for it.
Overall it takes less space than today's dock, except for the moments the user asks for more, such as hovering a tab.

## Placement

- **Position.** The island sits at the top centre of the stage, vertically centred on the page header line (see
  [SHELL.md](SHELL.md#page-anatomy)).
- **No reserved space.** It floats over content and never pushes anything.
- **Opening downward.** Everything it opens (tabs, the composer, questions, the thread view) opens downward from it.
- **Centring.** It centres on the stage, not the window, so it moves smoothly when the rail or Side changes width.

## States

| State | What the user sees | Size |
| --- | --- | --- |
| **Rest** | The 3D prism alone, with a slow idle light | 40 × 40 hit area |
| **Working** | The prism's spectrum bands brighten one after another (the working loop). A small count appears only when more than one thread is working. | The same size |
| **Finished** | The prism does a full rotation. A one-line notification slides out of it ("*Photosynthesis deck* is ready"). Hovering holds the notification and clicking opens that thread's view. After it retracts, a small spectral glint stays on the prism until the thread is seen. | Grows sideways for 4–6 s |
| **Needs you** | The prism morphs into a compact question card (below) without opening the composer or the tabs | The size of the card |
| **Hover** | The structure: tabs and the + button (below), not the composer | A 40 px-high pill |
| **Composing** | The + morphs into the input field | About 560 px wide |
| **Typing in an editor** | The island shrinks to the bare prism at reduced opacity, so it never competes with the work | The same as Rest |
| **Hidden** | Nothing. A shortcut (Ctrl/Cmd + .) and focus mode hide it. Only a "needs you" event breaks through, as a thin pulse at the top edge that opens the question when clicked. | None |

At rest, a working thread does not show its own tab. The user learns about activity from the prism, and gets details
by hovering.

## The hover structure

```text
           working, needs you                   finished           history (hidden)
   [ ◐ Chemistry quiz ][ ● Essay plan ]   ( + )   [ ✓ Deck ][ ✓ Notes ] ┆ › ……
```

- **The + button.** It is always at the exact centre of the pill, and the pill grows outward from it.
- **Left of +:** active threads (working or waiting on the user), newest nearest the +.
- **Right of +:** finished threads that have not been dismissed.
  - They stay visible here until the user dismisses them, even after they have been seen.
- **Beyond them, history.**
  - Dismissed and older threads continue to the right, out of view.
  - Only a soft edge fade and a small "›" hint show that more exists.
  - History is reached by deliberately scrolling or dragging to the right. It loads lazily and is virtualised, so
    nothing is rendered until the user goes there.
- **With no threads,** the pill is just the +.

### Tabs

A tab shows only the title and one status cue: the working light, the needs-you glint or the done mark. It has no
buttons, because actions live in the thread view.

- The maximum width is about 180 px, and the title truncates at a word boundary.
- **Dismiss a finished tab** by flicking it rightward into history. The gesture follows the direction history lives
  in. The keyboard equivalent is Delete, and the context menu also has it.
- **A working thread is stopped** from its thread view, not from the tab.

## The thread view (hovering a tab)

The thread view replaces opening the Side for most quick checks.

**Opening it.**

- Hovering a tab for about 250 ms opens a card that drops below the island, about 560–640 px wide and at most 70% of
  the viewport high.
- A pointer moving from the tab to the card keeps it open. The hover path forgives diagonal movement.
- Clicking the tab pins the card. Esc or clicking outside closes it.
- Moving to a neighbouring tab doesn't close and reopen the card: the card slides horizontally and its content
  cross-fades.

**What the card contains.**

- **Header:**
  - the title;
  - the current caption;
  - quick actions in an AdaptiveBar:
    - Open in side;
    - Stop;
    - Undo Spectra's changes;
    - Copy reply;
    - Dismiss.
- **Body:** the thread itself (captions, messages, artifact cards and widgets), in compact density. It is the same
  component as the Side and chat page.
- **Footer:** an inline reply field. Replying keeps the card open.

## Questions and approvals

When a run calls `ask_user` or needs permission (see [HARNESS.md](../ai/HARNESS.md#permissions)), the prism morphs
into a question card. The composer and tabs do not open.

- **The question** is written in plain words: "Delete *Old notes* permanently?" or "Which class is this quiz for?"
- **Choices.**
  - Up to four options, or a short answer field.
  - For approvals:
    - **Allow** (with a dropdown offering "Always allow …" for the category);
    - **Don't allow**.
- **"Open thread"** is a small text link for context.
- **Several pending questions** stack, showing "1 of 3", and the card steps through them.
- **When the island is already open on hover,** the question appears as an extension of its tab instead: the tab
  grows the card below itself.
- **Answering** shrinks the card back into the prism, and the run continues with the working light.

## Composing

1. Clicking + morphs the pill into the input:
   - the + rotates into the field's leading position;
   - the field widens from the centre.
2. The field shows context chips: the focused artifact, the selection, and attachments.
3. Enter sends. The field collapses back into a new tab that slides out of the + to the left (working), and the pill
   returns to rest after a moment unless the pointer is on it.
4. Esc, or moving away with an empty field, cancels.

## Arriving threads

When a thread is opened from the threads view or started from elsewhere (for example "Ask about this" on an
artifact):

1. A ghost of its row or button flies along a gentle curve to the island.
2. The island briefly expands to receive the ghost as a tab.
3. The island settles back to rest after about 1.2 s.

## Keyboard and access

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + J | Open the composer |
| Ctrl/Cmd + . | Hide or show the island |
| ← / → | Move between tabs when the island has focus |
| Enter | Open the focused tab's thread view |
| Delete | Dismiss the focused finished tab |

- Finished threads and new questions are announced politely to screen readers.
- With reduced motion, morphs become cross-fades and size changes become instant.

## Motion

Every transition between states is a morph of one continuous container.

- **The container** is measured and animated with springs.
- **The content** cross-fades with a slight blur.
- **The prism** is a persistent shared element that travels:
  - in the hover pill it dissolves into dots that re-form as the +;
  - in the composer it becomes the field's leading glyph;
  - in a question card it sits at the top left.
- **Interruption.** Any transition can be interrupted from its current state; nothing snaps.

[MOTION.md](MOTION.md#island) holds the timings and the full list of morphs.
