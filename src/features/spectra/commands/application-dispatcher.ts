import type { SpectraPreferences } from "../settings/schema";
import { applyPreferencePatch } from "../settings/schema";
import { spectraBus } from "../events";

export type ApplicationCommandDispatcher = (
  commandId: string,
  params: unknown,
) => void | Promise<void>;

export type ApplicationCommandHost = {
  openArtifact: (artifactId: string, surface?: "full" | "panel" | "tile") => void | Promise<void>;
  navigate: (destination: "library" | "calendar" | "settings" | "workspace", targetId?: string) => void;
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
          await host.openArtifact(targetId, "panel");
          return;
        }
        if (destination !== "library" && destination !== "calendar" && destination !== "settings" && destination !== "workspace")
          throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.navigate requires a registered destination");
        host.navigate(destination, targetId);
        return;
      }
      case "app.work.open": {
        const workId = typeof params.workId === "string" ? params.workId.trim() : "";
        if (!workId) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.work.open requires workId");
        await host.openArtifact(workId, params.surface === "tile" || params.surface === "full" || params.surface === "panel" ? params.surface : "panel");
        return;
      }
      case "app.calendar.open":
        host.navigate("calendar");
        return;
      case "app.work.reveal-anchor": {
        const anchor = objectRecord(params.anchor);
        if (typeof anchor.workId !== "string") throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.work.reveal-anchor requires anchor");
        const listeners = await spectraBus.commandAsync("work.revealAnchor", {
          anchor: anchor as never,
          focus: params.focus !== false,
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: work.revealAnchor");
        return;
      }
      case "app.run.open-conversation": {
        if (typeof params.runId !== "string" || !params.runId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.run.open-conversation requires runId");
        const listeners = await spectraBus.commandAsync("run.openConversation", {
          runId: params.runId,
          ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: run.openConversation");
        return;
      }
      case "app.reference.begin-picking": {
        if (typeof params.hostWorkId !== "string" || !params.hostWorkId.trim()) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.reference.begin-picking requires hostWorkId");
        const listeners = await spectraBus.commandAsync("reference.beginPicking", { hostWorkId: params.hostWorkId });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: reference.beginPicking");
        return;
      }
      case "app.context.begin-picking": {
        const listeners = await spectraBus.commandAsync("context.beginPicking", {
          source: params.source === "composer" ? "composer" : "quick_chat",
        });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: context.beginPicking");
        return;
      }
      case "app.settings.change":
      case "app.settings.manageAccount": {
        const listeners = await spectraBus.commandAsync("settings.change", {
          patch: objectRecord(params.patch),
          ...(typeof params.section === "string" ? { section: params.section } : {}),
        });
        if (listeners > 0) return;
        const next = applyPreferencePatch(host.preferences, params.patch);
        host.replacePreferences(next);
        host.navigate("settings", typeof params.section === "string" ? params.section : undefined);
        return;
      }
      case "app.sync.policy.change": {
        const targetIds = Array.isArray(params.targetIds)
          ? params.targetIds.filter((value): value is string => typeof value === "string")
          : [];
        const patch = objectRecord(params.patch);
        if (targetIds.length === 0) throw new Error("APPLICATION_COMMAND_INVALID_PARAMS: app.sync.policy.change requires targetIds");
        const listeners = await spectraBus.commandAsync("sync.policy.change", { targetIds, patch });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: sync.policy.change");
        return;
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
        return;
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
        return;
      }
      case "app.managebac.sync": {
        const purpose = params.purpose === "class_resources" || params.purpose === "timetable" || params.purpose === "classes" || params.purpose === "cas"
          ? params.purpose
          : "upcoming_deadlines";
        const listeners = await spectraBus.commandAsync("managebac.sync", { purpose });
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: managebac.sync");
        return;
      }
      case "app.settings.manage-account": {
        host.navigate("settings", "account");
        return;
      }
      case "app.settings.clear-compute-cache": {
        const listeners = await spectraBus.commandAsync("settings.clearLocalComputeCache", {});
        if (listeners === 0) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: settings.clearLocalComputeCache");
        return;
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
        return;
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
        return;
      }
      case "app.library.delete": {
        const targetIds = Array.isArray(params.targetIds) ? params.targetIds.filter((value): value is string => typeof value === "string") : [];
        const listeners = await spectraBus.commandAsync("library.delete", { targetIds });
        if (listeners === 0) {
          if (!host.deleteLibraryItems) throw new Error("APPLICATION_COMMAND_HANDLER_UNAVAILABLE: app.library.delete");
          await host.deleteLibraryItems(targetIds);
        }
        return;
      }
      default:
        throw new Error(`APPLICATION_COMMAND_UNSUPPORTED: ${commandId}`);
    }
  };
}
