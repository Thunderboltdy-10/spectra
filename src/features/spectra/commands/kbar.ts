import { getSpectraThreads, searchSpectra, type SpectraThread } from "../data/api";
import type { SpectraArtifact, SpectraWorkspace } from "../data/api";
import { APP_COMMANDS } from "./app-registry";
import type { Command, CommandContext } from "./types";

export type KBarContext = {
  pathname: string;
  activeArtifactId?: string;
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
};

const CONTEXT_BOOSTS: Record<string, Partial<Record<"settings" | "artifact" | "chat" | "library" | "workspace", number>>> = {
  "app.settings.toggle-continuation": { settings: 35, chat: 20 },
  "app.bridge.open-settings": { settings: 28 },
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
  "app.bridge.pair": { settings: 34 },
  "app.bridge.setup": { settings: 30 },
  "app.bridge.policy.change": { settings: 26 },
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
  "app.bridge.pair",
  "app.bridge.setup",
  "app.bridge.policy.change",
  "app.settings.toggle-continuation",
  "app.settings.manage-account",
  "app.settings.clear-compute-cache",
  "app.bridge.open-settings",
  // These two are result-only entries, populated by the authorized search.
  "app.navigate",
  "app.work.open",
]);

function surfaceFor(pathname: string): keyof (typeof CONTEXT_BOOSTS)[string] | undefined {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/chat")) return "chat";
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
  if (!K_BAR_COMMAND_IDS.has(command.id)) return Number.NEGATIVE_INFINITY;
  const score = textScore(`${command.title} ${command.description} ${command.id}`, query);
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
    score: 100 + textScore(`${result.title} ${result.subtitle ?? ""}`, query),
  };
}

export function buildKBarEntries(
  commands: readonly Command<unknown>[] = APP_COMMANDS,
  context: KBarContext,
  query = "",
  results: readonly KBarSearchResult[] = [],
): KBarEntry[] {
  const entries = commands
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

function artifactResult(artifact: SpectraArtifact): KBarSearchResult {
  return {
    id: artifact._id,
    kind: "artifact",
    title: artifact.title,
    subtitle: artifact.summary ?? artifact.blueprintKey,
    params: { workId: artifact._id, surface: "panel" },
  };
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

function threadResult(thread: SpectraThread): KBarSearchResult {
  return {
    id: thread._id,
    kind: "thread",
    title: thread.title || "Untitled conversation",
    subtitle: thread.summaryShort ?? thread.previewText ?? "Conversation",
    params: { threadId: thread._id },
  };
}

function dedupeResults(results: KBarSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Search only compact, authorized indexes. This deliberately never calls a
 * thread/artifact detail endpoint: selecting a result is what mounts content.
 */
export async function searchAuthorizedKBar(query: string, signal?: AbortSignal): Promise<KBarSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const [search, firstThreads] = await Promise.all([
    searchSpectra(trimmed, { signal }),
    getSpectraThreads({ limit: 40, force: true, signal }),
  ]);
  const threads = [...firstThreads.threads];
  let cursor = firstThreads.nextCursor;
  let pages = 1;
  while (firstThreads.hasMore && cursor && pages < 8) {
    const page = await getSpectraThreads({ limit: 40, cursor, force: true, signal });
    threads.push(...page.threads);
    cursor = page.nextCursor;
    pages += 1;
    if (!page.hasMore) break;
  }
  const queryLower = trimmed.toLocaleLowerCase();
  const matchingThreads = threads.filter((thread) =>
    `${thread.title} ${thread.summaryShort ?? ""} ${thread.previewText ?? ""}`.toLocaleLowerCase().includes(queryLower),
  );
  return dedupeResults([
    ...search.artifacts.map(artifactResult),
    ...search.workspaces.map(workspaceResult),
    ...matchingThreads.map(threadResult),
  ]);
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
