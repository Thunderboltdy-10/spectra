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
  - the rail of thread tabs;
  - the composer as it gains lines;
  - questions;
  - the thread view.
- **Out of the way.**
  - While the user types in an editor, or drags anything within 120 px of it, the island fades to a faint prism and
    lets pointer events through.
  - It returns when the pointer comes back.

### The wake setting

Settings → Spectra → "The dock at rest" offers:

- **Always show the dock** (default): the dock rests at the bottom centre (see "The dock").
- **Show it from the edge:**
  - Nothing is shown at rest.
  - Moving the pointer into a 28 px band along the bottom centre (about 360 px wide) wakes the island, which forms
    straight into the dock.
  - Ctrl/Cmd + J also wakes it.
  - A "needs you" event still wakes it on its own.

## States

| State | What the user sees |
| --- | --- |
| **Rest** | The prism alone, about 30 px. It is still until the pointer comes near; then it leans toward it, and on hover it spins round once. |
| **Working** | The prism turns in 3D, and the spectrum flows round its edges. Faint spectral particles shed from it and drift into the field. When more than one thread is working, a small count sits beside it. |
| **Finished** | The prism spins once with momentum and settles. A short ripple runs through the field. A one-line notice unfolds from it ("*Photosynthesis deck* is ready"), and hovering holds the notice. After it folds away, the prism keeps the full spectrum on its edges until the thread has been seen. |
| **Needs you** | The question card (below) comes up over the island at once. A warm orange light leans out of the prism. |
| **Hover** | The rail stands up on the bar's top edge (below) |
| **Composing** | The dock opens into the composer, with the rail standing on it |
| **Thread in focus** | On the chat page, or while a thread is open in the Side, the island rests as a slim reply bar bound to that thread ("Reply to *Photosynthesis deck*"), because writing is the main action there. The prism sits at its left end. |
| **Faded** | The user is typing in an editor or dragging nearby: a faint prism that lets pointer events through |
| **Hidden** | Ctrl/Cmd + . or focus mode. Only a "needs you" event breaks through: particles rise from the bottom edge into a small pulse that opens the question when clicked. |

## The rail

The threads stand on the island's top edge as folder tabs, in the bar's own paper:

```text
              in play                ┆           put away
   ╭ ◐ Chemistry quiz ╮╭ ● Essay plan ╮ ┆ ╭ ✓ Notes ╮╭ ✓ Timetable ╮╭ 6 more ╮
 ( ◉ Ask Spectra anything                    Ctrl J │ New thread  Threads )
```

- **At rest** the tabs are tucked behind the bar. Only the threads in play show, as a lip a few pixels high in the
  colour of their state: violet while working, amber when they need the user, red when stopped, green when finished
  and not yet seen. Nothing else marks them, so a glance at the bar says what is going on.
- **Reaching for the island** (the pointer on it, or the keyboard in it) raises the tabs one after the other from the
  left. They go back down a moment after the hand leaves, unless a card is pinned, a menu is open or a tab is being
  dragged.
- **The tab in hand** is the same paper as the bar and joined to it, like the front sheet of a folder; the others are
  a sheet behind, with the bar's edge running under them. From the dock, the tab in hand is the one whose card is
  open; in the composer, the thread the composer writes into.
- **Width.** The rail stands on the straight part of the bar's top edge and never overhangs it. It shows the threads
  in play and as many put-away threads as keep their titles readable; the rest are behind "N more", which opens
  Threads.

### In play and put away

Threads in play, left of the divider, need attention or are still moving:

- working;
- waiting for the user;
- finished but not yet seen.

The newest sits nearest the divider. When a finished thread has been seen (its card or the thread was opened), it
is put away the next time the rail goes down. It never moves while the user is looking at it.

Put-away threads stay right of the divider until the user dismisses them. Older ones are in Threads.

### Arranging tabs

The user arranges tabs:

- **Order.** Dragging a tab reorders it within its side. The order is kept.
- **Between sides.** Dragging a tab across the divider moves it to the other side, and it stays there:
  - a put-away thread dragged left stays in play, pinned, until it is moved or dismissed;
  - a thread in play dragged right is put away.
- **Dismissing.** Flicking a put-away tab to the right sends it to history with inertia. The keyboard equivalent is
  Delete, and the tab's context menu has it too.
- **During a drag:**
  - the tab lifts off the rail as a whole folder tab;
  - the other tabs part to make room;
  - crossing the divider makes it ripple.

### Tabs

- A tab shows the title and one status cue: the working light, the needs-you glint or the done mark.
- It has no buttons. Actions live in the thread view.
- The maximum width is about 190 px, and the title truncates.

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

- Clicking the dock's field (or Ctrl/Cmd + J) opens it, and the bar widens from the centre to about 600 px.
- The rail stands on it. Its tabs say where the words go: the tab in hand is the thread being replied to. Clicking
  another tab turns the composer to that thread (on the chat page, the page changes to it); the first tab, "New
  thread", starts a new one. A thread in focus that has no tab stands in hand on its own.

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

- The words travel into the dock, which takes the run in; its light shows working.
- A new thread's card opens over its new tab, so what was sent is seen working. A reply to a thread still working
  joins its run instead of starting another.

