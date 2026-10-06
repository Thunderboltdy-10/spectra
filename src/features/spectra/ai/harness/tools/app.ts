import { patchTouchesAiPermissions } from "../../../settings/schema/ai-permissions";
import { normalizeAiPreferencePatch, preferenceLayerValuesSchema } from "../../../settings/schema/preferences";
import { AI_SYNC_PURPOSES, SCHOOL_SYNC_KINDS, SCHOOL_SYNC_MODES } from "../../../../../../shared/school-sync";
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

const COMMENT_ACTIONS = ["resolve", "reopen", "edit", "delete"] as const;
type CommentArgs = { artifactId: string; commentId: string; action: (typeof COMMENT_ACTIONS)[number]; body?: string };
const COMMENT_LABELS: Record<CommentArgs["action"], [string, string]> = {
  resolve: ["Resolving a comment", "Resolved a comment"],
  reopen: ["Reopening a comment", "Reopened a comment"],
  edit: ["Editing a comment", "Edited a comment"],
  delete: ["Deleting a comment", "Deleted a comment"],
};

const SHARE_ACTIONS = ["invite", "change_level", "revoke", "withdraw_invitation", "set_exception", "clear_exception", "create_public_link", "revoke_public_link"] as const;
type ShareArgs = {
  action: (typeof SHARE_ACTIONS)[number];
  resourceType: "workspace" | "artifact" | "agent";
  resourceId: string;
  subjectId?: string;
  invitationId?: string;
  grantId?: string;
  accountId?: string;
  linkId?: string;
  level?: "read" | "modify";
  effect?: "deny" | "restrict";
  expiresInDays?: 7 | 30;
};
const SHARE_NEEDS: Record<ShareArgs["action"], Array<keyof ShareArgs>> = {
  invite: ["subjectId", "level"],
  change_level: ["invitationId", "level"],
  revoke: ["grantId"],
  withdraw_invitation: ["invitationId"],
  set_exception: ["accountId", "effect"],
  clear_exception: ["accountId"],
  create_public_link: [],
  revoke_public_link: ["linkId"],
};

function shareQuestion(work: string, args: ShareArgs) {
  const can = args.level === "modify" ? "edit" : "view";
  switch (args.action) {
    case "invite": return `Share ${work} so they can ${can} it?`;
    case "change_level": return `Change someone's access to ${work} to ${can}?`;
    case "revoke": return `Remove someone's access to ${work}?`;
    case "withdraw_invitation": return `Withdraw the pending invitation to ${work}?`;
    case "set_exception": return args.effect === "deny" ? `Stop one member of a shared workspace from opening ${work}?` : `Let one member of a shared workspace only view ${work}?`;
    case "clear_exception": return `Give one workspace member their usual access to ${work} again?`;
    case "create_public_link": return `Make a public link so anyone with it can view ${work}${args.expiresInDays ? ` for ${args.expiresInDays} days` : ""}?`;
    case "revoke_public_link": return `Turn off a public link to ${work}?`;
  }
}

type CommandTool<A> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  effect: ToolEffect | ((args: A) => ToolEffect);
  category?: PermissionCategory | ((args: A) => PermissionCategory | undefined);
  label: (args: A) => string;
  doneLabel: (args: A) => string;
  question?: (args: A) => string;
  /** Works this call changes, so calls on the same work run in order. */
  targets?: (args: A) => string[];
  parse: (raw: Record<string, unknown>) => A;
  command: (args: A) => { command: string; args: Record<string, unknown> };
  after?: (args: A, result: CommandResult) => Partial<ToolOutcome>;
};

