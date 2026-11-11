import { WORK_TYPE_KEYS, type ArtifactTypeKey } from "../../../artifacts/types";
import { lengthNote } from "../authoring/page-estimate";
import { classifyArtifactContentWipe } from "../../../operations/artifact-content-wipe";
import { normalizeAiArtifactWriteContent } from "../../../operations/artifact-write-content";
import { AuthoringError, authorEdit, authorNew, isAuthoredType, readAuthored, type AuthoredContent, type ReadRange } from "../authoring";
import { formatCheatSheet } from "../authoring/formats";
import { openQuizForPractice } from "../authoring/items";
import { healStrings } from "../authoring/locate";
import { ToolInputError, type HarnessTool } from "../types";
import {
  errorText,
  optionalNumber,
  optionalString,
  rememberTitle,
  requireString,
  titled,
  type HarnessSession,
} from "./shared";

/*
 * create_artifact, edit_artifact and read_artifact. Content is written in each
 * type's authoring format (Markdown, slide specs, A1 ranges, nodes and edges),
 * checked against the same schema and policy as every AI write, and read back
 * so the model sees what landed, including anything empty or broken.
 */

const TYPE_NAMES: Record<string, string> = {
  document: "document",
  presentation: "presentation",
  sheets: "workbook",
  whiteboard: "whiteboard",
  flashcard_deck: "flashcard deck",
  quiz: "quiz",
  planner_task: "task",
  code: "code project",
  agent: "custom agent",
  timetable: "timetable",
};

export function typeName(type: string) {
  return TYPE_NAMES[type] ?? "item";
}

/** The schema, normalisation and content policy every AI write passes. */
function checkWrite(type: ArtifactTypeKey, authored: AuthoredContent, prompt: string) {
  try {
    normalizeAiArtifactWriteContent(type, authored.content, prompt);
  } catch (error) {
    throw new AuthoringError(`The result would not be valid: ${errorText(error)}. Nothing was saved.`);
  }
}

function problemsNote(authored: AuthoredContent) {
  return authored.problems.length
    ? "\nIf a problem above matters, fix them all together in one edit_artifact call."
    : "";
}

/** Code keeps its text as written; everything else has its LaTeX put right. */
const healed = <T,>(type: ArtifactTypeKey, value: T) => (type === "code" ? value : healStrings(value));

/** The edits that did not apply, for a result where the others did. */
function failuresNote(authored: AuthoredContent) {
  if (!authored.failures?.length) return "";
  const applied = (authored.attempted ?? 0) - authored.failures.length;
  return `\n${applied} of ${authored.attempted} edits applied and are saved. These did not:\n${authored.failures.join("\n")}\nSend only these again, corrected.`;
}

type CreateArgs = { type: ArtifactTypeKey; title: string; content: Record<string, unknown>; summary?: string; placeId?: string };

