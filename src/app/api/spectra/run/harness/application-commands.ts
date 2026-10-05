import { z } from "zod";
import type { AiTargetClass } from "@/features/spectra/ai/authority-policy";
import { normalizeCalendarCommand } from "@/features/spectra/calendar/domain/command";
import { FOLDER_ACTIONS, LOCAL_DEVICE_ACTIONS } from "@/features/spectra/devices/actions";
import { normalizeAiPreferencePatch, preferenceLayerValuesSchema } from "@/features/spectra/settings/schema/preferences";
import { normalizeCalendarTimeInput } from "../../../../../../shared/calendar-time";
import { AI_SYNC_PURPOSES, type AiSyncPurpose } from "../../../../../../shared/school-sync";

/*
 * The application commands the harness tools send (tools/app.ts and
 * tools/commands.ts), with the arguments each one takes and the authority
 * class it is judged under. This is the server's boundary: an operation whose
 * command is not here, or whose arguments do not parse, never runs.
 * Convex's spectraApplicationWrites:execute then maps each command to its one
 * mutation.
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
        action: z.enum(["create_folder", "rename", "move", "link"]),
        targetIds: z.array(z.string()).max(100).default([]),
        destinationId: z.string().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "create_folder" && !value.name) ctx.addIssue({ code: "custom", path: ["name"], message: "A folder name is required." });
        if (value.action !== "create_folder" && value.targetIds.length === 0) ctx.addIssue({ code: "custom", path: ["targetIds"], message: "At least one target is required." });
        if ((value.action === "move" || value.action === "link") && !value.destinationId) ctx.addIssue({ code: "custom", path: ["destinationId"], message: "A destination is required." });
      }),
    authority: "tree",
  },
  delete_library_items: { input: z.object({ targetIds: z.array(z.string()).min(1).max(100) }), authority: "tree_delete" },
  change_spectra_settings: { input: z.object({ patch: preferenceLayerValuesSchema }), authority: "settings" },
  change_sync_policy: {
    input: z.object({ targetIds: z.array(z.string()).min(1).max(100), patch: z.record(z.string(), z.unknown()) }),
    authority: "local_file",
  },
  write_memory: {
    input: z.object({ action: z.enum(["create", "revise"]), content: z.string().min(1).max(10_000), memoryId: z.string().optional() }),
    authority: "memory",
  },
  change_sharing: {
    input: z
      .object({
        resourceType: z.enum(["workspace", "artifact", "agent"]),
        resourceId: z.string(),
        action: z.enum(["invite", "change_level", "revoke"]),
        subjectId: z.string().optional(),
        invitationId: z.string().optional(),
        grantId: z.string().optional(),
        level: z.enum(["read", "modify"]).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.action === "invite" && !value.subjectId) ctx.addIssue({ code: "custom", path: ["subjectId"], message: "An invitee account id is required." });
        if (value.action === "change_level" && (!value.invitationId || !value.level)) ctx.addIssue({ code: "custom", path: ["invitationId"], message: "An accepted invitation and new level are required." });
        if (value.action === "revoke" && !value.grantId) ctx.addIssue({ code: "custom", path: ["grantId"], message: "A grant id is required." });
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