### Cancelling

Esc, or moving away with an empty field, cancels. Unsent text is kept as a draft per thread.

## Questions and approvals

When a run calls `ask_user` or needs permission (see [HARNESS.md](../ai/HARNESS.md#permissions)), the question card
is there at once and the skeleton's band crosses it once as it lands. The prism radiates yellow and its
status dot turns yellow. Neither the composer nor the tabs open.

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
- **Typing in the reply field** answers a question or declines an approval, with the text as what to do instead. The
  run resumes where it stopped.
- **Answering** sends the card back: it parts into dots that pour into the prism, which breathes, turns, and shows
  the working dot again.

## Arriving threads

When a thread is opened from the threads view or started elsewhere (for example "Ask about this" on an artifact):

1. The rail stands up.
2. The thread's tab is there, and the band crosses it once (with no tab yet, the dock).

## Keyboard and access

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + J | Open the composer (bound to the thread in focus, if any) |
| Ctrl/Cmd + . | Hide or show the island |
| ← / → | Move between tabs when the island has focus |
| Alt + ← / → | Move the focused tab, across the divider as well |
| Enter | Open the focused tab's thread view |
| Delete | Dismiss the focused done tab |

- Finished threads and new questions are announced politely to screen readers.
- With reduced motion:
  - morphs and travels are replaced by cross-fades;
  - size changes are instant;
  - the prism stays still and changes only its light.

## Motion

Every transition is a morph of one continuous container (`shape-morph.ts`):

- **The container.** The island's paper is measured in the shape that was there and the one that comes, and a
  frame stretches from one to the other in about 300 ms, overshooting a little and settling. The dock and the
  composer share it, and a thread card grows out of its tab and folds back into it. The rail rides the shape's
  top edge as it changes.
- **The content** of the old shape fades at once; the new shape's fades in over the frame once it is nearly
  there (110 ms in), so the island reads as one thing that extends rather than one thing redrawn.
- **No dots.** The island's waiting and working are the skeleton's (LIFE.md): the working mark in the dock and
  on tabs, skeleton lines in a thread card while the answer is still coming.
- **The status dot** by the prism's top right corner keeps the state visible after each short moment (see
  [LIFE.md](LIFE.md#status-dot)).
- **Interruption.** Every transition can be interrupted from its current state, and nothing snaps.

[LIFE.md](LIFE.md) defines the field, its verbs and choreographies, and the prism. [MOTION.md](MOTION.md) holds the timings.

## Implementation

The island lives in `src/features/spectra/island/`.

- **One island, lent engines.** `IslandHost` (mounted by the app shell) renders `<Island />` with a general run
  engine. A page that owns a run engine lends it with `useProvideIslandEngine` (`engine.ts`), and the latest lender
  wins:
  - the chat page lends its engine bound to the open thread, and the island rests as its reply bar;
  - the Workspace and Library shell lends its engine with the continued thread as focus, resting as the reply bar
    while that thread is open in its panel;
  - the Agents page lends its engine, so an open agent is what Spectra is asked about;
  - elsewhere, the thread open in the route's Side (the `side.thread` bus query) is the focus.
- **No page has its own composer.** `CommandBar` remains only on the landing page.
- **Sending never opens anything.** The run arrives as a tab; the user opens it from the thread view.
- **Tabs** come from one shared store (`run-tabs.ts`); `island-model.ts` arranges them and ranks the one status.
  Which threads the user has seen is kept per browser (`seen.ts`).
- **Questions** (`questions.ts`) merge the live harness question with saved runs waiting on the user, and each
  answers through the right path (harness answer, card action, choice continuation or a new turn).
- **The rail** (`island-rail.tsx`) draws the tabs and measures the shape it stands on (`useRailSeat`).
- **Arranging.** `arrange.ts` keeps the user's order per side and the threads moved across the divider (a choice
  belongs to the run it was made on; a put-away thread still comes forward when it needs the user).
  `use-tab-drag.ts` lifts a dragged tab into a ghost, moves its empty slot through the row (FLIP, so the others
  part), ripples the divider on crossing and throws a flicked put-away tab into history. Alt + ←/→ and the tab's context
  menu do the same from the keyboard and the pointer's other button.
- **Arriving.** `island.arrive` (emitted by the threads view) raises the rail and marks the thread's tab as
  arriving; with no tab yet, the dock.
- **Notices** (`notice.tsx`) rise above the dock: finished or stopped threads (named by the work the run made, when
  it made one), and every new
  notification (`island.notify`, from the account's notifications; opening one emits `notifications.choose`).
- **The app's words** ("Saved", "Could not move it") are notices too: `toast` from `@/components/ui/toast` hands them to the
  island, in the colour of what happened, with one action (Undo, Retry) and a duration (`Infinity` stays until dismissed). Pages
  without the island fall back to a plain toast.
- **Placement.** The island spans the stage between `--spectra-rail-width` and `--spectra-side-width` (published
  by the route's Side as it resizes) and glides when either changes.
- **Safe area.** The island's resting row registers as the composer band, so pages keep their last lines clear of
  it through `--spectra-composer-safe-area`.