export function createArtifactTool(session: HarnessSession): HarnessTool<CreateArgs> {
  return {
    name: "create_artifact",
    description: [
      "Create a new artifact in the user's library. Something short goes in whole. A substantial artifact is built in steps: create it with its structure and the first part written for real (a deck's theme and opening slides, a document's opening sections, a workbook's main sheet), then add the rest with edit_artifact a section or a few slides at a time, so it takes shape in front of the user. A deck built that way ends with one design edit over the whole deck. Every part you write is complete and finished, never a placeholder, and never leave empty headings or blank slides waiting.",
      "`content` uses the type's authoring format:",
      formatCheatSheet("create"),
      "The result reads back what was saved and lists any problems; edit_artifact is for changes after that.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...WORK_TYPE_KEYS] },
        title: { type: "string", description: "A short, specific title." },
        content: { type: "object", description: "The content in the type's authoring format.", additionalProperties: true },
        summary: { type: "string", description: "One sentence describing the artifact, for the library." },
        placeId: { type: "string", description: "A workspace placeId from the environment, to file the work with that class or project. Omit to file it with this conversation." },
      },
      required: ["type", "title", "content"],
      additionalProperties: false,
    },
    effect: "write",
    label: (args) => `Creating *${args.title}*`,
    parse: (raw) => {
      const type = raw.type;
      if (typeof type !== "string" || !(WORK_TYPE_KEYS as readonly string[]).includes(type))
        throw new ToolInputError(`type must be one of ${WORK_TYPE_KEYS.join(", ")}.`);
      const content = raw.content;
      if (!content || typeof content !== "object" || Array.isArray(content))
        throw new ToolInputError("content must be an object in the type's authoring format.");
      return {
        type: type as ArtifactTypeKey,
        title: requireString(raw, "title", 200),
        content: content as Record<string, unknown>,
        summary: optionalString(raw, "summary", 400),
        placeId: optionalString(raw, "placeId", 200),
      };
    },
    execute: async (args, ctx) => {
      if (!isAuthoredType(args.type)) return { ok: false, content: `${args.type} cannot be created here.` };
      const createdKey = `${args.type}:${args.title.trim().toLowerCase()}`;
      const already = session.created.get(createdKey);
      if (already)
        return {
          ok: true,
          content: `*${args.title}* already exists from earlier in this run (id ${already}), and nothing new was made. To change it, use edit_artifact on that id.`,
        };
      let authored: AuthoredContent;
      try {
        authored = authorNew(args.type, healed(args.type, args.content), { timeZone: session.backend.timeZone });
        checkWrite(args.type, authored, session.prompt);
        if (args.type === "quiz" && session.learner) authored = { ...authored, content: openQuizForPractice(authored.content) ?? authored.content };
      } catch (error) {
        return { ok: false, content: `create_artifact: ${errorText(error)}` };
      }
      const created = await session.backend.createArtifact(
        {
          type: args.type,
          title: args.title,
          content: authored.content,
          summary: args.summary ?? `${typeName(args.type).replace(/^\w/, (letter) => letter.toUpperCase())}: ${args.title}`,
          // Only an offered workspace can be filed into; anything else stays where the run is.
          workspaceId: (session.places?.some((place) => place.id === args.placeId) ? args.placeId : undefined) ?? session.workspaceId,
          toolCallId: ctx.toolCallId,
        },
        ctx.signal,
      );
      rememberTitle(session, created.id, created.title, args.type);
      session.created.set(createdKey, created.id);
      return {
        ok: true,
        content: `Created the ${typeName(args.type)} *${created.title}* (id ${created.id}).\n${authored.readback}${problemsNote(authored)}${args.type === "document" ? lengthNote(authored.content, session.prompt) : ""}`,
        artifacts: [{ id: created.id, type: args.type, title: created.title, action: "created", change: authored.summary }],
        doneLabel: `Created *${created.title}*`,
      };
    },
  };
}

type EditArgs = { id: string; operations: unknown[]; title?: string };

export function editArtifactTool(session: HarnessSession): HarnessTool<EditArgs> {
  return {
    name: "edit_artifact",
    description: [
      "Change an existing artifact with a list of operations, applied in order. Those that work are saved; the result names any that did not and why, so send only those again.",
      "Operations by type:",
      formatCheatSheet("edit"),
      "Read the artifact first unless you have just created or read it, or know its exact text. Edits merge with what collaborators are typing. A result that says saved means it is saved: nothing needs reading again to check it.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The artifact id." },
        operations: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: 'Each item is {"op": "...", ...fields}.',
        },
        title: { type: "string", description: "A new title, only when renaming." },
      },
      required: ["id", "operations"],
      additionalProperties: false,
    },
    effect: "write",
    targets: (args) => [args.id],
    shows: (args) => args.id,
    label: (args) => `Editing ${titled(session, args.id, "your artifact")}`,
    parse: (raw) => {
      const operations = raw.operations;
      if (!Array.isArray(operations) || !operations.length)
        throw new ToolInputError('operations must be a non-empty list of {"op": ...} objects.');
      return { id: requireString(raw, "id", 200), operations, title: optionalString(raw, "title", 200) };
    },
    execute: async (args, ctx) => {
      const current = await session.backend.getArtifact(args.id, ctx.signal);
      if (!current)
        return { ok: false, content: `No artifact has id "${args.id}", or the user cannot open it. Find it with list_library or search.` };
      rememberTitle(session, current.id, current.title, current.type);
      if (!current.canEdit) return { ok: false, content: `*${current.title}* ${current.readOnlyReason ?? "is shared with the user as read-only"}, so it cannot be edited.` };
      if (!isAuthoredType(current.type)) return { ok: false, content: `${current.type} cannot be edited here.` };
      let authored: AuthoredContent;
      try {
        authored = authorEdit(current.type, current.content, healed(current.type, args.operations), { timeZone: session.backend.timeZone });
        checkWrite(current.type, authored, session.prompt);
        // A quiz this run is still building opens once its questions are complete.
        if (current.type === "quiz" && session.learner && [...session.created.values()].includes(current.id))
          authored = { ...authored, content: openQuizForPractice(authored.content) ?? authored.content };
      } catch (error) {
        return { ok: false, content: `edit_artifact: ${errorText(error)}` };
      }
      const wipe = classifyArtifactContentWipe(current.type, current.content, authored.content);
      if (wipe.fullContentDeletion && !ctx.approved) {
        // Record the exact edit first, so the approval binds to it.
        const staged = await session.backend.stageArtifactUpdate?.(
          {
            id: current.id,
            type: current.type,
            ...(args.title ? { title: args.title } : {}),
            content: authored.content,
            toolCallId: ctx.toolCallId,
          },
          ctx.signal,
        );
        if (staged && (!staged.ok || staged.pause)) return staged;
        if (!staged) return {
          ok: false,
          content: "",
          pause: {
            kind: "approval",
            question: `Remove everything in *${current.title}*?`,
            category: "permanent_delete",
          },
        };
      }
      const updated = await session.backend.updateArtifact(
        {
          id: current.id,
          type: current.type,
          ...(args.title ? { title: args.title } : {}),
          content: authored.content,
          toolCallId: ctx.toolCallId,
          approved: Boolean(ctx.approved),
        },
        ctx.signal,
      );
      if (updated && (!updated.ok || updated.pause)) return updated;
      const title = args.title ?? current.title;
      rememberTitle(session, current.id, title, current.type);
      return {
        ok: true,
        content: `${updated?.desktopFilePending ? `Saved *${title}* in Spectra. ${DESKTOP_FILE_PENDING}` : `Saved *${title}*.`}${failuresNote(authored)}\n${authored.readback}${problemsNote(authored)}${current.type === "document" ? lengthNote(authored.content, session.prompt) : ""}`,
        artifacts: [{ id: current.id, type: current.type, title, action: "edited", change: authored.summary, ...(updated?.region ? { region: updated.region } : {}) }],
        doneLabel: `Edited *${title}*`,
      };
    },
  };
}

