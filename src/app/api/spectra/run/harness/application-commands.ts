import { z } from "zod";
import type { AiTargetClass } from "@/features/spectra/ai/authority-policy";
import { normalizeCalendarCommand } from "@/features/spectra/calendar/domain/command";
import { FOLDER_ACTIONS, LOCAL_DEVICE_ACTIONS } from "@/features/spectra/devices/actions";
import { normalizeAiPreferencePatch, preferenceLayerValuesSchema } from "@/features/spectra/settings/schema/preferences";
import { normalizeCalendarTimeInput } from "../../../../../../shared/calendar-time";
import { AI_SYNC_PURPOSES, SCHOOL_SYNC_KINDS, SCHOOL_SYNC_MODES, type AiSyncPurpose } from "../../../../../../shared/school-sync";

/*
 * The application commands the harness tools send (tools/app.ts,
 * tools/commands.ts and tools/work.ts), with the arguments each one takes and
 * the authority class it is judged under. This is the server's boundary: an
 * operation whose command is not here, or whose arguments do not parse, never
 * runs. Convex's spectraApplicationWrites:execute then maps most commands to
 * their one mutation; restore_version and the reference commands write
 * through the collaboration room instead.
 */

const calendarTime = {
  startAt: z.number().optional(),
  endAt: z.number().optional(),
  startLocal: z.string().optional(),
  endLocal: z.string().optional(),
  disambiguation: z.enum(["earlier", "later"]).optional(),
};

export const NAVIGATION_DESTINATIONS = ["library", "calendar", "settings", "devices", "workspace", "artifact", "agents", "school", "analytics"] as const;

type ApplicationCommand = { input: z.ZodType<Record<string, unknown>>; authority?: AiTargetClass };

