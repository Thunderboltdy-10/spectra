# Launch feedback, 2026-10-21

The owner's hands-on pass before launch. One line per item; `[x]` when done.
Bridge and sync are tested live; smaller UI items ship on a screenshot at most.

## Deploy and configuration
- [ ] Vercel production env: the deploy check lists what is missing (owner sets it in Vercel)
- [x] Local env: daily and search models set; reasoning high, instant jobs (thread naming) low
- [x] CI and GitHub release tags for the Bridge download; where the download link appears

## AI turn
- [x] No three-line skeleton while Spectra works
- [x] Long idle stretches after a work is created; turns too slow overall
- [x] Thinking trace: live, no freezes, short summaries between steps, revealable after the reply
- [x] "Working for 1m 20s" heading while thinking, "Worked for …" after; later traces below text have no badge
- [x] Thread title updates in the thread as fast as in the sidebar
- [x] One permission answer (Allow) covers the whole thread; ManageBac refresh never asks
- [x] No second, worse approval card after one was answered
- [x] AI can place embeds inline in its reply (e.g. a flashcard deck to play there)
- [x] Same detail for a run in the chat page, another tab, and the island hover

## Questions
- [x] Questions can be dismissed to pending without cancelling; auto-collapse after ~90 s
- [x] Collapsed questions show as a red count per thread; answer from there
- [x] Each question names its thread when several are shown together

## Island
- [x] Hover display uses the same thread view as the chat page (cards, embeds, persistent thinking)
- [x] Leaving the island closes the open thread display; "x" minimises instead of closing the thread
- [x] Hover opens after a short intent delay
- [x] A follow-up shows the earlier conversation too
- [x] Long placeholder never overflows
- [x] Fewer buttons in the top row
- [x] No hover display for a thread already open in the chat page or a column

## Home
- [x] Sun and time follow the real clock (sun becomes moon, animated, reacts to the pointer)
- [x] A new day shows yesterday's brief with the new date until the new one loads
- [x] Spectra mark in a thread reacts to the pointer and spins when pressed

## Works and editors
- [x] Empty works show no persistent skeleton on medium and large cards; top banner does not pulse
- [x] "Held on this device" notice never flickers; find why it appears
- [x] Closing a work: no "save your edits" prompt without a real conflict; nothing saves when nothing changed; switching works saves
- [x] Documents: a slim status rail at the very foot (page, words, characters); the flowing view uses the whole pane, as a note
- [x] Documents: Flowing, Pages and Side by side views from the rail; Pages are real sheets (words move to the next sheet whole) with zoom
- [x] Documents: no stray "Back to editing" (reader mode no longer sticks after access loads)
- [x] Text formatting toolbar sits at the top of large text fields; the floating one only on right-click
- [x] Code visualisations take the height they need; transparent background by default
- [x] Remove "picture" from preview cards; tables preview formatted
- [x] Documents and sheets open fast (lag vs Office)
- [x] Number fields: no white background; buttons standardised (larger, no border or background)
- [x] Documents: no outline; "+" and drag handles further left
- [x] Maximised quiz not too small
- [x] Maximising then returning keeps the work in the side panel; closing a side work keeps the scroll
- [x] "About this work" redesigned (and its Conversations tab loads)
- [x] Whiteboard: double-click to type (Escape puts the pen down); dot grid scales; edits no longer reset the zoom
- [x] Flashcards: study never goes browser-fullscreen (side panel first, then a Spectra full mode); Enter continues (default 3); space hint once; typed answers mark correct characters; study button becomes "Edit" and leaves study

## Library and selection
- [x] Library cards fill the row to the space available (not two per row)
- [x] Threads button in the Library uses the island thread list, scoped to the folder
- [x] Selection bar sits above the island; working "+"; no Return; drag to reorder; Select outside the dots menu and in onboarding
- [x] Bridge-imported Physics folder lands in Physics HL; any arrangement of imported files works
- [x] Local-only works embedded elsewhere fail gracefully on another device

