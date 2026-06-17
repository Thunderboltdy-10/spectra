import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const documentContentSchema = z.object({
  blocks: z.array(z.object({
    id: z.string(),
    type: z.enum(["paragraph", "heading", "quote", "callout", "list", "math", "code"]),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })),
  outline: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
  })).optional(),
});

export const documentBlueprint: ArtifactBlueprint = {
  key: "document",
  name: "Document",
  description: "Structured writing, notes, and study explanations.",
  version: 1,
  schema: documentContentSchema,
  defaultContent: {
    blocks: [{ id: "intro", type: "paragraph", text: "" }],
  },
  rendererKey: "document",
  operations: ["create", "append", "rewrite_selection", "summarize", "outline", "add_to_workspace"],
  searchableFields: ["blocks.text", "outline.title"],
};

