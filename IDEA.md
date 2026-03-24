# IDEA.md

## Notes on how to interpret this file

- Do **not** omit or collapse vague points just because they are messy.
- Do **not** invent specifics where they are unclear.
- If something is ambiguous, prefer to leave it vaguer rather than falsely clarifying it.
- Do **not** treat older project files as the source of truth for these ideas if they are outdated.
- This file is meant to preserve **all** current issues, upgrade ideas, open questions, rough instincts, and structural concerns discovered through recent testing.

---

## 1) Model generation, skills, tools, and capability expansion

- Expand on skills and tools within model generation.
  - Use actual internet download rather than only manually generated skills like SVG or Mermaid ones.
  - It should not be basic at all.
  - It should actually be quite complex and in-depth, with a ton of things.

- Support actual abstract diagrams.
  - Not just Mermaid.
  - Not just linear.
  - Support mesh, line/arrow-connected, visual, etc.
  - These should not only be triggered when the user asks directly.
  - They could also appear when useful as part of explanation.

- Search should also be able to crawl a web and extract all of its data.

- People love agents / functionalities that help in:
  - creating schedule,
  - subject-specific planning,
  - note-taking styling,
  - general planner,
  - subject planner.
  - Make sure this is possible.

---

## 2) Memory, personalization, context injection, and second-brain logic

- Models get confused due to memory.
  - Be careful how memory is fed and used.
  - I once asked it for WW2 flashcards, and three weeks later I asked for a random thing, and it spent almost 1 minute thinking and getting confused.
  - The final response was alright, but it still mentioned it not understanding the WW2 part.

- I think this is because it is too adapted to, or too aggressively mimicking, OpenClaw.
  - That is good to an extent.
  - But not as aggressive as it is at the moment.

- It should capture more global behaviours from me, or subjects I study, or topics, etc.
  - Some examples, which should **not** get hardcoded because they only apply to me:
    - doing IAs,
    - extended essay,
    - experiences in general.
  - But this should only be accessible and “given” to the model when it is necessary.

- Maybe this should work more like a RAG extension or something similar.
  - Research how it is done in Claude, for instance.
  - Or research newer techniques being developed that are better than RAG.

- My files + memory + ingestion need fundamental rethinking together.
  - There is an `OPENROUTER_API_KEY missing for ingestion` error when attaching a file to “My files”.
  - “My files” should still work anyway.
  - Memory is also not great.
  - Tackling all of this is essential.
  - This includes deciding which fundamental principle / technique to use, like RAG or something else.
  - The goal is a second brain that accompanies the user, but is **not** fed all the time.
  - Otherwise it causes the model confusion I’ve experienced when the memory is irrelevant.
  - It also creates huge costs due to context window length.

- There is no clear indication when memory gets updated.
  - The user could maybe see updated memory as a route.
  - Since it is experimental, it could be good to see what memory is saved.

### Raw example of the bad memory / tutoring / context-overreach behaviour

