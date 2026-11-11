import { BENCH_LIMITS } from "../../../agents/foundry/bench";
import { formatAgentBench } from "../agent-bench";
import { approveCompiledSkills } from "../agent-compilation";
import { formatAgentReleases } from "../agent-releases";
import { formatEmbeds } from "../embeds";
import { formatIncomingInvitations, formatSharing } from "../sharing";
import { formatVersions } from "../versions";
import { ToolInputError, type AnyHarnessTool, type HarnessTool } from "../types";
import { commandTool } from "./app";
import { oneOf, optionalNumber, optionalString, rememberTitle, requireString, titled, type HarnessSession } from "./shared";

/*
 * A work's history, embeds, sharing and releases, reached through find_commands and
 * run_command. Reads say what they found and that people's words in it are
 * evidence; changes run through the same server paths as the user's controls.
 */

type VersionsArgs = { artifactId: string; limit: number };

function readVersionsTool(session: HarnessSession): HarnessTool<VersionsArgs> {
  return {
    name: "read_versions",
    description:
      "Read an artifact's saved versions, newest first: each version's id, when it was made, who made it, whether Spectra did, and its name or summary. Use it before restore_version.",
    parameters: {
      type: "object",
      properties: { artifactId: { type: "string" }, limit: { type: "number" } },
      required: ["artifactId"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Reading the history of ${titled(session, args.artifactId, "your artifact")}`,
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
        content: formatVersions(page.versions, session.titles.get(args.artifactId)?.title ?? "This artifact", page.more),
        doneLabel: `Read the history of ${titled(session, args.artifactId, "your artifact")}`,
      };
    },
  };
}

type EmbedsArgs = { artifactId: string };

function readEmbedsTool(session: HarnessSession): HarnessTool<EmbedsArgs> {
  return {
    name: "read_embeds",
    description:
      "Read the live embeds (references to other artifacts) inside an artifact: each embed's id, the artifact it shows, where it sits, its size, whether it follows the live artifact or a pinned version, and whether its source is still available. Use it before manage_embed.",
    parameters: { type: "object", properties: { artifactId: { type: "string" } }, required: ["artifactId"], additionalProperties: false },
    effect: "read",
    label: (args) => `Reading what ${titled(session, args.artifactId, "your artifact")} embeds`,
    parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200) }),
    execute: async (args, ctx) => {
      const found = await session.backend.readEmbeds(args, ctx.signal);
      if (!found)
        return { ok: false, content: `No artifact has id "${args.artifactId}", or the user cannot open it. Find it with list_library or search.` };
      return {
        ok: true,
        content: formatEmbeds(found.embeds, session.titles.get(args.artifactId)?.title ?? "This artifact", found.canConfigure),
        doneLabel: `Read what ${titled(session, args.artifactId, "your artifact")} embeds`,
      };
    },
  };
}

type SharingArgs = { resourceType: "workspace" | "artifact" | "agent"; resourceId: string };

function readSharingTool(session: HarnessSession): HarnessTool<SharingArgs> {
  return {
    name: "read_sharing",
    description:
      "Read who can open an artifact, workspace or agent: people invited (pending or accepted, with the invitation and grant ids share takes), members of shared workspaces it sits in and any exception, and its public links by id. Use it before share. A public link's address is never shown to you.",
    parameters: {
      type: "object",
      properties: { resourceType: { type: "string", enum: ["workspace", "artifact", "agent"] }, resourceId: { type: "string" } },
      required: ["resourceType", "resourceId"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Checking who can open ${titled(session, args.resourceId, "your artifact")}`,
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
        doneLabel: `Checked who can open ${titled(session, args.resourceId, "your artifact")}`,
      };
    },
  };
}

