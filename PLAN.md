2026-03-06T23:59:00+01:00

Latest user request:
the agent visibility should be controlled by whoever creates the agent, not the admins from school. remove it from admin. and for personal analytics in super-admin, make sure you merge both the token and spend rate into one chart, the same way it is done in analytics. but in normal analytics,remove the bottom two charts with activity and study time, and mode usage, as they are already at the top in the rest of the page. also make it so that for every graph/chart, i can move using left and right buttons to see the data from different months. for feedback, the auto-screenshot taker should work and appear for me. this means when submitting, it should capture a screenshot of the page and send it. i dont want to see the feedback though, so wait until the feedback section popup is closed to take it and send it with the feedback itself so that i as a super-admin with feedback can access and see what the user was seeing too. of course, images MUST be compressed before sending. when orchestrating, i got quikcly a few random toast popups regarding the current agents active. dont use the toast to communicate so much information to the user: it is too much. and make it so that the entire agent streaming response doesnt refresh as soon as it finishes. it does that now at the moment and it is annoying because it should just finish. and whilst drafting, it shouldnt make scrolling up that tricky. it genuinely feels like a challenge. i also would block models that cost above 30 euros for any certain task (input or output 1M tokens) as too expensive (except for images). right panel now is too small. it should be larger and shouldnt get as small as it is now, even in smaller screens. i also dont get the fallbacks into: why this model: Fallbacks

    Attempt 1

    embeddinggemma:latest ? phi3:mini

    {"error":{"message":"embeddinggemma:latest is not a valid model ID","code":400},"user_id":"user_394FROypbXuqMD5gOTcTYmEHgzi"}
    Attempt 2

    phi3:mini ? deepseek/deepseek-v3.1-terminus:exacto

    {"error":{"message":"phi3:mini is not a valid model ID","code":400},"user_id":"user_394FROypbXuqMD5gOTcTYmEHgzi"}
    Attempt 1

    openai/o4-mini-deep-research ? deepseek/deepseek-v3.1-terminus:exacto

    {"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\n \"error\": {\n \"message\": \"Unsupported parameter: 'temperature' is not supported with this model.\",\n \"type\": \"invalid_request_error\",\n \"param\": \"temperature\",\n \"code\": null\n }\n}","provider_name":"OpenAI","is_byok":false}},"user_id":"user_394FROypbXuqMD5gOTcTYmEHgzi"}
    Attempt 1

    phi3:mini ? deepseek/deepseek-v3.1-terminus:exacto

    {"error":{"message":"phi3:mini is not a valid model ID","code":400},"user_id":"user_394FROypbXuqMD5gOTcTYmEHgzi"}. It overflows to the right of the right panel (fix the x-overflow to have none).  And it would be cool to have a button to toggle the orchestration part once a message is sent. cause once i close it, there is no way of retrieving it. and the conversation title top bar and right panel horizontal bars dont line up now when they should. monthly usage STILL on complete 0%. and settings in right panel bugged (possibly as width too small). cannot see anything. bring back in the sidebar the border to the settings button like the rest of the buttons. use frontend-design skill, as well as [SKILL.md](SKILL.md) for all these fixes. still many issues: i feel that for reserach tasks, some models have been hard-coded, as the same are used for the same stuff. i also got this source link: [Request ID: f51da5aeb4de7093] Server Error ArgumentValidationError: Object contains extra field `domain` that is not in the validator. Path: .citations[0] Object: {domain: "reuters.com", filename: "Link", sourceType: "search", title: "Link", url: "https://www.reuters.com/world/middle-east/"} Validator: v.object({filename: v.string(), page: v.optional(v.float64()), resourceId: v.optional(v.id("resources")), snippet: v.optional(v.string()), sourceType: v.union(v.literal("pack"), v.literal("personal"), v.literal("general"), v.literal("search")), url: v.optional(v.string())}) . and the thinking aspect should provide more information on how the agent is thinking. if sub-agents are called, it should show from there some reasoning saying that it called them, and then, part of streaming of each agent could be added in the thinking tab without it becoming chaotic in a cool and informative way. i have no way of testing hence if searxng is working due to this error. much better, but some problems still. also, inoticed in admin you added orchestration v2 toggle. what is difference? did you just create it now? what are the differences?

Actionable tasks:
- Remove school-admin control over agent visibility from the admin UI and keep visibility ownership with the agent creator flow.
- Update analytics and super-admin charts: merge spend/tokens where requested, remove duplicated lower charts, and add month-by-month navigation to every chart.
- Repair feedback screenshot submission so the screenshot is captured after closing the popup, compressed, and uploaded with the feedback while remaining visible to super-admin reviewers.
- Reduce orchestration noise and fix response UX: fewer toasts, stable final streamed response, easier drafting scroll behavior, reopen orchestration panel, richer thinking/sub-agent detail, and no x-overflow in route trace.
- Enlarge and realign the right panel/settings surfaces; restore the bordered sidebar settings button; fix monthly usage display.
- Add model cost guardrails, remove invalid/hard-coded fallback behavior for research routing, and preserve SearXNG observability.
- Fix the citation validator mismatch for `domain` so search citations persist correctly.
- Re-verify affected flows and explain the existing orchestratorV2 toggle in the final response.

Blockers / assumptions:
- The worktree already contains prior edits from earlier implementation passes; preserve unrelated changes.
- Use the existing app visual system and the repo UI guardrails in `SKILL.md`/`CODEX.md` rather than introducing a new aesthetic.
- Verify with TypeScript locally; browser/runtime verification may still be limited by missing optional native dependencies in this environment.
