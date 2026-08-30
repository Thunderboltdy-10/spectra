import { z } from "zod";
import type { WorkCapability } from "../work/registry";
import type { AuthorityRisk, CapabilityDefinition } from "./types";

type TimetableCapabilitySpec = {
  localId: string;
  description: string;
  params?: z.ZodType;
  manifestOperation: string;
  requires?: WorkCapability;
  exposed?: boolean;
  risk?: AuthorityRisk;
  disabledReason?: string;
};

const none = z.null();
const identifier = z.string().trim().min(1).max(180);
const dateTime = z.string().datetime({ offset: true });
const layerTarget = z.object({ layerId: identifier }).strict();
const eventTarget = z.object({ eventId: identifier }).strict();
const recurrenceTarget = z.object({ eventId: identifier }).strict();

const TIMETABLE_SPECS: readonly TimetableCapabilitySpec[] = [
  // Stable P3 ids retained for existing workbar bindings.
  {
    localId: "today",
    description: "Return the calendar to today.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "previous",
    description: "Show the previous calendar range.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "next",
    description: "Show the next calendar range.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "view",
    description: "Change the calendar view.",
    params: z.enum(["week", "day", "month", "agenda"]),
    manifestOperation: "inspect_range",
  },
  {
    localId: "calendars",
    description: "Choose which calendars are visible.",
    manifestOperation: "manage_layer",
  },
  {
    localId: "add",
    description: "Add time to the calendar.",
    manifestOperation: "add_event",
  },
  {
    localId: "import",
    description: "Import an ICS or CSV calendar.",
    manifestOperation: "reconcile_source",
    requires: "edit",
  },
  {
    localId: "export.ics",
    description: "Export the visible calendar as ICS.",
    manifestOperation: "inspect_range",
  },

  {
    localId: "navigate.today",
    description: "Return the calendar to today.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "navigate.previous",
    description: "Show the previous calendar range.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "navigate.next",
    description: "Show the next calendar range.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "view.change",
    description: "Change between day, week, month, and agenda views.",
    params: z.enum(["week", "day", "month", "agenda"]),
    manifestOperation: "inspect_range",
  },

  {
    localId: "layer.toggleVisibility",
    description: "Show or hide a calendar without deleting source data.",
    params: layerTarget,
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.showAll",
    description: "Show every available calendar layer.",
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.hideOptional",
    description:
      "Hide optional calendars while retaining essential source layers.",
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.addPersonal",
    description: "Add a private calendar stored only in personal state.",
    params: z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict(),
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.addShared",
    description: "Add a workspace-visible calendar layer.",
    params: z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict(),
    manifestOperation: "manage_layer",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "layer.rename",
    description: "Rename an owned calendar layer.",
    params: z
      .object({ layerId: identifier, name: z.string().trim().min(1).max(120) })
      .strict(),
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.setColor",
    description:
      "Change an owned calendar colour or a personal source overlay colour.",
    params: z
      .object({
        layerId: identifier,
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict(),
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.moveEarlier",
    description: "Move an owned calendar earlier in the legend order.",
    params: layerTarget,
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.moveLater",
    description: "Move an owned calendar later in the legend order.",
    params: layerTarget,
    manifestOperation: "manage_layer",
    exposed: true,
  },
  {
    localId: "layer.toggleLock",
    description:
      "Lock or unlock an owned calendar against accidental event edits.",
    params: layerTarget,
    manifestOperation: "manage_layer",
    exposed: true,
    risk: "confirm",
  },
  {
    localId: "layer.deleteEmpty",
    description: "Delete an empty owned calendar layer.",
    params: layerTarget,
    manifestOperation: "manage_layer",
    exposed: true,
    risk: "destructive",
  },

  {
    localId: "event.addPersonal",
    description: "Add private time without changing shared artifact content.",
    params: z
      .object({ start: dateTime.optional(), layerId: identifier.optional() })
      .strict(),
    manifestOperation: "add_event",
    exposed: true,
  },
  {
    localId: "event.addShared",
    description: "Add workspace-visible time to an editable shared layer.",
    params: z
      .object({ start: dateTime.optional(), layerId: identifier.optional() })
      .strict(),
    manifestOperation: "add_event",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "event.addStudy",
    description: "Add a focused study block.",
    params: z
      .object({
        start: dateTime.optional(),
        durationMinutes: z.number().int().min(15).max(1_440).optional(),
      })
      .strict(),
    manifestOperation: "propose_study_blocks",
    exposed: true,
  },
  {
    localId: "event.move",
    description: "Move an editable event while preserving its duration.",
    params: z.object({ eventId: identifier, start: dateTime }).strict(),
    manifestOperation: "move_event",
    exposed: true,
  },
  {
    localId: "event.resize",
    description: "Resize an editable event with end-after-start validation.",
    params: z.object({ eventId: identifier, end: dateTime }).strict(),
    manifestOperation: "resize_event",
    exposed: true,
  },
  {
    localId: "event.delete",
    description: "Delete an editable local or shared event.",
    params: eventTarget,
    manifestOperation: "update_event",
    exposed: true,
    risk: "destructive",
  },

  {
    localId: "overlay.setColor",
    description:
      "Set a personal colour for an event without changing its source.",
    params: z
      .object({
        eventId: identifier,
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
      })
      .strict(),
    manifestOperation: "update_event",
    exposed: true,
  },
  {
    localId: "overlay.setTime",
    description: "Show a source event at an alternative personal time.",
    params: z
      .object({
        eventId: identifier,
        start: dateTime.nullable(),
        end: dateTime.nullable(),
      })
      .strict(),
    manifestOperation: "update_event",
    exposed: true,
  },
  {
    localId: "overlay.setReminder",
    description:
      "Set a private in-app reminder without writing provider reminders.",
    params: z
      .object({
        eventId: identifier,
        minutesBefore: z.number().int().min(0).max(525_600).nullable(),
      })
      .strict(),
    manifestOperation: "update_event",
    exposed: true,
  },
  {
    localId: "overlay.setNote",
    description: "Attach a private note to an event.",
    params: z
      .object({ eventId: identifier, note: z.string().max(250_000) })
      .strict(),
    manifestOperation: "update_event",
    exposed: true,
  },
  {
    localId: "overlay.setHidden",
    description: "Hide or show one event in the personal calendar view.",
    params: z.object({ eventId: identifier, hidden: z.boolean() }).strict(),
    manifestOperation: "update_event",
    exposed: true,
  },
  {
    localId: "overlay.reset",
    description:
      "Reset an event's personal colour, time, reminder, note, and visibility.",
    params: eventTarget,
    manifestOperation: "update_event",
    exposed: true,
    risk: "confirm",
  },

  {
    localId: "recurrence.setFrequency",
    description: "Set a daily, weekly, monthly, or non-repeating series.",
    params: z
      .object({
        eventId: identifier,
        frequency: z.enum(["none", "daily", "weekly", "monthly"]),
      })
      .strict(),
    manifestOperation: "set_recurrence",
    exposed: true,
  },
  {
    localId: "recurrence.setInterval",
    description: "Repeat an event every N days, weeks, or months.",
    params: z
      .object({
        eventId: identifier,
        interval: z.number().int().min(1).max(365),
      })
      .strict(),
    manifestOperation: "set_recurrence",
    exposed: true,
  },
  {
    localId: "recurrence.setWeekdays",
    description: "Choose the weekdays for a weekly series.",
    params: z
      .object({
        eventId: identifier,
        weekdays: z
          .array(z.enum(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]))
          .min(1)
          .max(7),
      })
      .strict(),
    manifestOperation: "set_recurrence",
    exposed: true,
  },
  {
    localId: "recurrence.setEnd",
    description: "End a recurring series never, on a date, or after a count.",
    params: z.discriminatedUnion("kind", [
      z.object({ eventId: identifier, kind: z.literal("never") }).strict(),
      z
        .object({
          eventId: identifier,
          kind: z.literal("date"),
          until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict(),
      z
        .object({
          eventId: identifier,
          kind: z.literal("count"),
          count: z.number().int().min(1).max(500),
        })
        .strict(),
    ]),
    manifestOperation: "set_recurrence",
    exposed: true,
  },
  {
    localId: "recurrence.skipOccurrence",
    description: "Skip one occurrence while retaining the recurring series.",
    params: z
      .object({ eventId: identifier, occurrenceStart: dateTime })
      .strict(),
    manifestOperation: "set_recurrence",
    exposed: true,
    risk: "confirm",
  },

  {
    localId: "import.file",
    description:
      "Import an ICS or CSV file while retaining its original and reporting adaptations.",
    params: z.object({ format: z.enum(["ics", "csv"]) }).strict(),
    manifestOperation: "reconcile_source",
    requires: "edit",
  },
  {
    localId: "export.csv",
    description: "Export visible calendar events as CSV.",
    manifestOperation: "inspect_range",
  },
  {
    localId: "print.current",
    description:
      "Print the current calendar range or save it as PDF through the browser.",
    manifestOperation: "inspect_range",
  },

  {
    localId: "layer.renameProvider",
    description: "Rename or delete a provider-owned calendar.",
    manifestOperation: "manage_layer",
    disabledReason:
      "This calendar is managed by its provider. Rename or delete it there, then refresh Spectra.",
  },
  {
    localId: "event.editSource",
    description: "Edit provider-owned event fields.",
    manifestOperation: "reconcile_source",
    disabledReason:
      "Source title, time, location, attendees, and permissions are read-only here. Personal overlays remain available.",
  },
  {
    localId: "recurrence.editCustom",
    description: "Rewrite an imported custom recurrence rule.",
    params: recurrenceTarget,
    manifestOperation: "set_recurrence",
    disabledReason:
      "This imported recurrence rule is preserved exactly but is outside Spectra's editable subset. Change it in its source.",
  },
  {
    localId: "export.pdf",
    description: "Generate a calendar PDF directly.",
    manifestOperation: "inspect_range",
    disabledReason:
      "Direct PDF generation is not available. Use Print / save PDF to keep the current calendar layout.",
  },
];

export const TIMETABLE_STUDIO_CAPABILITIES: readonly CapabilityDefinition[] =
  TIMETABLE_SPECS.map((spec) => {
    const id = `timetable.${spec.localId}` as CapabilityDefinition["id"];
    return {
      id,
      params: spec.params ?? none,
      scope: "artifact",
      availability: (context) => {
        if (spec.disabledReason)
          return { state: "disabled" as const, reason: spec.disabledReason };
        if (spec.requires && !context.can(spec.requires))
          return { state: "hidden" as const };
        return { state: "enabled" as const };
      },
      execute: { editor: id },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: spec.risk ?? "safe",
      },
      choreography: { target: "workbar-command", region: id },
      manifestOperation: spec.manifestOperation,
      ...(spec.requires ? { requires: spec.requires } : {}),
    } satisfies CapabilityDefinition;
  });