```text
Got it, let's start by addressing this. First, wait, the student's original recent request was for IB study flashcards on WW2, right? Wait no, wait the user just asked for a paragraph on Crow from Brawl Stars? Wait but first, I need to also remember the tutor mode policies, plus tie in that they were working on IB study materials, maybe? Wait no, wait let's check. Wait first, the student's profile: they asked to create WW2 flashcards for IB, then now they asked for a paragraph on Crow from Brawl Stars? Wait but I need to first, if I write the paragraph, but also tie back to their study goals, plus add the required misconception check and follow-up question? Wait no, wait wait, let's make sure. Wait first, Crow from Brawl Stars: he's a Mythic Assassin Brawler, right? Let's write an accurate paragraph first, then add the required pedagogical elements. Wait but also, the school soul says to encourage their priorities, they had a study goal for IB, so I should acknowledge that first? Wait no, let's structure it: first, the paragraph they asked for, then a misconception check related to common Brawl Stars misconceptions about Crow, then tie back to their original study plan to keep them on track with their IB goals, then the reflective follow-up question. Wait let's make the paragraph accurate: "Crow is a fan-favorite Mythic Assassin Brawler in Supercell’s mobile hit Brawl Stars, first introduced in the game’s2017 global beta as one of its original roster of rare, high-skill characters. Built around a core kit of poison damage and hit-and-run mobility, Crow’s primary attack throws three volleys of poison daggers that stack damage over time, preventing enemy Brawlers from healing and revealing hidden units like Leon or Sandy, while his Super leap lets him dash over walls and obstacles, leaving a trail of poison both when he jumps and lands, turning escapes or aggressive re-engagements high-risk for opposing teams. His unique playstyle rewards map awareness and precise positioning over raw damage output, making him a staple pick for competitive Brawl Stars modes like Gem Grab and Showdown, while his edgy, mysterious backstory—hinted at as a former test subject for the game’s villainous team who turned his poison powers against his oppressors—has cemented his popularity as a mascot-adjacent character for the franchise, with dozens of themed skins ranging from a retro mecha version to a Halloween-themed Vampire Crow that refresh his appeal years after his launch." That's a solid paragraph. Now, add the misconception check: common misconception about Crow is that he's only effective as a solo showdown brawler, that's wrong, he's great in3v3 modes too. Wait, make that a proper misconception check: "Misconception Check: A common false belief among new Brawl Stars players is that Crow is only viable in the solo mode Showdown, rather than3v3 competitive modes. Can you explain one reason Crow’s poison kit makes him uniquely effective in the3v3 mode Gem Grab, which requires teams to hold10 gems to win?" Then, tie back to their original IB study goal: "To keep you aligned with your earlier request to build IB-aligned WWII study flashcards, once you’ve wrapped up any short Brawl Stars breaks, we can dive straight into structuring those revision materials to match your preferred structured, direct learning style." Then the reflective follow-up question? Wait no, the question I already asked can be, but wait let's make sure it fits. Wait also, did I follow all policies? Let's check: no final answer given, I asked a guiding question, added a misconception check, tied back to their original study request which was for IB WW2 flashcards, that's right. Wait wait, but let's make sure it flows naturally. Let me put it all together smoothly. Wait also, since there are no sources, I rely on model knowledge, which is fine because web search was unavailable? Wait no, the sources said no retrieved sources, so I can state that the paragraph is based on common in-universe and public Brawl Stars facts, from model knowledge. Wait right, the prompt said if web search is unavailable, state you're relying on model knowledge. Wait let's add that first? Wait no, let's structure it properly: First, note that this paragraph relies on model knowledge, as no external sources were retrieved. Then the paragraph, then the misconception check, then tie back to their IB study goals, then the follow-up question. Wait that's perfect. Let me write that out:First: "Note: I am relying on model knowledge to share this content, as no external sources were retrieved for this query.Crow is a fan-favorite Mythic Assassin Brawler in Supercell’s mobile hit Brawl Stars, first introduced in the game’s2017 global beta as one of its original high-skill, rare roster characters. Built around a core kit focused on poison damage and hit-and-run mobility, Crow’s primary attack throws three volleys of poison daggers that stack damage over time, prevent enemy Brawlers from healing, and reveal hidden units like Leon or Sandy, while his Super ability lets him leap over walls and obstacles, leaving a trail of poison both when he jumps and lands to turn escapes or aggressive re-engagements high-risk for opposing teams. His playstyle rewards map awareness and precise positioning over raw damage output, making him a staple pick for both casual and competitive play across modes including solo Showdown and3v3 Gem Grab, while his mysterious edgy backstory—hinted at as a former test subject who turned his experimental poison powers against his oppressors—has cemented his long-term popularity, with dozens of themed skins ranging from a retro mecha version to a Halloween Vampire Crow that refresh his appeal years after his launch.Misconception Check: A common false belief among new Brawl Stars players is that Crow is only viable in the solo Showdown mode, rather than3v3 competitive game types. To test your understanding of his kit, can you explain one specific way Crow’s poison damage could benefit a team playing to win the3v3 mode Gem Grab, which requires a team to hold10 gems to secure a win?To align with your original goal of building IB-aligned WWII study flashcards to support your exam revision, we can pivot back to structuring those materials in your preferred clear, structured format once you’re ready to return to your studies. What element of your WWII IB unit do you feel most needs focused flashcard support to help you prepare for your exam?"Wait that's perfect. It follows all the policies: states it's relying on model knowledge, has a misconception check, asks a guiding question, ties back to the student's original study request which was for IB WW2 flashcards, ends with a reflective follow-up question, doesn't give any direct answers that violate policy, the paragraph is what they asked for. Let me check all the requirements again: yes, tutor mode policy says to have one misconception check, never give final answer, ask follow-up questions, tie back to their learning goals. All boxes ticked.
```

