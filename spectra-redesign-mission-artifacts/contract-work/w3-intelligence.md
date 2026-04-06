# Area: Wave 3 Intelligence
## Assertions

### VAL-W3-001: T0 Gate Fast-Path for Filler Messages Only
For a trivial filler input (for example, “ok”, “thanks”, or “cool”), the request uses a fast response path and returns without invoking classifier-led planning or expensive orchestration stages.
Tool: curl
Evidence: API response metadata/log fields show T0 or equivalent fast-path marker; classifier/routing-stage traces are absent for that request ID.

### VAL-W3-002: Substantive Short Messages Do Not Incorrectly Trip T0
A short but substantive prompt (for example, “derive Snell’s law”) is not treated as filler and is routed through non-T0 intelligence flow.
Tool: curl
Evidence: API response metadata/logs for request ID show non-T0 classification and classifier execution present.

### VAL-W3-003: Non-T0 Routing Follows Classifier Truth
For non-T0 prompts, selected execution behavior (skills/routing intent) matches classifier output rather than legacy heuristic-only routing.
Tool: curl
Evidence: Request logs include structured classifier output and downstream route/skill selections aligned with that output.

### VAL-W3-004: Classifier Produces Structured, Valid Decision Contract
Non-T0 requests return or log a structured classifier decision containing tier/intent/skills (or equivalent required fields) in schema-valid shape.
Tool: curl
Evidence: Captured API/log payload for request ID contains classifier object with required fields and no schema fallback error.

### VAL-W3-005: Multi-Skill Injection Executes in a Single Response Plan
When a prompt requires combined behaviors (e.g., explain + quiz), the system injects multiple skills in one run and output reflects both behaviors coherently.
Tool: agent-browser
Evidence: User-visible response contains both expected behavior components; logs show multiple active skill IDs in prompt assembly.

### VAL-W3-006: Visual Skill Is Triggered by Visual Intent and Constrained for Quality
When user intent is explicitly visual (diagram/chart/timeline request), visual skill activates and generated output is structured, legible, and instruction-following rather than generic low-quality filler.
Tool: agent-browser
Evidence: UI response shows a concrete visual-style artifact/representation matching prompt constraints; logs show visual skill included in active skill set.

### VAL-W3-007: Visual Skill Does Not Leak Into Non-Visual Requests
For clearly non-visual prompts, visual skill is not injected by default and response remains text-first unless user asks for visual output.
Tool: curl
Evidence: Skill injection logs for request ID exclude visual skill; response format is consistent with non-visual intent.

### VAL-W3-008: Ghost Suggestions Respect Visibility Cap
At any moment, no more than two ghost suggestions are simultaneously visible in workspace UI.
Tool: agent-browser
Evidence: UI inspection across workspace shows <=2 ghost items rendered concurrently; supporting event/state logs confirm enforced cap.

### VAL-W3-009: Ghost Suggestions Suppress During Active Editing
While user is actively editing an item, ghost suggestions are hidden/suppressed and only resume when editing focus ends.
Tool: agent-browser
Evidence: Screen interaction trace shows ghosts absent during edit mode and reappearing after edit exit; logs indicate suppression state toggles.

### VAL-W3-010: Ghost Acceptance Materializes into Normal Item State
Accepting a ghost converts it to a persistent normal workspace item with full opacity/state and standard interaction affordances.
Tool: agent-browser
Evidence: Before/after UI state transition recorded; API mutation/logs show create/accept action with resulting persisted item ID.

### VAL-W3-011: Ghost Dismissal Removes Suggestion Without Side Effects
Dismissing a ghost removes it from visible suggestions and does not create unintended persistent artifacts.
Tool: agent-browser
Evidence: UI shows dismissed ghost removed; mutation/log trace shows dismissal event and no corresponding persisted content creation.

### VAL-W3-012: Provenance Indicator Is Visible for AI-Created Items
Items created by AI-assisted flows display a clear provenance indicator that distinguishes them from user-created items.
Tool: agent-browser
Evidence: UI marker/badge/icon visible on AI-origin item; fetched item payload/log includes provenance source field matching AI origin.

### VAL-W3-013: Provenance Data Survives Lifecycle Operations
After move/update/reorganize operations on AI-origin items, provenance remains intact and still indicates AI origin.
Tool: curl
Evidence: Sequential API reads/logs show provenance fields preserved across mutations for same item ID.

### VAL-W3-014: Semantic Agent Matching Selects Contextually Relevant Agent
When multiple agents exist, a query semantically aligned to one domain selects the most relevant agent without requiring exact keyword match.
Tool: curl
Evidence: Matching/routing logs show chosen agent ID with higher semantic score than alternatives for request ID.

### VAL-W3-015: Semantic Matching Falls Back Safely When Confidence Is Low
If semantic confidence is insufficient, system avoids hard-binding to an irrelevant agent and falls back to neutral/default behavior.
Tool: curl
Evidence: Logs show low-confidence match state and explicit fallback route; response remains valid without incorrect agent lock-in.

### VAL-W3-016: Cheap Background Lane Handles Deferred Intelligence Tasks
Background intelligence tasks (e.g., ghost generation, clustering, summarization helpers) execute asynchronously on cheap lane and do not block foreground chat latency.
Tool: curl
Evidence: Foreground response returns before background completion; job/event logs show deferred task queued/executed with background lane metadata.

### VAL-W3-017: Background Lane Produces Observable Outcomes
Cheap-lane background execution results in observable product changes (for example, new ghost suggestion set or refreshed derived metadata) within expected eventual-consistency window.
Tool: agent-browser
Evidence: Initial UI state captured, then post-processing state shows new derived artifacts; logs tie resulting change to prior background job/request ID.
