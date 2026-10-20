# The Library

The Library is everything the user has made, filed where they put it. It is one place with one loop: the top,
workspaces, folders inside them and the work in each. Everything opens inside it and Back returns the way the reader
came. There is no separate workspace page.

## Workspaces are places

- A workspace is a special folder in the Library. Opening one keeps the reader in the Library: the URL is
  `/library?workspaceId=<id>` (and `&nodeId=<folder>` inside it), and the old `/workspace/<id>` redirects there.
- The header adapts to the place: the Library's own title at the top, the workspace's name, line and commands
  (Threads, People, ⋯) inside one, and a class's ink for a School class. The bar under it never moves (see
  [SHELL.md](SHELL.md), "Page anatomy").
- The tab names the place it shows. Moving to another place retargets the tab rather than opening a new one, unless
  that place is already open in another tab, which is then brought forward.
- Folders never change the view. A workspace opened from list view opens as a list, and from the shelf as a shelf.

## Views

There are two views, and the reader's choice is remembered on this device (`spectra.library.view`).

- **The shelf** shows work as index cards (the same `WorkCardBody` Home uses), their faces the work itself.
- **The list** is for scanning and arranging: rows of 42 px, 14.5 px names, a 28 px kind tile. It can be sorted,
  filtered, dragged, renamed in place and picked from.
  - Resting the pointer on a row of work lifts that work's card beside it (`row-peek.tsx`). The first card waits
    450 ms; once one is up, the next row's swaps in at once. Any scroll, press, key or drag puts it away. The card
    never takes the pointer.
  - **Quick access** is a collapsible pane on the right (`spectra.library.quick-pane`), like a file manager's
    sidebar: Home, Recent, Favorites, Shared, the places tree and Trash. It hides itself below 760 px of Library
    width.

The bar holds only where the reader is, the search and New. Everything else (shelf or list, the type shown, the
order, Select several, quick access, Empty Trash) is in one three-dots menu at its end, which wears the active tone
while a type or an order narrows the view (`SurfaceMoreMenu`).

Recent, Favorites, Shared, search results and Trash are ways of looking, not places: they are always lists. New work
made from one of them starts at the top of where the reader is, and folders are only made in a place.

## The shelf

- At the top: what was touched lately, newest first, under plain headings a student would say out loud (Today,
  Yesterday, Earlier this week, Earlier this month, then month names). It keeps going as the reader scrolls
  (`useLoadOnApproach`), one page at a time; nothing is folded behind "show all".
- Beside it: the workspaces (in their colours) and what is in no workspace.
- A folder or a non-class workspace shows its own work the same way, with the folders inside it down the side. With
  nothing down the side, the cards take the whole width, three to a row.

## Stacks

Works laid on one another on a shelf become one card (`shelf-stacks.tsx`, `convex/workStacks.ts`). Gathering moves
nothing: each work still lives where it was; `orgNodes.stackId` only groups how shelves show them.

- **Making one:** drag a card onto another; the card under it lifts and says "Stack here". A stack holds 12 at most.
- **Closed** (the default), it is a kraft folder: how many it holds on its tab, and every work's name inside,
  scrolling when there are many. A name opens its work in one press, so the folder is the quick way in.
- **Opened** (the folder's tab, or a press anywhere on it), the folder wipes away top to bottom and the card under it
  has a binder tab per work, spaced like the tabs above a page and scrolling sideways. A tab turns the card to that
  work; the face opens it. Which of the two a stack shows is remembered on this device.
- **Undoing:** the open card's menu puts it back in the folder, takes the work shown out, or unstacks all. Dragging a
  work out of a stack and letting go on the open shelf takes it out too. A stack of one is no stack.

## A class

A School class's workspace is a shelf of its own (`class-shelf.tsx`): its To do from School first, then its work. It
wears the class's ink.

## The path

- The breadcrumb starts with a house icon for the top of the Library ("Library home"), then each place on the way
  down. The top is never called "Library" in the path.
- Every step is a way back and a place to drop things.
- Recent and Trash appear as a last, unclickable step.
- The path runs through a workspace like any folder; stepping above it leaves the workspace.

## Costs

The Library can hold thousands of items. Lists are virtualised, children are read a page at a time, and card faces
are read only when a card comes near the screen, a few at a time, and kept while the work is unchanged.