---

## 3) Notifications, titles, dashboard, small layout tweaks, and docs

- Response-ready notification should be cooler-looking.
  - Similar style and feel to the achievements-unlocked one.
  - Clicking on it should bring the user to that conversation.
  - It should make it obvious that this works.

- Conversation title is not created consistently.
  - It should be a 3–5 word summary of the initial prompt.

- Dashboard “Study Studio” top card is too big.
  - Bring streak and XP badges within the same row.
  - Remove them from the underlying huge container card.

- Remove just a couple of pixels of margin in the main chat search field.

- Update `app specifications.md`.

- Flashcard reminder and idea may be too intrusive.

---

## 4) Right panels, orchestration defaults, progress states, and route trace layout

- Right panels open with **lots** of empty space at their right for route trace.

- The default right panel is currently **not** the orchestration one.
  - It should be.
  - It also does not open up properly when opened automatically.
  - Manual opening by the user does use the sliding animation.
  - Automatic opening does not.
  - It shows the route trace one instead.
  - The route trace one is also the one with the issue of lots of right-side empty space.

- Progress part is completely broken.
  - It still shows “Thinking” even when generating.
  - The “done” state never gets completed.
  - These options should also depend on the model, prompt, etc.

- Thinking progress time should show lowercase `s` rather than uppercase `S` for seconds.
  - That should remain.

---

## 5) Mermaid, visualisations, preview, canvas, and render behaviour

- Whilst generating Mermaid visualisations, it is quite buggy.
  - Things shift around.
  - Preview moves.

- I hate split preview.
  - Default to preview if available, and if it works.
  - Preview now does work.
  - But I cannot see the canvas idea from before.

- Preview should be on the same background as normal code.
  - It should not sit on its own white background.
  - The white background clashes with dark mode.

- Preview should not have the top bar.
  - It should basically be **just** the preview, or the code rendered, and nothing else.
  - Expand/reset buttons could, if preview is selected, be added to the main top bar instead.
  - They should not be rendered if preview is not selected.
  - They should not be inside the sub-bar.

- When typing in the normal search bar in chat, Mermaid and other visualisations all flicker.

- I also have not seen actual JS / React code for visualisations.

- Things that start with `<<` tags are own, Spectra styling, right?
  - If so, text should not get written until it is fully closed.
  - Depending on the start tag, a skeleton should be rendered.

- Canvas sometimes shows with the same issue as route trace.
  - There is lots of extra / blank space at the right.
  - It looks ugly.

- I am seeing many syntax errors for Mermaid.

---

## 6) Model/provider selection, ranking, routing visibility, and finish behaviour

- It does not allow manual selection from the dropdown.
- Or, in the model page, the “use model” button does not work.

- In the model page, there should be three models shown per row, not two.

- `bytedance-seed/seed-2.0-lite` and `bytedance-seed/seed-2.0-mini` should effectively be the main / priority models.
  - Apparently they are quite effective for their low costs.
  - This is good.
  - But this should **not** just be hard-coded in a way that forces it.
  - I just feel that it could be varied, of course.

- Provider/model mix feels off.
  - I keep seeing some providers I have barely ever seen.
  - Nothing really about OpenAI, Z.ai, Moonshot, MiniMax, Mistral, etc.
  - It is usually this Seed one, Claude, or Gemini.
  - It also feels like the same candidates all the time.
  - The scores for each also feel unreliable.
  - The user must **really** understand which model was chosen.

- Models sometimes finish due to `length` finish reason in OpenRouter.
  - No errors are shown in frontend nor backend.
  - I only see it in logs.
  - This especially happens with the Seed model.
  - It happens **all the time** with it.
  - I cannot change model manually, because it does not let me, so I cannot properly test this.

- Small-version models from huge providers are often not the best option.
  - Rather than a Flash or Haiku, I would often prefer one of the stronger Chinese ones that cost similar and are still better.
  - Price is important here.
  - But I do not want to just use those all the time.
  - I also need the good ones.
  - Keep the cap that if any model costs more than 30 in Million In or Out, it is not available for routing automatically.
  - Once manual selection works, show caution when selected manually too.

