import { z } from "zod";
import { documentContentSchema } from "../blueprints/document";
import { flashcardDeckContentSchema } from "../blueprints/flashcard-deck";
import { plannerTaskContentSchema } from "../blueprints/planner-task";
import { quizContentSchema } from "../blueprints/quiz";
import {
  inspectCodeNetworkOrigin,
  MAX_CODE_NETWORK_ORIGINS,
} from "../code/network-policy";

const id = z.string().trim().min(1).max(180);
const text = z.string().max(250_000);
const codeSource = z.string().max(900_000);

export {
  documentContentSchema,
  flashcardDeckContentSchema,
  plannerTaskContentSchema,
  quizContentSchema,
};

export const agentContentSchema = z
  .object({
    profile: z.object({
      purpose: z.string().max(4_000),
      outcomes: z.array(z.string().min(1).max(500)).max(30),
      audienceIntent: z.string().max(1_000),
      inScope: z.array(z.string().min(1).max(500)).max(100),
      outOfScope: z.array(z.string().min(1).max(500)).max(100),
    }),
    instructions: z.object({ regionId: id, text }),
    skills: z.array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        instructions: text,
        enabled: z.boolean(),
      }),
    ),
    tools: z.array(
      z.object({
        id,
        key: z.string().min(1).max(100),
        enabled: z.boolean(),
        approval: z.enum(["never", "consequential", "always"]),
      }),
    ),
    resources: z.array(
      z.object({
        id,
        artifactId: id,
        mode: z.enum(["read", "use"]),
        label: z.string().max(160),
        versionPolicy: z.enum(["reviewed", "latest"]),
        pinnedVersionId: id.optional(),
      }),
    ),
    routing: z.object({
      enabled: z.boolean(),
      description: z.string().max(4_000),
      examples: z.array(z.string().max(500)).max(50),
      negativeExamples: z.array(z.string().max(500)).max(50),
    }),
    behavior: z.object({
      clarification: z.enum(["ask_when_needed", "confirm", "never_ask"]),
      tone: z.enum(["warm", "direct", "socratic", "formal", "playful"]),
      responseLength: z.enum(["concise", "balanced", "detailed"]),
      boundaries: z.array(z.string().min(1).max(500)).max(100),
    }),
    modelPolicy: z.object({
      mode: z.enum(["spectra_default", "reasoning", "fast"]),
      allowFallback: z.boolean(),
    }),
    runtimeBudget: z
      .object({
        maxTurns: z.number().int().min(4).max(40),
        maxToolCalls: z.number().int().min(4).max(100),
        maxElapsedMs: z.number().int().min(30_000).max(600_000),
        maxTotalTokens: z.number().int().min(20_000).max(500_000),
      })
      .optional(),
    evals: z
      .array(
        z.object({
          id,
          prompt: z.string().max(4_000),
          expected: z.string().max(4_000),
          category: z.string().min(1).max(100),
          required: z.boolean(),
        }),
      )
      .max(200),
    releaseNotes: z.string().max(4_000),
  })
  .strict();

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

