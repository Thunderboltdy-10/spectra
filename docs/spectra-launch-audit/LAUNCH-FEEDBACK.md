# Launch feedback, 2026-10-21

The owner's hands-on pass before launch. One line per item; `[x]` when done.
Bridge and sync are tested live; smaller UI items ship on a screenshot at most.

## Deploy and configuration
- [ ] Vercel production env: the deploy check lists what is missing (owner sets it in Vercel)
- [ ] Local env: daily and search models set; reasoning high, instant jobs (thread naming) low
- [ ] CI and GitHub release tags for the Bridge download; where the download link appears

## AI turn
- [ ] No three-line skeleton while Spectra works
- [ ] Long idle stretches after a work is created; turns too slow overall
- [ ] Thinking trace: live, no freezes, short summaries between steps, revealable after the reply
- [ ] "Working for 1m 20s" heading while thinking, "Worked for …" after; later traces below text have no badge
- [ ] Thread title updates in the thread as fast as in the sidebar
- [ ] One permission answer (Allow) covers the whole thread; ManageBac refresh never asks
- [ ] No second, worse approval card after one was answered
- [ ] AI can place embeds inline in its reply (e.g. a flashcard deck to play there)
- [ ] Same detail for a run in the chat page, another tab, and the island hover

## Questions
- [ ] Questions can be dismissed to pending without cancelling; auto-collapse after ~90 s
- [ ] Collapsed questions show as a red count per thread; answer from there
- [ ] Each question names its thread when several are shown together

## Island
- [ ] Hover display uses the same thread view as the chat page (cards, embeds, persistent thinking)
- [ ] Leaving the island closes the open thread display; "x" minimises instead of closing the thread
- [ ] Hover opens after a short intent delay
- [ ] A follow-up shows the earlier conversation too
- [ ] Long placeholder never overflows
- [ ] Fewer buttons in the top row
- [ ] No hover display for a thread already open in the chat page or a column

## Home
- [ ] Sun and time follow the real clock (sun becomes moon, animated, reacts to the pointer)
- [ ] A new day shows yesterday's brief with the new date until the new one loads
- [ ] Spectra mark in a thread reacts to the pointer and spins when pressed

## Works and editors
- [ ] Empty works show no persistent skeleton on medium and large cards; top banner does not pulse
- [ ] "Held on this device" notice never flickers; find why it appears
- [ ] Closing a work: no "save your edits" prompt without a real conflict; nothing saves when nothing changed; switching works saves
- [ ] Text formatting toolbar sits at the top of large text fields; the floating one only on right-click
- [ ] Code visualisations take the height they need; transparent background by default
- [ ] Remove "picture" from preview cards; tables preview formatted
- [ ] Documents and sheets open fast (lag vs Office)
- [ ] Number fields: no white background; buttons standardised (larger, no border or background)
- [ ] Documents: no outline; "+" and drag handles further left
- [ ] Maximised quiz not too small
- [ ] Maximising then returning keeps the work in the side panel; closing a side work keeps the scroll
- [ ] "About this work" redesigned
- [ ] Whiteboard: double-click to type; dot grid scales
- [ ] Flashcards: study never goes browser-fullscreen (side panel first, then a Spectra full mode); Enter continues (default 3); space hint once; typed answers mark correct characters; study button becomes "Edit" and leaves study

## Library and selection
- [ ] Threads button in the Library uses the island thread list, scoped to the folder
- [ ] Selection bar sits above the island; working "+"; no Return; drag to reorder; Select outside the dots menu and in onboarding
- [ ] Bridge-imported Physics folder lands in Physics HL; any arrangement of imported files works
- [ ] Local-only works embedded elsewhere fail gracefully on another device

## Calendar and tasks
- [ ] Calendar opens on today
- [ ] Every task opens on the right when pressed (hover peeks), same as ManageBac tasks
- [ ] Undated tasks pinned at the top of the day while scrolling
- [ ] Done can be undone for every task
- [ ] Task creation with a proper time picker
- [ ] Moving a ManageBac task clones it; offer recombining (also by drag)
- [ ] ManageBac sync starts from today, not the whole history

## Bridge and devices (live tested)
- [ ] "Set SPECTRA_CONVEX_URL…" on sync; outdated Bridge replaced
- [ ] This computer recognised as this computer
- [ ] Devices shows the download first when Bridge is missing
- [ ] Local-file page replaced; its settings move to Devices; no vague "could not finish this step"
- [ ] Office round trip reviewed end to end

## Accounts and admin
- [ ] Agents page loads on first visit
- [ ] Invite flow redesigned and working
- [ ] File attachments ("could not find file")
- [ ] Superadmin: usage tracking, AI and Convex storage limits
- [ ] Superadmin emergency stop for AI and Convex work (sign-in and the admin page stay up; reversible)
- [ ] Feedback button beside the username: screenshot, category, description; inbox for superadmin
- [ ] Details pages (ManageBac and others) redesigned
- [ ] Onboarding: reminder time, Devices; tips appear when the user first does the thing
