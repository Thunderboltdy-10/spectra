import { z } from "zod";
import type { ArtifactBlueprint } from "../core";

export const documentContentSchema = z.object({
  blocks: z.array(z.object({
    id: z.string().trim().min(1),
    type: z.enum(["paragraph", "heading", "quote", "callout", "list", "math", "equation", "code", "task", "table"]),
    text: z.string().optional(),
    latex: z.string().max(12_000).optional(),
    attrs: z.object({
      level: z.number().int().min(1).max(3).optional(),
      alignment: z.enum(["left", "center", "right"]).optional(),
      display: z.enum(["inline", "block"]).optional(),
      language: z.string().max(48).optional(),
      tone: z.enum(["info", "note", "warning", "success"]).optional(),
      checked: z.boolean().optional(),
    }).passthrough().optional(),
  }).passthrough()),
  outline: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
  }).passthrough()).optional(),
  tiptap: z.unknown().optional(),
}).passthrough();

export const documentBlueprint: ArtifactBlueprint = {
  key: "document",
  name: "Document",
  description: "Structured writing, notes, and study explanations.",
  version: 2,
  schema: documentContentSchema,
  defaultContent: {
    blocks: [{ id: "intro", type: "paragraph", text: "" }],
  },
  rendererKey: "document",
  operations: ["create", "append", "rewrite_selection", "summarize", "outline", "add_to_workspace"],
  searchableFields: ["blocks.text", "outline.title"],
};