const slideObjectSchema = z
  .object({
    id,
    type: z.enum([
      "text",
      "shape",
      "image",
      "chart",
      "table",
      "embed",
      "video",
      "group",
    ]),
    x: z.number().min(0).max(1_000),
    y: z.number().min(0).max(750),
    width: z.number().positive().max(1_000),
    height: z.number().positive().max(750),
    rotation: z.number().min(-360).max(360),
    content: z.unknown(),
    style: z.record(z.string(), z.unknown()).optional(),
    altText: z.string().max(2_000).optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    readingOrder: z.number().int().nonnegative().optional(),
    parentId: id.optional(),
    componentId: id.optional(),
    sourceBinding: z
      .object({
        artifactId: id,
        kind: z.enum(["artifact", "sheets_range"]),
        range: z.string().max(160).optional(),
        versionId: id.optional(),
        live: z.boolean().optional(),
      })
      .strict()
      .optional(),
    animation: z
      .object({
        kind: z.enum(["none", "fade", "rise", "scale", "wipe"]),
        durationMs: z.number().min(0).max(10_000).optional(),
        delayMs: z.number().min(0).max(30_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const presentationContentSchema = z
  .object({
    theme: z
      .object({
        id,
        name: z.string().max(120).optional(),
        tokens: z.record(z.string(), z.string()).optional(),
        fonts: z
          .object({
            heading: z.string().max(160).optional(),
            body: z.string().max(160).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    slides: z
      .array(
        z
          .object({
            id,
            title: z.string().max(300),
            speakerNotes: text.optional(),
            objects: z.array(slideObjectSchema).max(500),
            layoutId: id.optional(),
            masterId: id.optional(),
            sectionId: id.optional(),
            background: z.string().max(100).optional(),
            transition: z
              .object({
                kind: z.enum(["none", "fade", "push", "dissolve"]),
                durationMs: z.number().min(0).max(10_000).optional(),
              })
              .strict()
              .optional(),
            citations: z
              .array(
                z
                  .object({
                    id,
                    label: z.string().min(1).max(500),
                    url: z.string().max(2_000).optional(),
                  })
                  .strict(),
              )
              .max(100)
              .optional(),
            accessibility: z
              .object({
                label: z.string().max(500).optional(),
                readingOrder: z.array(id).max(500).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(1_000)
      .min(1),
    sections: z
      .array(z.object({ id, name: z.string().min(1).max(120) }).strict())
      .max(200)
      .optional(),
    components: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(120),
            object: slideObjectSchema,
          })
          .strict(),
      )
      .max(200)
      .optional(),
    settings: z
      .object({
        aspectRatio: z.enum(["16:9", "4:3"]).optional(),
        defaultTransition: z
          .enum(["none", "fade", "push", "dissolve"])
          .optional(),
        autoAdvanceSeconds: z.number().min(0).max(3_600).optional(),
        showSlideNumbers: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((deck, context) => {
    const slideIds = new Set<string>();
    const objectIds = new Set<string>();
    const componentIds = new Set<string>();
    const sectionIds = new Set<string>();
    const canvasHeight = deck.settings?.aspectRatio === "4:3" ? 750 : 562.5;
    deck.sections?.forEach((section, sectionIndex) => {
      if (sectionIds.has(section.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Section IDs must be unique.",
          path: ["sections", sectionIndex, "id"],
        });
      }
      sectionIds.add(section.id);
    });
    deck.slides.forEach((slide, slideIndex) => {
      if (slideIds.has(slide.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Slide IDs must be unique.",
          path: ["slides", slideIndex, "id"],
        });
      }
      slideIds.add(slide.id);
      if (slide.sectionId && !sectionIds.has(slide.sectionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A slide section must reference a declared section.",
          path: ["slides", slideIndex, "sectionId"],
        });
      }
      const slideObjectIds = new Set(slide.objects.map((object) => object.id));
      const slideObjectsById = new Map(
        slide.objects.map((object) => [object.id, object]),
      );
      slide.objects.forEach((object, objectIndex) => {
        if (objectIds.has(object.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Object IDs must be unique across the deck.",
            path: ["slides", slideIndex, "objects", objectIndex, "id"],
          });
        }
        objectIds.add(object.id);
        if (
          object.x + object.width > 1_000 ||
          object.y + object.height > canvasHeight
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Slide objects must remain within the scene bounds.",
            path: ["slides", slideIndex, "objects", objectIndex],
          });
        }
        if (
          object.sourceBinding?.kind === "sheets_range" &&
          !object.sourceBinding.range?.trim()
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Sheets-backed objects require a source range.",
            path: [
              "slides",
              slideIndex,
              "objects",
              objectIndex,
              "sourceBinding",
              "range",
            ],
          });
        }
        if (
          object.parentId &&
          slideObjectsById.get(object.parentId)?.type !== "group"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Grouped objects must reference a group on the same slide.",
            path: ["slides", slideIndex, "objects", objectIndex, "parentId"],
          });
        }
        if (object.type === "group") {
          const content =
            object.content &&
            typeof object.content === "object" &&
            !Array.isArray(object.content)
              ? (object.content as Record<string, unknown>)
              : {};
          const childIds = Array.isArray(content.childIds)
            ? content.childIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          if (
            childIds.length < 2 ||
            childIds.some(
              (childId) =>
                slideObjectsById.get(childId)?.parentId !== object.id,
            )
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Groups require at least two matching child objects.",
              path: ["slides", slideIndex, "objects", objectIndex, "content"],
            });
          }
        }
      });
      slide.accessibility?.readingOrder?.forEach((objectId, orderIndex) => {
        if (!slideObjectIds.has(objectId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Reading order references an object outside this slide.",
            path: [
              "slides",
              slideIndex,
              "accessibility",
              "readingOrder",
              orderIndex,
            ],
          });
        }
      });
    });
    deck.components?.forEach((component, componentIndex) => {
      if (componentIds.has(component.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reusable component IDs must be unique.",
          path: ["components", componentIndex, "id"],
        });
      }
      componentIds.add(component.id);
      if (component.object.componentId !== component.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A reusable component template must reference its component ID.",
          path: ["components", componentIndex, "object", "componentId"],
        });
      }
    });
  });

const cellSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  formula: z.string().max(8_000).optional(),
  format: z
    .object({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      numberFormat: z
        .enum(["general", "number", "currency", "percent", "date"])
        .optional(),
      decimals: z.number().int().min(0).max(12).optional(),
      fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
      fontSize: z.number().min(6).max(72).optional(),
      textColor: z.string().max(80).optional(),
      fillColor: z.string().max(80).optional(),
    })
    .optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(20_000).optional(),
  provenance: z
    .object({
      source: z.string().max(500).optional(),
      importedAt: z.number().optional(),
    })
    .optional(),
});
export const sheetsContentSchema = z
  .object({
    workbook: z.object({
      calculationMode: z.enum(["automatic", "manual"]),
      locale: z.string().min(2).max(40),
      timezone: z.string().max(100).optional(),
      namedRanges: z.record(z.string(), z.string()).optional(),
      calculationVersion: z.number().int().positive().optional(),
    }),
    sheets: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(100),
          cells: z.record(z.string().regex(/^[A-Z]+[1-9][0-9]*$/), cellSchema),
          tables: z.array(
            z.object({
              id,
              name: z.string().min(1).max(100),
              range: z.string().min(2).max(100),
              filters: z
                .array(
                  z.object({
                    column: z.number().int().nonnegative().max(16_383),
                    allowedValues: z
                      .array(
                        z.union([
                          z.string(),
                          z.number(),
                          z.boolean(),
                          z.null(),
                        ]),
                      )
                      .max(10_000),
                  }),
                )
                .max(16_384)
                .optional(),
              sort: z
                .object({
                  column: z.number().int().nonnegative().max(16_383),
                  direction: z.enum(["asc", "desc"]),
                })
                .optional(),
            }),
          ),
          charts: z.array(
            z.object({
              id,
              type: z.enum([
                "column",
                "bar",
                "line",
                "area",
                "pie",
                "scatter",
                "combo",
                "histogram",
              ]),
              sourceRange: z.string().min(2).max(100),
              title: z.string().max(300),
              position: z.object({
                x: z.number(),
                y: z.number(),
                width: z.number().positive(),
                height: z.number().positive(),
              }),
            }),
          ),
          rowCount: z.number().int().positive().max(1_000_000).optional(),
          columnCount: z.number().int().positive().max(16_384).optional(),
          frozenRows: z.number().int().nonnegative().optional(),
          frozenColumns: z.number().int().nonnegative().optional(),
          hiddenRows: z.array(z.number().int().nonnegative()).optional(),
          hiddenColumns: z.array(z.number().int().nonnegative()).optional(),
          columnWidths: z.record(z.string(), z.number().positive()).optional(),
          rowHeights: z.record(z.string(), z.number().positive()).optional(),
          mergedRanges: z
            .array(
              z.string().regex(/^[A-Z]+[1-9][0-9]*(?::[A-Z]+[1-9][0-9]*)?$/),
            )
            .max(10_000)
            .optional(),
          conditionalFormats: z
            .array(
              z.discriminatedUnion("kind", [
                z.object({
                  id,
                  range: z.string().min(2).max(100),
                  kind: z.literal("color_scale"),
                  minimumColor: z.string().max(80),
                  maximumColor: z.string().max(80),
                }),
                z.object({
                  id,
                  range: z.string().min(2).max(100),
                  kind: z.literal("cell_is"),
                  operator: z.enum(["greater_than", "less_than", "equal_to"]),
                  value: z.number(),
                  fillColor: z.string().max(80),
                  textColor: z.string().max(80).optional(),
                }),
              ]),
            )
            .max(10_000)
            .optional(),
          rowIdentities: z.record(z.string(), id).optional(),
          columnIdentities: z.record(z.string(), id).optional(),
        }),
      )
      .min(1),
    activeSheetId: id,
  })
  .strict();

