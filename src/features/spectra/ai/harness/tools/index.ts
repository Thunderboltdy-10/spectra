import { loadSkillTool } from "../skills";
import type { AnyHarnessTool } from "../types";
import { appTools } from "./app";
import { createArtifactTool, editArtifactTool, readArtifactTool } from "./artifacts";
import { listLibraryTool, readCalendarTool, readThreadTool, schoolDataTool, searchTool, webSearchTool } from "./context";
import { askUserTool, showWidgetTool, updateTodosTool } from "./interaction";
import type { HarnessSession } from "./shared";

export { createSession, type HarnessSession } from "./shared";

/** Every tool the model has. There is no tool discovery step: all are always present. */
export function buildHarnessTools(session: HarnessSession): AnyHarnessTool[] {
  return [
    createArtifactTool(session),
    editArtifactTool(session),
    readArtifactTool(session),
    listLibraryTool(session),
    searchTool(session),
    readThreadTool(session),
    webSearchTool(session),
    readCalendarTool(session),
    schoolDataTool(session),
    loadSkillTool(),
    askUserTool(),
    updateTodosTool(session),
    showWidgetTool(),
    ...appTools(session),
  ] as AnyHarnessTool[];
}
