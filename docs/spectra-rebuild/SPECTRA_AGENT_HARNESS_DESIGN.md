# Spectra Agent Harness

Status: active implementation, 2026-07-13.

## Why the current planner is being replaced

The original Wave Z engine asks one model call to preload context, infer intent,
describe progress, generate every mutation, and write the final response in one
large JSON object. That couples unrelated failure modes: one incorrect intent
count can reject otherwise correct content; a missing field can discard a long
run; and the model cannot inspect new workspace state between actions.

Spectra is an agent, not a structured-output chatbot. Its harness must own the
control loop and let DeepSeek decide which bounded tool to use next.

## External design evidence

- OpenAI's Codex harness repeats model inference, tool execution, and observed
  tool results until the model returns a final assistant message. Context-window
  management is a harness responsibility, not one giant initial prompt.
  <https://openai.com/index/unrolling-the-codex-agent-loop/>
- OpenAI's harness engineering guidance emphasizes environments, explicit
  intent, and feedback loops that make agent work verifiable.
  <https://openai.com/index/harness-engineering/>
- Anthropic recommends the smallest high-signal context, just-in-time retrieval,
  compaction, structured memory, and tools designed for model ergonomics.
  <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
  <https://www.anthropic.com/engineering/writing-tools-for-agents>
- Anthropic separates deterministic workflows from open-ended agents and uses
  evaluator/optimizer and orchestrator/worker patterns only when task complexity
  benefits from them.
  <https://www.anthropic.com/engineering/building-effective-agents>
- DeepSeek and OpenRouter both support OpenAI-compatible typed tool calls and
  multi-turn tool-result loops.
  <https://api-docs.deepseek.com/guides/tool_calls>
  <https://openrouter.ai/docs/api/reference/parameters>
- DeepSeek's native prefix cache is automatic and rewards stable repeated
  system/tool prefixes. Spectra records cache-hit and cache-miss tokens rather
  than assuming a repeated large prompt is automatically cheap or fast.
  <https://api-docs.deepseek.com/guides/kv_cache>
- Codex exposes one persistent harness protocol to every client and treats
  threads, tool execution, progress, diffs, reconnection, and persistence as
  harness concerns rather than UI-local state.
  <https://openai.com/index/unlocking-the-codex-harness/>
- Claude Code's autonomy model reinforces a complementary boundary: broad
  capability inside a narrow, mechanically enforced scope is safer and less
  disruptive than asking repeatedly for permission for ordinary in-scope work.
  <https://www.anthropic.com/engineering/claude-code-sandboxing>
- Codex deliberately keeps the previous prompt as an exact prefix of the next
  inference and keeps tool ordering stable so provider prompt caching remains
  effective. Mid-thread environment changes are appended as new messages rather
  than rewriting old context. Spectra must apply the same rule to its durable
  thread transcript and tool catalogue instead of rebuilding a semantically
  equivalent but byte-different monolith each turn.
  <https://openai.com/index/unrolling-the-codex-agent-loop/>
- Claude Code isolates high-volume retrieval in fresh subagent contexts and
  returns only a compact result, while targeted latency-sensitive edits stay in
  the main context. Spectra's analogue is a bounded reader/evaluator worker for
  large source sets; ordinary focused edits must not pay worker-startup or
  reread costs.
  <https://code.claude.com/docs/en/sub-agents>
- Claude Code compacts older history while preserving recent exchanges and key
  decisions, and exposes durable checkpoints for rewinding edits without
  destroying later history. Spectra maps these to structured thread memory and
  append-only artifact versions/restores rather than destructive rollback.
  <https://code.claude.com/docs/en/agent-sdk/agent-loop>
  <https://code.claude.com/docs/en/checkpointing>

## Target loop

1. **Acknowledge** — create the durable run/thread immediately.
2. **Contract** — the harness derives explicit requested outcomes and protected
   objects from the user message. The model may refine ambiguity, but it cannot
   redefine explicit counts or prohibitions.
3. **Orient** — send only focus, compact workspace/thread maps, available tool
   descriptions, and recent structured memory.