const COMMANDS: Record<string, ApplicationCommand> = {
  navigate_spectra: {
    input: z.object({ destination: z.enum(NAVIGATION_DESTINATIONS), targetId: z.string().optional() }),
    authority: "navigation",
  },
  add_comment: {
    input: z.object({
      artifactId: z.string().min(1),
      body: z.string().trim().min(1).max(20_000),
      anchor: z.object({ regionId: z.string().trim().min(1).max(240), fallbackExcerpt: z.string().max(500).optional() }),
      parentCommentId: z.string().optional(),
    }),
    authority: "content",
  },
  manage_comment: {
    input: z
      .object({
        artifactId: z.string().trim().min(1).max(200),
        commentId: z.string().trim().min(1).max(200),
        action: z.enum(["resolve", "reopen", "edit", "delete"]),
        body: z.string().trim().min(1).max(20_000).optional(),
      })
      .refine((value) => value.action !== "edit" || Boolean(value.body), { message: "body is required to edit a comment." }),
    authority: "content",
  },
  read_devices: { input: z.object({}), authority: "navigation" },
  control_device: {
    input: z
      .object({
        action: z.enum(LOCAL_DEVICE_ACTIONS),
        grantId: z.string().trim().min(1).max(200).optional(),
        deviceId: z.string().trim().min(1).max(200).optional(),
      })
      .superRefine((value, ctx) => {
        if (FOLDER_ACTIONS.has(value.action) && !value.grantId) ctx.addIssue({ code: "custom", path: ["grantId"], message: "A folder grant id is required." });
      }),
    authority: "navigation",
  },
  pair_device: { input: z.object({}), authority: "settings" },
  remove_device: { input: z.object({ deviceId: z.string().trim().min(1).max(200) }), authority: "settings" },
  organize_library: {
    input: z
      .object({
        action: z.enum(["create_folder", "create_workspace", "rename", "move", "link"]),
        targetIds: z.array(z.string()).max(100).default([]),
        destinationId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      })
      .superRefine((value, ctx) => {
        const creates = value.action === "create_folder" || value.action === "create_workspace";
        if (creates && !value.name) ctx.addIssue({ code: "custom", path: ["name"], message: "A name is required." });
        if (!creates && value.targetIds.length === 0) ctx.addIssue({ code: "custom", path: ["targetIds"], message: "At least one target is required." });
        if ((value.action === "move" || value.action === "link") && !value.destinationId) ctx.addIssue({ code: "custom", path: ["destinationId"], message: "A destination is required." });
      }),
    authority: "tree",
  },
  delete_library_items: { input: z.object({ targetIds: z.array(z.string()).min(1).max(100) }), authority: "tree_delete" },
  restore_library_items: { input: z.object({ targetIds: z.array(z.string()).min(1).max(100) }), authority: "tree" },
  pin_library_item: { input: z.object({ targetId: z.string().trim().min(1).max(200), pinned: z.boolean() }), authority: "tree" },
  manage_conversation: {
    input: z
      .object({
        threadId: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(200).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .refine((value) => value.title !== undefined || value.pinned !== undefined || value.archived !== undefined, {
        message: "Say what changes: title, pinned or archived.",
      }),
    authority: "content",
  },
  save_version: {
    input: z.object({ artifactId: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(180) }),
    authority: "content",
  },
  // Restoring saves the current work as a version first, so it is undoable.
  restore_version: {
    input: z.object({ artifactId: z.string().trim().min(1).max(200), versionId: z.string().trim().min(1).max(200) }),
    authority: "content",
  },
  // Publishing serves a Code work's build to everyone who can open it.
  publish_code: {
    input: z.object({ artifactId: z.string().trim().min(1).max(200), action: z.enum(["publish", "unpublish"]) }),
    authority: "content",
  },
  // Embeds are the host work's content: changing or removing one is an edit.
  manage_embed: {
    input: z
      .object({
        artifactId: z.string().trim().min(1).max(200),
        embedId: z.string().trim().min(1).max(200),
        action: z.enum(["resize", "follow_live", "pin", "recheck", "remove"]),
        mode: z.enum(["compact", "expanded"]).optional(),
        versionId: z.string().trim().min(1).max(200).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "resize" && !value.mode) ctx.addIssue({ code: "custom", path: ["mode"], message: "resize needs a mode." });
        if (value.action === "pin" && !value.versionId) ctx.addIssue({ code: "custom", path: ["versionId"], message: "pin needs a version id." });
      }),
    authority: "content",
  },
  change_spectra_settings: { input: z.object({ patch: preferenceLayerValuesSchema }), authority: "settings" },
  change_sync_policy: {
    input: z.object({ targetIds: z.array(z.string()).min(1).max(100), patch: z.record(z.string(), z.unknown()) }),
    authority: "local_file",
  },
  write_memory: {
    input: z
      .object({ action: z.enum(["create", "revise", "forget"]), content: z.string().min(1).max(10_000).optional(), memoryId: z.string().optional() })
      .superRefine((value, ctx) => {
        if (value.action !== "forget" && !value.content) ctx.addIssue({ code: "custom", path: ["content"], message: "What to remember is required." });
        if (value.action !== "create" && !value.memoryId) ctx.addIssue({ code: "custom", path: ["memoryId"], message: "A memory id is required." });
      }),
    authority: "memory",
  },
  change_sharing: {
    input: z
      .object({
        resourceType: z.enum(["workspace", "artifact", "agent"]),
        resourceId: z.string(),
        action: z.enum(["invite", "change_level", "revoke", "withdraw_invitation", "set_exception", "clear_exception", "create_public_link", "revoke_public_link"]),
        subjectId: z.string().optional(),
        invitationId: z.string().optional(),
        grantId: z.string().optional(),
        accountId: z.string().optional(),
        linkId: z.string().optional(),
        level: z.enum(["read", "modify"]).optional(),
        effect: z.enum(["deny", "restrict"]).optional(),
        expiresInDays: z.union([z.literal(7), z.literal(30)]).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "invite" && !value.subjectId) ctx.addIssue({ code: "custom", path: ["subjectId"], message: "An invitee account id is required." });
        if (value.action === "change_level" && (!value.invitationId || !value.level)) ctx.addIssue({ code: "custom", path: ["invitationId"], message: "An accepted invitation and new level are required." });
        if (value.action === "revoke" && !value.grantId) ctx.addIssue({ code: "custom", path: ["grantId"], message: "A grant id is required." });
        if (value.action === "withdraw_invitation" && !value.invitationId) ctx.addIssue({ code: "custom", path: ["invitationId"], message: "A pending invitation id is required." });
        if ((value.action === "set_exception" || value.action === "clear_exception") && !value.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "The member's account id is required." });
        if ((value.action === "set_exception" || value.action === "clear_exception") && value.resourceType === "workspace") ctx.addIssue({ code: "custom", path: ["resourceType"], message: "Exceptions are set on a single work, not a workspace." });
        if (value.action === "set_exception" && !value.effect) ctx.addIssue({ code: "custom", path: ["effect"], message: "An exception is deny or restrict." });
        if (value.action === "revoke_public_link" && !value.linkId) ctx.addIssue({ code: "custom", path: ["linkId"], message: "A public link id is required." });
      }),
    authority: "sharing",
  },
  // Checks run the agent's draft against its suite: they spend model tokens and record a run, nothing else.
  run_agent_checks: {
    input: z.object({ agentId: z.string().trim().min(1).max(200) }),
    authority: "content",
  },
  // A release decides which version of an agent people reach; a private one reaches only the owner.
  release_agent: {
    input: z
      .object({
        agentId: z.string().trim().min(1).max(200),
        action: z.enum(["release_private", "publish", "promote", "rollback", "suspend"]),
        releaseId: z.string().trim().min(1).max(200).optional(),
        releaseNotes: z.string().trim().max(4_000).optional(),
      })
      .superRefine((value, ctx) => {
        const managed = value.action === "promote" || value.action === "rollback" || value.action === "suspend";
        if (managed && !value.releaseId) ctx.addIssue({ code: "custom", path: ["releaseId"], message: "A release id is required." });
        if (!managed && value.releaseId) ctx.addIssue({ code: "custom", path: ["releaseId"], message: "A new release is made from the current draft." });
      }),
    authority: "sharing",
  },
  trigger_managebac_sync: {
    input: z.object({ purpose: z.enum(AI_SYNC_PURPOSES as [AiSyncPurpose, ...AiSyncPurpose[]]), force: z.boolean().optional() }),
    authority: "managebac_sync",
  },
  select_managebac_classes: {
    input: z.object({
      recordIds: z.array(z.string().min(1)).max(100),
      expectedRevision: z.number().int().min(0).optional(),
      retention: z.enum(["keep_in_spectra", "archive_projection"]).optional(),
    }),
    authority: "managebac_selection",
  },
  set_school_sync_mode: {
    input: z.object({
      kind: z.enum(SCHOOL_SYNC_KINDS),
      // null clears a class's own choice so it follows the kind's mode again.
      mode: z.enum(SCHOOL_SYNC_MODES).nullable(),
      providerClassId: z.string().trim().min(1).max(200).optional(),
    }).refine((value) => value.mode !== null || value.providerClassId, { message: "Only a class's own choice can be cleared." }),
    authority: "managebac_selection",
  },
  manage_class_workspaces: {
    input: z.object({
      action: z.enum(["create", "release"]),
      recordIds: z.array(z.string().min(1)).min(1).max(100),
      retention: z.enum(["keep_in_spectra", "archive_projection"]).optional(),
    }),
    authority: "managebac_selection",
  },
  insert_reference: {
    input: z.object({ hostWorkId: z.string(), targetWorkId: z.string(), label: z.string().max(160).optional() }),
    authority: "content",
  },
  // Calendar writes go through the same revision-checked gesture path as a drag.
  schedule_calendar_task: {
    input: z.object({
      taskItemId: z.string().optional(),
      planArtifactId: z.string().optional(),
      planTaskId: z.string().optional(),
      ...calendarTime,
      timezone: z.string(),
      idempotencyKey: z.string().min(8).max(240).optional(),
    }),
  },
  create_calendar_personal_event: {
    input: z.object({
      title: z.string().min(1).max(500),
      ...calendarTime,
      timezone: z.string(),
      notes: z.string().max(20_000).optional(),
      allDay: z.boolean().optional(),
      linkedArtifactIds: z.array(z.string()).max(24).optional(),
    }),
  },
  move_calendar_block: {
    input: z.object({ itemId: z.string(), ...calendarTime, timezone: z.string().optional(), expectedRevision: z.number() }),
  },
  resize_calendar_block: {
    input: z.object({
      itemId: z.string(),
      endAt: z.number().optional(),
      endLocal: z.string().optional(),
      timezone: z.string().optional(),
      disambiguation: z.enum(["earlier", "later"]).optional(),
      expectedRevision: z.number(),
    }),
  },
  // Finishing or removing an item is the user's own reversible calendar work.
  complete_calendar_block: { input: z.object({ itemId: z.string().min(1), expectedRevision: z.number() }), authority: "content" },
  remove_calendar_event: { input: z.object({ itemId: z.string().min(1) }), authority: "content" },
};

export const APPLICATION_COMMAND_NAMES = Object.keys(COMMANDS);

/** Calendar commands also arrive under their older planner names. */
export function normalizeApplicationCommand(command: string) {
  return normalizeCalendarCommand(command) ?? command;
}

export function isApplicationCommand(command: string) {
  return Object.hasOwn(COMMANDS, normalizeApplicationCommand(command));
}

/**
 * Parse one command's arguments at the server boundary. Model-friendly
 * aliases are normalised before Zod strips unknown fields: the settings schema
 * accepts only persisted preference sections, so normalising after the parse
 * would turn a valid request into an empty write.
 */
export function parseApplicationCommand(command: string, args: Record<string, unknown>) {
  const name = normalizeApplicationCommand(command);
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!spec) throw new Error(`APP_COMMAND_NOT_REGISTERED:${command}`);
  const normalized =
    name === "change_spectra_settings"
      ? { ...args, patch: normalizeAiPreferencePatch(args.patch) }
      : normalizeCalendarCommand(name)
        ? normalizeCalendarTimeInput(args)
        : args;
  return { command: name, args: spec.input.parse(normalized), authority: spec.authority };
}