function readShareInvitationsTool(session: HarnessSession): HarnessTool<Record<string, never>> {
  return {
    name: "read_share_invitations",
    description:
      "Read the invitations other people sent the user (to an artifact, workspace or agent) that wait for an answer, with the invitation ids respond_to_share takes.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    effect: "read",
    label: () => "Checking your invitations",
    parse: () => ({}),
    execute: async (_args, ctx) => ({
      ok: true,
      content: formatIncomingInvitations(await session.backend.readShareInvitations(ctx.signal)),
      doneLabel: "Checked your invitations",
    }),
  };
}

type RespondArgs = { invitationId: string; response: "accept" | "decline" };

type AgentReleasesArgs = { agentId: string };

function readAgentReleasesTool(session: HarnessSession): HarnessTool<AgentReleasesArgs> {
  return {
    name: "read_agent_releases",
    description:
      "Read an agent's releases, newest first: each release's id, who it reaches (the owner only, staged, live, suspended), whether a passing check run backs it, and its notes; and whether the current draft passed its checks. Use it before release_agent.",
    parameters: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"], additionalProperties: false },
    effect: "read",
    label: (args) => `Reading the releases of ${titled(session, args.agentId, "your agent")}`,
    parse: (raw) => ({ agentId: requireString(raw, "agentId", 200) }),
    execute: async (args, ctx) => {
      const found = await session.backend.readAgentReleases(args, ctx.signal);
      if (!found)
        return { ok: false, content: `No agent has id "${args.agentId}", or the user cannot open it. Find it with list_library or search.` };
      return {
        ok: true,
        content: formatAgentReleases(found, session.titles.get(args.agentId)?.title ?? "This agent"),
        doneLabel: `Read the releases of ${titled(session, args.agentId, "your agent")}`,
      };
    },
  };
}

function readAgentBenchTool(session: HarnessSession): HarnessTool<AgentReleasesArgs> {
  return {
    name: "read_agent_bench",
    description:
      "Read an agent's bench, as the agent studio shows it: the tests kept from it (ids, questions, what a good answer must or must not do) and the user's recent bench answers, newest first. Use it before save_agent_bench_case or remove_agent_bench_case.",
    parameters: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"], additionalProperties: false },
    effect: "read",
    label: (args) => `Reading the bench of ${titled(session, args.agentId, "your agent")}`,
    parse: (raw) => ({ agentId: requireString(raw, "agentId", 200) }),
    execute: async (args, ctx) => {
      const found = await session.backend.readAgentBench(args, ctx.signal);
      if (!found)
        return { ok: false, content: `No agent has id "${args.agentId}" that the user can edit. Find it with list_library or search.` };
      return {
        ok: true,
        content: formatAgentBench(found, session.titles.get(args.agentId)?.title ?? "This agent"),
        doneLabel: `Read the bench of ${titled(session, args.agentId, "your agent")}`,
      };
    },
  };
}

type ApproveSkillsArgs = { agentId: string; skillIds?: string[] };

