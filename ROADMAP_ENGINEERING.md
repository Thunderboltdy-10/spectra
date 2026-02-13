# Ixos for Schools — Engineering Roadmap (build plan)

This roadmap is for **coding agents** (and you reviewing/merging). It is aligned with your current architecture (Next.js + Convex + OpenRouter + Study Modes + RAG + Agents + Analytics) and your goal: a stable, premium-feeling school deployment with real orchestration.

## Guiding principles

1) **Cheap-first orchestration**
- Cheap models decide mode/model/tools.
- Expensive models are used only for the final answer when justified.

2) **Token-efficient personalization**
- School Soul and student memory are *retrieved + compressed*, not pasted wholesale.

3) **Capability gating**
- Never send attachments to models that can’t handle them.
- When unsupported, switch model or do a specialist prepass (e.g., vision -> text).

4) **Explainability without cringe**
- Users see concise “Why this model/mode/tools” (1–2 lines), not “I understand…” fluff.

5) **Everything is traceable**
- Every auto decision, fallback, and tool call is visible in a Route Trace.

---

## Reference notes (OpenRouter + agentic systems)

These notes are here so your coding agents implement the *real* wire formats and avoid guessing.

### OpenRouter Auto Router (`openrouter/auto`)
- OpenRouter’s Auto Router analyzes the prompt using **NotDiamond** and forwards the request to a curated set of high-quality models.
- The response can include metadata about which underlying model was used.
- Use this as a **baseline** router when you want a known-good selector, but keep your own router so you can include broader/cheaper models and school-specific policies.

### Reasoning / “thinking tokens”
- OpenRouter normalizes reasoning across providers via the unified `reasoning` object.
- Practical mapping for your UI toggle:
  - Low: `reasoning: { effort: 'low', exclude: false }`
  - Medium: `reasoning: { effort: 'medium', exclude: false }`
  - High: `reasoning: { effort: 'high', exclude: false }`
- Reasoning (when provided) appears in `message.reasoning`.
- Some models/providers do **not** return reasoning tokens even if they internally reason; your UI should handle “no reasoning returned” gracefully.

### Multimodal images (what to actually send)
- Images are sent in a `messages[].content[]` array using `type: 'image_url'`. The `url` can be either a public URL or a base64 `data:` URL.
- Recommendation: send the user’s text first, then the images as separate content blocks.
- Model compatibility varies; you must capability-gate (or prepass) instead of hoping it works.

### A note on OpenClaw-style agents (security posture)
- OpenClaw is popular because it’s “always on” and can operate across tools, but that power also increases security and privacy risk (credentials, prompt injection, data leakage).
- Your differentiation can be: **strong orchestration without always-on permissions**. Keep strict tool scopes, least privilege, and clear retention rules.

---

## P0 — Launch-critical foundations (stability + UX + trust)

### EPIC P0.1 — Route Trace + observability (stop guessing)
**Outcome:** any weirdness (e.g., always choosing GLM) becomes instantly explainable.

**Build**
- Persist a `routeTrace` object per assistant message:
  - inputs: routerMode/manualModel, user-selected overrides, mode, thinkingLevel, needsSearch, needsRag, needsVision, promptEnhanced, tier/budget state, attachments summary
  - candidates: [{ modelId, allowed, scoreBreakdown, eliminatedBecause }]
  - selected: { modelId, why }
  - toolchain: ["rag", "web_search", "vision_prepass", "quiz_grader", ...]
  - fallbacks: [{ from, to, error }]
- Extend NDJSON `done` payload to include `routeTrace` so UI can show it instantly.
- UI: “Why this response” drawer on every assistant message.

**Acceptance tests**
- You can explain any selection in 1 click.
- Fallbacks are never silent.

---

### EPIC P0.2 — Fix AutoRouter always choosing GLM (root-cause + hardened routing)
**Outcome:** Auto routing behaves predictably and uses the right model per task.

**Likely causes to check**
- Primary model IDs failing and falling back.
- Tier enforcement collapsing everything to a single free model.
- UI showing requested model instead of used model.
- Auto-settings overwriting router decisions.

