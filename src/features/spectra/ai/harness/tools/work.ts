import { formatEmbeds } from "../embeds";
import { formatSharing } from "../sharing";
import { formatVersions } from "../versions";
import { ToolInputError, type AnyHarnessTool, type HarnessTool } from "../types";
import { commandTool } from "./app";
import { oneOf, optionalNumber, optionalString, requireString, titled, type HarnessSession } from "./shared";

/*
 * A work's history, embeds and sharing, reached through find_commands and
 * run_command. Reads say what they found and that people's words in it are
 * evidence; changes run through the same server paths as the user's controls.
 */

type VersionsArgs = { artifactId: string; limit: number };

function readVersionsTool(session: HarnessSession): HarnessTool<VersionsArgs> {
  return {
    name: "read_versions",
    description:
      "Read a work's saved versions, newest first: each version's id, when it was made, who made it, whether Spectra did, and its name or summary. Use it before restore_version.",
    parameters: {
      type: "object",
      properties: { artifactId: { type: "string" }, limit: { type: "number" } },
      required: ["artifactId"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Reading the history of ${titled(session, args.artifactId, "your work")}`,
    parse: (raw) => ({
      artifactId: requireString(raw, "artifactId", 200),
      limit: Math.max(1, Math.min(50, Math.round(optionalNumber(raw, "limit") ?? 20))),
    }),
    execute: async (args, ctx) => {
      const page = await session.backend.readVersions(args, ctx.signal);
      if (!page)
        return { ok: false, content: `No artifact has id "${args.artifactId}", or the user cannot open it. Find it with list_library or search.` };
      return {
        ok: true,
        content: formatVersions(page.versions, session.titles.get(args.artifactId)?.title ?? "This work", page.more),
        doneLabel: `Read the history of ${titled(session, args.artifactId, "your work")}`,
      };
    },
  };
}

type EmbedsArgs = { artifactId: string };

function readEmbedsTool(session: HarnessSession): HarnessTool<EmbedsArgs> {
  return {
    name: "read_embeds",
    description:
      "Read the live embeds (references to other work) inside a work: each embed's id, the work it shows, where it sits, its size, whether it follows the live work or a pinned version, and whether its source is still available. Use it before manage_embed.",
    parameters: { type: "object", properties: { artifactId: { type: "string" } }, required: ["artifactId"], additionalProperties: false },
    effect: "read",
    label: (args) => `Reading what ${titled(session, args.artifactId, "your work")} embeds`,
    parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200) }),
    execute: async (args, ctx) => {
      const found = await session.backend.readEmbeds(args, ctx.signal);
      if (!found)
        return { ok: false, content: `No artifact has id "${args.artifactId}", or the user cannot open it. Find it with list_library or search.` };
      return {
        ok: true,
        content: formatEmbeds(found.embeds, session.titles.get(args.artifactId)?.title ?? "This work", found.canConfigure),
        doneLabel: `Read what ${titled(session, args.artifactId, "your work")} embeds`,
      };
    },
  };
}

type SharingArgs = { resourceType: "workspace" | "artifact" | "agent"; resourceId: string };

function readSharingTool(session: HarnessSession): HarnessTool<SharingArgs> {
  return {
    name: "read_sharing",
    description:
      "Read who can open a work, workspace or agent: people invited (pending or accepted, with the invitation and grant ids share takes), members of shared workspaces it sits in and any exception, and its public links by id. Use it before share. A public link's address is never shown to you.",
    parameters: {
      type: "object",
      properties: { resourceType: { type: "string", enum: ["workspace", "artifact", "agent"] }, resourceId: { type: "string" } },
      required: ["resourceType", "resourceId"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Checking who can open ${titled(session, args.resourceId, "your work")}`,
    parse: (raw) => ({
      resourceType: oneOf(raw, "resourceType", ["workspace", "artifact", "agent"] as const),
      resourceId: requireString(raw, "resourceId", 200),
    }),
    execute: async (args, ctx) => {
      const found = await session.backend.readSharing(args, ctx.signal);
      if (!found)
        return { ok: false, content: `Nothing with id "${args.resourceId}" can be shared by the user: it does not exist, or only its owner can share it.` };
      return {
        ok: true,
        content: formatSharing(found, session.titles.get(args.resourceId)?.title ?? "this"),
        doneLabel: `Checked who can open ${titled(session, args.resourceId, "your work")}`,
      };
    },
  };
}

type PublishArgs = { artifactId: string; action: "publish" | "unpublish" };

const EMBED_ACTIONS = ["resize", "follow_live", "pin", "recheck", "remove"] as const;
type EmbedArgs = { artifactId: string; embedId: string; action: (typeof EMBED_ACTIONS)[number]; mode?: "compact" | "expanded"; versionId?: string };
const EMBED_LABELS: Record<EmbedArgs["action"], [string, string]> = {
  resize: ["Resizing an embed", "Resized an embed"],
  follow_live: ["Making an embed follow the live work", "Made an embed follow the live work"],
  pin: ["Pinning an embed to a version", "Pinned an embed to a version"],
  recheck: ["Checking an embed again", "Checked an embed again"],
  remove: ["Removing an embed", "Removed an embed"],
};

/** Commands only run_command reaches: a work's history, embeds, sharing and publishing. */
export function workTools(session: HarnessSession): AnyHarnessTool[] {
  return [
    readVersionsTool(session),
    commandTool(session, {
      name: "restore_version",
      description:
        "Restore a work to one of its saved versions (versionId from read_versions). The current work is saved as a version first, so the restore can itself be undone by restoring that one.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, versionId: { type: "string" } },
        required: ["artifactId", "versionId"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: { artifactId: string }) => [args.artifactId],
      label: (args: { artifactId: string }) => `Restoring an earlier version of ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: { artifactId: string }) => `Restored an earlier version of ${titled(session, args.artifactId, "your work")}`,
      parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200), versionId: requireString(raw, "versionId", 200) }),
      command: (args) => ({ command: "restore_version", args }),
    }),
    commandTool(session, {
      name: "publish_code",
      description:
        "Publish a Code work's live build, so everyone who can open the work runs the current code (publish), or take the build down (unpublish). Publishing builds the work's saved source; when the build fails you get the compiler's report to fix the code with edit_artifact. The user approves it unless they allowed publishing.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, action: { type: "string", enum: ["publish", "unpublish"] } },
        required: ["artifactId", "action"],
        additionalProperties: false,
      },
      effect: "irreversible",
      category: "external_send",
      targets: (args: PublishArgs) => [args.artifactId],
      label: (args: PublishArgs) => `${args.action === "publish" ? "Publishing" : "Unpublishing"} ${titled(session, args.artifactId, "your code")}`,
      doneLabel: (args: PublishArgs) => `${args.action === "publish" ? "Published" : "Unpublished"} ${titled(session, args.artifactId, "your code")}`,
      question: (args: PublishArgs) =>
        args.action === "publish"
          ? `Publish ${titled(session, args.artifactId, "this code")} so everyone who can open it runs this version?`
          : `Take down the published build of ${titled(session, args.artifactId, "this code")}?`,
      parse: (raw): PublishArgs => ({ artifactId: requireString(raw, "artifactId", 200), action: oneOf(raw, "action", ["publish", "unpublish"] as const) }),
      command: (args) => ({ command: "publish_code", args }),
    }),
    readEmbedsTool(session),
    readSharingTool(session),
    commandTool(session, {
      name: "manage_embed",
      description:
        "Change a live embed inside a work (embedId from read_embeds): resize {mode: compact|expanded}; follow_live makes it show the source as it is now; pin {versionId} keeps it on one saved version of the source (ids from read_versions on the source work); recheck tries again to show a pinned embed whose source was deleted; remove takes it out of the work (the source work is untouched). To move an embed, move its block with edit_artifact. To add one, use insert_reference.",
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string", description: "The work that contains the embed." },
          embedId: { type: "string" },
          action: { type: "string", enum: [...EMBED_ACTIONS] },
          mode: { type: "string", enum: ["compact", "expanded"] },
          versionId: { type: "string" },
        },
        required: ["artifactId", "embedId", "action"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: EmbedArgs) => [args.artifactId],
      label: (args: EmbedArgs) => `${EMBED_LABELS[args.action][0]} in ${titled(session, args.artifactId, "your work")}`,
      doneLabel: (args: EmbedArgs) => `${EMBED_LABELS[args.action][1]} in ${titled(session, args.artifactId, "your work")}`,
      parse: (raw): EmbedArgs => {
        const action = oneOf(raw, "action", EMBED_ACTIONS);
        const parsed: EmbedArgs = { artifactId: requireString(raw, "artifactId", 200), embedId: requireString(raw, "embedId", 200), action };
        if (action === "resize") {
          if (raw.mode === undefined) throw new ToolInputError("resize needs mode: compact or expanded.");
          parsed.mode = oneOf(raw, "mode", ["compact", "expanded"] as const);
        }
        if (action === "pin") {
          const versionId = optionalString(raw, "versionId", 200);
          if (!versionId) throw new ToolInputError("pin needs versionId, a saved version of the embedded work (read_versions on that work lists them).");
          parsed.versionId = versionId;
        }
        return parsed;
      },
      command: (args) => ({ command: "manage_embed", args }),
    }),
  ] as unknown as AnyHarnessTool[];
}