function approveAgentSkillsTool(session: HarnessSession): HarnessTool<ApproveSkillsArgs> {
  return {
    name: "approve_agent_skills",
    description:
      "Approve the skills compile_agent drafted for an agent, as the agent studio's Approve does: each joins the agent as verified (the next version of a skill it already has), and the compiled routing and release notes apply with them. skillIds approves only those; left out, every drafted skill still waiting is approved. Read what was drafted in compile_agent's result first, and approve only skills that match what the user wants the agent to do.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        skillIds: { type: "array", items: { type: "string" }, description: "Drafted skill ids from compile_agent; all waiting skills when left out." },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    effect: "write",
    targets: (args) => [args.agentId],
    label: (args) => `Approving skills for ${titled(session, args.agentId, "your agent")}`,
    parse: (raw) => {
      const ids = raw.skillIds;
      if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id.trim())))
        throw new ToolInputError("skillIds is a non-empty list of drafted skill ids; leave it out to approve every waiting skill.");
      return {
        agentId: requireString(raw, "agentId", 200),
        ...(Array.isArray(ids) ? { skillIds: [...new Set(ids.map((id) => String(id).trim()))].slice(0, 24) } : {}),
      };
    },
    execute: async (args, ctx) => {
      const current = await session.backend.getArtifact(args.agentId, ctx.signal);
      if (!current || current.type !== "agent")
        return { ok: false, content: `No agent has id "${args.agentId}", or the user cannot open it. Find it with list_library or search.` };
      rememberTitle(session, current.id, current.title, current.type);
      if (!current.canEdit) return { ok: false, content: `*${current.title}* is shared with the user as read-only, so its skills cannot be approved.` };
      const compilation = await session.backend.readAgentCompilation({ agentId: args.agentId }, ctx.signal);
      if (!compilation?.result || compilation.status !== "completed")
        return {
          ok: false,
          content: `*${current.title}* has no finished compilation to approve${compilation ? ` (the latest one ${compilation.status === "cancelled" ? "was stopped" : compilation.status === "failed" ? "failed" : "is still running"})` : ""}. compile_agent drafts its skills.`,
        };
      const approval = approveCompiledSkills(current.content, compilation.result, args.skillIds);
      if (approval.unknown.length)
        return {
          ok: false,
          content: `The latest compilation did not draft ${approval.unknown.map((id) => `"${id}"`).join(", ")}. It drafted: ${compilation.result.skills.map((skill) => `${skill.id} (${skill.name})`).join(", ") || "no skills"}.`,
        };
      if (!approval.approved.length)
        return { ok: false, content: `No drafted skill of *${current.title}* is waiting for approval: they were approved already.` };
      const updated = await session.backend.updateArtifact(
        {
          id: current.id,
          type: current.type,
          content: approval.content as unknown as Record<string, unknown>,
          toolCallId: ctx.toolCallId,
          approved: Boolean(ctx.approved),
        },
        ctx.signal,
      );
      if (updated && (!updated.ok || updated.pause)) return updated;
      const names = approval.approved.map((skill) => skill.name);
      const change = `Approved ${names.length} skill${names.length === 1 ? "" : "s"}`;
      return {
        ok: true,
        content: [
          `Approved on *${current.title}*: ${names.join(", ")}. The compiled routing and release notes apply with them.`,
          ...(approval.already.length ? [`Already approved: ${approval.already.join(", ")}.`] : []),
          ...(compilation.stale ? ["The draft changed after this compilation began; run_agent_checks shows whether it still holds together."] : []),
        ].join("\n"),
        artifacts: [{ id: current.id, type: current.type, title: current.title, action: "edited", change }],
        doneLabel: `${change} for *${current.title}*`,
      };
    },
  };
}

type BenchCaseRef = { agentId: string; caseId: string };
type BenchArgs = { agentId: string; prompt: string; target?: "release"; releaseNumber?: number };
type BenchCaseArgs = {
  agentId: string;
  caseId?: string;
  prompt: string;
  mustInclude: string[];
  mustNotInclude: string[];
  rubric?: string;
  required?: boolean;
};