**Build**
- Add a “router dry-run” mode (no model call) that returns just `routeTrace`.
- Make routing deterministic:
  - separate: (a) decide policy/tools/mode (b) decide model (c) apply tier/budget (d) apply capability gating (e) apply fallback plan
- Ensure UI always renders `modelUsed` and not `modelRequested`.

**Acceptance tests**
- Auto selection varies by prompt difficulty.
- The system does not default to GLM unless it is truly the best/only option.

---

### EPIC P0.3 — Attachments: reliable in prod (Images + PDF + DOCX)
**Outcome:** attachments work fast, with graceful fallbacks, and don’t blow up costs.

**Architecture**
- **Two-path** attachment handling:
  1) *Instant path (answer now)*
     - Images -> vision payload (image_url blocks).
     - PDF/DOCX -> quick extract -> short “Attachment Context” block.
  2) *Background path (use later)*
     - parse -> chunk -> embed -> vector index.

**Build**
- One attachment normalizer:
  - Input: files
  - Output: { attachmentsSummary, preparedMessageParts, quickExtractText, backgroundIngestJobs }
- Capability gating:
  - if images present -> require vision
  - if model can’t do it -> (a) switch model OR (b) run vision prepass -> pass text to main model
- UI:
  - per-file progress status
  - clear errors: “Model can’t read images; switched to X.”

**Storage/cost controls**
- Retention rules:
  - personal attachments auto-delete after X days unless pinned
  - keep derived text + embeddings longer
- Thumbnails: store small previews for UI.

**Acceptance tests**
- Image/PDF/DOCX attachments work in deployment consistently.
- Unsupported model never receives incompatible attachments.

---

### EPIC P0.4 — Model catalog correctness (pricing + featured + provider icons)
**Outcome:** costs are correct, famous models appear first, and the picker looks premium.

**Build**
- Fix pricing parse/store:
  - store `inputCostPerM` and `outputCostPerM` as numbers
  - display “—” if unknown (never 0 unless truly free)
- Add Featured models:
  - curated list + “Most used in org” (from analytics)
  - render Featured section first in dropdown + models page
- Provider logos:
  - local icon registry (provider -> svg) with dark/light variants
  - fallback to initials avatar

**Acceptance tests**
- Costs show correctly.
- Dark mode icons don’t disappear.
- Featured models show first.

---

### EPIC P0.5 — Models page: strength-based browsing (fast, non-chatty)
**Outcome:** students browse by “best for physics / essays / coding”, not raw context.

**Build**
- Hybrid search:
  - normalization + fuzzy match (fix gpt-5.2 vs gpt 5 2)
  - semantic match using embeddings (per-model “strength text”)
- Filters:
  - provider, cost, speed, reasoning, vision capability
- Default layout:
  - Featured
  - “Popular tasks” chips (Physics, Essays, Coding, Fast & Cheap, Vision, Research)
  - then All models
- Results are models only (no assistant-style text).

**Acceptance tests**
- “physics strength model” returns sensible top models.
- Works instantly (no per-search LLM call).

---

### EPIC P0.6 — Citations + structured rendering (no broken brackets, no answer leaks)
**Outcome:** citations are clickable; quizzes/flashcards don’t leak answers during streaming.

**Build**
- Citations:
  - parse [1], [2] markers and render as clickable superscripts
  - sources drawer with snippet/page
- Structured streaming:
  - for quiz/exam/flashcards: buffer until full block complete
  - never render answer key until final
  - if output breaks schema: fall back to plain text + “Regenerate strict”

**Acceptance tests**
- citations always clickable
- quizzes do not reveal answers before submit

---

## P1 — Differentiators that make this “school-native”

### EPIC P1.1 — Teacher-edited School Soul (PRIVATE, RAG-based)
**Outcome:** teachers can edit culture/curriculum/policies; students feel it without seeing raw text.

**Build**
- Tables:
  - `orgSoulDocs`, `orgSoulChunks` (mirror resources/chunks)
- Teacher-only UI:
  - editor with sections + versioning + publish
  - preview: “policy bullets” that will be injected
- Runtime:
  - retrieve top Soul chunks relevant to prompt
  - compress to 6–10 bullets
  - inject as INTERNAL GUIDANCE (do not reveal)

