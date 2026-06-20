import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const threadReferenceContentSchema = z.object({
  threadId: z.string().trim().min(1).nullable(),
  summary: z.string().optional(),
  linkedArtifactIds: z.array(z.string()).optional(),
}).passthrough();

export const threadReferenceBlueprint: ArtifactBlueprint = {
  key: "thread_reference",
  name: "Thread Reference",
  description: "A workspace-ready reference to a useful conversation.",
  version: 1,
  schema: threadReferenceContentSchema,
  defaultContent: {
    threadId: null,
    summary: "",
    linkedArtifactIds: [],
  },
  rendererKey: "thread_reference",
  operations: ["pin_to_workspace", "summarize", "continue", "add_to_workspace"],
  searchableFields: ["summary"],
};
