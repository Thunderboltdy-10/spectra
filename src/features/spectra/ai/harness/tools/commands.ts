import { COMMAND_CATALOG, catalogCommand, type CatalogCommand } from "../../../commands/ai-reach";
import { foldForSearch } from "../../../../../../shared/semantic-chunks";
import { ToolInputError, type AnyHarnessTool, type HarnessTool, type ToolEffect } from "../types";
import { commandTool } from "./app";
import { oneOf, optionalNumber, optionalString, requireString, type HarnessSession } from "./shared";

/*
 * The command catalog, for the model. find_commands finds what a user can do
 * in Spectra and how Spectra reaches it; run_command runs one through the
 * same harness tool, so the effect, the category and the user's permissions
 * decide exactly as if that tool had been called. Actions only the user may
 * take, including every permission change, are refused with the reason.
 */

const SYNC_PATCH_KEYS = {
  preset: ["spectra", "device", "both", "linked"],
  contentDirection: ["local-to-spectra", "spectra-to-local", "bidirectional", "manual"],
  discovery: ["auto", "ask", "explicit"],
  structure: ["independent", "mirror-to-disk", "mirror-from-disk", "mirror-both", "ask"],
  cloudContent: ["full", "metadata-only", "none"],
  timing: ["continuous", "on-save-open", "manual"],
} as const;

function ids(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((entry) => typeof entry !== "string" || !entry.trim()))
    throw new ToolInputError(`${key} must be a list of 1 to 100 ids.`);
  return value.map((entry: string) => entry.trim());
}

/** Commands only run_command reaches. They have no first-class tool. */
export function runOnlyTools(session: HarnessSession): AnyHarnessTool[] {
  return [
    commandTool(session, {
      name: "change_sync_policy",
      description:
        "Change how library items sync with the user's computer: targetIds and a patch of preset, contentDirection, discovery, structure, cloudContent, timing, protectedOriginal, includeGlobs or excludeGlobs.",
      parameters: {
        type: "object",
        properties: {
          targetIds: { type: "array", items: { type: "string" } },
          patch: { type: "object", additionalProperties: true },
        },
        required: ["targetIds", "patch"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: "bridge_files",
      label: () => "Changing how items sync",
      doneLabel: () => "Changed how items sync",
      question: (args: { targetIds: string[] }) =>
        `Change how ${args.targetIds.length === 1 ? "this item syncs" : `these ${args.targetIds.length} items sync`} with your computer?`,
      parse: (raw) => {
        const patchRaw = raw.patch;
        if (!patchRaw || typeof patchRaw !== "object" || Array.isArray(patchRaw)) throw new ToolInputError("patch must be an object.");
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patchRaw as Record<string, unknown>)) {
          if (key in SYNC_PATCH_KEYS) {
            const allowed = SYNC_PATCH_KEYS[key as keyof typeof SYNC_PATCH_KEYS] as readonly string[];
            if (typeof value !== "string" || !allowed.includes(value)) throw new ToolInputError(`patch.${key} must be one of ${allowed.join(", ")}.`);
            patch[key] = value;
          } else if (key === "protectedOriginal") {
            if (typeof value !== "boolean") throw new ToolInputError("patch.protectedOriginal must be true or false.");
            patch[key] = value;
          } else if (key === "includeGlobs" || key === "excludeGlobs") {
            if (!Array.isArray(value) || value.length > 50 || value.some((glob) => typeof glob !== "string" || !glob.trim() || glob.length > 200))
              throw new ToolInputError(`patch.${key} must be a list of up to 50 patterns.`);
            patch[key] = value;
          } else if (key === "localMirrorGrantId") {
            throw new ToolInputError("Only the user picks a folder on their computer. Point them to Bridge setup.");
          } else throw new ToolInputError(`patch.${key} is not a sync setting.`);
        }
        if (!Object.keys(patch).length) throw new ToolInputError("patch is empty.");
        return { targetIds: ids(raw, "targetIds"), patch };
      },
      command: (args) => ({ command: "change_sync_policy", args }),
    }),
    commandTool(session, {
      name: "insert_reference",
      description: "Insert a live reference to one work (targetWorkId) inside another (hostWorkId), with an optional label.",
      parameters: {
        type: "object",
        properties: { hostWorkId: { type: "string" }, targetWorkId: { type: "string" }, label: { type: "string" } },
        required: ["hostWorkId", "targetWorkId"],
        additionalProperties: false,
      },
      effect: "write",
      label: () => "Inserting a reference",
      doneLabel: () => "Inserted a reference",
      parse: (raw) => {
        const label = optionalString(raw, "label", 160);
        return { hostWorkId: requireString(raw, "hostWorkId", 200), targetWorkId: requireString(raw, "targetWorkId", 200), ...(label ? { label } : {}) };
      },
      command: (args) => ({ command: "insert_reference", args }),
    }),
  ] as unknown as AnyHarnessTool[];
}

