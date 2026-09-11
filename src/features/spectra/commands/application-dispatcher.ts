import type { SpectraPreferences } from "../settings/schema";
import { applyPreferencePatch } from "../settings/schema";
import { spectraBus } from "../events";
import type { CommandEffectKind, CommandExecutionResult } from "./types";

export type ApplicationCommandDispatcher = (
  commandId: string,
  params: unknown,
) => void | Promise<void | CommandExecutionResult>;

export type ApplicationCommandHost = {
  openArtifact: (artifactId: string, surface?: "full" | "panel" | "tile") => void | Promise<void | CommandExecutionResult["readiness"]>;
  navigate: (destination: "library" | "calendar" | "settings" | "workspace", targetId?: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  openRoute?: (href: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  openThread?: (threadId: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  replacePreferences: (next: SpectraPreferences) => void;
  preferences: SpectraPreferences;
  organizeLibrary?: (input: {
    action: "create_folder" | "rename" | "move" | "link";
    targetIds: string[];
    destinationId?: string;
    name?: string;
  }) => void | Promise<void>;
  deleteLibraryItems?: (targetIds: string[]) => void | Promise<void>;
};

function completed(
  commandId: string,
  effect: CommandEffectKind,
  message: string,
  readiness?: CommandExecutionResult["readiness"],
  data?: unknown,
): CommandExecutionResult {
  const status = readiness?.status === "failed"
    ? "failed"
    : readiness?.status === "cancelled"
      ? "cancelled"
      : "completed";
  return {
    commandId,
    effect,
    status,
    message: readiness?.reason ?? message,
    ...(readiness ? { readiness } : {}),
    ...(data === undefined ? {} : { data }),
  };
}

function readinessFrom(value: CommandExecutionResult["readiness"] | void) {
  return value && typeof value === "object" && "status" in value ? value : undefined;
}

const routeForMap = {
  "app.page.chat": "/chat?new=1",
  "app.page.workspace": "/workspace?home=1",
  "app.page.library": "/library",
  "app.page.calendar": "/calendar",
  "app.page.settings": "/settings",
  "app.page.agents": "/agents",
  "app.page.school": "/school",
  "app.page.analytics": "/analytics",
  "app.chat.new": "/chat?new=1",
  "app.bridge.open-settings": "/settings?section=devices",
} as const;

function routeFor(commandId: string) {
  return routeForMap[commandId as keyof typeof routeForMap];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * The only client-side adapter for app commands. Artifact commands remain in
 * the artifact registry; product commands cross this boundary and then use
 * the existing shell/bus path. Unsupported mutations fail loudly so a command
 * cannot report success without a real host.
 */
export function createApplicationCommandDispatcher(host: ApplicationCommandHost): ApplicationCommandDispatcher {
  return async (commandId, rawParams) => {
    const params = objectRecord(rawParams);
    // Unregistered aliases collapse onto IR ids. Callers may still pass the
    // old names; the switch below only sees registered commands.
    if (commandId === "app.work.openLibrary") {
      commandId = "app.navigate";
      params.destination = "library";
    } else if (commandId === "app.work.openWorkspace") {
      commandId = "app.navigate";
      params.destination = "workspace";
      if (typeof params.targetId !== "string" && typeof params.workspaceId === "string") {
        params.targetId = params.workspaceId;
      }
    }
    switch (commandId) {
      case "app.navigate": {
        const destination = params.destination;
        const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
        if (destination === "artifact") {
          if (!targetId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.navigate requires targetId for artifacts");
          const readiness = readinessFrom(await host.openArtifact(targetId, "panel"));
          return completed(commandId, "open", "Work opened.", readiness, { targetId });
        }
        if (destination !== "library" && destination !== "calendar" && destination !== "settings" && destination !== "workspace")
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.navigate requires a registered destination");
        const readiness = readinessFrom(await host.navigate(destination, targetId));
        return completed(commandId, "navigate", `${destination[0]!.toUpperCase()}${destination.slice(1)} opened.`, readiness);
      }
      case "app.work.open": {
        const workId = typeof params.workId === "string" ? params.workId.trim() : "";
        if (!workId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.work.open requires workId");
        const readiness = readinessFrom(await host.openArtifact(workId, params.surface === "tile" || params.surface === "full" || params.surface === "panel" ? params.surface : "panel"));
        return completed(commandId, "open", "Work opened.", readiness, { workId });
      }
      case "app.calendar.open": {
        const readiness = readinessFrom(await host.navigate("calendar"));
        return completed(commandId, "navigate", "Calendar opened.", readiness);
      }
      case "app.page.chat":
      case "app.page.workspace":
      case "app.page.library":
      case "app.page.calendar":
      case "app.page.settings":
      case "app.page.agents":
      case "app.page.school":
      case "app.page.analytics":
      case "app.chat.new":
      case "app.bridge.open-settings": {
        const href = routeFor(commandId);
        if (!href || !host.openRoute)
          throw new Error(`APPLICATION_COMMAND_HANDLER_UNAVAILABLE: ${commandId}`);
        const readiness = readinessFrom(await host.openRoute(href));
        return completed(commandId, "navigate", "Page opened.", readiness, { href });
      }
      case "app.thread.open": {
        const threadId = typeof params.threadId === "string" ? params.threadId.trim() : "";
        if (!threadId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.thread.open requires threadId");
        if (host.openThread) {
          const readiness = readinessFrom(await host.openThread(threadId));
          return completed(commandId, "open", "Conversation opened.", readiness, { threadId });
        }
        const listeners = await spectraBus.commandAsync("run.openConversation", { runId: threadId, threadId });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: run.openConversation");
        return completed(commandId, "open", "Conversation opened.", undefined, { threadId });
      }
      case "app.chat.continue": {
        const threadId = typeof params.threadId === "string" ? params.threadId.trim() : "";
        if (threadId && host.openRoute) {
          const readiness = readinessFrom(await host.openRoute(`/chat?threadId=${encodeURIComponent(threadId)}`));
          return completed(commandId, "navigate", "Continuing the current conversation.", readiness, { threadId });
        }
        return completed(commandId, "toggle", "The current conversation remains the continuation target.");
      }
      case "app.run.stop": {
        const listeners = await spectraBus.commandAsync("run.stopRequested", {
          ...(typeof params.runId === "string" && params.runId.trim() ? { runId: params.runId.trim() } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: run.stopRequested");
        return completed(commandId, "mutate", "Stop requested. Committed work remains available.");
      }
      case "app.follow.stop": {
        const listeners = await spectraBus.commandAsync("follow.stopRequested", {});
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: follow.stopRequested");
        return completed(commandId, "toggle", "Follow mode stopped. Durable work continues.");
      }
      case "app.comments.open": {
        const artifactId = typeof params.artifactId === "string" ? params.artifactId.trim() : "";
        if (!artifactId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.comments.open requires artifactId");
        const listeners = await spectraBus.commandAsync("comments.open", { artifactId });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: comments.open");
        return completed(commandId, "open", "Comments opened.", undefined, { artifactId });
      }
      case "app.comments.add": {
        const artifactId = typeof params.artifactId === "string" ? params.artifactId.trim() : "";
        const body = typeof params.body === "string" ? params.body.trim() : "";
        const regionId = typeof params.regionId === "string" ? params.regionId.trim() : undefined;
        if (!artifactId || !body) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.comments.add requires artifactId and body");
        const listeners = await spectraBus.commandAsync("comments.add", { artifactId, body, ...(regionId ? { regionId } : {}) });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: comments.add");
        return completed(commandId, "mutate", "Comment added.", undefined, { artifactId });
      }
      case "app.library.import":
      case "app.workspace.import": {
        const kind = commandId === "app.library.import" ? "file" : "workspace";
        const listeners = await spectraBus.commandAsync("library.import", { kind });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: library.import");
        return completed(commandId, "open", kind === "file" ? "Library import opened." : "Workspace import opened.");
      }
      case "app.settings.toggle-continuation": {
        if (typeof params.value !== "boolean") throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.settings.toggle-continuation requires value");
        host.replacePreferences(applyPreferencePatch(host.preferences, { ai: { continueCurrentConversation: params.value } }));
        return completed(commandId, "toggle", params.value ? "New messages will continue the current conversation." : "New messages will start a new conversation.", undefined, { value: params.value });
      }
      case "app.work.reveal-anchor": {
        const anchor = objectRecord(params.anchor);
        if (typeof anchor.workId !== "string") throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.work.reveal-anchor requires anchor");
        const listeners = await spectraBus.commandAsync("work.revealAnchor", {
          anchor: anchor as never,
          focus: params.focus !== false,
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: work.revealAnchor");
        return completed(commandId, "open", "Work anchor revealed.");
      }
      case "app.run.open-conversation": {
        if (typeof params.runId !== "string" || !params.runId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.run.open-conversation requires runId");
        const listeners = await spectraBus.commandAsync("run.openConversation", {
          runId: params.runId,
          ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: run.openConversation");
        return completed(commandId, "open", "Conversation opened.");
      }
      case "app.reference.begin-picking": {
        if (typeof params.hostWorkId !== "string" || !params.hostWorkId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.reference.begin-picking requires hostWorkId");
        const listeners = await spectraBus.commandAsync("reference.beginPicking", { hostWorkId: params.hostWorkId });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: reference.beginPicking");
        return completed(commandId, "select", "Reference picking started.");
      }
      case "app.context.begin-picking": {
        const listeners = await spectraBus.commandAsync("context.beginPicking", {
          source: params.source === "composer" ? "composer" : "quick_chat",
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: context.beginPicking");
        return completed(commandId, "select", "Context picking started.");
      }
      case "app.settings.change":
      case "app.settings.manageAccount": {
        const listeners = await spectraBus.commandAsync("settings.change", {
          patch: objectRecord(params.patch),
          ...(typeof params.section === "string" ? { section: params.section } : {}),
        });
        if (listeners > 0) return completed(commandId, "mutate", "Settings changed.");
        const next = applyPreferencePatch(host.preferences, params.patch);
        host.replacePreferences(next);
        const readiness = readinessFrom(await host.navigate("settings", typeof params.section === "string" ? params.section : undefined));
        return completed(commandId, "mutate", "Settings changed.", readiness);
      }
      case "app.sync.policy.change": {
        const targetIds = Array.isArray(params.targetIds)
          ? params.targetIds.filter((value): value is string => typeof value === "string")
          : [];
        const patch = objectRecord(params.patch);
        if (targetIds.length === 0) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.sync.policy.change requires targetIds");
        const listeners = await spectraBus.commandAsync("sync.policy.change", { targetIds, patch });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: sync.policy.change");
        return completed(commandId, "mutate", "Sync policy change requested.");
      }
      case "app.bridge.pair":
      case "app.bridge.setup":
      case "app.bridge.policy.change": {
        const action =
          commandId === "app.bridge.pair"
            ? "pair"
            : commandId === "app.bridge.policy.change"
              ? "policy"
              : typeof params.action === "string"
                ? params.action
                : "pair";
        if (commandId === "app.bridge.policy.change") {
          if (
            params.preset !== "managed-copy" &&
            params.preset !== "native-sync" &&
            params.preset !== "advanced"
          ) {
            throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.bridge.policy.change requires preset");
          }
          const listeners = await spectraBus.commandAsync("bridge.policy.change", {
            preset: params.preset,
          });
          if (listeners === 0) host.navigate("settings", "devices");
          return;
        }
        if (action !== "pair" && action !== "select-location" && action !== "retry-connection" && action !== "retry-folder")
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.bridge.setup requires a supported action");
        if (action === "retry-folder" && (typeof params.grantId !== "string" || !params.grantId.trim()))
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.bridge.setup retry-folder requires grantId");
        const listeners = await spectraBus.commandAsync("bridge.setup", {
          action,
          ...(typeof params.grantId === "string" ? { grantId: params.grantId } : {}),
        });
        if (listeners === 0) host.navigate("settings", "devices");
        return;
      }
      case "app.memory.write": {
        if (typeof params.content !== "string" || !params.content.trim())
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.memory.write requires content");
        const listeners = await spectraBus.commandAsync("memory.write", {
          action: params.action === "revise" ? "revise" : "create",
          content: params.content.trim(),
          ...(typeof params.memoryId === "string" ? { memoryId: params.memoryId } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: memory.write");
        return completed(commandId, "mutate", "Memory update requested.");
      }
      case "app.sharing.change": {
        const resourceType = params.resourceType;
        const action = params.action;
        if ((resourceType !== "workspace" && resourceType !== "artifact" && resourceType !== "agent") ||
            (action !== "invite" && action !== "change_level" && action !== "revoke") ||
            typeof params.resourceId !== "string" || !params.resourceId.trim())
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.sharing.change requires resourceType, resourceId and action");
        const listeners = await spectraBus.commandAsync("sharing.change", {
          resourceType,
          resourceId: params.resourceId,
          action,
          ...(typeof params.subjectId === "string" ? { subjectId: params.subjectId } : {}),
          ...(typeof params.invitationId === "string" ? { invitationId: params.invitationId } : {}),
          ...(typeof params.grantId === "string" ? { grantId: params.grantId } : {}),
          ...(params.level === "modify" || params.level === "read" ? { level: params.level } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: sharing.change");
        return completed(commandId, "mutate", "Sharing change requested.");
      }
      case "app.managebac.sync": {
        const purpose = params.purpose === "class_resources" || params.purpose === "timetable" || params.purpose === "classes" || params.purpose === "cas" || params.purpose === "upcoming_deadlines"
          ? params.purpose
          : "upcoming_deadlines";
        const listeners = await spectraBus.commandAsync("managebac.sync", { purpose });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: managebac.sync");
        return completed(commandId, "mutate", "ManageBac sync requested.");
      }
      case "app.managebac.select-classes": {
        const recordIds = Array.isArray(params.recordIds)
          ? params.recordIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 100)
          : [];
        const listeners = await spectraBus.commandAsync("managebac.selectClasses", {
          recordIds,
          ...(typeof params.expectedRevision === "number" ? { expectedRevision: params.expectedRevision } : {}),
          ...(params.retention === "archive_projection" || params.retention === "keep_in_spectra" ? { retention: params.retention } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: managebac.selectClasses");
        return;
      }
      case "app.settings.manage-account": {
        const readiness = readinessFrom(await host.navigate("settings", "account"));
        return completed(commandId, "navigate", "Account settings opened.", readiness);
      }
      case "app.settings.clear-compute-cache": {
        const listeners = await spectraBus.commandAsync("settings.clearLocalComputeCache", {});
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: settings.clearLocalComputeCache");
        return completed(commandId, "mutate", "Local compute cache clear requested.");
      }
      case "app.reference.insert": {
        const hostWorkId = typeof params.hostWorkId === "string" ? params.hostWorkId.trim() : "";
        const target = objectRecord(params.target);
        if (!hostWorkId || typeof target.workId !== "string") {
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.reference.insert requires hostWorkId and target");
        }
        const listeners = await spectraBus.commandAsync("reference.insert", {
          hostWorkId,
          target: target as never,
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: reference.insert");
        return completed(commandId, "mutate", "Reference inserted.");
      }
      case "app.library.organize": {
        const listeners = await spectraBus.commandAsync("library.organize", {
          action: params.action === "create_folder" || params.action === "rename" || params.action === "move" || params.action === "link" ? params.action : "create_folder",
          targetIds: Array.isArray(params.targetIds) ? params.targetIds.filter((value): value is string => typeof value === "string") : [],
          ...(typeof params.destinationId === "string" ? { destinationId: params.destinationId } : {}),
          ...(typeof params.name === "string" ? { name: params.name } : {}),
        });
        if (listeners === 0) {
          if (!host.organizeLibrary) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: app.library.organize");
          await host.organizeLibrary({
            action: params.action === "create_folder" || params.action === "rename" || params.action === "move" || params.action === "link" ? params.action : "create_folder",
            targetIds: Array.isArray(params.targetIds) ? params.targetIds.filter((value): value is string => typeof value === "string") : [],
            ...(typeof params.destinationId === "string" ? { destinationId: params.destinationId } : {}),
            ...(typeof params.name === "string" ? { name: params.name } : {}),
          });
        }
        return completed(commandId, "mutate", "Library organization requested.");
      }
      case "app.library.delete": {
        const targetIds = Array.isArray(params.targetIds) ? params.targetIds.filter((value): value is string => typeof value === "string") : [];
        const listeners = await spectraBus.commandAsync("library.delete", { targetIds });
        if (listeners === 0) {
          if (!host.deleteLibraryItems) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: app.library.delete");
          await host.deleteLibraryItems(targetIds);
        }
        return completed(commandId, "mutate", "Library deletion requested.");
      }
      default:
        throw new Error(`APPLICATION_COMMAND_UNSUPPORTED: ${commandId}`);
    }
  };
}
