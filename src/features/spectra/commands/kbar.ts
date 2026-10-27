import { searchSpectra, type SpectraWorkspace } from "../data/api";
import type { SemanticKind, SemanticResult } from "../semantic/types";
import { spectraBus } from "../events";
import { APP_COMMANDS } from "./app-registry";
import { commandForBinding } from "./registry";
import { documentCommandBindings, documentCommandStubHandlers } from "./office/document-commands";
import type { Command, CommandContext, CommandExecutionResult, CommandParam } from "./types";
import type { WorkType } from "../work/registry";
import { regionOfResult } from "../anchors/locate";
import { isHomePath } from "../chat/home-routes";

export type KBarContext = {
  pathname: string;
  activeArtifactId?: string;
  activeArtifactType?: WorkType;
  activeWorkspaceId?: string;
  activeThreadId?: string;
  activeRunIds: readonly string[];
  followingAi: boolean;
  continueCurrentConversation: boolean;
};

export type KBarEntry = {
  id: string;
  command: Command<unknown>;
  label: string;
  description: string;
  params?: Record<string, unknown>;
  contextLabel?: string;
  score: number;
};

export type KBarSearchResult = {
  id: string;
  kind: "artifact" | "workspace" | "thread";
  title: string;
  subtitle?: string;
  params: Record<string, unknown>;
  /** Position in a ranked (semantic) answer: 0 is the best match. */
  rank?: number;
};

const CONTEXT_BOOSTS: Record<string, Partial<Record<"settings" | "artifact" | "chat" | "library" | "workspace", number>>> = {
  "app.settings.toggle-continuation": { settings: 35, chat: 20 },
  "app.settings.change": { settings: 22 },
  "app.settings.manage-account": { settings: 18 },
  "app.settings.clear-compute-cache": { settings: 16 },
  "app.comments.open": { artifact: 42 },
  "app.comments.add": { artifact: 40 },
  "app.work.reveal-anchor": { artifact: 25 },
  "app.run.stop": { chat: 55 },
  "app.follow.stop": { chat: 45 },
  "app.chat.continue": { chat: 38 },
  "app.chat.new": { chat: 18 },
  "app.library.import": { library: 24 },
  "app.workspace.import": { workspace: 24 },
  "app.library.organize": { library: 30 },
  "app.library.delete": { library: 28 },
  "app.sync.policy.change": { settings: 24, library: 12 },
  "app.memory.write": { settings: 18 },
  "app.sharing.change": { artifact: 16, workspace: 14 },
  "app.managebac.sync": { settings: 24 },
  "app.managebac.select-classes": { settings: 22 },
  "app.devices.pair": { settings: 30 },
  "app.devices.add-folder": { library: 14 },
  "app.devices.add-files": { library: 14 },
};

const K_BAR_COMMAND_IDS = new Set([
  "app.page.chat",
  "app.page.workspace",
  "app.page.library",
  "app.page.calendar",
  "app.page.settings",
  "app.page.agents",
  "app.page.school",
  "app.page.analytics",
  "app.thread.open",
  "app.chat.new",
  "app.chat.continue",
  "app.run.stop",
  "app.follow.stop",
  "app.comments.open",
  "app.comments.add",
  "app.library.import",
  "app.workspace.import",
  "app.library.organize",
  "app.library.delete",
  "app.sync.policy.change",
  "app.memory.write",
  "app.sharing.change",
  "app.managebac.sync",
  "app.managebac.select-classes",
  "app.managebac.import-resource",
  "app.devices.open",
  "app.devices.pair",
  "app.devices.add-folder",
  "app.devices.add-files",
  "app.devices.pause",
  "app.settings.toggle-continuation",
  "app.settings.manage-account",
  "app.settings.clear-compute-cache",
  // These two are result-only entries, populated by the authorized search.
  "app.navigate",
  "app.work.open",
]);

const DOCUMENT_KBAR_COMMAND_IDS = new Set([
  "document.history.undo",
  "document.history.redo",
  "document.insert.citation",
  "document.insert.footnote",
  "document.insert.endnote",
  "document.references.sources",
  "document.references.bibliography",
  "document.review.comments",
  "document.review.comment.add",
  "document.review.trackChanges.show",
  "document.review.trackChanges.propose",
]);