/* Ranking. Words are folded and lightly stemmed; a query word also reaches
 * the words that mean the same thing here ("delete" finds the Trash). */
const CONCEPTS: readonly (readonly string[])[] = [
  ["delete", "remove", "trash", "bin", "erase", "discard", "rid"],
  ["open", "show", "go", "navigate", "view", "see", "take", "jump"],
  ["schedule", "calendar", "event", "meeting", "appointment", "book", "plan", "block", "agenda"],
  ["share", "invite", "access", "collaborate", "permission", "send"],
  ["setting", "preference", "option", "theme", "dark", "light", "appearance", "mode", "density"],
  ["remember", "memory", "note", "forget", "keep"],
  ["folder", "organize", "organise", "move", "rename", "sort", "tidy", "file"],
  ["sync", "refresh", "update", "pull", "storage", "mirror", "offline"],
  ["school", "managebac", "class", "deadline", "cas", "timetable"],
  ["comment", "feedback", "annotate", "review"],
  ["create", "new", "make", "write", "build", "draft", "generate"],
  ["edit", "change", "fix", "rewrite", "format", "insert", "add"],
  ["find", "search", "look", "where", "locate"],
  ["computer", "desktop", "device", "bridge", "local", "pair"],
  ["chat", "conversation", "thread", "message", "talk"],
  ["agent", "specialist", "assistant"],
  ["publish", "release", "public", "link"],
  ["stop", "cancel", "halt"],
  ["permission", "allow", "control", "authority", "approve"],
];

const STOP = new Set(["a", "an", "the", "to", "of", "for", "in", "on", "my", "me", "i", "it", "this", "that", "and", "or", "with", "can", "you", "please", "how", "do", "is", "be", "from", "into", "some", "all"]);

function stem(word: string) {
  return word.replace(/(ings|ing|ies|es|ed|s)$/, (end) => (end === "ies" ? "y" : "")).replace(/e$/, "");
}

function words(text: string) {
  return foldForSearch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

const CONCEPT_OF = new Map<string, number>();
CONCEPTS.forEach((group, index) => group.forEach((word) => CONCEPT_OF.set(stem(word), index)));

type Indexed = { command: CatalogCommand; title: Set<string>; body: Set<string>; concepts: Set<number> };

const INDEX: readonly Indexed[] = COMMAND_CATALOG.map((command) => {
  const title = new Set(words(`${command.title} ${command.id.replace(/[._]/g, " ")}`));
  const body = new Set(words(`${command.description} ${(command.keywords ?? []).join(" ")} ${command.area}`));
  const concepts = new Set([...title, ...body].map((word) => CONCEPT_OF.get(word)).filter((value): value is number => value !== undefined));
  return { command, title, body, concepts };
});

/** Catalog commands ranked for a query, best first. */
export function rankCommands(query: string, options: { area?: string; limit?: number } = {}) {
  const terms = words(query);
  const scored = INDEX.filter((entry) => !options.area || entry.command.area === options.area).map((entry) => {
    let score = 0;
    for (const term of terms) {
      if (entry.title.has(term)) score += 3;
      else if (entry.body.has(term)) score += 2;
      else {
        const concept = CONCEPT_OF.get(term);
        if (concept !== undefined && entry.concepts.has(concept)) score += 1;
      }
    }
    if (entry.command.reach.kind === "tool") score += 0.1;
    return { command: entry.command, score };
  });
  return scored
    .filter((entry) => entry.score >= 1 || (!terms.length && options.area))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 6)
    .map((entry) => entry.command);
}

function argsHint(tool: AnyHarnessTool | undefined, fixed: Record<string, unknown> = {}) {
  const schema = tool?.parameters as { properties?: Record<string, { type?: string; enum?: string[] }>; required?: string[] } | undefined;
  const properties = Object.entries(schema?.properties ?? {}).filter(([key]) => !(key in fixed));
  if (!properties.length) return "{}";
  const required = new Set(schema?.required ?? []);
  return `{${properties
    .map(([key, value]) => `${key}${required.has(key) ? "" : "?"}: ${value.enum ? value.enum.join("|") : (value.type ?? "any")}`)
    .join(", ")}}`;
}

