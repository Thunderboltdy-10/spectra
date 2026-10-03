# Shell and panels

## Regions

```text
┌──────┬───────────────────────────────────────┬──────────────────┐
│      │               ◆  (island)             │                  │
│ Rail │                 Stage                 │      Side        │
│      │                                       │  (one panel)     │
└──────┴───────────────────────────────────────┴──────────────────┘
```

- **Rail:** navigation on the left. It collapses to icons.
- **Stage:** the page.
- **Side:** one panel on the right. It may hold several tabs, but it is never a stack of columns.
- **Island:** floats at the top centre of the stage. It has no rail or reserved band of its own (see
  [ISLAND.md](ISLAND.md)).

**At most three columns are ever visible.** Page-internal columns count toward the three. When a page's own
navigation column would make a fourth, it folds into a breadcrumb with a popover.

## Two kinds of panel

| | Closable | Collapsible |
| --- | --- | --- |
| For | Transient work you opened: an artifact, a conversation, the threads view | Structural parts of a page: ManageBac details, Calendar plans, the artifact companion in fullscreen |
| Control | × in the header | A collapse chevron in the header |
| When hidden | Gone | Folds to a slim edge tab with its icon; one click restores it |
| Resizable | Yes | Yes |
| Maximise or fullscreen | No | No |
| Remembered | Its open tabs, per page | Its open or collapsed state and its width, per page |

**How it looks.** Both kinds look identical: the same PanelHeader, surface and resize handle. Only the control
differs. No panel has its own background colour, so the beige sidebar goes.

**When both want the Side.** A closable panel opening on a page with a collapsible side panel temporarily replaces
it. The collapsible panel tucks into its edge tab, and closing the closable panel brings it back.

## Fullscreen artifacts

- **Where an artifact can take the stage.** Only the pages that host artifacts as their main content: **Workspace**
  and **Library**.
- **Everywhere else, an artifact opens in the Side.**
  - Its "Open full" button moves to Workspace.
  - A shared-element transition carries the artifact from the panel to the stage.
- **The fullscreen layout:**
  - **Stage:** the artifact.
  - **Side:** the artifact's **companion**, a collapsible panel with these tabs:
    - Details;
    - Comments;
    - Activity;
    - Related: semantic links to other artifacts and threads;
    - Conversations: threads about this artifact.
  - The threads view or a conversation temporarily replaces the companion.

## Artifact in the Side: reaching its companion

An artifact in the Side cannot open its companion as another column, because that would make four. So:

- **The companion becomes an inner sheet** inside the Side panel.
  - It slides in from the panel's right edge, covering about 78% of the panel.
  - The artifact stays visible, dimmed, in the remaining strip.
  - Clicking the strip, the back control or Esc returns to the artifact.
- **Comments** anchored in the content show as small margin marks in this mode and open as popovers on their anchors.
- **The threads view** opens the same way.
- **One model throughout:** the companion is a column when there is room, and a sheet when its artifact is already
  in the Side.

## Width rules

The available width is measured, not the viewport.

| | Default | Minimum | Maximum |
| --- | --- | --- | --- |
| Side | 420 | 340 | 50% of stage plus side |
| Rail | 232 | 56 (icons) | — |

**Each page declares a stage minimum,** for example:

- Library: 560;
- Calendar: 640;
- ManageBac: 600.

**When space runs short, the shell gives way in this order:**

1. the rail collapses to icons;
2. the page's collapsible panels collapse to their edge tabs;
3. page-internal navigation folds into its popover;
4. the Side floats over the stage with elevation, instead of squeezing it.

Nothing ever wraps to a second row. AdaptiveBar handles the commands (see [LANGUAGE.md](LANGUAGE.md)).

## The threads view

The threads view is how the user finds any conversation.

**Opening it.**

- From the rail (**Conversations**) or from the island.
- It opens as a closable panel and temporarily replaces whatever the Side holds. Back restores it.
- In fullscreen it replaces the companion. When the artifact is in the Side, it opens as an inner sheet.

**What it contains.**

- A search field: "Find a conversation".
  - Search is semantic and hybrid across titles, summaries and messages (see
    [HARNESS.md](../ai/HARNESS.md#semantic-layer)).
- Below the field: active threads, recent threads, and threads grouped by the artifacts they touched.
- Each row shows the title, a one-line summary, the glyphs of related artifacts, and the time.

**Choosing a thread:**

1. The thread opens in the Side.
2. It joins the island's active threads.
3. A ghost of the row glides along a curve into its new island tab (see [MOTION.md](MOTION.md)).

**The chat page.** The full chat page still exists. It is the same thread component, on the stage.

## The rail

- **Top:** a compact workspace or school switcher.
- **Navigation:**
  - Home;
  - Library;
  - Calendar;
  - Conversations;
  - School (ManageBac);
  - Agents.
- **Pinned:** a few pinned artifacts.
- **Bottom: one 40 px account row.**
  - It shows the avatar and name.
  - It opens a menu with Settings, Theme (a quick switch), Help and Sign out.
  - Everything else currently in the bottom section is removed or moved to where it is actually used.
  - Notifications reach the user through the island. Their history sits in the account menu with an unread count.
- **Collapsed:** at 56 px, only the icons remain. Hovering shows the label as a tooltip. The prism is not in the rail,
  because it lives in the island.

## Page anatomy

**The header line.**

- The page title sits on the left, in the display serif for top-level pages.
- The page's AdaptiveBar sits on the right.
- The centre stays clear for the island. Headers never place controls in the central 120 px.

**Pages without a header.** On a fullscreen artifact, the island floats over the centre of the artifact's title row,
so artifact headers follow the same rule.

**Empty, loading and problem states** come from the kit (see [MOTION.md](MOTION.md) for how they live).

## Per-page defaults

| Page | Stage | Side by default | Notes |
| --- | --- | --- | --- |
| Home | Hub | Nothing | |
| Library | Grid or list | Nothing | Folders are a breadcrumb plus a popover tree. The artifact can go fullscreen. |
| Workspace | The artifact | The companion (collapsible) | |
| Calendar | Week or month | **Plans**, collapsible | The grid opens on working hours (about 07:00), with a now line, quiet axes and type-coloured event markers |
| School and ManageBac | List or detail | Details, collapsible | No beige |
| Settings | Sections | Nothing | The section list folds into a popover when the Side opens |
| Chat | The thread | Nothing | The same component as the Side thread |

**Opening an artifact or conversation on any page** opens it in the Side, closable, temporarily replacing any
collapsible panel there.
