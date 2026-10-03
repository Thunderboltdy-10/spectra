import { patchTouchesAiPermissions } from "../../../settings/schema/ai-permissions";
import { normalizeAiPreferencePatch, preferenceLayerValuesSchema } from "../../../settings/schema/preferences";
import type { CommandResult } from "../backend";
import { ToolInputError, type AnyHarnessTool, type HarnessTool, type PermissionCategory, type ToolEffect, type ToolOutcome } from "../types";
import {
  oneOf,
  optionalNumber,
  optionalString,
  plural,
  requireString,
  titled,
  type HarnessSession,
} from "./shared";

/*
 * Application tools. Each maps to one registered application command, so the
 * AI changes Spectra through the same server path as the user's own controls.
 * The effect decides permission: ordinary writes run (and are undoable);
 * settings, sharing, ManageBac and desktop-file effects ask first.
 */

type CommandTool<A> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  effect: ToolEffect;
  category?: PermissionCategory;
  label: (args: A) => string;
  doneLabel: (args: A) => string;
  question?: (args: A) => string;
  parse: (raw: Record<string, unknown>) => A;
  command: (args: A) => { command: string; args: Record<string, unknown> };
  after?: (args: A, result: CommandResult) => Partial<ToolOutcome>;
};

function commandTool<A>(session: HarnessSession, spec: CommandTool<A>): HarnessTool<A> {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    effect: spec.effect,
    ...(spec.category ? { category: () => spec.category } : {}),
    label: spec.label,
    ...(spec.question ? { question: spec.question } : {}),
    parse: spec.parse,
    stage: async (args, ctx) => {
      await session.backend.stageCommand?.(
        { ...spec.command(args), toolCallId: ctx.toolCallId, approved: false },
        ctx.signal,
      );
    },
    execute: async (args, ctx) => {
      const request = spec.command(args);
      const result = await session.backend.runCommand(
        { ...request, toolCallId: ctx.toolCallId, approved: Boolean(ctx.approved) },
        ctx.signal,
      );
      if (result.pause) return { ok: false, content: "", pause: result.pause };
      return {
        ok: result.ok,
        content: result.content,
        ...(result.uiEvents?.length ? { uiEvents: result.uiEvents } : {}),
        ...(result.ok ? { doneLabel: spec.doneLabel(args) } : {}),
        ...(result.ok ? spec.after?.(args, result) : {}),
      };
    },
  };
}

function stringList(raw: Record<string, unknown>, key: string, max = 100) {
  const value = raw[key];
  if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== "string" || !entry.trim()))
    throw new ToolInputError(`${key} must be a non-empty list of ids.`);
  if (value.length > max) throw new ToolInputError(`${key} holds at most ${max} ids.`);
  return value.map((entry: string) => entry.trim());
}

/** "appearance theme: dark; ai research depth: deep" */
export function describePatch(patch: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const name = `${prefix}${prefix ? " " : ""}${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
    if (value && typeof value === "object" && !Array.isArray(value)) return describePatch(value as Record<string, unknown>, name);
    return [`${name}: ${Array.isArray(value) ? value.join(", ") : String(value).replace(/_/g, " ")}`];
  });
}

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;

function localTime(raw: Record<string, unknown>, key: string, required: boolean) {
  const value = optionalString(raw, key, 40);
  if (!value) {
    if (required) throw new ToolInputError(`${key} is required, as YYYY-MM-DDTHH:mm in the user's time zone.`);
    return undefined;
  }
  if (!LOCAL_TIME.test(value)) throw new ToolInputError(`${key} must be YYYY-MM-DDTHH:mm (or YYYY-MM-DD for all day), in the user's time zone.`);
  return value.length === 10 ? `${value}T00:00` : value;
}