**Acceptance tests**
- teachers can publish Soul changes
- responses reflect Soul style and boundaries

---

### EPIC P1.2 — Agent builder v2 (describe -> generate -> edit)
**Outcome:** creating a subject agent is effortless and produces high-quality defaults.

**Build**
- “Describe the agent” -> generate draft config:
  - name, description, suggested modes, recommended models, guardrails
- Advanced controls:
  - allowed tools (rag/search/vision prepass)
  - model allowlist/denylist
  - attachment policy

**Acceptance tests**
- teacher can create a physics agent in minutes
- agent behaves consistently

---

### EPIC P1.3 — Agent-aware model ranking (learn from usage)
**Outcome:** each agent learns which models work best and the orchestrator uses that signal.

**Build**
- Aggregate stats:
  - per agent: models used, success indicators (user rating, retries, quiz score changes)
- Use in routing:
  - when agent active, boost top performing models for that agent
- UI:
  - “Best models for this agent” section

**Acceptance tests**
- selecting an agent nudges the router to proven models
- recommendations update over time

---

### EPIC P1.4 — Student Coach analytics (teach AI usage, not just show charts)
**Outcome:** students learn how to use AI properly: better prompts, better mode choice, cost awareness.

**Build**
- Rule-based insights:
  - mode diversity, prompt length, expensive model overuse, quiz weakness areas
- Optional weekly summary using cheap model (only if opted-in):
  - 3 insights + 2 suggestions + 1 goal
- UI:
  - “Improve your AI habits” panel
  - contextual nudges (“Use Tutor mode for this”) when appropriate

**Acceptance tests**
- insights are actionable and cheap
- students can see how prompt enhancer improved their prompt

---

### EPIC P1.5 — Cheap conversation titles
**Outcome:** titles are meaningful and not the first characters of the first prompt.

**Build**
- On first message of a new chat:
  - call a lightweight model to produce 3–6 word title
  - store to chats.title

---

## P2 — Advanced orchestration (multi-agent collaboration) + premium polish

### EPIC P2.1 — Multi-agent collaboration (tool graph) for complex tasks
**Outcome:** complex tasks can use multiple specialists (vision/search/retrieval/code) and synthesize into one answer.

**Design**
- Router Brain decides whether to activate multi-agent.
- If yes, spawn a small task graph:
  - Vision Interpreter (if image)
  - Retriever (RAG)
  - Web Researcher (if allowed)
  - Code Helper (if code)
  - Critic/Verifier (optional)
- Synthesizer merges results into a single final answer.

**Cost controls**
- Hard caps: max subcalls, max tokens, max wall time
- Cache intermediate results (e.g., image description)
- Use cheapest acceptable specialist models

**UI**
- “Collaborators used” badges (Vision + Search + Synthesizer)
- collapsible “Work” panel (not noisy)

---

### EPIC P2.2 — Model metadata enrichment (release date, knowledge cutoff, etc.)
**Outcome:** models page becomes a true explorer.

**Build**
- Extend modelCatalog with optional fields:
  - `releasedAt`, `knowledgeCutoff`, `notes`
- Populate for top models via curated registry you maintain.
- Always show “Unknown” if not provided.

---

### EPIC P2.3 — Org branding (path-based first; subdomains later)
**Outcome:** each school has branding without infra complexity.

**Build**
- org settings: logo, primary color, display name
- path routing: `/org/<slug>/...`
- later: optional subdomains

---

## Suggested “coding agent” roles you can run repeatedly

1) **Routing/Trace Agent**: implement routeTrace + drawer + dry-run.
2) **Attachments Agent**: capability gating + two-path pipeline + retention.
3) **Models UX Agent**: featured models, provider icons, cost fix, strength search.
4) **Structured Modes Agent**: citations + streaming-safe quiz/flashcards.
5) **Soul Agent**: teacher editor + RAG-based private injection.

## Merge strategy (avoid chaos)
- Land P0.1 (trace) first.
- Gate risky changes behind feature flags:
  - `orchestratorV2Enabled`
  - `semanticModelSearchEnabled`
  - `multiAgentEnabled`
  - `soulEnabled`
