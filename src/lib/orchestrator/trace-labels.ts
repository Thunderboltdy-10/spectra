const TOOLCHAIN_LABELS: Record<string, string> = {
  web_search: 'Web search',
  search_provider_searxng: 'SearXNG live search',
  search_provider_model_fallback: 'Model-based search fallback',
  search_provider_error: 'Search provider error',
  rag_retrieval: 'Resource retrieval',
  retrieval_retrieved: 'Retrieved high-confidence sources',
  retrieval_no_high_confidence_matches: 'No high-confidence retrieval matches',
  retrieval_no_sources_available: 'No retrieval sources available',
  retrieval_no_chunks: 'No retrievable chunks found',
  retrieval_failed: 'Retrieval failed',
  retrieval_not_requested: 'Retrieval not requested',
  marker_verification: 'Answer verification pass',
  route_plan: 'Route plan synthesis',
  prompt_enhancement: 'Prompt enhancement',
  context_compaction: 'Context compaction',
  memory_injection: 'Relevant memory injected',
  school_soul_capsule: 'School guidance capsule',
  source_reliability: 'Source reliability scoring',
  cross_reference: 'Cross-reference evidence',
  vision_gate: 'Vision capability check',
  vision_prepass: 'Vision prepass',
  vision_prepass_manual_lock: 'Manual model vision helper',
  history_image_reference: 'Referenced prior image context',
  adaptive_quiz: 'Adaptive quiz calibration',
  quiz_format_repair: 'Quiz format repair',
  quiz_regenerate_repair: 'Quiz regeneration repair',
  quiz_final_repair: 'Final quiz format repair',
  flashcard_format_repair: 'Flashcard format repair',
  flashcard_regenerate_repair: 'Flashcard regeneration repair',
  flashcard_final_repair: 'Final flashcard format repair',
  artifact_generation: 'Artifact generation',
  image_prompt_refinement: 'Image prompt refinement',
  image_generation: 'Image generation',
  multi_agent_collaboration: 'Multi-agent collaboration',
  critic_skipped_budget_guard: 'Critic skipped by budget guard',
  synthesis_model_reselect: 'Synthesis model adjusted',
  skill_fetch: 'Runtime skills selected',
  skill_guidance_applied: 'Skill guidance applied',
  retry_model_override: 'Retry model override',
  phase_router: 'Phase-based routing',
  route_trace: 'Route trace',
  route_model: 'Model route emitted',
  openrouter_auto_unresolved_model: 'Provider did not disclose final delegated model',
};

export function formatToolchainLabel(tool: string) {
  if (TOOLCHAIN_LABELS[tool]) return TOOLCHAIN_LABELS[tool];
  return tool
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
