# The Spectra island

The island is where the user talks to Spectra, on every page. It replaces:

- the live dock;
- the floating run cards;
- the floating approval panels;
- the chat page's composer;
- every other composer.

It is one living object at the bottom centre of the screen. At rest it is just the prism. It shows only what matters
right now, and reveals more when the user reaches for it. The prism is made of the dot field (see [LIFE.md](LIFE.md)),
so every change of state is the same matter rearranging itself.

## Placement

- **Position.**
  - The island sits at the bottom centre of the stage, 16 px above the bottom edge.
  - It is centred on the stage, not the window, so it glides when the rail or Side changes width.
- **Present everywhere.** It is on every signed-in page, including Chat, Settings and a fullscreen artifact.
- **No reserved band.**
  - It floats over content and never pushes anything.
  - Scrolling pages add bottom padding, so their last line can scroll clear of it.
- **Opening upward.** Everything it opens grows upward from it:
  - the tabs pill;
  - the composer as it gains lines;
  - questions;
  - the thread view.
- **Out of the way.**
  - While the user types in an editor, or drags anything within 120 px of it, the island fades to a faint prism and
    lets pointer events through.
  - It returns when the pointer comes back.

### The wake setting

Settings → Spectra → Island offers:

- **Show the prism** (default): the prism rests at the bottom centre.
- **Wake from the edge:**
  - Nothing is shown at rest.
  - Moving the pointer into a 28 px band along the bottom centre (about 360 px wide) wakes the island. The field
    gathers out of the paper and condenses into the prism, which opens straight into the hover structure.
  - Ctrl/Cmd + J also wakes it.
  - A "needs you" event still wakes it on its own.

## States

| State | What the user sees |
| --- | --- |
| **Rest** | The prism alone, about 30 px. It is still until the pointer comes near; then it leans toward it, and on hover it spins round once. |
| **Working** | The prism turns in 3D, and the spectrum flows round its edges. Faint spectral particles shed from it and drift into the field. When more than one thread is working, a small count sits beside it. |
| **Finished** | The prism spins once with momentum and settles. A short ripple runs through the field. A one-line notice unfolds from it ("*Photosynthesis deck* is ready"), and hovering holds the notice. After it folds away, the prism keeps the full spectrum on its edges until the thread has been seen. |
| **Needs you** | The prism dissolves into particles that re-form as the question card (below). A warm orange light leans out of it. |
| **Hover** | The structure: tabs on both sides of the + (below) |
| **Composing** | The + opens into the composer |
| **Thread in focus** | On the chat page, or while a thread is open in the Side, the island rests as a slim reply bar bound to that thread ("Reply to *Photosynthesis deck*"), because writing is the main action there. The prism sits at its left end. |
| **Faded** | The user is typing in an editor or dragging nearby: a faint prism that lets pointer events through |
| **Hidden** | Ctrl/Cmd + . or focus mode. Only a "needs you" event breaks through: particles rise from the bottom edge into a small pulse that opens the question when clicked. |

## The hover structure

```text
      in play (working, needs you, just finished)               done                history
   [ ◐ Chemistry quiz ][ ● Essay plan ][ ✓ Deck ]   ( + )   [ ✓ Notes ][ ✓ Timetable ] ┆ › ……
```

- **The + button.** It always stays at the exact centre of the pill, and the pill grows outward from it.

### Left of the +: in play

Threads that need attention or are still moving:

- working;
- waiting for the user;
- finished but not yet seen.

The newest sits nearest the +.

When a finished thread has been seen (its card or the thread was opened), it moves to the done side the next time
the pill closes. It never moves while the user is looking at it.

### Right of the +: done

Seen, finished threads stay here until the user dismisses them.

### Beyond them: history

- Dismissed and older threads continue to the right, out of view, behind a soft fade and a "›" hint.
- The user reaches history by scrolling or dragging deliberately.
- History loads lazily and is virtualised.

### Arranging tabs

The user arranges tabs:

- **Order.** Dragging a tab reorders it within its side. The order is kept.
- **Between sides.** Dragging a tab across the + moves it to the other side, and it stays there:
  - a done thread dragged left stays in play, pinned, until it is moved or dismissed;
  - a thread in play dragged right is put away.
- **Dismissing.** Flicking a done tab to the right sends it into history with inertia. The keyboard equivalent is
  Delete, and the tab's context menu has it too.
- **During a drag:**
  - the other tabs part to make room;
  - the dragged tab trails a faint wake of particles;
  - crossing the + makes the + ripple.

### Tabs

- A tab shows the title and one status cue: the working light, the needs-you glint or the done mark.
- It has no buttons. Actions live in the thread view.
- The maximum width is about 180 px, and the title truncates at a word boundary.

### With no threads

The pill is just the +.

## The thread view (hovering a tab)