4. **Observe on demand** — DeepSeek calls read-only tools such as
   `search_objects`, `read_artifact`, `read_workspace`, and `read_thread`.
   Results are concise, typed, and appended to the turn.
5. **Act incrementally** — one typed mutation proposal per tool call. Spectra
   validates ownership and semantics, materializes or updates the corresponding
   visible shell, records the operation, and returns the observed result.
6. **Approve when necessary** — destructive or broad operations pause in one
   durable approval state shared by `/workspace` and `/chat`.
7. **Verify outcome** — deterministic graders inspect created counts, requested
   fields, links, placement, and saved state. Complex content can additionally
   receive a bounded evaluator pass with concrete feedback.
8. **Finish truthfully** — only after commit and verification does the final
   assistant response become canonical.

The loop has no arbitrary time, token, artifact, or turn cutoff. It ends on a
final answer, a user decision, explicit Stop, lost ownership lease, or a proven
no-progress cycle. A repeated identical tool request is returned as structured
feedback so the model can choose another strategy; it is not silently retried.

## Durable state

Every inference, tool request, tool result, staged patch, approval, commit,
verification, provider transition, and recovery is an ordered run event tied to
one execution lease. Refresh reconstructs the same run rather than restarting
it. Long tasks compact old transcript detail into structured run memory while
preserving user instructions, tool outcomes, unresolved decisions, and object
identities.

## Migration sequence

- [x] Truthful response gating and durable execution leases.
- [x] Same-model provider fallback plus one repair per malformed provider result.
- [x] Canonical artifact-content normalization and outcome count checks.
- [x] Minimal context for trivial conversation; focus-aware bounded packets.
- [x] Harness-owned reconciliation for explicit single-create contracts.
- [x] Streaming agent-turn parser with distinct parallel tool-call identities.
- [x] Unbounded model/tool/result loop with explicit no-progress detection.
- [x] Read-only search/read tools and just-in-time context loop.
- [x] Adaptive compact orientation (focused detail, lightweight global maps).
- [x] Dependency-aware task graphs with typed parallel artifact writers and a
      compact non-creation coordinator.
- [x] Harness-owned explicit planner reconciliation, creation-clause isolation,
      and opaque-id removal from user-facing generated content.
- [x] Model-authored live work labels streamed from hidden typed-tool fields.
- [x] DeepSeek prefix-cache hit/miss observability in model usage telemetry.
- [x] One-operation mutation tools with immediate semantic staging and a
      single-turn terminal path for validated focused actions.
- [x] Natural focused-scope routing distinguishes “preserve everything else”
      from a broad mutation and recognizes references such as “base it on the
      subtasks”; canonical open-object identity, not a keyword-dependent context
      excerpt, determines whether a validated operation can finish immediately.
- [x] Compact terminal-plan transport: individual mutations are validated when
      proposed, while the final envelope stays small and is parsed again by the
      canonical Zod/ownership/policy boundary instead of repeating every rich
      artifact schema on every agent turn.
- [x] Deterministic post-commit artifact existence, type, and content verifier.
- [ ] Optional evaluator feedback tool for genuinely subjective large outputs.
- [x] Structured thread compaction preserves purpose, evolving summary,
      originating user instructions, and a recent-turn window instead of a
      blind tail-only transcript slice.
- [x] Former 64-operation/32-artifact ceilings are approval review thresholds,
      not execution caps; accepted broad work continues under the durable run
      lease, ownership checks, checkpoints, and explicit Stop control.
- [ ] Browser eval bank with repeated trials, latency, cost, failure, and outcome
      grading for document, deck, quiz, planner, mixed, approval, recovery, and
      parallel-run tasks.
- [ ] Preserve a byte-stable durable thread prefix for provider caching: append
      visible user/assistant messages and environment deltas instead of nesting
      the entire changing conversation inside one newly serialized user packet.
- [ ] Isolated bounded reader/evaluator workers for genuinely high-volume source
      sets, with only citations, facts, and unresolved conflicts returned to the
      main DeepSeek loop; never delegate a quick focused edit.