- Told it through my prompt to use a model, but it did not.
  - It tried to emulate it instead.

- Told it specifically to use many models using orchestration, and it did not.
  - It feels like user prompt now does not dictate anything.
  - Probably searching through all the model providers and models, or mode names, or orchestration / multiple keywords, is not the correct decision.
  - So find a better one.
  - This needs analysis of prompt interpretation for this.

---

## 7) Search, research, sources, and source presentation

- SearXNG is not available for use.
  - Models do not seem to recognize it or know how to use it.
  - It should probably behave like a tool.

- Research mode seems dead.
  - It never returns good results.
  - It seems based on SearXNG, which is not working.
  - Orchestration is also not available for some reason.
  - This is key.
  - Models can also be spawned at any time of a request for different parts.

- When sources are used, whenever used and relevant, a pill should be included at the end of the paragraph to show that that source was specifically used.
  - But sources are not working:
    - search does not work,
    - memory part with files does not work,
    - or memory in general does not work.
  - This whole area needs a huge redesign / reconsideration.

- Asked it about a specific file in My Files and how it works, but it was not able to give it to me.

- SearXNG is not available, but this is the first time ever that I actually got a source listed.
  - Apparently the model did manage it.
  - I think it may have used OpenRouter search or model search instead.
  - The source itself shows great.
  - But it should show the source pill within the text generation, rather than just the icon for open page, which is what I can see at the moment.

- For search sources, it shows both live sources and normal sources.
  - Remove live sources.

- Questions asked before research seem to be the same.
  - I have been asked all of them all the time.
  - They should be quite specific and actually useful.
  - Multiple choice most of the time.
  - The UI also does not stay updated on reload.
  - It should be encouraged, if not enough context is present, rather than generic clarification.
  - This should apply in every mode, but especially for things that are specific like research or document creation.

---

## 8) Chat persistence, generation-state persistence, auto-scroll, and sidebar rendering

- Model takes a long time to realise that the response is finished.
  - It stays “unsaved and weird”.
  - During generation, if I refresh, it goes away.
  - It then does not show the complete, final structure of it with all the buttons, tokens, etc.
  - This previous stage is not that great.
  - The transition from one state to the other is quite rough.

- During generation, scrolling up and beating the auto-scroll-down is almost impossible.
  - Make it so that it is very easy.
  - Going to the bottom should re-trigger it.
  - Just scrolling up should make it exit auto-scroll mode.
  - Add a down-arrow button to go to bottom, with sliding animation.

- Do not render entire messages in sidebar at first.
  - Only some of them.
  - If scrolling down through the list, render others when needed.
  - But ensure that this does **not** break persistence for conversations.
  - Closing and opening the same conversation days later should still work exactly the same.

- Model output should not be interrupted.
  - And if it is interrupted, it should get saved anyway.
  - Right now it just gets deleted and there is no way of reading / looking at it from UI.
  - This happens many times, such as when changing the actual page.
  - Clicking back on sidebar should go back properly.
  - Reloading should not impact it.
  - It should show the streaming as-is, with no interruptions.

- Branch system for editing is not working well.
  - The `1/2` option is fine for two edits.
  - But then for `2/2`, it shows that, while also showing the `1/2` prompt at the top.
  - It should not work like that.

- Popup for editing message has too little width by default.
  - When submitting, it takes a long time to update the UI for the user prompt with the new information.
  - Of course, this should still respect branch logic.

---

## 9) UI breakages, buttons, and inconsistent screens

- Sometimes the entire UI breaks, often when switching through chats.
  - Tips still work above the search box.
  - Yet a note appears at the top of everything, in the chat heading / conversation title section.
  - This also causes all buttons and headings to display very far to the left.

- Setting button disappears mid-generation.
  - Bring it back.

- When in feedback tab, it should not highlight super-admin too.

- Settings sometimes show the outdated one.
  - The old / deprecated right panel and the manage account buttons, etc.
  - Remove those completely.
  - Keep the default one seen from the toggle within sidebar and main chat part.
  - This matters especially for the tips, which show the outdated settings when pressing “open settings”.

- Last button from navigation options in sidebar gets sort of blurred out from view.

---

## 10) Tokens, tables, output formatting, and layout polish

- Even simple prompts with very little generation show huge token numbers.
  - Even the simplest ones, one generation and not follow-ups, show more than 3500 always.
  - Quite scary.

