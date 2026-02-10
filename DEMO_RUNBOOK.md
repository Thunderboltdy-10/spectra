# AI School Demo Runbook

Use this as your exact script.

## Part 1: Full Check Flow (Do This Now)

### 0. Start clean
- [ ] Open the app and sign in as your demo account.
- Why: Prevent stale session issues before testing.

### 1. App boot + core navigation
- [ ] Confirm sidebar links: `Chat`, `Agents`, `Models`, `Analytics` (and `Admin` if admin account).
- [ ] Confirm light theme is default; toggle dark/light once.
- Why: Verifies top-level UX and no broken navigation.

### 2. Chat without workspace/pack
- [ ] Start a new chat from home.
- [ ] Send: `Help me revise Newton's laws in 5 minutes.`
- [ ] Confirm response streams and completes.
- Why: Proves pack-free chat path works end-to-end.

### 3. Auto-settings behavior
- [ ] Send: `What's the latest news about AI regulation in 2026?`
- [ ] Confirm search behavior appears (search citations / search-enabled auto result).
- Why: Verifies auto-search routing for current-events prompts.

- [ ] Send: `Prove the sum of angles in a triangle is 180 degrees.`
- [ ] Confirm higher-thinking behavior/model selection in auto result.
- Why: Verifies complexity-based thinking/model auto-selection.

### 4. Prompt enhancement indicator
- [ ] Send a vague prompt: `help with math`
- [ ] Confirm "Enhanced" appears in composer/status after response.
- Why: Verifies auto-enhance pipeline and visible feedback.

### 5. Stop generation
- [ ] Send a long request: `Write a detailed 20-point study plan for A-level physics with examples.`
- [ ] Click `Stop` mid-stream.
- [ ] Confirm stream stops cleanly and partial output remains.
- Why: Critical control UX for live demos.

### 6. Spending + tier behavior
- [ ] Open settings/sidebar spending meter.
- [ ] Confirm monthly spend and tier are displayed.
- [ ] Send a few extra prompts and confirm spend updates after responses.
- Why: Proves cost tracking and budget-tier logic are active.

### 7. Citations + rendering quality
- [ ] Ask for markdown with table + code + formula:
  - `Give me a markdown table comparing mitosis vs meiosis, a Python snippet, and the quadratic formula in LaTeX.`
- [ ] Confirm:
  - citations/cards render
  - code block has copy button
  - table is styled and scrollable on small width
  - LaTeX renders correctly
- Why: Verifies ChatGPT-level formatting polish.

### 8. Models live explorer
- [ ] Go to `/models`.
- [ ] Confirm models load (live endpoint), filters and sorting work.
- [ ] Click `Try in chat` on one model and confirm chat opens with model override from URL.
- Why: Verifies live catalog + handoff into chat flow.

### 9. Agent resources flow
- [ ] Go to `/agents`, open one agent.
- [ ] In `Resources` tab upload a PDF/doc.
- [ ] Confirm resource appears and status is processed.
- [ ] Start chat with that agent and ask about uploaded content.
- Why: Verifies agent-specific retrieval + upload pipeline.

### 10. Memory personalization
- [ ] In one chat send 3 short facts about user preference:
  - `I learn best with visual explanations.`
  - `I struggle with integration by parts.`
  - `I am preparing for A-Level Physics in June.`
- [ ] Start a new chat and ask for a study plan.
- [ ] Confirm response feels personalized to those facts.
- Why: Verifies extraction, storage, and memory injection.

### 11. Compaction behavior
- [ ] Continue one chat until >20 messages.
- [ ] Confirm the chat stays responsive and context remains coherent.
- Why: Verifies context compaction path under long conversations.

### 12. Error-state spot checks
- [ ] Temporarily trigger one failure mode (e.g., invalid model/manual mismatch or network disconnect simulation).
- [ ] Confirm user-facing error is meaningful, not blank/crash.
- Why: Demo safety net for real-world hiccups.

---

## Part 2: Teacher Demo Flow (Exact Script for Tomorrow)

Target runtime: 12-15 minutes.

### 1. Opening (1 min)
- Action: Show homepage + clean sidebar.
- Say: "This platform is designed so students use AI well by default: better prompts, model routing, thinking depth, retrieval, and budget controls."
- Why this matters: Frames outcomes (learning quality + safety + cost control).

### 2. Student tutoring experience (2 min)
- Action: New chat, ask a normal tutoring question.
- Show: streaming response, polished formatting, mode-aware behavior.
- Say: "Students can switch study modes, but auto-settings keep defaults strong even if they don't configure anything."
- Why this matters: Demonstrates ease-of-use and guided pedagogy.

### 3. "Latest info" intelligence (2 min)
- Action: Ask a current-events question (`latest`, `today`, `2026`).
- Show: search citations/cards.
- Say: "When the question needs current info, the system automatically routes to search-capable models and cites sources."
- Why this matters: Solves stale-answer risk.

### 4. Deep reasoning auto-detection (1.5 min)
- Action: Ask proof/derivation question.
- Show: auto thinking/model behavior.
- Say: "For harder prompts, we increase reasoning depth automatically so students don't need model expertise."
- Why this matters: Better answer quality without user complexity.

### 5. Cost governance (1.5 min)
- Action: Open spending meter/settings.
- Show: monthly spend + tiering concept.
- Say: "Every response records cost per user. As spend rises, model access tightens automatically: normal -> cheap-only -> free-only."
- Why this matters: School-safe subsidy model.

### 6. Model transparency (1 min)
- Action: Open `/models`, filter, sort, then `Try in chat`.
- Say: "Teachers/admin can inspect live model options and still enforce safe routing behavior."
- Why this matters: Transparency + controllability.

### 7. Agent with private resources (2 min)
- Action: Open an agent, show Resources tab, uploaded file, then chat using that agent.
- Say: "Subject agents can hold their own document context, so answers stay aligned to class materials."
- Why this matters: Classroom alignment and reuse.

### 8. Personalization memory (1 min)
- Action: Mention a prior learner preference and show personalized response style.
- Say: "The assistant retains durable learning preferences and adapts explanations over time."
- Why this matters: Individualized learning support.

### 9. Reliability control (1 min)
- Action: Start long generation then press `Stop`.
- Say: "Teachers and students can interrupt generation immediately without losing the session."
- Why this matters: Trust and usability in real classrooms.

### 10. Close (30 sec)
- Say: "So this is not just chat: it's a guided learning system with pedagogy, retrieval, memory, and budget governance built in."
- Why this matters: Clear differentiation from generic AI tools.

---

## Demo safety fallback lines (if anything glitches)
- "Let me refresh this chat thread; state is persisted."
- "I'll switch to a second prepared example while this request retries."
- "The key behavior is the same: auto-routing + citations + spending controls."

## Minimum success criteria for tomorrow
- Chat streams correctly
- Search-cited answer works
- Spending tier visible
- Models page loads live data
- Agent resource answer works
- Stop button works
