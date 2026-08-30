import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { captureSafetyRejectionReason } from "./memory";
import { USER_SKILL_LIMITS } from "../shared/user-skill-limits";

export { USER_SKILL_LIMITS } from "../shared/user-skill-limits";

type SkillCtx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;

function fail(message: string): never {
  throw new Error(`USER_SKILL_INVALID: ${message}`);
}

async function requireActor(ctx: SkillCtx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

function compact(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizedName(value: string) {
  return compact(value).toLocaleLowerCase();
}

function normalizeTriggerTerms(values: readonly string[]) {
  const terms = [
    ...new Set(
      values.map((value) => compact(value).toLocaleLowerCase()).filter(Boolean),
    ),
  ];
  if (terms.length === 0)
    fail("Add at least one short phrase that should use this skill.");
  if (terms.length > USER_SKILL_LIMITS.triggerCount)
    fail(
      `A skill can have up to ${USER_SKILL_LIMITS.triggerCount} trigger phrases.`,
    );
  if (terms.some((term) => term.length > USER_SKILL_LIMITS.triggerCharacters))
    fail(
      `Each trigger phrase can be up to ${USER_SKILL_LIMITS.triggerCharacters} characters.`,
    );
  if (terms.join("").length > USER_SKILL_LIMITS.triggerMetadataCharacters)
    fail("The trigger phrases are too long together. Shorten or remove a few.");
  return terms;
}

export function skillBodyCaptureRejectionReason(body: string) {
  const reason = captureSafetyRejectionReason(body);
  return reason === "sensitive_or_secret" ? reason : null;
}

function normalizeInput(input: {
  name: string;
  purpose: string;
  triggerTerms: string[];
  body: string;
}) {
  const name = compact(input.name);
  const purpose = compact(input.purpose);
  const body = input.body.normalize("NFKC").trim();
  if (name.length < 2) fail("Give the skill a clear name.");
  if (name.length > USER_SKILL_LIMITS.nameCharacters)
    fail(
      `Skill names can be up to ${USER_SKILL_LIMITS.nameCharacters} characters.`,
    );
  if (purpose.length < 8)
    fail("Describe in one sentence when this skill helps.");
  if (purpose.length > USER_SKILL_LIMITS.purposeCharacters)
    fail(
      `Skill purposes can be up to ${USER_SKILL_LIMITS.purposeCharacters} characters.`,
    );
  if (body.length < 20)
    fail("Add a concrete procedure for the skill to follow.");
  if (body.length > USER_SKILL_LIMITS.bodyCharacters)
    fail(
      `Skill instructions can be up to ${USER_SKILL_LIMITS.bodyCharacters.toLocaleString("en-US")} characters.`,
    );
  if (skillBodyCaptureRejectionReason(body))
    fail(
      "This skill cannot save secrets, credentials, or sensitive personal data.",
    );
  return {
    name,
    normalizedName: normalizedName(name),
    purpose,
    triggerTerms: normalizeTriggerTerms(input.triggerTerms),
    body,
  };
}

function metadata(skill: Doc<"userSkills">) {
  return {
    id: skill.skillKey,
    name: skill.name,
    purpose: skill.purpose,
    triggerTerms: skill.triggerTerms,
    version: skill.version,
    source: "self" as const,
    updatedAt: skill.updatedAt,
  };
}

async function activeSkill(ctx: SkillCtx, actor: Actor, skillKey: string) {
  return ctx.db
    .query("userSkills")
    .withIndex("by_account_skill_status", (builder) =>
      builder
        .eq("accountId", actor.accountId)
        .eq("skillKey", skillKey)
        .eq("status", "active"),
    )
    .unique();
}

export const listMetadata = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const skills = await ctx.db
      .query("userSkills")
      .withIndex("by_account_status_updated", (builder) =>
        builder.eq("accountId", actor.accountId).eq("status", "active"),
      )
      .order("desc")
      .take(USER_SKILL_LIMITS.activePerAccount);
    return skills.map(metadata);
  },
});

export const read = query({
  args: { skillId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const skill = await activeSkill(ctx, actor, args.skillId);
    if (!skill) return null;
    return { ...metadata(skill), body: skill.body };
  },
});

export const authorityState = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const prior = await ctx.db
      .query("userSkills")
      .withIndex("by_account_updated", (builder) =>
        builder.eq("accountId", actor.accountId),
      )
      .take(1);
    return { hasWrittenSkill: prior.length > 0 };
  },
});

export const write = mutation({
  args: {
    action: v.union(v.literal("create"), v.literal("update")),
    skillId: v.optional(v.string()),
    name: v.string(),
    purpose: v.string(),
    triggerTerms: v.array(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const value = normalizeInput(args);
    const current =
      args.action === "update" && args.skillId
        ? await activeSkill(ctx, actor, args.skillId)
        : null;
    if (args.action === "update" && !current)
      fail("That skill is no longer available to update.");
    if (args.action === "create" && args.skillId)
      fail("A new skill cannot use an existing skill id.");

    const sameName = await ctx.db
      .query("userSkills")
      .withIndex("by_account_name_status", (builder) =>
        builder
          .eq("accountId", actor.accountId)
          .eq("normalizedName", value.normalizedName)
          .eq("status", "active"),
      )
      .unique();
    if (sameName && sameName.skillKey !== current?.skillKey)
      fail("A skill with that name already exists. Update it instead.");

    if (!current) {
      const active = await ctx.db
        .query("userSkills")
        .withIndex("by_account_status_updated", (builder) =>
          builder.eq("accountId", actor.accountId).eq("status", "active"),
        )
        .take(USER_SKILL_LIMITS.activePerAccount);
      if (active.length >= USER_SKILL_LIMITS.activePerAccount)
        fail(
          `You can keep up to ${USER_SKILL_LIMITS.activePerAccount} active skills. Delete one in Settings before creating another.`,
        );
    }

    const now = Date.now();
    const skillKey = current?.skillKey ?? `skill_${crypto.randomUUID()}`;
    const nextId = await ctx.db.insert("userSkills", {
      accountId: actor.accountId,
      createdInSchoolId: actor.schoolId,
      skillKey,
      ...value,
      version: (current?.version ?? 0) + 1,
      status: "active",
      authoredBy: "model",
      ...(current ? { previousVersionId: current._id } : {}),
      createdAt: now,
      updatedAt: now,
    });
    if (current) {
      await ctx.db.patch(current._id, {
        status: "superseded",
        supersededById: nextId,
        updatedAt: now,
      });
    }
    const written = await ctx.db.get(nextId);
    if (!written)
      throw new Error("USER_SKILL_WRITE_FAILED: The skill was not saved.");
    return metadata(written);
  },
});

export const remove = mutation({
  args: { skillId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const skill = await activeSkill(ctx, actor, args.skillId);
    if (!skill) return { removed: false };
    const now = Date.now();
    await ctx.db.patch(skill._id, {
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
    });
    return { removed: true, skillId: skill.skillKey };
  },
});