- Tables are not laid out or structured correctly most of the time.
  - Some columns occupy too much more space than needed for the text.
  - Others too little.
  - This makes things overflow.

---

## 11) Dropdowns, selection UX, model page, mode picker, and provider navigation

- For dropdown for mode selection, make it like the landing page.
  - Use different blocks in a grid rather than an actual list.
  - Of course smaller and adapted.
  - Still with scroll, because I do not want to pack them too much.
  - Keep the brief description.
  - Use up space effectively.

- Model dropdown also needs improvement.
  - Add a left sidebar-like area with provider icons.
  - Many providers are missing icons.
  - Default to recommended at the top of the sidebar, using a star icon.
  - Then rank by popularity with providers.
  - Search should work normally too.
  - Hovering on icons should show tooltip of their actual name.

- Do the same for the model page, but even cooler.
  - Keep leaderboard at the right.
  - At the left, add sidebar for providers with just the icons, or showing text if there is space.
  - More providers should fit on screen.
  - Right now it shows two in 1080p, three in 1440p, but each is too wide.

- Rather than selecting another one adding it by default, make it so that it changes.
  - But `Ctrl + select` should indeed allow multiple selection.
  - Same for dropdown.

- Dropdown for agents should likewise get a redesign.
  - In general, all of the agent part is underlooked even though it is key.
  - It seems too simple and does not feel like it could work.
  - It should work almost as if RL was used with a model to make it for a specific use case.
  - System prompt should be awesome, but more than that.
  - It should hold and use files / resources.
  - For example:
    - specs,
    - mark scheme guidance,
    - etc.
  - Or maybe even search for the newest and update.

---

## 12) Slash commands and dynamic prompt-bar interaction

- Better functionality for `/` slash commands.
  - I type them, but then I do not know how to execute them.
  - It seems like I need to manually and actually type, for example, the model ID for `/model`.
  - Instead, it should show options within the cool tip and attachment section that comes up from the top part of the search bar.

- That top part of the search bar should be dynamic.
  - It should show cool parts / extensions as it is meant for that.
  - The way some things are shown there could change.
  - But it should stay minimal, small, and make sense.
  - It is a bit like Dynamic Island from iPhones.

---

## 13) Files, attachment policy, and retention questions

- Make sure there are limits to files attached per conversation.
  - Max 5.

- Make sure there are limits to total files in My Files.
  - Max 25.

- Include precautions around compaction.

- File extensions that are not compatible should be blocked.
  - Video should directly be blocked from attach.

- Open question:
  - I still do not know about files.
  - Should they stay forever, or disappear after around 7 days?
  - Except those stored in My Files.

---

## 14) Themes, dark mode, colour controls, and animation feel

- Dark mode is still horrible.
  - Would use foreground as such, although themes should of course be adapted:
    - `#2D2D2B`

- Do not understand the custom color theme option.
  - It should not involve primary and secondary, because that is for the actual school branding.
  - It should just let the user select one color type.
  - I also do not want glaring colors.
  - It should adjust intensity and alpha.
  - Pink is an example of it currently looking too glaring and rough.

- Improve animations overall.
  - Especially when the model that is used is determined, and similar moments.
  - Do not overdo it to the point of distraction.
  - But cool, special effects that are brief and effective would be good.

---

## 15) Feedback capture, feedback management, and internal review tooling

- Feedback is **not** capturing screenshots automatically.
  - It should capture screenshot of the page.
  - Research how this could be done.

- Feedback should actually be ordered somehow.
  - Not just dumped there.
  - Should allow me to toggle, star, etc. some of the feedback.
  - Should also allow me to view all non-marked-as-shipped / implemented feedback in one part.
  - That should be bullet-pointed and ordered so it is easy to copy.

---

## 16) Concrete errors / logs preserved from testing

### Catalog sync error

```text
3/24/2026, 7:15:18 PM [CONVEX A(catalogSync:refreshCatalogRuntime)] Uncaught Error: OPENROUTER_API_KEY missing for catalog sync
at refreshCatalogBase (../convex/catalogSync.ts:434:16)
at handler (../convex/catalogSync.ts:522:4)
```

### Ingestion / My Files error

- `OPENROUTER_API_KEY missing for ingestion` when attaching file to “My files”.

---