const DOCUMENT_KBAR_COMMANDS: readonly Command<unknown>[] = documentCommandBindings(documentCommandStubHandlers)
  .map((binding, index) => commandForBinding("document", binding, index))
  .filter((command) => DOCUMENT_KBAR_COMMAND_IDS.has(command.id))
  .map((registeredCommand) => {
    const command = registeredCommand as unknown as Command<unknown>;
    return {
      ...command,
      availability: (context) => context.artifactId ? command.availability(context) : { state: "hidden" as const },
      execute: async (context, params) => {
        if (!context.artifactId) {
          return {
            commandId: command.id,
            status: "unavailable",
            effect: "mutate",
            message: "Open a document before running this command.",
          } satisfies CommandExecutionResult;
        }
        const { listeners, results } = await spectraBus.commandAsyncResults("document.executeCommand", {
          artifactId: context.artifactId,
          commandId: command.id,
          ...(params === undefined ? {} : { params: params as CommandParam }),
        });
        const outcome = results.find((result): result is CommandExecutionResult =>
          Boolean(result && typeof result === "object" && "status" in result && "message" in result),
        );
        if (outcome) return outcome;
        return {
          commandId: command.id,
          status: "unavailable",
          effect: "mutate",
          message: listeners
            ? "This document command is not available on the active editor."
            : "Open the document in an editor before running its commands.",
        } satisfies CommandExecutionResult;
      },
    };
  });

function surfaceFor(pathname: string): keyof (typeof CONTEXT_BOOSTS)[string] | undefined {
  if (pathname.startsWith("/settings")) return "settings";
  if (isHomePath(pathname)) return "chat";
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (/\/artifact(?:\/|$)/.test(pathname)) return "artifact";
  return undefined;
}

function textScore(text: string, query: string) {
  if (!query) return 0;
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase().trim();
  if (!needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 70;
  if (haystack.includes(needle)) return 45;
  const words = needle.split(/\s+/).filter(Boolean);
  const matches = words.filter((word) => haystack.includes(word)).length;
  return matches ? 12 * matches : -1000;
}

export function rankKBarCommand(command: Command<unknown>, context: KBarContext, query = "") {
  if (command.visibility === "internal") return Number.NEGATIVE_INFINITY;
  if (!K_BAR_COMMAND_IDS.has(command.id) && !DOCUMENT_KBAR_COMMAND_IDS.has(command.id)) return Number.NEGATIVE_INFINITY;
  if (DOCUMENT_KBAR_COMMAND_IDS.has(command.id) && (context.activeArtifactType !== "document" || !context.activeArtifactId)) return Number.NEGATIVE_INFINITY;
  // A command named for what was typed outranks one that only mentions it.
  const score = Math.max(
    textScore(command.title, query) + (query ? 15 : 0),
    textScore(`${command.title} ${command.description} ${command.id}`, query),
  );
  if (score < 0) return Number.NEGATIVE_INFINITY;
  const surface = surfaceFor(context.pathname);
  let result = score + (command.priority === "essential" ? 8 : command.priority === "advanced" ? -2 : 3);
  result += surface ? CONTEXT_BOOSTS[command.id]?.[surface] ?? 0 : 0;
  if (command.id === "app.run.stop" && context.activeRunIds.length === 0) return Number.NEGATIVE_INFINITY;
  if (command.id === "app.follow.stop" && !context.followingAi) return Number.NEGATIVE_INFINITY;
  if ((command.id === "app.comments.open" || command.id === "app.comments.add") && !context.activeArtifactId)
    return Number.NEGATIVE_INFINITY;
  if (command.id === "app.chat.continue" && !context.activeThreadId) return Number.NEGATIVE_INFINITY;
  return result;
}

function commandEntry(command: Command<unknown>, context: KBarContext, query: string): KBarEntry | null {
  const score = rankKBarCommand(command, context, query);
  if (!Number.isFinite(score)) return null;
  const params = command.id === "app.comments.open" || command.id === "app.comments.add"
    ? { artifactId: context.activeArtifactId! }
    : command.id === "app.chat.continue"
      ? { threadId: context.activeThreadId! }
      : command.id === "app.run.stop"
        ? { runId: context.activeRunIds[0] }
        : command.id === "app.settings.toggle-continuation"
          ? { value: !context.continueCurrentConversation }
          : undefined;
  // A person cannot answer "Comma-separated node IDs". Commands that target
  // an item the palette cannot seed stay with the AI and the surfaces that
  // already hold the target; search results carry their own IDs.
  const seeded: Record<string, unknown> = params ?? {};
  if (
    (command.parameters ?? []).some(
      (parameter) => parameter.kind === "item" && seeded[parameter.name] === undefined,
    )
  )
    return null;
  return {
    id: `command:${command.id}`,
    command,
    label: command.id === "app.settings.toggle-continuation"
      ? context.continueCurrentConversation ? "Turn off conversation continuation" : "Turn on conversation continuation"
      : command.title,
    description: command.description,
    ...(params ? { params } : {}),
    score,
  };
}

function resultEntry(result: KBarSearchResult, command: Command<unknown>, query: string): KBarEntry {
  return {
    id: `${result.kind}:${result.id}`,
    command,
    label: result.title,
    description: result.subtitle ?? `Open ${result.kind} through the authorized Spectra path.`,
    params: result.params,
    contextLabel: result.kind[0]!.toUpperCase() + result.kind.slice(1),
    // Ranked results keep their order. Only a title match lifts a result above
    // commands: a loosely related work must not intercept "Analytics".
    score: 40 + Math.max(0, textScore(result.title, query)) - (result.rank ?? 0) * 0.5,
  };
}

export function buildKBarEntries(
  commands: readonly Command<unknown>[] = APP_COMMANDS,
  context: KBarContext,
  query = "",
  results: readonly KBarSearchResult[] = [],
): KBarEntry[] {
  const visibleCommands = context.activeArtifactType === "document" && context.activeArtifactId
    ? [...commands, ...DOCUMENT_KBAR_COMMANDS]
    : commands;
  const entries = visibleCommands
    .map((command) => commandEntry(command, context, query))
    .filter((entry): entry is KBarEntry => Boolean(entry));
  const workCommand = commands.find((command) => command.id === "app.work.open");
  const navigateCommand = commands.find((command) => command.id === "app.navigate");
  const threadCommand = commands.find((command) => command.id === "app.thread.open");
  for (const result of results) {
    const command = result.kind === "artifact" ? workCommand : result.kind === "workspace" ? navigateCommand : threadCommand;
    if (!command || command.visibility === "internal") continue;
    entries.push(resultEntry(result, command, query));
  }
  return entries
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, 36);
}