/** F12: what the reply may claim about a file on the computer that Bridge has not written yet. */
export const DESKTOP_FILE_PENDING =
  "The file on their computer has not taken the change yet: Spectra Bridge writes it next, and waits while the file is open in Office. Say it is saved in Spectra and will reach the file on their computer; do not say the file itself is saved.";

type ReadArgs = { id: string } & ReadRange;

export function readArtifactTool(session: HarnessSession): HarnessTool<ReadArgs> {
  return {
    name: "read_artifact",
    description:
      "Read an artifact in its authoring format: a document as Markdown, slides as an outline, a workbook as a grid with formulas, a board as nodes and edges, cards and questions as numbered lists, code with line numbers. Large items: read a part (section, from/to, sheet and range, file).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        section: { type: "string", description: "Documents: a heading." },
        from: { type: "number", description: "Slides, cards, questions or code lines: first number." },
        to: { type: "number", description: "Last number, inclusive." },
        sheet: { type: "string", description: "Workbooks: the sheet name." },
        range: { type: "string", description: "Workbooks: an A1 range." },
        file: { type: "string", description: "Code: the file path." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "read",
    shows: (args) => args.id,
    label: (args) => `Reading ${titled(session, args.id, "your artifact")}`,
    parse: (raw) => ({
      id: requireString(raw, "id", 200),
      section: optionalString(raw, "section", 300),
      from: optionalNumber(raw, "from"),
      to: optionalNumber(raw, "to"),
      sheet: optionalString(raw, "sheet", 200),
      range: optionalString(raw, "range", 40),
      file: optionalString(raw, "file", 400),
    }),
    execute: async (args, ctx) => {
      const current = await session.backend.getArtifact(args.id, ctx.signal);
      if (!current)
        return { ok: false, content: `No artifact has id "${args.id}", or the user cannot open it. Find it with list_library or search.` };
      rememberTitle(session, current.id, current.title, current.type);
      const sources = [{ id: current.id, title: current.title, workId: current.id }];
      if (!isAuthoredType(current.type))
        return { ok: true, content: `*${current.title}* (${current.type}). ${current.summary ?? ""}`, sources };
      let body: string;
      try {
        body = readAuthored(current.type, current.content, args);
      } catch (error) {
        return { ok: false, content: `read_artifact: ${errorText(error)}` };
      }
      return {
        ok: true,
        content: `*${current.title}*, a ${typeName(current.type)} (id ${current.id})${current.canEdit ? "" : ", read-only"}${current.location ? `, in ${current.location}` : ""}.\n${body}`,
        doneLabel: `Read *${current.title}*`,
        sources,
      };
    },
  };
}
