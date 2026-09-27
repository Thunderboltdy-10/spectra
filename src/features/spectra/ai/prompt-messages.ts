import type { SpectraAgentMessage } from "./agent-loop";

/** Append current state without changing the stable prompt or prior messages.
 * Only trusted runtime instructions belong in systemContext/recoveryContext.
 * Workspace state and source content retain their user/data role.
 */
export function appendPromptContext(
  messages: readonly SpectraAgentMessage[],
  context: { systemContext?: string; userContext?: string; recoveryContext?: string; recoveryData?: string },
): SpectraAgentMessage[] {
  return [
    ...messages,
    ...(context.systemContext ? [{ role: "system" as const, content: context.systemContext }] : []),
    ...(context.userContext ? [{ role: "user" as const, content: context.userContext }] : []),
    ...(context.recoveryContext ? [{ role: "system" as const, content: context.recoveryContext }] : []),
    ...(context.recoveryData ? [{ role: "user" as const, content: context.recoveryData }] : []),
  ];
}