function workspaceResult(workspace: SpectraWorkspace): KBarSearchResult {
  return {
    id: workspace._id,
    kind: "workspace",
    title: workspace.title,
    subtitle: workspace.description ?? "Workspace",
    params: { destination: "workspace", targetId: workspace._id },
  };
}

/** The semantic layer finds work and chats; the bar opens them through registered commands. */
export const KBAR_SEMANTIC_KINDS = ["artifact", "thread"] as const satisfies readonly SemanticKind[];

/** Semantic results as command-bar results, in the layer's ranking order. */
export function semanticKBarResults(results: readonly SemanticResult[]): KBarSearchResult[] {
  return results.flatMap((result, index): KBarSearchResult[] => {
    if (result.kind === "artifact") {
      const region = regionOfResult(result);
      return [{
        id: result.itemId,
        kind: "artifact",
        title: result.title || "Untitled",
        subtitle: [result.typeLabel, result.location ?? result.snippet].filter(Boolean).join(" · "),
        params: { workId: result.itemId, surface: "panel", ...(region ? { region } : {}) },
        rank: index,
      }];
    }
    if (result.kind === "thread")
      return [{
        id: result.itemId,
        kind: "thread",
        title: result.title || "Untitled conversation",
        subtitle: result.snippet || "Conversation",
        params: { threadId: result.itemId },
        rank: index,
      }];
    return [];
  });
}

/** Workspaces have no semantic kind; the bar finds them by name through the authorized index. */
export async function searchKBarWorkspaces(query: string, signal?: AbortSignal): Promise<KBarSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const search = await searchSpectra(trimmed, { signal });
  return search.workspaces.map(workspaceResult);
}

/** One list without duplicates: semantic results first, then workspaces. */
export function mergeKBarResults(...lists: ReadonlyArray<readonly KBarSearchResult[]>): KBarSearchResult[] {
  const seen = new Set<string>();
  return lists.flat().filter((result) => {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function commandContextForKBar(context: KBarContext, dispatch: CommandContext["executeApplicationCommand"]): CommandContext {
  return {
    workType: "document",
    can: () => true,
    compatibilityProfile: "spectra-native",
    fidelity: { artifact: "NATIVE" },
    ...(context.activeArtifactId ? { artifactId: context.activeArtifactId } : {}),
    selection: { ids: [] },
    permissions: { role: "edit", editable: true },
    executeApplicationCommand: dispatch,
  };
}
