# AI School Round 2 Demo Playbook

## 1) Fast Validation Flow (10 minutes)

1. Open `/` and send: `What is the latest AI education news this week?`
   - Confirm smooth streaming (styled draft + cursor).
   - Confirm inline citation numbers `[1]` are clickable.
   - Confirm citation cards below also link correctly.
2. Click **Regenerate** on the latest assistant message.
   - Confirm previous assistant response is replaced, not duplicated.
3. Send a first prompt in a brand-new chat.
   - Confirm first user bubble appears immediately.
4. Toggle **Enhance / Thinking / Search** pills in composer (Auto -> Yes -> No).
   - Confirm labels update in place.
5. Attach a file and send a question.
   - Confirm upload progress toast, user bubble chips, and grounded response.
6. Open model dropdown.
   - Confirm search input works.
   - Confirm no `-1`, no `0.000` pricing noise, no `(free)` suffix noise.
   - Confirm popularity-first ordering and capability chips (thinking/search).
7. Open `/models`.
   - Confirm provider logos render.
   - Confirm sort direction toggle works.
   - Confirm unknown prices render as `N/A` and sorting works.
8. Open `/analytics`.
   - Confirm `Most active time`, `Preferred model`, daily activity, and time-of-day chart render.
9. Press `Cmd/Ctrl + K`.
   - Confirm command palette opens and navigation actions work.
10. Open avatar menu in chat sidebar.
   - Confirm `Manage account` and `Sign out`.

## 2) Teacher Demo Flow (12-15 minutes)

1. Open with: “This is a guided learning system, not just a chatbot.”
2. Show composer command bar:
   - Mode, model, agent, and auto-controls all in one place.
3. Ask a current-events question:
   - Explain search orchestration: web model fetches live context, selected response model uses that context.
4. Ask a proof/derivation question:
   - Explain automatic reasoning depth and capability-aware routing.
5. Ask with weak prompt:
   - Show user text preserved.
   - Expand “View enhanced prompt” to show hidden refinement path.
6. Upload a file and ask grounded question:
   - Show retrieval + citations.
7. Show Models Explorer:
   - Filter, sort, and `Try in chat`.
8. Show Analytics:
   - topic synthesis, peak study window, preferred model.
9. Close with reliability controls:
   - Stop generation, regenerate, command palette, account menu.

## 3) Prompt/Model Orchestration (60-second explanation)

1. Request enters with mode + auto-controls (`enhance`, `thinking`, `search`).
2. Auto pipeline classifies:
   - complexity (`simple/medium/complex`)
   - prompt category (`code/math_science/creative/research/general`)
   - search intent.
3. Budget + tier policy applied.
4. Route chooser selects model and fallbacks by:
   - mode
   - complexity/category
   - search need
   - tier constraints.
5. Search orchestration is independent:
   - if search enabled, web context is fetched first and injected;
   - final response model can still be a different model.
6. RAG is cost-guarded:
   - embeddings run only if resources exist.
7. Streaming path:
   - lightweight draft rendering during stream;
   - full markdown render on completion.
8. Post-response:
   - usage/cost logging
   - memory extraction
   - analytics write.

## 4) Mode-by-Mode Strategy (talk track)

1. Learn (Tutor):
   - Socratic gating, misconception checks, staged hints.
2. Review (Marker):
   - rubric-style critique, score-band language, targeted drills.
3. Practice (Exam):
   - timed framing, command verbs, mark allocation, self-check rubric.
4. Coach (Draft):
   - iterative revision order and concise writing interventions.
5. Quiz:
   - structured MCQ output with explanations, rendered in quiz UI component.
6. Flashcards:
   - front/back pairs with memory cues, rendered in interactive flashcard UI.
7. Research:
   - evidence synthesis + reliability scan + web evidence links.
8. Explain:
   - Feynman layering + teach-back prompt.
9. Chat:
   - open-ended support with the same background orchestration protections.

## 5) Deploy Checklist (Vercel + Convex)

1. Push code to GitHub.
2. In Convex:
   - run `npx convex deploy`
   - copy `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` values.
3. In Vercel:
   - import GitHub repo.
   - framework: Next.js.
   - set env vars (Production + Preview):
     - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
     - `CLERK_SECRET_KEY`
     - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
     - `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
     - `OPENROUTER_API_KEY`
     - `CONVEX_DEPLOYMENT`
     - `NEXT_PUBLIC_CONVEX_URL`
     - any existing app-specific vars from `.env.local`.
4. Redeploy in Vercel.
5. Validate production endpoints:
   - `/api/bootstrap`
   - `/api/chat`
   - `/api/models/live`
   - `/api/analytics`.

## 6) If Something Fails During Demo

1. “Let me open a prepared chat thread while this retries.”
2. “The key behavior is orchestration: model routing + search + retrieval + personalization.”
3. Use fallback showcase:
   - Models Explorer
   - Analytics page
   - Agent resources tab.
