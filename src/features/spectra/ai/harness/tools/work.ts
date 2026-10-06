import { formatVersions } from "../versions";
import type { AnyHarnessTool, HarnessTool } from "../types";
import { commandTool } from "./app";
import { optionalNumber, requireString, titled, type HarnessSession } from "./shared";

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

/** Commands only run_command reaches: a work's history, embeds and sharing. */
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
  ] as unknown as AnyHarnessTool[];
}