## Calendar and tasks
- [x] Calendar opens on today
- [x] Every task opens on the right when pressed (hover peeks), same as ManageBac tasks
- [x] Undated tasks pinned at the top of the day while scrolling
- [x] Done can be undone for every task
- [x] Task creation with a proper time picker
- [x] Moving a ManageBac task clones it; offer recombining (also by drag)
- [x] ManageBac sync starts from today, not the whole history

## Bridge and devices (live tested)
- [x] "Set SPECTRA_CONVEX_URL…" on sync; outdated Bridge replaced
- [x] This computer recognised as this computer
- [x] Devices shows the download first when Bridge is missing
- [x] Local-file page replaced; its settings move to Devices; no vague "could not finish this step"
- [x] Office round trip reviewed end to end: Word saves merge live, Spectra never writes over an unread Word save, conflicts settle on a clean merge, an overlapping local draft shows as Two versions with a review

## Accounts and admin
- [x] Agents page loads on first visit
- [x] Invite flow redesigned and working
- [x] File attachments ("could not find file"): the xmldom override broke mammoth; pinned to patched 0.8.15, Node build reads a Buffer
- [x] Superadmin: usage tracking, AI and Convex storage limits
- [x] Superadmin emergency stop for AI and Convex work (sign-in and the admin page stay up; reversible)
- [x] Feedback button beside the username: screenshot, category, description; inbox for superadmin
- [x] Feedback attachments show a preview of each file (images, video, documents), in the form and the inbox
- [x] Tips and onboarding complete: the tour from the start, then first-time tips (message, work, search, task, agent, Bridge) said once per account
- [x] No surface (except the landing page) keeps outdated visuals, UI, animation or effects: buttons, dropdowns and search fields share one borderless style at one size; admin figures in the serif, without trend lines that repeated the school total on every class
- [x] Details pages (ManageBac and others) redesigned: a school task opens as the same task work as any other, with a ManageBac notice, grade, hand-in and resources; Calendar copies open that same work; class details in one column with the sync options folded
- [x] Library places pane on the left and collapsible, like the threads column in chat
- [x] Imported decks show their first words on the card instead of a blank slide
- [x] Emails on Spectra's paper: invitations written for the student (teacher and admin versions too) with the school's name, what waits for them and how long the link lasts, plus a plain-text copy; the contact form's message in the same layout (Clerk's own emails are styled in the Clerk dashboard)
- [x] Onboarding: the tour asks for the brief and reminder times and offers Bridge on Devices; tips appear when the user first does the thing

## Threads, loading and briefs
- [x] Island hover overlays rounded at the bottom too
- [x] Threads load only what is needed: titles for lists, pages on demand, everywhere threads appear
- [x] Island threads untouched for 7 days leave the island (while online, never as a background job)
- [x] Daily brief stops after 4 inactive days; on return it is written there and the streak resets
- [x] One card per created or changed work in the chat (the one nearest the messages); no duplicate cards or messages anywhere
- [x] Brief actions collapse past the first few; done ones move to the bottom
- [x] Brief actions carry concrete instructions, not only a vague prompt

## Sharing and collaboration
- [x] A teacher's shared workspace shows inside the student's own ManageBac class instead of beside it; linking changes at any time, from the place's header (more systems later)
- [x] Works are private to their author by default; Share or Private on one or many (Library menu, selection bar); a workspace can start new work shared; the whole class can be invited at once
- [x] Invited people view by default; the author gives one person edit, or everyone at once (Everyone can edit, in Share and in the work's header), which makes them collaborators
- [x] Shared works wear a people mark on cards and rows; in a shared work, the people button in its header lists each person, their role, and (for the author) who has made changes
- [x] History, previews and restore are the author's alone, not even collaborators'
- [x] Make a copy of any work you can open (Library menu, shared works, the work's menu, the people list for readers); the copy is yours alone and lands beside the original or in your own workspace
- [x] Spectra edits a shared work live without it being saved first: it claims only the part it changes, waits for a person editing that part, keeps others' edits, and retries a lost live read instead of failing
