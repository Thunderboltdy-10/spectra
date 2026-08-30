/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { USER_SKILL_LIMITS } from "./userSkills";

const modules = import.meta.glob("./**/*.ts");

function identity(suffix: string) {
  return {
    subject: `clerk_user_skills_${suffix}`,
    email: `user-skills-${suffix}@example.test`,
    emailVerified: true,
  };
}

async function seedActor(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  schoolId?: Awaited<ReturnType<typeof seedSchool>>,
) {
  const actorIdentity = identity(suffix);
  return t.run(async (ctx) => {
    const now = Date.now();
    const activeSchoolId =
      schoolId ??
      (await ctx.db.insert("schools", {
        name: `User Skills School ${suffix}`,
        slug: `user-skills-${suffix}-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      }));
    const accountId = await ctx.db.insert("accounts", {
      clerkId: actorIdentity.subject,
      email: actorIdentity.email,
      emailVerified: true,
      name: `User Skills ${suffix}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId: activeSchoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId: activeSchoolId, identity: actorIdentity };
  });
}

async function seedSchool(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("schools", {
      name: "Shared User Skills School",
      slug: `shared-user-skills-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  });
}

const validSkill = {
  action: "create" as const,
  name: "Physics flashcards",
  purpose: "Build the user's preferred atomic physics flashcards.",
  triggerTerms: ["physics flashcards", "active recall"],
  body: "# Procedure\n\nCreate one precise concept per card, then check every answer against the supplied source.",
};

describe("account skills", () => {
  it("versions edits, lists metadata only, and lazily reads the active body", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t, "versioning");
    const asActor = t.withIdentity(actor.identity);

    expect(await asActor.query(anyApi.userSkills.authorityState, {})).toEqual({
      hasWrittenSkill: false,
    });
    const created = await asActor.mutation(anyApi.userSkills.write, validSkill);
    expect(created).toMatchObject({ version: 1, source: "self" });

    const listed = await asActor.query(anyApi.userSkills.listMetadata, {});
    expect(listed).toEqual([
      expect.objectContaining({ id: created.id, version: 1 }),
    ]);
    expect(listed[0]).not.toHaveProperty("body");

    const updatedBody =
      "# Procedure\n\nCreate one precise concept per card, cite the source, and add a short misconception cue.";
    const updated = await asActor.mutation(anyApi.userSkills.write, {
      ...validSkill,
      action: "update",
      skillId: created.id,
      name: "Physics recall cards",
      body: updatedBody,
    });
    expect(updated).toMatchObject({ id: created.id, version: 2 });
    expect(
      await asActor.query(anyApi.userSkills.read, { skillId: created.id }),
    ).toMatchObject({
      id: created.id,
      version: 2,
      body: updatedBody,
    });

    const versions = await t.run((ctx) =>
      ctx.db
        .query("userSkills")
        .withIndex("by_account_skill_version", (query) =>
          query.eq("accountId", actor.accountId).eq("skillKey", created.id),
        )
        .collect(),
    );
    expect(versions.map((skill) => skill.status).sort()).toEqual([
      "active",
      "superseded",
    ]);
    expect(await asActor.query(anyApi.userSkills.authorityState, {})).toEqual({
      hasWrittenSkill: true,
    });
  });

  it("keeps reads and deletion account-scoped while retaining deleted history", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchool(t);
    const owner = await seedActor(t, "owner", schoolId);
    const other = await seedActor(t, "other", schoolId);
    const created = await t
      .withIdentity(owner.identity)
      .mutation(anyApi.userSkills.write, validSkill);

    expect(
      await t.withIdentity(other.identity).query(anyApi.userSkills.read, {
        skillId: created.id,
      }),
    ).toBeNull();
    expect(
      await t.withIdentity(other.identity).mutation(anyApi.userSkills.remove, {
        skillId: created.id,
      }),
    ).toEqual({ removed: false });

    expect(
      await t.withIdentity(owner.identity).mutation(anyApi.userSkills.remove, {
        skillId: created.id,
      }),
    ).toEqual({ removed: true, skillId: created.id });
    expect(
      await t.withIdentity(owner.identity).query(anyApi.userSkills.read, {
        skillId: created.id,
      }),
    ).toBeNull();
    expect(
      await t
        .withIdentity(owner.identity)
        .query(anyApi.userSkills.listMetadata, {}),
    ).toEqual([]);
    const retained = await t.run((ctx) =>
      ctx.db
        .query("userSkills")
        .withIndex("by_account_skill_status", (query) =>
          query
            .eq("accountId", owner.accountId)
            .eq("skillKey", created.id)
            .eq("status", "deleted"),
        )
        .unique(),
    );
    expect(retained?.deletedAt).toEqual(expect.any(Number));
  });

  it("refuses oversized metadata, bodies, sensitive content, and a forty-first active skill", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t, "limits");
    const asActor = t.withIdentity(actor.identity);

    await expect(
      asActor.mutation(anyApi.userSkills.write, {
        ...validSkill,
        body: "x".repeat(USER_SKILL_LIMITS.bodyCharacters + 1),
      }),
    ).rejects.toThrow(/up to 4,000 characters/i);
    await expect(
      asActor.mutation(anyApi.userSkills.write, {
        ...validSkill,
        triggerTerms: Array.from(
          { length: USER_SKILL_LIMITS.triggerCount + 1 },
          (_, index) => `trigger ${index}`,
        ),
      }),
    ).rejects.toThrow(/up to 12 trigger phrases/i);
    await expect(
      asActor.mutation(anyApi.userSkills.write, {
        ...validSkill,
        body: "# Procedure\n\nUse the api_key supplied here and keep it for every later study session.",
      }),
    ).rejects.toThrow(/cannot save secrets/i);

    await t.run(async (ctx) => {
      const now = Date.now();
      for (
        let index = 0;
        index < USER_SKILL_LIMITS.activePerAccount;
        index += 1
      ) {
        await ctx.db.insert("userSkills", {
          accountId: actor.accountId,
          createdInSchoolId: actor.schoolId,
          skillKey: `seeded-skill-${index}`,
          normalizedName: `seeded skill ${index}`,
          name: `Seeded skill ${index}`,
          purpose: "Exercise the active account skill boundary.",
          triggerTerms: [`seeded-${index}`],
          body: "# Procedure\n\nFollow the bounded seeded test procedure carefully.",
          version: 1,
          status: "active",
          authoredBy: "model",
          createdAt: now + index,
          updatedAt: now + index,
        });
      }
    });
    await expect(
      asActor.mutation(anyApi.userSkills.write, {
        ...validSkill,
        name: "Forty first skill",
      }),
    ).rejects.toThrow(/up to 40 active skills/i);
  });
});