function describe(command: CatalogCommand, tools: Map<string, AnyHarnessTool>) {
  const head = `- ${command.id}: ${command.title}. ${command.description}`;
  if (command.reach.kind === "user") return `${head}\n  Only the user can do this: ${command.reach.reason}`;
  const reach = command.reach;
  const direct = tools.has(reach.tool) && !reach.fixed ? ` (or call ${reach.tool} directly)` : "";
  return `${head}\n  run_command {id: "${command.id}", args: ${argsHint(tools.get(reach.tool), reach.fixed)}}${direct}`;
}

type RunArgs = { command: CatalogCommand; tool: AnyHarnessTool; args: Record<string, unknown> };

const effectOf = (tool: AnyHarnessTool, args: Record<string, unknown>): ToolEffect =>
  typeof tool.effect === "function" ? tool.effect(args) : tool.effect;

/**
 * find_commands and run_command over the given tools: the model's own and
 * the run-only ones. `offered` is the list the model sees, used only to say
 * which commands also have a direct tool.
 */
export function commandTools(runnable: AnyHarnessTool[], offered: AnyHarnessTool[]): AnyHarnessTool[] {
  const byName = new Map(runnable.map((tool) => [tool.name, tool]));
  const direct = new Map(offered.map((tool) => [tool.name, tool]));

  const find: HarnessTool<{ query: string; area?: string; limit: number }> = {
    name: "find_commands",
    description:
      "Find what the user can do in Spectra and how you can do it: navigation, library, settings, calendar, sharing, Bridge, ManageBac, memory, comments, agents and more. Each result says how to run it with run_command, or why only the user can. Use it when no tool you have obviously fits.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the user wants, in their words." },
        area: { type: "string", enum: [...new Set(COMMAND_CATALOG.map((command) => command.area))] },
        limit: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    quiet: true,
    label: () => "Looking for a command",
    parse: (raw) => {
      const area = raw.area === undefined ? undefined : oneOf(raw, "area", [...new Set(COMMAND_CATALOG.map((command) => command.area))]);
      const limit = Math.max(1, Math.min(12, Math.round(optionalNumber(raw, "limit") ?? 6)));
      return { query: requireString(raw, "query", 300), ...(area ? { area } : {}), limit };
    },
    execute: async (args) => {
      const found = rankCommands(args.query, args);
      if (!found.length)
        return {
          ok: true,
          content: `No command matches "${args.query}". Areas: ${[...new Set(COMMAND_CATALOG.map((command) => command.area))].join(", ")}. Try other words or an area.`,
        };
      return { ok: true, content: found.map((command) => describe(command, direct)).join("\n") };
    },
  };

  const run: HarnessTool<RunArgs> = {
    name: "run_command",
    description:
      "Run a Spectra command found with find_commands: {id, args}. It runs with the user's permissions: anything that asks first still asks, and commands only the user may run (such as changing your permissions) are refused.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, args: { type: "object", additionalProperties: true } },
      required: ["id"],
      additionalProperties: false,
    },
    effect: (input) => effectOf(input.tool, input.args),
    category: (input) => input.tool.category?.(input.args),
    label: (input) => (input.tool ? input.tool.label(input.args) : "Running a command"),
    question: (input) => input.tool.question?.(input.args) ?? "",
    targets: (input) => input.tool.targets?.(input.args) ?? [],
    parse: (raw) => {
      const id = requireString(raw, "id", 120);
      const command = catalogCommand(id);
      if (!command) throw new ToolInputError(`There is no command "${id}". Use find_commands to find one.`);
      if (command.reach.kind === "user") throw new ToolInputError(`Only the user can do "${command.title}": ${command.reach.reason}`);
      const tool = byName.get(command.reach.tool);
      if (!tool) throw new ToolInputError(`"${command.title}" is not available in this conversation.`);
      const given = raw.args === undefined ? {} : raw.args;
      if (!given || typeof given !== "object" || Array.isArray(given)) throw new ToolInputError("args must be an object.");
      const merged = { ...(given as Record<string, unknown>), ...(command.reach.fixed ?? {}) };
      return { command, tool, args: tool.parse ? (tool.parse(merged) as Record<string, unknown>) : merged };
    },
    stage: async (input, ctx) => {
      await input.tool.stage?.(input.args, ctx);
    },
    execute: (input, ctx) => input.tool.execute(input.args, ctx),
  };

  return [find, run] as unknown as AnyHarnessTool[];
}
