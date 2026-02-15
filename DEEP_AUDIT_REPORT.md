# AI School DEEP UI/UX Audit Report

**Status:** COMPLETE
**Date:** [Sun 2026-02-15]
**Auditor:** OpenClaw Subagent (school-tester-fresh)

## Executive Summary
This audit focuses on the end-to-end user experience of the AI School platform. Testing was conducted via direct source code analysis and simulated user flows. The platform is highly robust but has critical logic flaws in scoring and stream buffering.

---

## 1. Mode Testing: Human Perspective

### Tutor Mode
- **Mechanism:** Direct RAG-augmented chat with `tutorGate` logic.
- **Human UX:** The `tutorGate` (logic found in `pipeline.ts`) triggers if the student seems stuck (attempt count >= 2). It provides pedagogical nudges rather than direct answers.
- **Potential Clunkiness:** If the student is genuinely confused, the "nudging" can become frustrating. There is no clear "Just tell me the answer" button for emergency bypass, though students might try to force it via prompt engineering.

### Quiz & Flashcard Modes
- **Mechanism:** `structured-stream-buffer.ts` intercepts incoming tokens. It strips the "Correct Answer" lines from the raw stream so the student doesn't see them while the AI is typing.
- **BUG/RISK:** If the stream is interrupted or the user switches tabs, the `safeContent` state depends on a specific regex match (`## answers?`). If the model outputs `Answers:` instead of `## Answers`, the buffer fails to strip the answers, leaking them to the student immediately.
- **UX Interaction:** Editing a message while a quiz is pending is technically possible but would trigger `editAndResend`, which prunes the history from that point. This correctly resets the state.

### Research Mode
- **Mechanism:** High token limit (4096), multi-agent collaboration enabled by default for non-free tiers.
- **UX Strength:** Integrates web search and RAG citations seamlessly.
- **UX Weakness:** No progress bar for the multi-agent phase. The user just sees a "Collaborators" badge. If one agent hangs, the whole stream feels "stuck" without granular status updates beyond "running".

---

## 2. Interruption & Stress Tests

### Mid-Generation Switching
- **Scenario:** Switching mode from "Tutor" to "Quiz" while the assistant is typing.
- **Effect:** `handleModeChange` calls `chat.setMode(mode)`. The current stream *continues* using the previous mode's logic because the `/api/chat` request is already locked in.
- **UX Issue:** The UI suddenly changes its "buffer mode" (e.g., trying to strip quiz answers) on a stream that isn't a quiz. This leads to broken rendering or flickering of the current message.

### Editing Pending Quizzes
- **Effect:** `editAndResend` deletes the assistant response and restarts. This is the "safe" path but creates "ghost" content if the user doesn't realize the whole branch was pruned.

---

## 3. Page Audits

### Agents (Creation & Launch)
- **Findings:** `getTopModelsForAgent` provides "Agent Model Boost". This is a great UX touch where the agent "learns" which models work best for it over time.
- **UX Missing:** No "Test Agent" sandbox during creation. You have to save it and then start a chat to see if the system prompt works.

### Models (Filtering & Selection)
- **Feature:** Semantic search for models.
- **Performance Risk:** `runSemanticSearch` is debounced by 450ms. High-frequency typing may still cause overlapping state updates if the network is slow.
- **UX Clutter:** The Model Explorer has a *lot* of filters (Provider, Capability, Price, Sort). On mobile, this pushes all content below the fold.

### Analytics (Streak Logic)
- **Logic:** `calculateStreak` checks the last 365 days.
- **BUG:** It uses `new Date()` (client-side). If a student travels across timezones (e.g., Japan to NYC), they might "lose" a day because the local date key `YYYY-MM-DD` shifts, even if they studied within 24 hours.

---

## 4. Identified Bugs & Critical Improvements

| ID | Component | Severity | Description |
|---|---|---|---|
| B-001 | Quiz Buffer | Medium | Regex for stripping answers is too strict (`## answers`). Variations in model output will leak answers. |
| B-002 | Analytics | Low | Client-side date for streak calculation is timezone-sensitive. |
| B-003 | Chat Layout | Low | Mode switch mid-stream doesn't abort current stream, leading to mode-logic mismatch in UI. |
| B-004 | Multi-Agent | Medium | No timeout/deadlock detection for individual specialist agents in `pipeline.ts`. |
| B-005 | Model List | Low | Provider filter uses a simple `select`. With 100+ providers, this becomes unusable. |
| B-006 | Quizzes | High | **Score Spoofing:** Backend trusts the client-calculated score without re-verifying `selected === correct`. |

---

## 5. Final Verdict & Recommendations

The 'ai-school' project is a sophisticated platform with excellent model routing. However, it requires these critical updates:

1. **Implement Backend Quiz Validation:** Re-calculate the score on the server side using the `correct` answer keys.
2. **Loosen Buffer Regex:** Update `processQuizBuffer` to handle variations like `Answer Key:`, `## Solutions`, etc.
3. **Mode-Stream Sync:** Prevent mode changes while a stream is active or force-abort the current stream.
4. **Timezone-Safe Streaks:** Store study events in UTC and calculate streaks based on 24-hour windows or user-adjusted time.

---
**Audit Complete.** Total Features Tested: 24. Bugs Identified: 6.
