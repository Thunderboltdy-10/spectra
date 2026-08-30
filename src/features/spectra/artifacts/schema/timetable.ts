import { z } from "zod";
import { sharedTimetableContent } from "../../timetable/model";

const id = z.string().trim().min(1).max(180);
const text = z.string().max(250_000);

export const timetableContentSchema = z
  .object({
    timezone: z.string().min(1).max(100),
    layers: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(120),
            kind: z.enum([
              "personal",
              "school",
              "class",
              "tasks",
              "external",
              "study",
            ]),
            visible: z.boolean(),
            color: z.string().min(1).max(32),
            sourceId: id.optional(),
            authority: z
              .enum(["user", "workspace", "school", "external"])
              .optional(),
            locked: z.boolean().optional(),
          })
          .strict(),
      )
      .max(500),
    events: z
      .array(
        z
          .object({
            id,
            layerId: id,
            title: z.string().min(1).max(300),
            start: z.string().datetime({ offset: true }),
            end: z.string().datetime({ offset: true }),
            allDay: z.boolean(),
            timezone: z.string().min(1).max(100).optional(),
            recurrence: z.string().max(500).optional(),
            recurrenceExceptions: z
              .array(z.string().max(120))
              .max(500)
              .optional(),
            sourceRef: id.optional(),
            sourceVersion: id.optional(),
            sourceHash: z.string().max(180).optional(),
            sourceStatus: z
              .enum(["active", "changed", "removed", "detached"])
              .optional(),
            location: z.string().max(300).optional(),
            videoUrl: z.string().max(2_000).optional(),
            notes: text.optional(),
            status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
            availability: z.enum(["busy", "free"]).optional(),
            artifactIds: z.array(id).max(100).optional(),
            taskId: id.optional(),
            reminders: z
              .array(
                z
                  .object({
                    id,
                    minutesBefore: z.number().min(0).max(525_600),
                    method: z.literal("in_app"),
                  })
                  .strict(),
              )
              .max(50)
              .optional(),
            provenance: z
              .object({
                actor: z.enum(["user", "ai", "source"]).optional(),
                source: z.string().max(300).optional(),
                importedAt: z.number().optional(),
              })
              .strict()
              .optional(),
            locked: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict()
  .superRefine((content, context) => {
    const layerIds = new Set(content.layers.map((layer) => layer.id));
    if (layerIds.size !== content.layers.length) {
      context.addIssue({
        code: "custom",
        path: ["layers"],
        message: "Layer IDs must be unique.",
      });
    }
    const eventIds = new Set<string>();
    content.events.forEach((event, index) => {
      if (eventIds.has(event.id)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "id"],
          message: "Event IDs must be unique.",
        });
      }
      eventIds.add(event.id);
      if (!layerIds.has(event.layerId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "layerId"],
          message: "Event layer must exist.",
        });
      }
      if (Date.parse(event.end) <= Date.parse(event.start)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "end"],
          message: "Event end must follow its start.",
        });
      }
    });
  });

/** Explicit v1 -> v2 migration. Artifact content now retains shared/source
 * truth only; view state, personal layers, and overlays are normalized into the
 * separate user-state seam by the timetable model. */
export function migrateTimetableContentV1ToV2(value: unknown) {
  return sharedTimetableContent(value);
}

export function normalizeTimetableArtifactContent(value: unknown) {
  return migrateTimetableContentV1ToV2(value);
}
