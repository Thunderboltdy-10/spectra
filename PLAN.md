# Plan Update - 2026-03-15 00:37 CET

## Latest User Request (Verbatim)
"I want you to redesign and then implement the routing, orchestration, hidden-call accounting, and orchestration UI of this app in a serious way.

Do not just tweak the current heuristic router. Do not just add a few more if/else rules. The current architecture is too mode-first, too static, too sticky, too easy to waste tokens with, and too opaque in the UI.

Start by understanding the whole real call graph of the chat request from end to end. I care about every single place where OpenRouter can be called, not just the main visible assistant response. That includes prompt enhancement, title generation, memory extraction, verification passes, retries, repair loops, search fallbacks, multimodal prepasses, sub-agent calls, and anything else that can burn tokens. I have already seen cases where simple prompts cost far too much. I want that fixed properly. Before changing behaviour, trace every billable subcall and make it impossible for the system to spend money silently.  Ensure the money spent per request is directly gotten from OpenRouter’s request, and added to user spendings so monthly usage works correctly.

Use OpenRouter’s current official behaviour as a reference point, but not as the final design. Research how `openrouter/auto` works, how provider routing works, how Auto Exacto works for tool calls, and how usage accounting is returned in streaming responses. Then use that to build something more sophisticated for this app. OpenRouter auto is only a black-box chooser over a curated set. I need a richer control plane that handles models, phases, tools, search, agents, thinking, enhancement, and cost together.

The new design should stop treating “mode” as the main driver of everything. Mode should become more of a preference and pedagogy layer. Internally, the system should work in phases. For example, a request might need planning, retrieval, web search, analysis, writing, and verification. Another might need just a cheap direct answer. Another might need a tool agent first and then a writer. The system should be able to move from one phase to another naturally mid-run instead of pretending everything is one giant fixed route. Mixed requests like “research this and then write me a polished document” should feel native, not like a broken compromise between two modes.

I want a router that does not keep picking the same model all the time. Variety should be intentional, but not random and not dumb. Build something like stable / fresh / challenger lanes, where strong reliable models still get most of the important traffic, but newer models and underused challengers are explored in a controlled way. Newer models should be meaningfully favoured, but not blindly. Cost has to matter too. Cheap phases should stay cheap. Expensive models should need a reason. High-stakes phases can be more conservative. Low-stakes phases should allow more exploration. Do not flatten 400+ models into one giant ranking. Bucket them by role and capability first, then score a shortlist.

The scoring should not just be based on vibe labels. It should combine phase fit, live reward, reliability, freshness, cost fit, latency fit, context fit, and a deliberate anti-lock-in signal. It should also penalise repetition of the same model and long provider streaks where appropriate. I do not want the old “rotate away from previous model” style guard if it is just noise. I want a real system that explores intelligently and learns from outcomes.

Thinking should also be redesigned. Right now it seems too heuristic and too easy to over-trigger. I do not want one global thinking level controlling the whole request. Thinking should be phase-specific. Planning might be low, analysis medium or high, authoring medium, verification medium, and many simple requests should stay low throughout. If a model does not support a capability, route or downgrade explicitly instead of muddling through.

Search, RAG, skills, tools, and agents should be handled as optional expensive actions, not default clutter. Retrieval should not appear in the task graph unless it is actually justified. Search should not trigger just because heuristics are broad. Skills should become real tool calls rather than prompt fluff. If prompt enhancement survives, it should be cheap, optional, measurable, and clearly surfaced. I originally imagined enhancement as genuine prompt improvement before the main call, but I have never really seen it working in a convincing way. Audit it honestly.

For agents and orchestration, think carefully about context cost. I do not want every agent to load the full previous conversation by default. That is too expensive and often unnecessary. The main orchestrator should usually build compact, role-specific context packets for each specialist. Only pass full history when there is a real reason. I want the orchestration design to be staged and dependency-aware, not flat fan-out by default. Some specialists should run only if earlier evidence or risk signals justify them. Final synthesis should not always be tied to the same main model either.

The UI and trust layer need serious attention too. The orchestration right panel should feel polished, smooth, and intentional. The entrance animation should slide in properly from right to left instead of feeling abrupt. It should only open when there is meaningful orchestration to show. The phases shown to the user should match what actually happened, not generic labels like “thinking” or “routing” when that is not informative. I want clearer, more human, less technical wording, but also better fidelity. Show meaningful subcalls, phase transitions, model decisions, search/retrieval use, and why the system escalated or stayed cheap. I want the panel to feel like a trustworthy window into the control plane, not a clunky debug drawer.

Please do this as a real redesign and implementation pass, not a cosmetic patch. Research the current system, research OpenRouter’s actual current routing and usage behaviour, then rework the architecture so it is phase-based, cost-aware, variety-aware, auditable, and cleaner in the UI. Use the existing code where sensible, but do not stay trapped by the current abstractions. I care more about getting the right structure than preserving every old idea.

At the end, explain plainly what the hidden spend paths were, what you changed, where the new routing decisions now happen, how variety is introduced without chaos, how cost is now controlled, and whether there is anything I need to do manually"

## Actionable Tasks
1. Map the current end-to-end chat request call graph and enumerate every OpenRouter billable subcall path.
2. Audit current spend/accounting flow to identify silent spend paths and missing monthly usage updates.
3. Research current OpenRouter official behavior for: `openrouter/auto`, provider routing, Auto Exacto tool-call routing, and streaming usage/cost accounting.
4. Redesign backend architecture to phase-based orchestration control plane:
   - Phase planner/executor (planning, retrieval, search, analysis, authoring, verification, synthesis).
   - Phase-specific model selection and thinking levels.
   - Optional expensive actions gated by evidence/risk.
   - Explicit, auditable subcall ledger for every OpenRouter call.
5. Implement multi-lane model selection (stable/fresh/challenger) with role/capability bucketing, shortlist scoring, anti-lock-in and repetition/provider-streak penalties.
6. Implement direct OpenRouter-cost ingestion per subcall and aggregate per-request + persistent user spend updates for monthly accounting.
7. Refactor agents/orchestration context handling to default compact role-specific packets, with explicit escalation to full history.
8. Rework orchestration UI panel behavior and copy:
   - Only open when meaningful orchestration exists.
   - Smooth right-to-left entrance animation.
   - Human-readable but faithful phase and subcall timeline.
   - Surface model decisions, escalations, search/retrieval/tool usage, and cost rationale.
9. Verify core UI and request flows with regression-focused checks.
10. Summarize hidden spend paths discovered, concrete changes, and any required manual follow-up.

## Blockers / Assumptions
- Assumption: Existing schema/tables can be evolved for per-subcall ledger and user spend aggregation.
- Assumption: OpenRouter responses (including streaming final chunks and/or provider metadata) are available through current request wrappers.
- Potential blocker: Some historical hidden subcalls may bypass shared client wrappers and require broad call-site migration.
- Potential blocker: UI orchestration panel may depend on event payload shape requiring frontend/backend contract updates.
