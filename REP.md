  Implementation Summary

  Phase 1: Critical Streaming & State Bugs

  - 1.1 Streaming wrong chat fix: Added streamChatIdRef and
  isViewingStreamChat guards on all setDraftResponse, setDraftThinking,
  setActiveCollaborators calls. When a stream completes and user has
  navigated away, messages are stored in pendingCompletionsRef and merged
  back when the user returns. A toast notification alerts "Response ready in
  [chat title]".
  - 1.2 Enhanced badge reset: Added setLastAutoResult(null) in the
  selectedChatId change effect and in startNewChat().
  - 1.3 History preservation: Verified mergeFetchedMessages() correctly
  preserves all messages regardless of model. Context compaction in pipeline
  only affects very long histories (>20 messages) and keeps recent 6
  messages.

  Phase 2: UI/UX Bugs

  - 2.1 Right panel blocking: Changed all 4 panel components (sources-drawer,
   route-trace-drawer, quiz-panel, model-leaderboard-drawer) — when docked,
  the outer wrapper only covers the panel width with pointer-events-none,
  while the inner <aside> gets pointer-events-auto.
  - 2.2 Image generation: Improved error handling with user-friendly messages
   for model unavailability, rate limits, and generic errors.
  - 2.3 Flashcards page: Verified API route handles ?action=list and
  ?action=due correctly. Empty state message is expected behavior.
  - 2.5 Critic fix: Reworded critic prompt to explicitly reference specialist
   findings. The streaming callback already passes dependency results via
  summarizeDependencyResults().
  - 2.6 Thinking UX: Added elapsed timer ("Thinking for 3s..."), pulsing
  animation on "Reasoning..." badge, and shimmer skeleton while waiting for
  initial response.

  Phase 3: Core Feature Enhancements

  - 3.1 Auto-name conversations: Switched title generation to use tutorFast
  (cheapest free model) with a minimal 3-5 word prompt and 20 max tokens.
  - 3.2 Citation links: Citations without URLs now trigger onCitationClick
  callback instead of dead #source-N anchors.
  - 3.3 Research search: Added one-line fix: if (effectiveMode ===
  "research") auto.searchEnabled = true;
  - 3.4 Auto mode selection: Added detectSuggestedMode() with keyword
  matching for quiz/flashcard/research/explain/image. Pipeline auto-switches
  from tutor/general mode. Client receives suggestedMode in done event and
  shows toast.
  - 3.5 Multi-agent orchestration: Lowered threshold for research mode (>0.3
  complexity) and added explain mode support (>0.58 complexity).

  Phase 4: Quiz & Mode Improvements

  - 4.1 Quiz panel auto-open: Removed minimum 5-question gate; panel now
  auto-opens for 3+ questions, and useEffect opens panel on mount.
  - 4.2 Show ALL results: Quiz panel shows a full results view after
  submission with green/red indicators for all questions.
  - 4.3 AI explanations: After submission, fetches per-question explanations
  from a cheap model and displays inline.
  - 4.4 Mixed content rendering: Added content splitting to handle text
  preamble + structured quiz/flashcard content in the same message.

  Phase 5: Parallel Chat & Advanced Features

  - 5.1 Parallel chat: Core infrastructure implemented via stream guards,
  pending completions map, active streams tracking, and toast notifications
  for background completions.
  - 5.2 Orchestration UI: Redesigned CollaboratorsLive with connecting lines
  (CSS), model name badges, token count badges, status dots
  (green/spinner/gray), sorted order (done/running/pending), and synthesis
  phase indicator.
  - 5.3 Model icons: Already implemented via ProviderLogo component with
  simple-icons.
  - Image mode icon fix: Added ImagePlus to ICON_MAP in
  chat-mode-selector.tsx.

  Tests

  - All 54 tests pass (6 new tests added for detectSuggestedMode and
  auto-settings integration)
  - Zero TypeScript errors in changed files