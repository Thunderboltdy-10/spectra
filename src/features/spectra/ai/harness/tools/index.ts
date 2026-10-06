import { loadSkillTool } from "../skills";
import type { AnyHarnessTool } from "../types";
import { appTools } from "./app";
import { commandTools, runOnlyTools } from "./commands";
import { createArtifactTool, editArtifactTool, readArtifactTool } from "./artifacts";
import { listLibraryTool, readCalendarTool, readCommentsTool, readThreadTool, schoolDataTool, searchTool, webSearchTool } from "./context";
import { askUserTool, showWidgetTool, updateTodosTool, agentHandoffTool } from "./interaction";
import type { HarnessSession } from "./shared";

export { createSession, type HarnessSession } from "./shared";

/**
 * Every tool the model has, always present. find_commands and run_command
 * reach the rest of the command catalog through these same tools, plus the
 * few commands that have no tool of their own.
 */
export function buildHarnessTools(session: HarnessSession): AnyHarnessTool[] {
  const offered = [
    createArtifactTool(session),
    editArtifactTool(session),
    readArtifactTool(session),
    listLibraryTool(session),
    searchTool(session),
    readThreadTool(session),
    readCommentsTool(session),
    webSearchTool(session),
    readCalendarTool(session),
    schoolDataTool(session),
    loadSkillTool(),
    askUserTool(),
    updateTodosTool(session),
    showWidgetTool(),
    ...appTools(session),
    // Only offered when the user has agents to hand a request to.
    ...(session.agents.length && session.backend.useAgent ? [agentHandoffTool(session)] : []),
  ] as AnyHarnessTool[];
  return [...offered, ...commandTools([...offered, ...runOnlyTools(session)], offered)];
}