function checkList(raw: Record<string, unknown>, key: string) {
  const value = raw[key] ?? [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new ToolInputError(`${key} must be a list of short phrases.`);
  const phrases = value.map((entry: string) => entry.trim()).filter(Boolean);
  if (phrases.length > BENCH_LIMITS.checks) throw new ToolInputError(`${key} holds at most ${BENCH_LIMITS.checks} phrases.`);
  if (phrases.some((phrase) => phrase.length > BENCH_LIMITS.checkValue))
    throw new ToolInputError(`Each phrase in ${key} is at most ${BENCH_LIMITS.checkValue} characters.`);
  return phrases;
}

const RELEASE_ACTIONS = ["release_private", "publish", "promote", "rollback", "suspend"] as const;
type ReleaseArgs = { agentId: string; action: (typeof RELEASE_ACTIONS)[number]; releaseId?: string; releaseNotes?: string };
const RELEASE_LABELS: Record<ReleaseArgs["action"], [string, string]> = {
  release_private: ["Releasing {agent} to you", "Released {agent} to you"],
  publish: ["Publishing {agent}", "Published {agent}"],
  promote: ["Promoting a release of {agent}", "Promoted a release of {agent}"],
  rollback: ["Rolling {agent} back to an earlier release", "Rolled {agent} back to an earlier release"],
  suspend: ["Suspending a release of {agent}", "Suspended a release of {agent}"],
};

type PublishArgs = { artifactId: string; action: "publish" | "unpublish" };

const EMBED_ACTIONS = ["resize", "follow_live", "pin", "recheck", "remove"] as const;
type EmbedArgs = { artifactId: string; embedId: string; action: (typeof EMBED_ACTIONS)[number]; mode?: "compact" | "expanded"; versionId?: string };
const EMBED_LABELS: Record<EmbedArgs["action"], [string, string]> = {
  resize: ["Resizing an embed", "Resized an embed"],
  follow_live: ["Making an embed follow the live artifact", "Made an embed follow the live artifact"],
  pin: ["Pinning an embed to a version", "Pinned an embed to a version"],
  recheck: ["Checking an embed again", "Checked an embed again"],
  remove: ["Removing an embed", "Removed an embed"],
};

/** Commands only run_command reaches: a work's history, embeds, sharing and publishing, and agent releases. */
export function workTools(session: HarnessSession): AnyHarnessTool[] {
  return [
    readVersionsTool(session),
    commandTool(session, {
      name: "restore_version",
      description:
        "Restore an artifact to one of its saved versions (versionId from read_versions). The current artifact is saved as a version first, so the restore can itself be undone by restoring that one.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, versionId: { type: "string" } },
        required: ["artifactId", "versionId"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: { artifactId: string }) => [args.artifactId],
      label: (args: { artifactId: string }) => `Restoring an earlier version of ${titled(session, args.artifactId, "your artifact")}`,
      doneLabel: (args: { artifactId: string }) => `Restored an earlier version of ${titled(session, args.artifactId, "your artifact")}`,
      parse: (raw) => ({ artifactId: requireString(raw, "artifactId", 200), versionId: requireString(raw, "versionId", 200) }),
      command: (args) => ({ command: "restore_version", args }),
    }),
    commandTool(session, {
      name: "publish_code",
      description:
        "Publish a Code artifact's live build, so everyone who can open the artifact runs the current code (publish), or take the build down (unpublish). Before publishing a visualisation, set its accessible title and text alternative using edit_artifact set_accessibility {title, description}; HTML labels do not set the artifact's metadata. Publishing builds the artifact's saved source; when the build fails you get the compiler's report to fix the code with edit_artifact. The user approves it unless they allowed publishing.",
      parameters: {
        type: "object",
        properties: { artifactId: { type: "string" }, action: { type: "string", enum: ["publish", "unpublish"] } },
        required: ["artifactId", "action"],
        additionalProperties: false,
      },
      effect: "irreversible",
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
    readShareInvitationsTool(session),
    commandTool(session, {
      name: "respond_to_share",
      description:
        "Answer an invitation someone sent the user (invitationId from read_share_invitations): accept adds the shared artifact, workspace or agent to the user's Library at the invited level; decline turns it down. Only when the user asks; the user approves it unless they allowed sharing changes.",
      parameters: {
        type: "object",
        properties: { invitationId: { type: "string" }, response: { type: "string", enum: ["accept", "decline"] } },
        required: ["invitationId", "response"],
        additionalProperties: false,
      },
      effect: "irreversible",
      label: (args: RespondArgs) => (args.response === "accept" ? "Accepting an invitation" : "Declining an invitation"),
      doneLabel: (args: RespondArgs) => (args.response === "accept" ? "Accepted the invitation" : "Declined the invitation"),
      question: (args: RespondArgs) =>
        args.response === "accept" ? "Accept this invitation and add what was shared to your Library?" : "Decline this invitation?",
      parse: (raw): RespondArgs => ({
        invitationId: requireString(raw, "invitationId", 200),
        response: oneOf(raw, "response", ["accept", "decline"] as const),
      }),
      command: (args) => ({ command: "respond_share_invitation", args }),
    }),
    readAgentReleasesTool(session),
    commandTool(session, {
      name: "run_agent_checks",
      description:
        "Run an agent's checks on its current draft, as the agent studio's Run checks does: its skills' cases, privacy and adversarial cases, and the tests the user saved from the bench. It takes a few minutes and uses the school's AI allowance. Passing checks are what release_agent publish needs; failing cases come back with the graders' reasons, to improve the agent with edit_artifact and run the checks again.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: { agentId: string }) => [args.agentId],
      label: (args: { agentId: string }) => `Running checks on ${titled(session, args.agentId, "your agent")}`,
      doneLabel: (args: { agentId: string }) => `Ran checks on ${titled(session, args.agentId, "your agent")}`,
      parse: (raw) => ({ agentId: requireString(raw, "agentId", 200) }),
      command: (args) => ({ command: "run_agent_checks", args }),
    }),
    readAgentBenchTool(session),
    commandTool(session, {
      name: "run_agent_bench",
      description:
        "Ask one of the user's agents a question on its bench, as the agent studio's bench does, and read its answer. target draft (the default) answers with the draft as it is now, unsaved edits included; release answers as a release (releaseNumber, the newest when left out). The answer is kept on the bench and shown in an open studio; a test kept for the same question grades it. It uses the school's AI allowance. Use it to see how a change to the agent behaves before running the checks.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          prompt: { type: "string", description: "The question, as a person using the agent would ask it." },
          target: { type: "string", enum: ["draft", "release"] },
          releaseNumber: { type: "number" },
        },
        required: ["agentId", "prompt"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: BenchArgs) => [args.agentId],
      label: (args: BenchArgs) => `Asking ${titled(session, args.agentId, "your agent")} on the bench`,
      doneLabel: (args: BenchArgs) => `Asked ${titled(session, args.agentId, "your agent")} on the bench`,
      parse: (raw): BenchArgs => {
        const target = raw.target === undefined ? "draft" : oneOf(raw, "target", ["draft", "release"] as const);
        const releaseNumber = optionalNumber(raw, "releaseNumber");
        if (releaseNumber !== undefined && target !== "release")
          throw new ToolInputError("releaseNumber names a release to answer as; set target to release.");
        if (releaseNumber !== undefined && (!Number.isInteger(releaseNumber) || releaseNumber < 1))
          throw new ToolInputError("releaseNumber is a release's number, as read_agent_releases lists it.");
        return {
          agentId: requireString(raw, "agentId", 200),
          prompt: requireString(raw, "prompt", BENCH_LIMITS.prompt),
          ...(target === "release" ? { target } : {}),
          ...(releaseNumber !== undefined ? { releaseNumber } : {}),
        };
      },
      command: (args) => ({ command: "run_agent_bench", args }),
    }),
    commandTool(session, {
      name: "save_agent_bench_case",
      description:
        "Keep a bench question as one of an agent's tests, as the studio's Save as test does: what a good answer must include (mustInclude) and must leave out (mustNotInclude), short phrases, and optionally a rubric a judge reads. Kept tests join the agent's checks, so a later draft cannot lose what the user accepted. The same question again, or caseId from read_agent_bench, updates that test. required false makes it optional.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          caseId: { type: "string" },
          prompt: { type: "string" },
          mustInclude: { type: "array", items: { type: "string" } },
          mustNotInclude: { type: "array", items: { type: "string" } },
          rubric: { type: "string" },
          required: { type: "boolean" },
        },
        required: ["agentId", "prompt"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: BenchCaseArgs) => [args.agentId],
      label: (args: BenchCaseArgs) => `Keeping a test for ${titled(session, args.agentId, "your agent")}`,
      doneLabel: (args: BenchCaseArgs) => `Kept a test for ${titled(session, args.agentId, "your agent")}`,
      parse: (raw): BenchCaseArgs => {
        const mustInclude = checkList(raw, "mustInclude");
        const mustNotInclude = checkList(raw, "mustNotInclude");
        const rubric = optionalString(raw, "rubric", BENCH_LIMITS.rubric)?.trim();
        if (!mustInclude.length && !mustNotInclude.length && !rubric)
          throw new ToolInputError("Say what a good answer must include or leave out (mustInclude, mustNotInclude), or give a rubric.");
        if (raw.required !== undefined && typeof raw.required !== "boolean") throw new ToolInputError("required is true or false.");
        const caseId = optionalString(raw, "caseId", 200);
        return {
          agentId: requireString(raw, "agentId", 200),
          ...(caseId ? { caseId } : {}),
          prompt: requireString(raw, "prompt", BENCH_LIMITS.prompt),
          mustInclude,
          mustNotInclude,
          ...(rubric ? { rubric } : {}),
          ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
        };
      },
      command: (args) => ({ command: "save_agent_bench_case", args }),
    }),
    commandTool(session, {
      name: "remove_agent_bench_case",
      description:
        "Remove one of an agent's bench tests (caseId from read_agent_bench). It is deleted, not trashed, and leaves the agent's checks. Only when the user asks; the user approves it unless they allowed permanent deletions.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string" }, caseId: { type: "string" } },
        required: ["agentId", "caseId"],
        additionalProperties: false,
      },
      effect: "irreversible",
      targets: (args: BenchCaseRef) => [args.agentId],
      label: (args: BenchCaseRef) => `Removing a test from ${titled(session, args.agentId, "your agent")}`,
      doneLabel: (args: BenchCaseRef) => `Removed a test from ${titled(session, args.agentId, "your agent")}`,
      question: (args: BenchCaseRef) =>
        `Remove this test from ${titled(session, args.agentId, "this agent")}? Its checks will no longer include it.`,
      parse: (raw): BenchCaseRef => ({ agentId: requireString(raw, "agentId", 200), caseId: requireString(raw, "caseId", 200) }),
      command: (args) => ({ command: "remove_agent_bench_case", args }),
    }),
    commandTool(session, {
      name: "compile_agent",
      description:
        "Compile an agent in the Foundry, as the agent studio's Compile does: from its saved mission, the user's answers and the sources it was given, the compiler drafts skills, a routing signature and release notes. It takes a minute or two and uses the school's AI allowance. Nothing on the agent changes: the drafted skills wait for approval in the studio, and approve_agent_skills approves them.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
        additionalProperties: false,
      },
      effect: "write",
      targets: (args: { agentId: string }) => [args.agentId],
      label: (args: { agentId: string }) => `Compiling ${titled(session, args.agentId, "your agent")}`,
      doneLabel: (args: { agentId: string }) => `Compiled ${titled(session, args.agentId, "your agent")}`,
      parse: (raw) => ({ agentId: requireString(raw, "agentId", 200) }),
      command: (args) => ({ command: "compile_agent", args }),
    }),
    approveAgentSkillsTool(session),
    commandTool(session, {
      name: "release_agent",
      description:
        "Release one of the user's agents, as the agent studio does. release_private makes a release of the current draft that only the user reaches, to try it in a conversation; it needs no checks. publish releases the current draft to everyone who can use the agent; it needs the draft to have passed its checks (read_agent_releases says; run them with run_agent_checks). promote {releaseId} takes a staged release live; rollback {releaseId} serves an earlier checked release again; suspend {releaseId} stops a release reaching anyone new. releaseNotes is optional. Everything but release_private asks the user unless they allowed sharing changes. To stop sharing an agent with someone, use share.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          action: { type: "string", enum: [...RELEASE_ACTIONS] },
          releaseId: { type: "string" },
          releaseNotes: { type: "string" },
        },
        required: ["agentId", "action"],
        additionalProperties: false,
      },
      effect: (args: ReleaseArgs) => (args.action === "release_private" ? "write" : "irreversible"),
      targets: (args: ReleaseArgs) => [args.agentId],
      label: (args: ReleaseArgs) => RELEASE_LABELS[args.action][0].replace("{agent}", titled(session, args.agentId, "your agent")),
      doneLabel: (args: ReleaseArgs) => RELEASE_LABELS[args.action][1].replace("{agent}", titled(session, args.agentId, "your agent")),
      question: (args: ReleaseArgs) => {
        const agent = titled(session, args.agentId, "this agent");
        if (args.action === "publish") return `Publish ${agent} so everyone who can use it reaches this version?`;
        if (args.action === "promote") return `Take this release of ${agent} live for everyone who can use it?`;
        if (args.action === "rollback") return `Serve an earlier release of ${agent} to everyone who uses it?`;
        return `Stop this release of ${agent} reaching anyone new?`;
      },
      parse: (raw): ReleaseArgs => {
        const action = oneOf(raw, "action", RELEASE_ACTIONS);
        const releaseId = optionalString(raw, "releaseId", 200);
        const releaseNotes = optionalString(raw, "releaseNotes", 4_000);
        const needsRelease = action === "promote" || action === "rollback" || action === "suspend";
        if (needsRelease && !releaseId) throw new ToolInputError(`${action} needs releaseId; read it with read_agent_releases.`);
        if (!needsRelease && releaseId) throw new ToolInputError(`${action} releases the current draft; it takes no releaseId.`);
        return {
          agentId: requireString(raw, "agentId", 200),
          action,
          ...(releaseId ? { releaseId } : {}),
          ...(releaseNotes && !needsRelease ? { releaseNotes } : {}),
        };
      },
      command: (args) => ({ command: "release_agent", args }),
    }),
    commandTool(session, {
      name: "manage_embed",
      description:
        "Change a live embed inside an artifact (embedId from read_embeds): resize {mode: compact|expanded}; follow_live makes it show the source as it is now; pin {versionId} keeps it on one saved version of the source (ids from read_versions on the source artifact); recheck tries again to show a pinned embed whose source was deleted; remove takes it out of the artifact (the source artifact is untouched). To move an embed, move its block with edit_artifact. To add one, use insert_reference.",
      parameters: {
        type: "object",
        properties: {
          artifactId: { type: "string", description: "The artifact that contains the embed." },
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
      label: (args: EmbedArgs) => `${EMBED_LABELS[args.action][0]} in ${titled(session, args.artifactId, "your artifact")}`,
      doneLabel: (args: EmbedArgs) => `${EMBED_LABELS[args.action][1]} in ${titled(session, args.artifactId, "your artifact")}`,
      parse: (raw): EmbedArgs => {
        const action = oneOf(raw, "action", EMBED_ACTIONS);
        const parsed: EmbedArgs = { artifactId: requireString(raw, "artifactId", 200), embedId: requireString(raw, "embedId", 200), action };
        if (action === "resize") {
          if (raw.mode === undefined) throw new ToolInputError("resize needs mode: compact or expanded.");
          parsed.mode = oneOf(raw, "mode", ["compact", "expanded"] as const);
        }
        if (action === "pin") {
          const versionId = optionalString(raw, "versionId", 200);
          if (!versionId) throw new ToolInputError("pin needs versionId, a saved version of the embedded artifact (read_versions on that artifact lists them).");
          parsed.versionId = versionId;
        }
        return parsed;
      },
      command: (args) => ({ command: "manage_embed", args }),
    }),
  ] as unknown as AnyHarnessTool[];
}