export const codeContentSchema = z
  .object({
    runtime: z.enum(["browser", "react", "python", "none"]),
    runtimeVersion: z.string().min(1).max(60).optional(),
    entryFileId: id,
    files: z
      .array(
        z
          .object({
            id,
            path: z.string().min(1).max(500),
            language: z.string().min(1).max(60),
            source: codeSource,
            lineIds: z.array(id).optional(),
            mediaType: z.string().max(150).optional(),
            generated: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
    visualisation: z
      .object({
        enabled: z.boolean(),
        title: z.string().max(300).optional(),
        description: z.string().max(2_000).optional(),
        openMode: z.enum(["source", "preview"]).optional(),
        aspectRatio: z.number().positive().max(5).optional(),
      })
      .strict(),
    dependencies: z.record(z.string(), z.string()).optional(),
    preview: z
      .object({
        orientation: z.enum(["horizontal", "vertical"]).optional(),
        autoRun: z.boolean().optional(),
        height: z.number().int().min(240).max(1_400).optional(),
      })
      .strict()
      .optional(),
    networkPolicy: z
      .object({
        mode: z.enum(["none", "allowlist"]),
        allowlist: z
          .array(z.string().trim().min(1).max(500))
          .max(MAX_CODE_NETWORK_ORIGINS)
          .optional(),
      })
      .strict()
      .optional(),
    environmentSchema: z
      .array(
        z
          .object({
            key: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
            description: z.string().max(500).optional(),
            required: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    tests: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            fileId: id.optional(),
            source: codeSource,
            enabled: z.boolean().optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    parameters: z
      .array(
        z
          .object({
            id,
            key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
            label: z.string().trim().min(1).max(160),
            description: z.string().max(500).optional(),
            type: z.enum(["number", "text", "boolean", "select"]),
            value: z.union([
              z.string().max(2_000),
              z.number().finite(),
              z.boolean(),
            ]),
            min: z.number().finite().optional(),
            max: z.number().finite().optional(),
            step: z.number().positive().finite().optional(),
            options: z
              .array(z.string().trim().min(1).max(160))
              .max(40)
              .optional(),
          })
          .strict(),
      )
      .max(80)
      .optional(),
    assets: z
      .array(
        z
          .object({
            id,
            assetId: id,
            path: z.string().trim().min(1).max(500),
            name: z.string().trim().min(1).max(240),
            mediaType: z.string().trim().min(1).max(150),
            bytes: z.number().int().positive().max(8_000_000),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    resourceBindings: z
      .array(
        z
          .object({
            id,
            artifactId: id,
            kind: z.enum(["artifact", "sheets_range", "asset"]),
            range: z.string().max(200).optional(),
            label: z.string().max(300).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    accessibility: z
      .object({
        title: z.string().max(300).optional(),
        description: z.string().max(2_000).optional(),
        reducedMotion: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.files.some((file) => file.id === value.entryFileId)) {
      context.addIssue({
        code: "custom",
        path: ["entryFileId"],
        message: "The entry file must exist in the artifact source tree.",
      });
    }
    const paths = new Set<string>();
    const fileIds = new Set<string>();
    const lineIds = new Set<string>();
    let sourceBytes = 0;
    value.files.forEach((file, index) => {
      if (fileIds.has(file.id)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "id"],
          message: "Source file identities must be unique.",
        });
      }
      fileIds.add(file.id);
      const normalized = file.path.replaceAll("\\", "/");
      if (
        normalized.startsWith("/") ||
        normalized.split("/").some((part) => part === "..")
      ) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: "Source paths must remain inside the artifact root.",
        });
      }
      const key = normalized.toLowerCase();
      if (paths.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: "Source file paths must be unique.",
        });
      }
      paths.add(key);
      sourceBytes += new TextEncoder().encode(file.source).byteLength;
      if (
        file.lineIds &&
        file.lineIds.length !== file.source.split("\n").length
      ) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "lineIds"],
          message:
            "Stable line identities must match the current source lines.",
        });
      }
      file.lineIds?.forEach((lineId, lineIndex) => {
        if (lineIds.has(lineId)) {
          context.addIssue({
            code: "custom",
            path: ["files", index, "lineIds", lineIndex],
            message: "Stable line identities must be unique in the artifact.",
          });
        }
        lineIds.add(lineId);
      });
    });
    if (sourceBytes > 900_000) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Live source exceeds the 900 KB artifact limit.",
      });
    }
    const testBytes = (value.tests ?? []).reduce(
      (total, test) => total + new TextEncoder().encode(test.source).byteLength,
      0,
    );
    const testIds = new Set<string>();
    (value.tests ?? []).forEach((test, index) => {
      if (testIds.has(test.id)) {
        context.addIssue({
          code: "custom",
          path: ["tests", index, "id"],
          message: "Executable check identities must be unique.",
        });
      }
      testIds.add(test.id);
    });
    if (testBytes > 300_000) {
      context.addIssue({
        code: "custom",
        path: ["tests"],
        message: "Executable checks exceed the 300 KB artifact limit.",
      });
    }
    const environmentKeys = new Set<string>();
    (value.environmentSchema ?? []).forEach((variable, index) => {
      if (environmentKeys.has(variable.key)) {
        context.addIssue({
          code: "custom",
          path: ["environmentSchema", index, "key"],
          message: "Environment declaration names must be unique.",
        });
      }
      environmentKeys.add(variable.key);
    });
    const parameterIds = new Set<string>();
    const parameterKeys = new Set<string>();
    (value.parameters ?? []).forEach((parameter, index) => {
      if (parameterIds.has(parameter.id)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "id"],
          message: "Visualisation parameter identities must be unique.",
        });
      }
      parameterIds.add(parameter.id);
      if (parameterKeys.has(parameter.key)) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "key"],
          message: "Visualisation parameter keys must be unique.",
        });
      }
      parameterKeys.add(parameter.key);
      const expected =
        parameter.type === "number"
          ? "number"
          : parameter.type === "boolean"
            ? "boolean"
            : "string";
      if (typeof parameter.value !== expected) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "value"],
          message: `A ${parameter.type} parameter requires a ${expected} value.`,
        });
      }
      if (
        parameter.type === "select" &&
        (!parameter.options?.length ||
          !parameter.options.includes(String(parameter.value)))
      ) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "options"],
          message:
            "Select parameters need options containing the current value.",
        });
      }
      if (
        parameter.type === "number" &&
        parameter.min !== undefined &&
        parameter.max !== undefined &&
        parameter.min > parameter.max
      ) {
        context.addIssue({
          code: "custom",
          path: ["parameters", index, "min"],
          message: "The minimum cannot exceed the maximum.",
        });
      }
    });
    const assetReferenceIds = new Set<string>();
    const assetIds = new Set<string>();
    const assetPaths = new Set<string>();
    let assetBytes = 0;
    (value.assets ?? []).forEach((asset, index) => {
      const normalizedPath = asset.path.replaceAll("\\", "/");
      if (
        normalizedPath.startsWith("/") ||
        normalizedPath.split("/").some((part) => part === ".." || !part)
      ) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "path"],
          message: "Asset paths must remain inside the artifact root.",
        });
      }
      if (assetReferenceIds.has(asset.id) || assetIds.has(asset.assetId)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "id"],
          message: "Asset identities must be unique in the artifact.",
        });
      }
      const pathKey = normalizedPath.toLowerCase();
      if (assetPaths.has(pathKey)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "path"],
          message: "Asset paths must be unique in the artifact.",
        });
      }
      assetReferenceIds.add(asset.id);
      assetIds.add(asset.assetId);
      assetPaths.add(pathKey);
      assetBytes += asset.bytes;
    });
    if (assetBytes > 8_000_000) {
      context.addIssue({
        code: "custom",
        path: ["assets"],
        message: "Current live preview assets cannot exceed 8 MB.",
      });
    }
    const networkOrigins = new Set<string>();
    (value.networkPolicy?.allowlist ?? []).forEach((candidate, index) => {
      const inspected = inspectCodeNetworkOrigin(candidate);
      if (!inspected.ok) {
        context.addIssue({
          code: "custom",
          path: ["networkPolicy", "allowlist", index],
          message: inspected.error,
        });
        return;
      }
      if (networkOrigins.has(inspected.origin)) {
        context.addIssue({
          code: "custom",
          path: ["networkPolicy", "allowlist", index],
          message: "Approved network origins must be unique.",
        });
      }
      networkOrigins.add(inspected.origin);
    });
    if (
      value.networkPolicy?.mode === "none" &&
      (value.networkPolicy.allowlist?.length ?? 0) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["networkPolicy", "allowlist"],
        message: "Disabled network policy cannot retain active origins.",
      });
    }
    if (
      (value.runtime === "python" || value.runtime === "none") &&
      value.networkPolicy?.mode === "allowlist"
    ) {
      context.addIssue({
        code: "custom",
        path: ["networkPolicy", "mode"],
        message: "This runtime profile does not support network access.",
      });
    }
    const dependencyVersions: Record<string, string> = {
      recharts: "2.15.4",
      d3: "7.9.0",
      "lucide-react": "0.563.0",
      "date-fns": "4.1.0",
    };
    Object.entries(value.dependencies ?? {}).forEach(([name, version]) => {
      if (
        value.runtime !== "react" ||
        !Object.hasOwn(dependencyVersions, name) ||
        dependencyVersions[name] !== version
      ) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", name],
          message:
            "Runtime dependencies must use a Spectra-curated, pinned React package.",
        });
      }
    });
  });