export function appTools(session: HarnessSession): AnyHarnessTool[] {
  const timeZone = session.backend.timeZone;
  const tools = [
    commandTool(session, {
      name: "change_settings",
      description:
        "Change the user's Spectra settings. patch uses the real sections: appearance {theme: light|dark|system, density: comfortable|compact, editorTextScale, contrast, reducedMotion}, general {startPage, dateFormat, timeFormat, locale}, ai {researchDepth, showLiveDockProgress, autoRouteSpecialists}, writing {smartCompletion, sensitivity}, notifications, privacy, accessibility. AI permissions are not settable here: only the user changes those, in Settings. The user approves each change unless they allowed settings changes.",
      parameters: {
        type: "object",
        properties: { patch: { type: "object", additionalProperties: true } },
        required: ["patch"],
        additionalProperties: false,
      },
      effect: "settings",
      category: "settings",
      label: () => "Changing your settings",
      doneLabel: () => "Changed your settings",
      question: (args: { patch: Record<string, unknown> }) => `Change your settings: ${describePatch(args.patch).join("; ")}?`,
      parse: (raw) => {
        const patch = normalizeAiPreferencePatch(raw.patch);
        if (patchTouchesAiPermissions(raw.patch) || patchTouchesAiPermissions(patch))
          throw new ToolInputError("Spectra cannot change its own permissions. Tell the user they can change them in Settings.");
        const parsed = preferenceLayerValuesSchema.safeParse(patch);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new ToolInputError(`patch${issue?.path?.length ? `.${issue.path.join(".")}` : ""}: ${issue?.message ?? "is not a valid settings change"}.`);
        }
        if (!Object.keys(patch).length) throw new ToolInputError("patch is empty or uses settings that do not exist.");
        return { patch };
      },
      command: (args) => ({ command: "change_spectra_settings", args: { patch: args.patch } }),
    }),
    commandTool(session, {
      name: "calendar",
      description: `Change the user's calendar. action add_event: a personal event {title, start, end?, allDay?, notes?}. action schedule_task: a work block for a planner task {taskId (the task's artifact id), start, end}. action move_block {itemId, start, end?, expectedRevision} and resize_block {itemId, end, expectedRevision} for work blocks from read_calendar. Times are YYYY-MM-DDTHH:mm in the user's time zone (${timeZone}). Official school deadlines cannot be moved.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add_event", "schedule_task", "move_block", "resize_block"] },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          allDay: { type: "boolean" },
          notes: { type: "string" },
          taskId: { type: "string" },
          itemId: { type: "string" },
          expectedRevision: { type: "number" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { action: string; title?: string }) =>
        args.action === "add_event" ? `Adding *${args.title}* to your calendar` : "Updating your calendar",
      doneLabel: (args: { action: string; title?: string }) =>
        args.action === "add_event" ? `Added *${args.title}* to your calendar` : "Updated your calendar",
      parse: (raw) => {
        const action = oneOf(raw, "action", ["add_event", "schedule_task", "move_block", "resize_block"] as const);
        if (action === "add_event")
          return {
            action,
            title: requireString(raw, "title", 500),
            start: localTime(raw, "start", true),
            end: localTime(raw, "end", false),
            allDay: raw.allDay === true,
            notes: optionalString(raw, "notes"),
          };
        if (action === "schedule_task")
          return { action, taskId: requireString(raw, "taskId", 200), start: localTime(raw, "start", true), end: localTime(raw, "end", true) };
        const expectedRevision = optionalNumber(raw, "expectedRevision");
        if (expectedRevision === undefined) throw new ToolInputError("expectedRevision is required; read it with read_calendar.");
        return action === "move_block"
          ? { action, itemId: requireString(raw, "itemId", 200), start: localTime(raw, "start", true), end: localTime(raw, "end", false), expectedRevision }
          : { action, itemId: requireString(raw, "itemId", 200), end: localTime(raw, "end", true), expectedRevision };
      },
      command: (args: Record<string, unknown>) => {
        const action = args.action;
        if (action === "add_event")
          return {
            command: "create_calendar_personal_event",
            args: {
              title: args.title,
              startLocal: args.start,
              ...(args.end ? { endLocal: args.end } : {}),
              timezone: timeZone,
              ...(args.allDay ? { allDay: true } : {}),
              ...(args.notes ? { notes: args.notes } : {}),
            },
          };
        if (action === "schedule_task")
          return { command: "schedule_calendar_task", args: { planArtifactId: args.taskId, startLocal: args.start, endLocal: args.end, timezone: timeZone } };
        if (action === "move_block")
          return {
            command: "move_calendar_block",
            args: { itemId: args.itemId, startLocal: args.start, ...(args.end ? { endLocal: args.end } : {}), timezone: timeZone, expectedRevision: args.expectedRevision },
          };
        return { command: "resize_calendar_block", args: { itemId: args.itemId, endLocal: args.end, timezone: timeZone, expectedRevision: args.expectedRevision } };
      },
    }),
    commandTool(session, {
      name: "organize_library",
      description:
        "Organize the library: create_folder {name, destinationId?}, rename {targetIds: [one id], name}, move {targetIds, destinationId}, link {targetIds, destinationId} (adds a shortcut without moving). Ids are folder or item ids from list_library. If items have files on the user's computer through Bridge, the user is asked first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create_folder", "rename", "move", "link"] },
          targetIds: { type: "array", items: { type: "string" } },
          destinationId: { type: "string" },
          name: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { action: string; name?: string }) =>
        args.action === "create_folder" ? `Creating the folder *${args.name}*` : "Organizing your library",
      doneLabel: (args: { action: string; name?: string }) =>
        args.action === "create_folder" ? `Created the folder *${args.name}*` : "Organized your library",
      parse: (raw) => {
        const action = oneOf(raw, "action", ["create_folder", "rename", "move", "link"] as const);
        const name = optionalString(raw, "name", 200);
        if ((action === "create_folder" || action === "rename") && !name) throw new ToolInputError("name is required.");
        const targetIds = action === "create_folder" ? [] : stringList(raw, "targetIds");
        const destinationId = optionalString(raw, "destinationId", 200);
        if ((action === "move" || action === "link") && !destinationId) throw new ToolInputError("destinationId is required.");
        return { action, targetIds, ...(destinationId ? { destinationId } : {}), ...(name ? { name } : {}) };
      },
      command: (args: Record<string, unknown>) => ({ command: "organize_library", args }),
    }),
    commandTool(session, {
      name: "move_to_trash",
      description:
        "Move library items (work, folders) to the Trash. The user can restore them from the Trash, so this does not ask first unless desktop files are affected. Spectra never deletes permanently.",
      parameters: {
        type: "object",
        properties: { targetIds: { type: "array", items: { type: "string" } } },
        required: ["targetIds"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { targetIds: string[] }) =>
        args.targetIds.length === 1 ? `Moving ${titled(session, args.targetIds[0], "an item")} to the Trash` : `Moving ${plural(args.targetIds.length, "item")} to the Trash`,
      doneLabel: (args: { targetIds: string[] }) => `Moved ${plural(args.targetIds.length, "item")} to the Trash`,
      parse: (raw) => ({ targetIds: stringList(raw, "targetIds") }),
      command: (args) => ({ command: "delete_library_items", args: { targetIds: args.targetIds } }),
    }),
    commandTool(session, {
      name: "share",
      description:
        "Change who can open the user's work: invite {resourceType, resourceId, subjectId (an account id), level: read|modify}, change_level {invitationId, level}, revoke {grantId}. The user approves every sharing change unless they allowed sharing changes.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["invite", "change_level", "revoke"] },
          resourceType: { type: "string", enum: ["workspace", "artifact", "agent"] },
          resourceId: { type: "string" },
          subjectId: { type: "string" },
          invitationId: { type: "string" },
          grantId: { type: "string" },
          level: { type: "string", enum: ["read", "modify"] },
        },
        required: ["action", "resourceType", "resourceId"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: "sharing",
      label: (args: { resourceId: string }) => `Changing who can open ${titled(session, args.resourceId, "your work")}`,
      doneLabel: (args: { resourceId: string }) => `Changed sharing for ${titled(session, args.resourceId, "your work")}`,
      question: (args: { action: string; resourceId: string; level?: string }) =>
        args.action === "revoke"
          ? `Remove someone's access to ${titled(session, args.resourceId, "this work")}?`
          : args.action === "invite"
            ? `Share ${titled(session, args.resourceId, "this work")} so they can ${args.level === "modify" ? "edit" : "view"} it?`
            : `Change someone's access to ${titled(session, args.resourceId, "this work")} to ${args.level === "modify" ? "edit" : "view"}?`,
      parse: (raw) => {
        const action = oneOf(raw, "action", ["invite", "change_level", "revoke"] as const);
        const parsed: Record<string, unknown> = {
          action,
          resourceType: oneOf(raw, "resourceType", ["workspace", "artifact", "agent"] as const),
          resourceId: requireString(raw, "resourceId", 200),
        };
        for (const key of ["subjectId", "invitationId", "grantId"]) {
          const value = optionalString(raw, key, 200);
          if (value) parsed[key] = value;
        }
        if (raw.level !== undefined) parsed.level = oneOf(raw, "level", ["read", "modify"] as const);
        if (action === "invite" && (!parsed.subjectId || !parsed.level)) throw new ToolInputError("invite needs subjectId and level.");
        if (action === "change_level" && (!parsed.invitationId || !parsed.level)) throw new ToolInputError("change_level needs invitationId and level.");
        if (action === "revoke" && !parsed.grantId) throw new ToolInputError("revoke needs grantId.");
        return parsed as { action: string; resourceId: string; level?: string };
      },
      command: (args) => ({ command: "change_sharing", args: args as Record<string, unknown> }),
    }),
    commandTool(session, {
      name: "managebac",
      description:
        "Act on the user's ManageBac connection: sync {purpose: upcoming_deadlines|class_resources|timetable|classes|cas} refreshes school records; select_classes {classIds, expectedRevision?} sets which classes sync. The user approves unless they allowed ManageBac changes.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["sync", "select_classes"] },
          purpose: { type: "string", enum: ["upcoming_deadlines", "class_resources", "timetable", "classes", "cas"] },
          classIds: { type: "array", items: { type: "string" } },
          expectedRevision: { type: "number" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: "managebac",
      label: (args: { action: string }) => (args.action === "sync" ? "Syncing ManageBac" : "Choosing your ManageBac classes"),
      doneLabel: (args: { action: string }) => (args.action === "sync" ? "Synced ManageBac" : "Chose your ManageBac classes"),
      question: (args: { action: string; classIds?: string[] }) =>
        args.action === "sync" ? "Refresh your school records from ManageBac now?" : `Sync only these ${plural(args.classIds?.length ?? 0, "class")} from ManageBac?`,
      parse: (raw) => {
        const action = oneOf(raw, "action", ["sync", "select_classes"] as const);
        if (action === "sync")
          return { action, purpose: oneOf(raw, "purpose", ["upcoming_deadlines", "class_resources", "timetable", "classes", "cas"] as const, "upcoming_deadlines") };
        const expectedRevision = optionalNumber(raw, "expectedRevision");
        return { action, classIds: stringList(raw, "classIds"), ...(expectedRevision !== undefined ? { expectedRevision } : {}) };
      },
      command: (args: Record<string, unknown>) =>
        args.action === "sync"
          ? { command: "trigger_managebac_sync", args: { purpose: args.purpose } }
          : {
              command: "select_managebac_classes",
              args: { recordIds: args.classIds, ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}) },
            },
    }),
    commandTool(session, {
      name: "remember",
      description:
        "Save something lasting about the user that will help later (a preference, their level, a goal), or revise a saved memory by memoryId. Only when the user states it or clearly wants it kept; never secrets.",
      parameters: {
        type: "object",
        properties: { content: { type: "string" }, memoryId: { type: "string" } },
        required: ["content"],
        additionalProperties: false,
      },
      effect: "write",
      label: () => "Remembering that",
      doneLabel: () => "Remembered that",
      parse: (raw) => ({ content: requireString(raw, "content", 2_000), memoryId: optionalString(raw, "memoryId", 200) }),
      command: (args) => ({
        command: "write_memory",
        args: args.memoryId ? { action: "revise", content: args.content, memoryId: args.memoryId } : { action: "create", content: args.content },
      }),
    }),
    commandTool(session, {
      name: "add_comment",
      description:
        "Leave a visible, AI-attributed comment on a piece of work, for feedback the user asked for without changing the work. regionId is a block, slide or cell region from the content; omit it to comment on the whole item.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, body: { type: "string" }, regionId: { type: "string" } },
        required: ["artifactId", "body"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { artifactId: string }) => `Commenting on ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: { artifactId: string }) => `Commented on ${titled(session, args.artifactId, "your work")}`,
      parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200), body: requireString(raw, "body"), regionId: optionalString(raw, "regionId", 240) }),
      command: (args) => ({
        command: "add_comment",
        args: { artifactId: args.artifactId, body: args.body, anchor: { regionId: args.regionId ?? "work:root" } },
      }),
    }),
    commandTool(session, {
      name: "open_in_spectra",
      description:
        "Show the user a place in Spectra: library, calendar, settings, a workspace or an artifact (targetId). Use it when they ask to see something; whether their view follows depends on their Follow AI setting.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", enum: ["library", "calendar", "settings", "workspace", "artifact"] },
          targetId: { type: "string" },
        },
        required: ["destination"],
        additionalProperties: false,
      },
      effect: "read",
      label: (args: { destination: string; targetId?: string }) =>
        args.destination === "artifact" ? `Opening ${titled(session, args.targetId, "your work")}` : `Opening ${args.destination}`,
      doneLabel: (args: { destination: string; targetId?: string }) =>
        args.destination === "artifact" ? `Opened ${titled(session, args.targetId, "your work")}` : `Opened ${args.destination}`,
      parse: (raw) => {
        const destination = oneOf(raw, "destination", ["library", "calendar", "settings", "workspace", "artifact"] as const);
        const targetId = optionalString(raw, "targetId", 200);
        if ((destination === "artifact" || destination === "workspace") && !targetId) throw new ToolInputError("targetId is required.");
        return { destination, ...(targetId ? { targetId } : {}) };
      },
      command: (args) => ({ command: "navigate_spectra", args }),
      after: (args) => {
        const known = args.targetId ? session.titles.get(args.targetId) : undefined;
        return args.destination === "artifact" && args.targetId && known
          ? { artifacts: [{ id: args.targetId, type: known.type, title: known.title, action: "referenced" as const }] }
          : {};
      },
    }),
    commandTool(session, {
      name: "setup_bridge",
      description:
        "Open the Bridge settings step that connects Spectra to files on the user's computer: pair, select-location, retry-connection or retry-folder {grantId}. The user finishes the step themselves.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["pair", "select-location", "retry-connection", "retry-folder"] },
          grantId: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "read",
      label: () => "Opening Bridge setup",
      doneLabel: () => "Opened Bridge setup",
      parse: (raw) => ({
        action: oneOf(raw, "action", ["pair", "select-location", "retry-connection", "retry-folder"] as const),
        ...(optionalString(raw, "grantId", 200) ? { grantId: optionalString(raw, "grantId", 200) } : {}),
      }),
      command: (args) => ({ command: "setup_bridge", args }),
    }),
  ];
  return tools as unknown as AnyHarnessTool[];
}
