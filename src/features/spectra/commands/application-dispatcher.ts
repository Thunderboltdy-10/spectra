import type { SpectraPreferences } from "../settings/schema";
import { applyPreferencePatch } from "../settings/schema";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { DEVICES_HREF, loadBridgeStatusCache } from "../bridge/client";
import { runLocalDeviceAction } from "../devices/device-actions";
import { devicePairing } from "../devices/pairing";
import type { CommandEffectKind, CommandExecutionResult } from "./types";
import { aiSyncPurpose } from "../../../../shared/school-sync";

export type ApplicationCommandDispatcher = (
  commandId: string,
  params: unknown,
) => void | Promise<void | CommandExecutionResult>;

export type ApplicationCommandHost = {
  openArtifact: (artifactId: string, surface?: "full" | "panel" | "tile") => void | Promise<void | CommandExecutionResult["readiness"]>;
  navigate: (destination: "library" | "calendar" | "settings" | "workspace", targetId?: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  openRoute?: (href: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  openThread?: (threadId: string) => void | Promise<void | CommandExecutionResult["readiness"]>;
  addComment?: (input: {
    artifactId: string;
    body: string;
    regionId?: string;
  }) => void | Promise<void>;
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
      ? "failed"
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

function isCommandOutcome(value: unknown): value is SpectraCommandOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpectraCommandOutcome>;
  return (
    (candidate.status === "completed" ||
      candidate.status === "pending" ||
      candidate.status === "needs-human" ||
      candidate.status === "failed") &&
    typeof candidate.message === "string"
  );
}

function fromHandler(
  commandId: string,
  effect: CommandEffectKind,
  fallbackMessage: string,
  value: unknown,
  data?: unknown,
): CommandExecutionResult {
  if (!isCommandOutcome(value))
    return {
      commandId,
      effect,
      status: "failed",
      message: "The command handler did not confirm that the action completed.",
      ...(data === undefined ? {} : { data }),
    };
  return {
    commandId,
    effect,
    status: value.status,
    message: value.message,
    ...(value.readiness ? { readiness: value.readiness } : {}),
    ...(value.data === undefined && data === undefined
      ? {}
      : { data: value.data === undefined ? data : value.data }),
  };
}

async function dispatchSemantic<K extends keyof import("../events/contracts").SpectraCommands>(
  commandId: string,
  effect: CommandEffectKind,
  key: K,
  payload: import("../events/contracts").SpectraCommands[K],
  message: string,
  data?: unknown,
) {
  const result = await spectraBus.commandAsyncResults(key, payload);
  if (result.listeners === 0)
    throw new Error(`APPLICATION_COMMAND_HANDLER_UNAVAILABLE: ${String(key)}`);
  const explicit = [...result.results].reverse().find(isCommandOutcome);
  return fromHandler(commandId, effect, message, explicit, data);
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
  "app.devices.open": DEVICES_HREF,
} as const;

function routeFor(commandId: string) {
  return routeForMap[commandId as keyof typeof routeForMap];
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof value === "string")
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
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
        if (destination === "devices" && host.openRoute) {
          const readiness = readinessFrom(await host.openRoute(DEVICES_HREF));
          return completed(commandId, "navigate", "Devices opened.", readiness);
        }
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
      case "app.devices.open": {
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
        return dispatchSemantic(
          commandId,
          "open",
          "run.openConversation",
          { runId: threadId, threadId },
          "Conversation opened.",
          { threadId },
        );
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
        return dispatchSemantic(commandId, "mutate", "run.stopRequested", {
          ...(typeof params.runId === "string" && params.runId.trim() ? { runId: params.runId.trim() } : {}),
        }, "Stop requested. Committed work remains available.");
      }
      case "app.follow.stop": {
        return dispatchSemantic(commandId, "toggle", "follow.stopRequested", {}, "Follow mode stopped. Durable work continues.");
      }
      case "app.comments.open": {
        const artifactId = typeof params.artifactId === "string" ? params.artifactId.trim() : "";
        if (!artifactId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.comments.open requires artifactId");
        return dispatchSemantic(commandId, "open", "comments.open", { artifactId }, "Comments opened.", { artifactId });
      }
      case "app.comments.add": {
        const artifactId = typeof params.artifactId === "string" ? params.artifactId.trim() : "";
        const body = typeof params.body === "string" ? params.body.trim() : "";
        const regionId = typeof params.regionId === "string" ? params.regionId.trim() : undefined;
        if (!artifactId || !body) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.comments.add requires artifactId and body");
        const dispatched = await spectraBus.commandAsyncResults("comments.add", { artifactId, body, ...(regionId ? { regionId } : {}) });
        if (dispatched.listeners > 0) {
          const explicit = [...dispatched.results].reverse().find(isCommandOutcome);
          return fromHandler(commandId, "mutate", "Comment added.", explicit, { artifactId });
        }
        if (!host.addComment)
          throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: comments.add");
        await host.addComment({ artifactId, body, ...(regionId ? { regionId } : {}) });
        return completed(commandId, "mutate", "Comment added.", undefined, { artifactId });
      }
      case "app.library.import":
      case "app.workspace.import": {
        const kind = commandId === "app.library.import" ? "file" : "workspace";
        return dispatchSemantic(
          commandId,
          "open",
          "library.import",
          { kind },
          kind === "file" ? "Library import opened." : "Workspace import opened.",
        );
      }
      case "app.settings.toggle-continuation": {
        if (typeof params.value !== "boolean") throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.settings.toggle-continuation requires value");
        host.replacePreferences(applyPreferencePatch(host.preferences, { ai: { continueCurrentConversation: params.value } }));
        return completed(commandId, "toggle", params.value ? "New messages will continue the current conversation." : "New messages will start a new conversation.", undefined, { value: params.value });
      }
      case "app.work.reveal-anchor": {
        const anchor = objectRecord(params.anchor);
        if (typeof anchor.workId !== "string") throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.work.reveal-anchor requires anchor");
        return dispatchSemantic(commandId, "open", "work.revealAnchor", {
          anchor: anchor as never,
          focus: params.focus !== false,
        }, "Work anchor revealed.");
      }
      case "app.run.open-conversation": {
        if (typeof params.runId !== "string" || !params.runId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.run.open-conversation requires runId");
        return dispatchSemantic(commandId, "open", "run.openConversation", {
          runId: params.runId,
          ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
        }, "Conversation opened.");
      }
      case "app.reference.begin-picking": {
        if (typeof params.hostWorkId !== "string" || !params.hostWorkId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.reference.begin-picking requires hostWorkId");
        return dispatchSemantic(commandId, "select", "reference.beginPicking", { hostWorkId: params.hostWorkId }, "Reference picking started.");
      }
      case "app.settings.change":
      case "app.settings.manageAccount": {
        const dispatched = await spectraBus.commandAsyncResults("settings.change", {
          patch: objectRecord(params.patch),
          ...(typeof params.section === "string" ? { section: params.section } : {}),
        });
        if (dispatched.listeners > 0) {
          const explicit = [...dispatched.results].reverse().find(isCommandOutcome);
          return fromHandler(commandId, "mutate", "Settings changed.", explicit);
        }
        const next = applyPreferencePatch(host.preferences, objectRecord(params.patch));
        host.replacePreferences(next);
        const readiness = readinessFrom(await host.navigate("settings", typeof params.section === "string" ? params.section : undefined));
        return completed(commandId, "mutate", "Settings changed.", readiness);
      }
      case "app.sync.policy.change": {
        const targetIds = stringList(params.targetIds);
        const patch = objectRecord(params.patch);
        if (targetIds.length === 0) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.sync.policy.change requires targetIds");
        return dispatchSemantic(commandId, "mutate", "sync.policy.change", { targetIds, patch }, "Sync policy change requested.");
      }
      case "app.devices.pair": {
        // The page holds the Convex client that starts pairing; ask it to.
        devicePairing().want();
        const readiness = host.openRoute ? readinessFrom(await host.openRoute(DEVICES_HREF)) : undefined;
        return {
          commandId,
          effect: "mutate",
          status: "pending",
          message: "Connecting this computer. Confirm the code on the computer when it asks.",
          ...(readiness ? { readiness } : {}),
        };
      }
      case "app.devices.add-folder":
      case "app.devices.pause": {
        const paused = typeof params.paused === "boolean" ? params.paused : !loadBridgeStatusCache()?.paused;
        const outcome = await runLocalDeviceAction(
          commandId === "app.devices.add-folder"
            ? { action: "add_folder" }
            : { action: paused ? "pause_syncing" : "resume_syncing" },
        );
        return fromHandler(commandId, "mutate", outcome.message, outcome);
      }
      case "app.memory.write": {
        if (typeof params.content !== "string" || !params.content.trim())
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.memory.write requires content");
        return dispatchSemantic(commandId, "mutate", "memory.write", {
          action: params.action === "revise" ? "revise" : "create",
          content: params.content.trim(),
          ...(typeof params.memoryId === "string" ? { memoryId: params.memoryId } : {}),
        }, "Memory update requested.");
      }
      case "app.sharing.change": {
        const resourceType = params.resourceType;
        const action = params.action;
        if ((resourceType !== "workspace" && resourceType !== "artifact" && resourceType !== "agent") ||
            (action !== "invite" && action !== "change_level" && action !== "revoke") ||
            typeof params.resourceId !== "string" || !params.resourceId.trim())
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.sharing.change requires resourceType, resourceId and action");
        return dispatchSemantic(commandId, "mutate", "sharing.change", {
          resourceType,
          resourceId: params.resourceId,
          action,
          ...(typeof params.subjectId === "string" ? { subjectId: params.subjectId } : {}),
          ...(typeof params.invitationId === "string" ? { invitationId: params.invitationId } : {}),
          ...(typeof params.grantId === "string" ? { grantId: params.grantId } : {}),
          ...(params.level === "modify" || params.level === "read" ? { level: params.level } : {}),
        }, "Sharing change requested.");
      }
      case "app.managebac.sync": {
        return dispatchSemantic(commandId, "mutate", "managebac.sync", { purpose: aiSyncPurpose(params.purpose) }, "ManageBac sync requested.");
      }
      case "app.managebac.select-classes": {
        const recordIds = stringList(params.recordIds).slice(0, 100);
        return dispatchSemantic(commandId, "mutate", "managebac.selectClasses", {
          recordIds,
          ...(typeof params.expectedRevision === "number" ? { expectedRevision: params.expectedRevision } : {}),
          ...(params.retention === "archive_projection" || params.retention === "keep_in_spectra" ? { retention: params.retention } : {}),
        }, "ManageBac class selection requested.");
      }
      case "app.managebac.import-resource": {
        const sourceRecordId = typeof params.sourceRecordId === "string" ? params.sourceRecordId.trim() : "";
        if (!sourceRecordId)
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.managebac.import-resource requires sourceRecordId");
        return dispatchSemantic(commandId, "mutate", "managebac.importResource", {
          sourceRecordId,
          ...(params.refresh === true ? { refresh: true } : {}),
          ...(typeof params.requestKey === "string" && params.requestKey.trim() ? { requestKey: params.requestKey.trim() } : {}),
        }, "ManageBac resource import requested.");
      }
      case "app.settings.manage-account": {
        const readiness = readinessFrom(await host.navigate("settings", "account"));
        return completed(commandId, "navigate", "Account settings opened.", readiness);
      }
      case "app.settings.clear-compute-cache": {
        return dispatchSemantic(commandId, "mutate", "settings.clearLocalComputeCache", {}, "Local compute cache clear requested.");
      }
      case "app.reference.insert": {
        const hostWorkId = typeof params.hostWorkId === "string" ? params.hostWorkId.trim() : "";
        const target = objectRecord(params.target);
        if (!hostWorkId || typeof target.workId !== "string") {
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.reference.insert requires hostWorkId and target");
        }
        return dispatchSemantic(commandId, "mutate", "reference.insert", {
          hostWorkId,
          target: target as never,
        }, "Reference inserted.");
      }
      case "app.library.organize": {
        const dispatched = await spectraBus.commandAsyncResults("library.organize", {
          action: params.action === "create_folder" || params.action === "rename" || params.action === "move" || params.action === "link" ? params.action : "create_folder",
          targetIds: stringList(params.targetIds),
          ...(typeof params.destinationId === "string" ? { destinationId: params.destinationId } : {}),
          ...(typeof params.name === "string" ? { name: params.name } : {}),
        });
        if (dispatched.listeners === 0) {
          if (!host.organizeLibrary) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: app.library.organize");
          await host.organizeLibrary({
            action: params.action === "create_folder" || params.action === "rename" || params.action === "move" || params.action === "link" ? params.action : "create_folder",
            targetIds: stringList(params.targetIds),
            ...(typeof params.destinationId === "string" ? { destinationId: params.destinationId } : {}),
            ...(typeof params.name === "string" ? { name: params.name } : {}),
          });
          return completed(commandId, "mutate", "Library organization completed.");
        }
        const explicit = [...dispatched.results].reverse().find(isCommandOutcome);
        return fromHandler(commandId, "mutate", "Library organization completed.", explicit);
      }
      case "app.library.delete": {
        const targetIds = stringList(params.targetIds);
        const dispatched = await spectraBus.commandAsyncResults("library.delete", { targetIds });
        if (dispatched.listeners === 0) {
          if (!host.deleteLibraryItems) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: app.library.delete");
          await host.deleteLibraryItems(targetIds);
          return completed(commandId, "mutate", "Library deletion completed.");
        }
        const explicit = [...dispatched.results].reverse().find(isCommandOutcome);
        return fromHandler(commandId, "mutate", "Library deletion completed.", explicit);
      }
      default:
        throw new Error(`APPLICATION_COMMAND_UNSUPPORTED: ${commandId}`);
    }
  };
}