The thread view is the main way to follow Spectra's work, before any side panel.

**Opening and closing.**

- Hovering a tab for about 250 ms raises a card above it, anchored to the tab. The card is about 560–640 px wide and
  at most 70% of the viewport high.
- The hover path forgives diagonal movement.
- Clicking the tab pins the card. Esc or clicking outside closes it.
- Moving to a neighbouring tab slides the card across instead of reopening it, and its content cross-fades.

**What the card contains.**

- **Header:**
  - the title;
  - the live caption;
  - quick actions in an AdaptiveBar:
    - Open in side;
    - Stop;
    - Undo Spectra's changes;
    - Copy reply;
    - Dismiss.
- **Body:** the thread itself, in compact density. It is the same component as the Side and chat page.
- **Footer:** a reply field. It is the same composer as below, bound to this thread.

## The composer

The island's composer is Spectra's only composer.

### Opening

- Clicking + (or Ctrl/Cmd + J) opens it.
- The + turns into the agent switch at the field's left end, and the field widens from the centre to about 560–640
  px.

### Writing

- Enter sends.
- Shift + Enter adds a new line.
- The field grows upward, line by line, up to about 8 lines, then scrolls.
- Pasting long text keeps it as text. It is not turned into an attachment.

### Attachments

The user attaches files in any of these ways:

- the attach button;
- drag and drop anywhere on the island;
- pasting files or images.

Attachments appear as small chips above the text and can be removed. Images show thumbnails.

### References

Typing @ opens a semantic picker of the user's artifacts, threads and events. A picked item becomes an inline chip.
This is the only way the user points Spectra at something explicitly. There are no automatic context chips:
Spectra finds what the user means itself (see [HARNESS.md](../ai/HARNESS.md#context)).

### The agent switch

The agent switch is at the left end of the field.

- **Default.** It shows the prism, which means **Auto**: Spectra picks the right agent for each request.
- **Choosing an agent.**
  - Clicking cycles through Auto and the user's agents, most-used first, up to five.
  - Shift-click goes back.
  - The last stop is "All agents…", which opens a searchable list.
- **What it looks like.** The glyph morphs between agents through the field, and hovering names the current one.
- **How long it lasts.** An agent the user chose stays for that thread until they switch back to Auto.

### Sending

- The text condenses into particles, which stream into a new tab sliding out to the left of the +.
- The pill then returns to rest, unless the pointer is on it.

### Cancelling

Esc, or moving away with an empty field, cancels. Unsent text is kept as a draft per thread.

## Questions and approvals

When a run calls `ask_user` or needs permission (see [HARNESS.md](../ai/HARNESS.md#permissions)), the prism dissolves
and its particles re-form as a question card. Neither the composer nor the tabs open.

**The card.**

- **The question** is written in plain words: "Delete *Old notes* permanently?" or "Which class is this quiz for?"
- **Choices.**
  - Up to four options, or a short answer field.
  - For approvals:
    - **Allow** is a split button whose menu has one short item, "Always allow". Its second line names the category
      in a few words ("Deleting files").
    - **Don't allow**.
  - The split button is one rounded shape: the menu segment has its own rounded end and is never clipped.
- **"Open thread"** is a quiet text link.
- **Several pending questions** stack, showing "1 of 3", and the card steps through them.
- **When the pill is already open,** the question grows from its tab instead.
- **Typing in the reply field** answers a question or declines an approval, with the text as what to do instead. The
  run resumes where it stopped.
- **Answering** folds the card back into particles that re-form as the prism, and the working light resumes.

## Arriving threads

When a thread is opened from the threads view or started elsewhere (for example "Ask about this" on an artifact):

1. Its row or button sheds particles that stream along a curve to the island.
2. The pill opens to catch them as a tab.
3. It settles after about 1.2 s.

## Keyboard and access

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + J | Open the composer (bound to the thread in focus, if any) |
| Ctrl/Cmd + . | Hide or show the island |
| ← / → | Move between tabs when the island has focus |
| Alt + ← / → | Move the focused tab, across the + as well |
| Enter | Open the focused tab's thread view |
| Delete | Dismiss the focused done tab |

- Finished threads and new questions are announced politely to screen readers.
- With reduced motion:
  - particles are replaced by cross-fades;
  - size changes are instant;
  - the prism stays still and changes only its light.

## Motion

Every transition is a morph of one continuous container, carried by the field:

- **The container** is measured and animated with springs.
- **The content** cross-fades with a slight blur.
- **The prism never vanishes.** It dissolves into particles and the particles become the next thing: the +, the
  question card's outline, the agent glyph. Reversing a transition re-forms the prism.
- **Interruption.** Every transition can be interrupted from its current state, and nothing snaps.

[LIFE.md](LIFE.md) defines the particles, the physics and the prism. [MOTION.md](MOTION.md) holds the timings.
