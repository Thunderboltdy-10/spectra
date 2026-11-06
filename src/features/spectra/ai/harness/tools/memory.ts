import type { MemoryChange } from "../../../../../../shared/memory-files";
import { ToolInputError, type HarnessTool } from "../types";
import { optionalString, requireString, type HarnessSession } from "./shared";

/*
 * The agent's own notes about the user. The always-loaded files are already in
 * the environment; these open a topic and change a file. Not the library: work
 * lives in artifacts, skills are guides, and these are what Spectra knows.
 */

export function readMemoryTool(session: HarnessSession): HarnessTool<{ topic: string }> {
  return {
    name: "read_memory",
    description:
      "Open one of your longer notes about the user, by the topic slug listed in the environment. Do it when that topic bears on what they asked; the summary line tells you if it does.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
      additionalProperties: false,
    },
    effect: "read",
    label: () => "Checking my notes",
    parse: (raw) => ({ topic: requireString(raw, "topic", 100) }),
    execute: async (args, ctx) => {
      const topic = await session.backend.readMemoryTopic(args.topic, ctx.signal);
      if (!topic) return { ok: false, content: `There is no topic called ${args.topic}. The environment lists the ones that exist.` };
      return { ok: true, content: `# ${topic.title}\n${topic.summary}\n\n${topic.content}` };
    },
  };
}

const TEXT_FIELDS = ["slug", "title", "summary", "add", "find", "replace", "rewrite"] as const;

export function updateMemoryTool(session: HarnessSession): HarnessTool<MemoryChange> {
  return {
    name: "update_memory",
    description:
      "Change your notes about the user. file about: who they are and what they are doing. file preferences: how they want you to work, each line saying where it applies. file topic: a longer note on one matter, by slug; a new slug needs title and summary. Say what changes with add (a new line), find with replace (exact text; an empty replace removes it), or rewrite (the whole file, when it is near its limit). remove erases a topic. The result says if it saved.",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", enum: ["about", "preferences", "topic"] },
        slug: { type: "string" },
        title: { type: "string" },
        summary: { type: "string", description: "One line that says when this topic is worth opening." },
        add: { type: "string" },
        find: { type: "string" },
        replace: { type: "string" },
        rewrite: { type: "string" },
        remove: { type: "boolean" },
      },
      required: ["file"],
      additionalProperties: false,
    },
    effect: "read",
    label: () => "Updating my notes",
    parse: (raw) => {
      if (raw.file !== "about" && raw.file !== "preferences" && raw.file !== "topic")
        throw new ToolInputError("file must be about, preferences or topic.");
      const change: MemoryChange = { file: raw.file };
      for (const field of TEXT_FIELDS) {
        const value = field === "replace" && raw.replace === "" ? "" : optionalString(raw, field, 8_000);
        if (value !== undefined) change[field] = value;
      }
      if (raw.remove === true) change.remove = true;
      if (change.file === "topic" && !change.slug && !change.title) throw new ToolInputError("A topic needs a slug.");
      return change;
    },
    execute: async (args, ctx) => {
      const result = await session.backend.updateMemory(args, ctx.signal);
      if (result.ok) session.memoryWritten = true;
      return { ok: result.ok, content: result.message };
    },
  };
}