export function commandTool<A>(session: HarnessSession, spec: CommandTool<A>): HarnessTool<A> {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    effect: spec.effect,
    ...(spec.category ? { category: (args: A) => (typeof spec.category === "function" ? spec.category(args) : spec.category) } : {}),
    label: spec.label,
    ...(spec.question ? { question: spec.question } : {}),
    ...(spec.targets ? { targets: spec.targets } : {}),
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

/* Devices: Spectra Bridge on the user's computers (docs/product/DEVICES.md). */

const CALENDAR_ACTIONS = ["add_event", "schedule_task", "move_block", "resize_block", "complete_block", "remove_event"] as const;
const LIBRARY_ACTIONS = ["create_folder", "create_workspace", "rename", "move", "link", "pin", "unpin"] as const;
const MANAGEBAC_ACTIONS = ["sync", "select_classes", "set_sync_mode", "create_class_workspaces", "release_class_workspaces"] as const;
type ManageBacAction = (typeof MANAGEBAC_ACTIONS)[number];
const MANAGEBAC_LABELS: Record<ManageBacAction, [string, string]> = {
  sync: ["Syncing ManageBac", "Synced ManageBac"],
  select_classes: ["Choosing your ManageBac classes", "Chose your ManageBac classes"],
  set_sync_mode: ["Changing what syncs from school", "Changed what syncs from school"],
  create_class_workspaces: ["Making class workspaces", "Made class workspaces"],
  release_class_workspaces: ["Releasing class workspaces", "Released class workspaces"],
};

/** The places open_in_spectra can show; the app's follow navigator handles each one. */
export const OPEN_IN_SPECTRA_DESTINATIONS = [
  "library",
  "calendar",
  "settings",
  "devices",
  "workspace",
  "artifact",
  "agents",
  "school",
  "analytics",
] as const;

export const DEVICES_TOOL_ACTIONS = [
  "status",
  "pair",
  "add_folder",
  "retry_folder",
  "pause_folder",
  "remove_folder",
  "pause_syncing",
  "show_logs",
  "update",
  "remove_device",
] as const;

type DevicesAction = (typeof DEVICES_TOOL_ACTIONS)[number];
export type DevicesArgs = { action: DevicesAction; grantId?: string; deviceId?: string; paused?: boolean };

const DEVICES_LABELS: Record<DevicesAction, [string, string]> = {
  status: ["Checking your devices", "Checked your devices"],
  pair: ["Connecting this computer", "Started connecting this computer"],
  add_folder: ["Opening the folder picker", "Opened the folder picker"],
  retry_folder: ["Retrying the folder", "Asked to retry the folder"],
  pause_folder: ["Changing the folder's syncing", "Asked to change the folder's syncing"],
  remove_folder: ["Removing the folder", "Asked to remove the folder"],
  pause_syncing: ["Changing syncing on this computer", "Asked to change syncing"],
  show_logs: ["Opening Bridge's logs", "Asked to open Bridge's logs"],
  update: ["Updating Spectra Bridge", "Asked Spectra Bridge to update"],
  remove_device: ["Removing the device", "Removed the device"],
};

/** Pairing and removing ask first (settings); reading is free; the rest are ordinary. */
/** Labels see the raw arguments, so an unknown action still reads plainly. */
function devicesLabel(action: string): [string, string] {
  return DEVICES_LABELS[action as DevicesAction] ?? ["Working on your devices", "Worked on your devices"];
}

export function devicesToolEffect(action: DevicesAction): ToolEffect {
  if (action === "status") return "read";
  if (action === "pair" || action === "remove_folder" || action === "remove_device") return "settings";
  return "write";
}

function parseDevicesArgs(raw: Record<string, unknown>): DevicesArgs {
  const action = oneOf(raw, "action", DEVICES_TOOL_ACTIONS);
  const grantId = optionalString(raw, "grantId", 200);
  const deviceId = optionalString(raw, "deviceId", 200);
  if ((action === "retry_folder" || action === "pause_folder" || action === "remove_folder") && !grantId)
    throw new ToolInputError(`${action} needs grantId; read it with action status.`);
  if (action === "remove_device" && !deviceId) throw new ToolInputError("remove_device needs deviceId; read it with action status.");
  const paused = action === "pause_folder" || action === "pause_syncing" ? raw.paused !== false : undefined;
  return { action, ...(grantId ? { grantId } : {}), ...(deviceId ? { deviceId } : {}), ...(paused === undefined ? {} : { paused }) };
}

function controlDeviceArgs(args: DevicesArgs): Record<string, unknown> {
  const action =
    args.action === "pause_folder"
      ? args.paused === false ? "resume_folder" : "pause_folder"
      : args.action === "pause_syncing"
        ? args.paused === false ? "resume_syncing" : "pause_syncing"
        : args.action;
  return { action, ...(args.grantId ? { grantId: args.grantId } : {}), ...(args.deviceId ? { deviceId: args.deviceId } : {}) };
}

export function appTools(session: HarnessSession): AnyHarnessTool[] {
  const timeZone = session.backend.timeZone;
  const tools = [
    commandTool(session, {
      name: "change_settings",
      description:
        "Change the user's Spectra settings. patch uses the real sections: appearance {theme: light|dark|system, density: comfortable|compact, editorTextScale, contrast, reducedMotion}, general {startPage, dateFormat, timeFormat, locale}, ai {researchDepth, islandWake: prism|edge, autoRouteSpecialists}, writing {smartCompletion, sensitivity}, notifications, privacy, accessibility. AI permissions are not settable here: only the user changes those, in Settings. The user approves each change unless they allowed settings changes.",
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
      description: `Change the user's calendar. action add_event: a personal event {title, start, end?, allDay?, notes?}. action schedule_task: a work block for a planner task {taskId (the task's artifact id), start, end}. action move_block {itemId, start, end?, expectedRevision} and resize_block {itemId, end, expectedRevision} for work blocks from read_calendar. complete_block {itemId, expectedRevision} marks a work block done; remove_event {itemId} takes a personal event or work block off the calendar. Times are YYYY-MM-DDTHH:mm in the user's time zone (${timeZone}). Official school deadlines cannot be moved.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...CALENDAR_ACTIONS] },
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
        const action = oneOf(raw, "action", CALENDAR_ACTIONS);
        if (action === "remove_event") return { action, itemId: requireString(raw, "itemId", 200) };
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
        if (action === "complete_block") return { action, itemId: requireString(raw, "itemId", 200), expectedRevision };
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
        if (action === "complete_block")
          return { command: "complete_calendar_block", args: { itemId: args.itemId, expectedRevision: args.expectedRevision } };
        if (action === "remove_event") return { command: "remove_calendar_event", args: { itemId: args.itemId } };
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
        "Organize the library: create_folder {name, destinationId?}, create_workspace {name, destinationId?}, rename {targetIds: [one id], name} (folders, work and workspaces), move {targetIds, destinationId}, link {targetIds, destinationId} (adds a shortcut without moving), pin and unpin {targetIds: [one id]}. Ids are folder, workspace or item ids from list_library. If items have files on the user's computer through Bridge, the user is asked first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...LIBRARY_ACTIONS] },
          targetIds: { type: "array", items: { type: "string" } },
          destinationId: { type: "string" },
          name: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { action: string; name?: string }) =>
        args.action === "create_folder"
          ? `Creating the folder *${args.name}*`
          : args.action === "create_workspace"
            ? `Creating the workspace *${args.name}*`
            : "Organizing your library",
      doneLabel: (args: { action: string; name?: string }) =>
        args.action === "create_folder"
          ? `Created the folder *${args.name}*`
          : args.action === "create_workspace"
            ? `Created the workspace *${args.name}*`
            : "Organized your library",
      parse: (raw) => {
        const action = oneOf(raw, "action", LIBRARY_ACTIONS);
        const name = optionalString(raw, "name", 200);
        const creates = action === "create_folder" || action === "create_workspace";
        if ((creates || action === "rename") && !name) throw new ToolInputError("name is required.");
        const targetIds = creates ? [] : stringList(raw, "targetIds");
        if ((action === "pin" || action === "unpin") && targetIds.length !== 1) throw new ToolInputError("pin and unpin take one id in targetIds.");
        const destinationId = optionalString(raw, "destinationId", 200);
        if ((action === "move" || action === "link") && !destinationId) throw new ToolInputError("destinationId is required.");
        return { action, targetIds, ...(destinationId ? { destinationId } : {}), ...(name ? { name } : {}) };
      },
      command: (args: Record<string, unknown>) =>
        args.action === "pin" || args.action === "unpin"
          ? { command: "pin_library_item", args: { targetId: (args.targetIds as string[])[0], pinned: args.action === "pin" } }
          : { command: "organize_library", args },
    }),
    commandTool(session, {
      name: "restore_from_trash",
      description:
        "Bring library items back from the Trash to where they were, with any desktop files they had. Ids are the ones move_to_trash took, or Trash items the user names.",
      parameters: {
        type: "object",
        properties: { targetIds: { type: "array", items: { type: "string" } } },
        required: ["targetIds"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { targetIds: string[] }) =>
        args.targetIds.length === 1 ? `Restoring ${titled(session, args.targetIds[0], "an item")}` : `Restoring ${plural(args.targetIds.length, "item")}`,
      doneLabel: (args: { targetIds: string[] }) => `Restored ${plural(args.targetIds.length, "item")} from the Trash`,
      parse: (raw) => ({ targetIds: stringList(raw, "targetIds") }),
      command: (args) => ({ command: "restore_library_items", args: { targetIds: args.targetIds } }),
    }),
    commandTool(session, {
      name: "save_version",
      description:
        "Save a named version of a work item: a checkpoint the user can return to from its history. Use it before a large change they may want to undo, or when they ask to keep this state.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, name: { type: "string" } },
        required: ["artifactId", "name"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { artifactId: string }) => `Saving a version of ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: { artifactId: string; name: string }) => `Saved *${args.name}* of ${titled(session, args.artifactId, "your work")}`,
      parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200), name: requireString(raw, "name", 180) }),
      command: (args) => ({ command: "save_version", args: { artifactId: args.artifactId, name: args.name } }),
    }),
    commandTool(session, {
      name: "manage_conversation",
      description:
        "Rename, pin, unpin, archive or restore a conversation in the user's chat list. Omit threadId for this conversation.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          title: { type: "string" },
          pinned: { type: "boolean" },
          archived: { type: "boolean" },
        },
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { title?: string }) => (args.title ? `Renaming the conversation *${args.title}*` : "Tidying your conversations"),
      doneLabel: (args: { title?: string }) => (args.title ? `Renamed the conversation *${args.title}*` : "Tidied your conversations"),
      parse: (raw) => {
        const threadId = optionalString(raw, "threadId", 200);
        const title = optionalString(raw, "title", 200);
        const pinned = typeof raw.pinned === "boolean" ? raw.pinned : undefined;
        const archived = typeof raw.archived === "boolean" ? raw.archived : undefined;
        if (title === undefined && pinned === undefined && archived === undefined)
          throw new ToolInputError("Say what changes: title, pinned or archived.");
        return {
          ...(threadId ? { threadId } : {}),
          ...(title ? { title } : {}),
          ...(pinned !== undefined ? { pinned } : {}),
          ...(archived !== undefined ? { archived } : {}),
        };
      },
      command: (args) => ({ command: "manage_conversation", args }),
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
        "Change who can open the user's work (ids from read_sharing): invite {subjectId (an account id), level: read|modify}; change_level {invitationId, level}; revoke {grantId}; withdraw_invitation {invitationId} for a pending one; set_exception {accountId, effect: deny|restrict} limits one member who reaches a single work through a shared workspace (restrict means view only), clear_exception {accountId} lifts it; create_public_link {expiresInDays?: 7|30} makes a read-only address anyone can open, which goes to the user only, never to you; revoke_public_link {linkId}. The user approves every sharing change unless they allowed sharing changes, and every public link unless they allowed publishing outside Spectra.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...SHARE_ACTIONS] },
          resourceType: { type: "string", enum: ["workspace", "artifact", "agent"] },
          resourceId: { type: "string" },
          subjectId: { type: "string" },
          invitationId: { type: "string" },
          grantId: { type: "string" },
          accountId: { type: "string" },
          linkId: { type: "string" },
          level: { type: "string", enum: ["read", "modify"] },
          effect: { type: "string", enum: ["deny", "restrict"] },
          expiresInDays: { type: "number", enum: [7, 30] },
        },
        required: ["action", "resourceType", "resourceId"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: (args: ShareArgs) => (args.action === "create_public_link" ? "external_send" : "sharing"),
      label: (args: ShareArgs) =>
        args.action === "create_public_link"
          ? `Making a public link to ${titled(session, args.resourceId, "your work")}`
          : `Changing who can open ${titled(session, args.resourceId, "your work")}`,
      doneLabel: (args: ShareArgs) =>
        args.action === "create_public_link"
          ? `Made a public link to ${titled(session, args.resourceId, "your work")}`
          : `Changed sharing for ${titled(session, args.resourceId, "your work")}`,
      question: (args: ShareArgs) => shareQuestion(titled(session, args.resourceId, "this work"), args),
      parse: (raw): ShareArgs => {
        const action = oneOf(raw, "action", SHARE_ACTIONS);
        const parsed: ShareArgs = {
          action,
          resourceType: oneOf(raw, "resourceType", ["workspace", "artifact", "agent"] as const),
          resourceId: requireString(raw, "resourceId", 200),
        };
        for (const key of ["subjectId", "invitationId", "grantId", "accountId", "linkId"] as const) {
          const value = optionalString(raw, key, 200);
          if (value) parsed[key] = value;
        }
        if (raw.level !== undefined) parsed.level = oneOf(raw, "level", ["read", "modify"] as const);
        if (raw.effect !== undefined) parsed.effect = oneOf(raw, "effect", ["deny", "restrict"] as const);
        if (raw.expiresInDays !== undefined) {
          if (raw.expiresInDays !== 7 && raw.expiresInDays !== 30) throw new ToolInputError("expiresInDays is 7 or 30; leave it out for a link that does not expire.");
          parsed.expiresInDays = raw.expiresInDays;
        }
        const needs = SHARE_NEEDS[action].filter((key) => parsed[key] === undefined);
        if (needs.length) throw new ToolInputError(`${action} needs ${needs.join(" and ")}${action === "invite" ? "" : " (read_sharing lists them)"}.`);
        if ((action === "set_exception" || action === "clear_exception") && parsed.resourceType === "workspace")
          throw new ToolInputError("Exceptions are set on a single work: use resourceType artifact or agent.");
        return parsed;
      },
      command: (args) => ({ command: "change_sharing", args: args as Record<string, unknown> }),
    }),
    commandTool(session, {
      name: "managebac",
      description:
        "Act on the user's ManageBac connection: sync {purpose: upcoming_deadlines|class_resources|timetable|classes|past_tasks|grades|cas} refreshes school records; select_classes {classIds, expectedRevision?} sets which classes sync. set_sync_mode {kind, mode: auto|manual|off} sets whether a kind of school record syncs automatically, only when asked, or not at all; with classId (as read_school_data names it) it sets one class's own choice, and mode follow lets that class follow the kind's mode again. create_class_workspaces {classIds} makes a workspace for each class; release_class_workspaces {classIds, retention?: keep_in_spectra|archive_projection} lets them go. The user approves unless they allowed ManageBac changes.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...MANAGEBAC_ACTIONS] },
          purpose: { type: "string", enum: AI_SYNC_PURPOSES },
          classIds: { type: "array", items: { type: "string" } },
          expectedRevision: { type: "number" },
          kind: { type: "string", enum: [...SCHOOL_SYNC_KINDS] },
          mode: { type: "string", enum: [...SCHOOL_SYNC_MODES, "follow"] },
          classId: { type: "string" },
          retention: { type: "string", enum: ["keep_in_spectra", "archive_projection"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: "managebac",
      label: (args: { action: string }) => MANAGEBAC_LABELS[args.action as ManageBacAction]?.[0] ?? "Updating ManageBac",
      doneLabel: (args: { action: string }) => MANAGEBAC_LABELS[args.action as ManageBacAction]?.[1] ?? "Updated ManageBac",
      question: (args: { action: string; classIds?: string[]; kind?: string; mode?: string; classId?: string }) => {
        const classes = plural(args.classIds?.length ?? 0, "class");
        const kind = String(args.kind ?? "").replace(/_/g, " ");
        if (args.action === "sync") return "Refresh your school records from ManageBac now?";
        if (args.action === "set_sync_mode")
          return args.mode === "follow"
            ? `Let this class follow your choice for ${kind} again?`
            : `Sync ${kind}${args.classId ? " for this class" : ""} ${args.mode === "auto" ? "automatically" : args.mode === "manual" ? "only when you ask" : "never"}?`;
        if (args.action === "create_class_workspaces") return `Make a workspace for ${classes}?`;
        if (args.action === "release_class_workspaces") return `Release the workspaces of ${classes}?`;
        return `Sync only these ${classes} from ManageBac?`;
      },
      parse: (raw) => {
        const action = oneOf(raw, "action", MANAGEBAC_ACTIONS);
        if (action === "sync")
          return { action, purpose: oneOf(raw, "purpose", AI_SYNC_PURPOSES, "upcoming_deadlines") };
        if (action === "set_sync_mode") {
          const classId = optionalString(raw, "classId", 200);
          const mode = oneOf(raw, "mode", [...SCHOOL_SYNC_MODES, "follow"] as const);
          if (mode === "follow" && !classId) throw new ToolInputError("mode follow needs classId.");
          return { action, kind: oneOf(raw, "kind", SCHOOL_SYNC_KINDS), mode, ...(classId ? { classId } : {}) };
        }
        if (action === "create_class_workspaces") return { action, classIds: stringList(raw, "classIds") };
        if (action === "release_class_workspaces") {
          const retention = raw.retention === undefined ? undefined : oneOf(raw, "retention", ["keep_in_spectra", "archive_projection"] as const);
          return { action, classIds: stringList(raw, "classIds"), ...(retention ? { retention } : {}) };
        }
        const expectedRevision = optionalNumber(raw, "expectedRevision");
        return { action, classIds: stringList(raw, "classIds"), ...(expectedRevision !== undefined ? { expectedRevision } : {}) };
      },
      command: (args: Record<string, unknown>) => {
        if (args.action === "sync") return { command: "trigger_managebac_sync", args: { purpose: args.purpose } };
        if (args.action === "set_sync_mode")
          return {
            command: "set_school_sync_mode",
            args: { kind: args.kind, mode: args.mode === "follow" ? null : args.mode, ...(args.classId ? { providerClassId: args.classId } : {}) },
          };
        if (args.action === "create_class_workspaces" || args.action === "release_class_workspaces")
          return {
            command: "manage_class_workspaces",
            args: {
              action: args.action === "create_class_workspaces" ? "create" : "release",
              recordIds: args.classIds,
              ...(args.retention ? { retention: args.retention } : {}),
            },
          };
        return {
          command: "select_managebac_classes",
          args: { recordIds: args.classIds, ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}) },
        };
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
        "Leave a visible, AI-attributed comment on a piece of work, for feedback the user asked for without changing the work. regionId is a block, slide or cell region from the content; omit it to comment on the whole item. replyTo (a comment id from read_comments) answers that comment in its thread.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, body: { type: "string" }, regionId: { type: "string" }, replyTo: { type: "string" } },
        required: ["artifactId", "body"],
        additionalProperties: false,
      },
      effect: "write",
      label: (args: { artifactId: string }) => `Commenting on ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: { artifactId: string }) => `Commented on ${titled(session, args.artifactId, "your work")}`,
      parse: (raw) => ({
        artifactId: requireString(raw, "artifactId", 200),
        body: requireString(raw, "body"),
        regionId: optionalString(raw, "regionId", 240),
        replyTo: optionalString(raw, "replyTo", 200),
      }),
      command: (args) => ({
        command: "add_comment",
        args: {
          artifactId: args.artifactId,
          body: args.body,
          anchor: { regionId: args.regionId ?? "work:root" },
          ...(args.replyTo ? { parentCommentId: args.replyTo } : {}),
        },
      }),
    }),
    commandTool(session, {
      name: "manage_comment",
      description:
        "Change a comment on a piece of work (ids from read_comments): resolve or reopen its thread, edit its text, or delete it. Only the comment's author can edit or delete it. Deleting removes the text for good, so the user is asked first.",
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          commentId: { type: "string" },
          action: { type: "string", enum: [...COMMENT_ACTIONS] },
          body: { type: "string", description: "The new text, for edit." },
        },
        required: ["artifactId", "commentId", "action"],
        additionalProperties: false,
      },
      effect: (args: CommentArgs) => (args.action === "delete" ? "irreversible" : "write"),
      category: (args: CommentArgs) => (args.action === "delete" ? "permanent_delete" : undefined),
      label: (args: CommentArgs) => `${COMMENT_LABELS[args.action]?.[0] ?? "Changing a comment"} on ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: CommentArgs) => `${COMMENT_LABELS[args.action]?.[1] ?? "Changed a comment"} on ${titled(session, args.artifactId, "your work")}`,
      question: (args: CommentArgs) => `Delete this comment on ${titled(session, args.artifactId, "this work")}? Its text can't be brought back.`,
      parse: (raw): CommentArgs => {
        const action = oneOf(raw, "action", COMMENT_ACTIONS);
        const body = action === "edit" ? requireString(raw, "body") : undefined;
        return { artifactId: requireString(raw, "artifactId", 200), commentId: requireString(raw, "commentId", 200), action, ...(body ? { body } : {}) };
      },
      command: (args) => ({ command: "manage_comment", args: { ...args } }),
    }),
    commandTool(session, {
      name: "open_in_spectra",
      description:
        "Show the user a place in Spectra: library, calendar, settings, devices, agents (targetId: an agent to open its page), school, analytics, a workspace or an artifact (targetId). Use it when they ask to see something; whether their view follows depends on their Follow AI setting.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", enum: [...OPEN_IN_SPECTRA_DESTINATIONS] },
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
        const destination = oneOf(raw, "destination", OPEN_IN_SPECTRA_DESTINATIONS);
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
      name: "devices",
      description:
        "The user's computers connected through Spectra Bridge. status: read each computer's state, folders (grantId), last sync and any problem, with deviceIds. pair: connect the computer the user has Spectra open on; Spectra offers the download if Bridge is missing and the user confirms a code on the computer. add_folder opens the folder picker on that computer. retry_folder {grantId}, pause_folder {grantId, paused (false resumes)}, remove_folder {grantId} (files stay). pause_syncing {paused (false resumes)} for every folder. show_logs opens Bridge's log file. update installs a ready Bridge update. remove_device {deviceId} unpairs a computer; its files stay. Actions on a computer run there through the user's open Spectra; pass deviceId to aim at one computer. pair, remove_folder and remove_device ask first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...DEVICES_TOOL_ACTIONS] },
          grantId: { type: "string" },
          deviceId: { type: "string" },
          paused: { type: "boolean" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effect: (args: DevicesArgs) => devicesToolEffect(args.action),
      category: (args: DevicesArgs) => (devicesToolEffect(args.action) === "settings" ? "settings" : undefined),
      label: (args: DevicesArgs) => devicesLabel(args.action)[0],
      doneLabel: (args: DevicesArgs) => devicesLabel(args.action)[1],
      question: (args: DevicesArgs) =>
        args.action === "pair"
          ? "Connect this computer to Spectra? You'll confirm a code on the computer."
          : args.action === "remove_folder"
            ? "Stop using this folder in Spectra? Its files stay on the computer."
            : "Remove this device? It stops syncing; its files stay on the computer.",
      parse: (raw) => parseDevicesArgs(raw),
      command: (args) =>
        args.action === "status"
          ? { command: "read_devices", args: {} }
          : args.action === "pair"
            ? { command: "pair_device", args: {} }
            : args.action === "remove_device"
              ? { command: "remove_device", args: { deviceId: args.deviceId } }
              : { command: "control_device", args: controlDeviceArgs(args) },
    }),
  ];
  return tools as unknown as AnyHarnessTool[];
}