export const whiteboardContentSchema = z
  .object({
    viewport: z
      .object({
        x: z.number().min(-1_000_000).max(1_000_000),
        y: z.number().min(-1_000_000).max(1_000_000),
        zoom: z.number().min(0.05).max(8),
        pageId: id,
      })
      .strict(),
    pages: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(120),
            background: z.string().max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    nodes: z
      .array(
        z
          .object({
            id,
            type: z.enum([
              "text",
              "note",
              "shape",
              "image",
              "embed",
              "frame",
              "group",
              "table",
              "card",
              "drawing",
            ]),
            pageId: id,
            x: z.number().min(-1_000_000).max(1_000_000),
            y: z.number().min(-1_000_000).max(1_000_000),
            width: z.number().min(20).max(100_000),
            height: z.number().min(20).max(100_000),
            rotation: z.number().min(-360).max(360),
            zIndex: z.number().int().min(-100_000).max(100_000),
            content: z.unknown(),
            style: z.record(z.string(), z.unknown()).optional(),
            layerId: id,
            parentId: id.optional(),
            frameId: id.optional(),
            semanticLabel: z.string().max(500).optional(),
            accessibilityOrder: z.number().int().nonnegative().optional(),
            provenance: z
              .object({
                source: z.string().max(120).optional(),
                sourceId: z.string().max(500).optional(),
                createdAt: z.number().optional(),
              })
              .strict()
              .optional(),
            locked: z.boolean().optional(),
            hidden: z.boolean().optional(),
            constraints: z
              .object({
                horizontal: z
                  .enum(["free", "left", "center", "right"])
                  .optional(),
                vertical: z
                  .enum(["free", "top", "center", "bottom"])
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(100_000),
    edges: z
      .array(
        z
          .object({
            id,
            pageId: id,
            layerId: id,
            from: id,
            to: id,
            fromAnchor: z.string().max(100).optional(),
            toAnchor: z.string().max(100).optional(),
            label: z.string().max(500).optional(),
            style: z.record(z.string(), z.unknown()).optional(),
            locked: z.boolean().optional(),
            zIndex: z.number().int().optional(),
          })
          .strict(),
      )
      .max(200_000),
    layers: z
      .array(
        z
          .object({
            id,
            pageId: id,
            name: z.string().min(1).max(100),
            visible: z.boolean(),
            locked: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(5_000),
    sources: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(500),
            url: z.string().max(2_000).optional(),
            artifactId: id.optional(),
          })
          .strict(),
      )
      .max(5_000)
      .optional(),
    settings: z
      .object({
        gridSize: z.number().min(4).max(200).optional(),
        snapToGrid: z.boolean().optional(),
        showGrid: z.boolean().optional(),
        canvasColor: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((board, context) => {
    const pageIds = new Set<string>();
    const layerIds = new Set<string>();
    const nodeIds = new Set<string>();
    board.pages.forEach((page, index) => {
      if (pageIds.has(page.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Page IDs must be unique.",
          path: ["pages", index, "id"],
        });
      pageIds.add(page.id);
    });
    board.layers.forEach((layer, index) => {
      if (layerIds.has(layer.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Layer IDs must be unique.",
          path: ["layers", index, "id"],
        });
      if (!pageIds.has(layer.pageId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Layer page is unavailable.",
          path: ["layers", index, "pageId"],
        });
      layerIds.add(layer.id);
    });
    if (!pageIds.has(board.viewport.pageId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Viewport page is unavailable.",
        path: ["viewport", "pageId"],
      });
    board.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Node IDs must be unique.",
          path: ["nodes", index, "id"],
        });
      if (!pageIds.has(node.pageId) || !layerIds.has(node.layerId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Node page and layer must exist.",
          path: ["nodes", index],
        });
      nodeIds.add(node.id);
    });
    const edgeIds = new Set<string>();
    board.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Connector IDs must be unique.",
          path: ["edges", index, "id"],
        });
      if (
        !nodeIds.has(edge.from) ||
        !nodeIds.has(edge.to) ||
        edge.from === edge.to
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Connector endpoints must be distinct nodes.",
          path: ["edges", index],
        });
      edgeIds.add(edge.id);
    });
    board.nodes.forEach((node, index) => {
      if (node.parentId && !nodeIds.has(node.parentId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Node parent must exist.",
          path: ["nodes", index, "parentId"],
        });
      if (node.frameId && !nodeIds.has(node.frameId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Node frame must exist.",
          path: ["nodes", index, "frameId"],
        });
    });
  });

export const artifactContentSchemas = {
  document: documentContentSchema,
  flashcard_deck: flashcardDeckContentSchema,
  quiz: quizContentSchema,
  planner_task: plannerTaskContentSchema,
  agent: agentContentSchema,
  timetable: timetableContentSchema,
  presentation: presentationContentSchema,
  sheets: sheetsContentSchema,
  code: codeContentSchema,
  whiteboard: whiteboardContentSchema,
} as const;
