export function shouldUseComplexReasoning(input: {
  prompt: string;
  attachmentCount: number;
  boundedSingleCreation: boolean;
}) {
  if (input.boundedSingleCreation) return false;
  const prompt = input.prompt;
  return (
    input.attachmentCount > 1 ||
    /\b(?:research|evaluate|prove|derive|reorganize)\b/i.test(prompt) ||
    /\b(?:compare|analy[sz]e)\b[\s\S]{0,80}\b(?:across|several|multiple)\s+(?:artifacts?|documents?|workspaces?)\b/i.test(
      prompt,
    ) ||
    /\b(?:create|update|edit|move|link|rename)\b[\s\S]{0,120}\b(?:several|multiple|many)\s+(?:artifacts?|documents?|decks?|quizzes|tasks?|workspaces?)\b/i.test(
      prompt,
    )
  );
}

export function shouldAllowAgentDiscovery(input: {
  prompt: string;
  hasFocusedArtifact: boolean;
}) {
  return (
    /\b(?:search|find|locate|reorganize|organize (?:my|the) workspace|previous|earlier)\b/i.test(
      input.prompt,
    ) ||
    /\b(?:across|all|everything|related|compare)\b[\s\S]{0,80}\b(?:artifacts?|documents?|workspaces?|library|inbox)\b/i.test(
      input.prompt,
    ) ||
    (!input.hasFocusedArtifact &&
      /\b(?:edit|update|revise|rewrite|rename|move|link|pin|delete|remove)\b/i.test(
        input.prompt,
      ))
  );
}
