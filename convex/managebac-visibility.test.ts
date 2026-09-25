/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { canReadManagebacRecord, getReadableManagebacSourceRecord } from "./managebacVisibility";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Visibility test school", slug: "visibility-test", status: "active", verifiedDomains: [],
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "visibility-alice", email: "alice@visibility.example.test", emailVerified: true,
      name: "Alice", status: "active", createdAt: now, updatedAt: now,
    });
    const otherAccountId = await ctx.db.insert("accounts", {
      clerkId: "visibility-bob", email: "bob@visibility.example.test", emailVerified: true,
      name: "Bob", status: "active", createdAt: now, updatedAt: now,
    });
    const membershipId = await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://visibility.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "test",
      manifestVersion: 1, capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: accountId, updatedByAccountId: accountId, createdAt: now, updatedAt: now,
    });
    const mappingId = await ctx.db.insert("externalIdentityMappings", {
      integrationId, schoolId, accountId, providerUserId: "provider-alice", verifiedEmailHash: "test-hash",
      status: "verified", matchCount: 1, createdAt: now, updatedAt: now,
    });
    const memberId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId, providerRecordId: "class-1", providerRecordKey: "class:class-1",
      recordType: "membership", classification: "personal", audienceScope: "mapped_user", mappedAccountId: accountId,
      providerClassId: "class-1", academicPeriodKey: "2026", normalized: { title: "My class" },
      payloadVersion: "1", sourceHash: "member", tombstone: false, sourceState: "available", fetchedAt: now, createdAt: now, updatedAt: now,
    });
    const selectionId = await ctx.db.insert("managebacClassSelections", {
      integrationId, schoolId, accountId, providerClassId: "class-1", providerRecordKey: "class:class-1",
      academicPeriodKey: "2026", selected: true, retention: "keep_in_spectra", selectionRevision: 1, createdAt: now, updatedAt: now,
    });
    const recordId = await ctx.db.insert("externalRecords", {
      integrationId, schoolId, providerRecordId: "resource-1", providerRecordKey: "resource:resource-1",
      recordType: "class_resource", classification: "class", audienceScope: "class_members",
      providerClassId: "class-1", academicPeriodKey: "2026", normalized: { title: "Inherited reading" },
      payloadVersion: "1", sourceHash: "resource", tombstone: false, sourceState: "available", fetchedAt: now, createdAt: now, updatedAt: now,
    });
    return { schoolId, accountId, otherAccountId, membershipId, integrationId, mappingId, memberId, selectionId, recordId };
  });
  const actor = { accountId: ids.accountId, schoolId: ids.schoolId };
  const read = (recordId: Id<"externalRecords"> = ids.recordId) => t.run(async ctx =>
    canReadManagebacRecord(ctx, actor, (await ctx.db.get(recordId))!));
  return { t, ...ids, actor, read };
}

describe("current single-record ManageBac visibility", () => {
  it("admits inherited class material and exact imported provenance", async () => {
    const f = await fixture();
    expect(await f.read()).toBe(true);
    const source = await f.t.run(ctx => getReadableManagebacSourceRecord(ctx, f.actor, `managebac:${f.recordId}`));
    expect(source?._id).toBe(f.recordId);
  });

  it("admits direct mapped records without requiring separate class membership", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      await ctx.db.delete(f.memberId);
      await ctx.db.patch(f.recordId, { audienceScope: "mapped_user", mappedAccountId: f.accountId });
    });
    expect(await f.read()).toBe(true);
  });

  it.each(["school", "authorized_staff"] as const)("uses explicit %s audience and current staff role", async audienceScope => {
    const f = await fixture();
    await f.t.run(async ctx => {
      await ctx.db.delete(f.memberId);
      await ctx.db.patch(f.recordId, { audienceScope, providerClassId: undefined });
    });
    expect(await f.read()).toBe(audienceScope === "school");
    await f.t.run(ctx => ctx.db.patch(f.membershipId, { role: "teacher" }));
    expect(await f.read()).toBe(true);
    await f.t.run(ctx => ctx.db.patch(f.membershipId, { role: "student" }));
    expect(await f.read()).toBe(audienceScope === "school");
  });

  it("keeps own class discovery available before selection", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.delete(f.selectionId));
    expect(await f.read(f.memberId)).toBe(true);
    expect(await f.read()).toBe(false);
  });

  it.each(["2025", undefined])("does not inherit membership from period %s", async academicPeriodKey => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.memberId, { academicPeriodKey }));
    expect(await f.read()).toBe(false);
  });

  it.each(["2025", undefined])("does not use a selected class from period %s", async academicPeriodKey => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.selectionId, { academicPeriodKey }));
    expect(await f.read()).toBe(false);
  });

  it("supports matching legacy periodless records without treating missing period as wildcard", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      for (const id of [f.memberId, f.recordId, f.selectionId]) await ctx.db.patch(id, { academicPeriodKey: undefined });
    });
    expect(await f.read()).toBe(true);
    await f.t.run(ctx => ctx.db.patch(f.memberId, { academicPeriodKey: "2026" }));
    expect(await f.read()).toBe(false);
  });

  it.each(["temporarily_unavailable", "missing", "removed"] as const)("denies %s source and membership", async sourceState => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.recordId, { sourceState }));
    expect(await f.read()).toBe(false);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.recordId, { sourceState: "available" });
      await ctx.db.patch(f.memberId, { sourceState });
    });
    expect(await f.read()).toBe(false);
  });

  it("denies tombstones, deselection, and a stale previously loaded source", async () => {
    const f = await fixture();
    const oldRecord = await f.t.run(ctx => ctx.db.get(f.recordId));
    await f.t.run(ctx => ctx.db.patch(f.recordId, { tombstone: true }));
    expect(await f.t.run(ctx => canReadManagebacRecord(ctx, f.actor, oldRecord!))).toBe(false);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.recordId, { tombstone: false });
      await ctx.db.patch(f.memberId, { tombstone: true });
    });
    expect(await f.read()).toBe(false);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.memberId, { tombstone: false });
      await ctx.db.patch(f.selectionId, { selected: false });
    });
    expect(await f.read()).toBe(false);
  });

  it.each(["disconnected", "validating", "blocked", "revoked"] as const)("denies %s integration", async status => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.integrationId, { status }));
    expect(await f.read()).toBe(false);
  });

  it("allows degraded current connector but not duplicate/replaced integration", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.integrationId, { status: "degraded" }));
    expect(await f.read()).toBe(true);
    await f.t.run(async ctx => {
      const old = (await ctx.db.get(f.integrationId))!;
      const { _id, _creationTime, ...body } = old;
      void _id; void _creationTime;
      await ctx.db.insert("schoolIntegrations", body);
    });
    expect(await f.read()).toBe(false);
    await f.t.run(ctx => ctx.db.delete(f.integrationId));
    expect(await f.read()).toBe(false);
  });

  it.each([
    { status: "revoked" }, { status: "ambiguous" }, { status: "pending" },
    { providerUserId: undefined }, { matchCount: 2 }, { revokedAt: 1 },
  ] satisfies Partial<Doc<"externalIdentityMappings">>[])("denies invalid identity mapping %j", async patch => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.mappingId, patch));
    expect(await f.read()).toBe(false);
  });

  it("never admits another account's personal row through a shared audience or selection", async () => {
    const f = await fixture();
    for (const audienceScope of ["mapped_user", "school", "class_members", "authorized_staff"] as const) {
      await f.t.run(ctx => ctx.db.patch(f.recordId, { mappedAccountId: f.otherAccountId, audienceScope }));
      expect(await f.read()).toBe(false);
    }
  });

  it("does not accept another account's membership or an unmapped personal source", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.memberId, { mappedAccountId: f.otherAccountId }));
    expect(await f.read()).toBe(false);
    await f.t.run(ctx => ctx.db.patch(f.recordId, { audienceScope: "mapped_user" }));
    expect(await f.read()).toBe(false);
  });

  it("rejects changed current school and inactive account authority", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.accountId, { status: "deactivated" }));
    expect(await f.read()).toBe(false);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.accountId, { status: "active" });
      await ctx.db.patch(f.schoolId, { status: "suspended" });
    });
    expect(await f.read()).toBe(false);
  });

  it("rejects foreign-school source, mapping, membership and selection rows", async () => {
    const f = await fixture();
    const otherSchoolId = await f.t.run(ctx => ctx.db.insert("schools", {
      name: "Other school", slug: "other-school", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: 1, updatedAt: 1,
    }));
    for (const id of [f.recordId, f.mappingId, f.memberId, f.selectionId]) {
      await f.t.run(ctx => ctx.db.patch(id, { schoolId: otherSchoolId }));
      expect(await f.read()).toBe(false);
      await f.t.run(ctx => ctx.db.patch(id, { schoolId: f.schoolId }));
    }
    await f.t.run(ctx => ctx.db.patch(f.membershipId, { schoolId: otherSchoolId }));
    expect(await f.read()).toBe(false);
  });

  it("rejects revoked school membership even with a cached actor", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.membershipId, { status: "ended" }));
    expect(await f.read()).toBe(false);
  });

  it("does not cap membership search before the exact match", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      const member = (await ctx.db.get(f.memberId))!;
      const { _id, _creationTime, ...body } = member;
      void _id; void _creationTime;
      await ctx.db.delete(f.memberId);
      for (let i = 0; i < 505; i++) await ctx.db.insert("externalRecords", { ...body, providerClassId: `unrelated-${i}` });
      await ctx.db.insert("externalRecords", body);
    });
    expect(await f.read()).toBe(true);
  });

  it.each(["", "managebac:", "managebac:old-provider-key", "managebac:a:b", "other:source", " managebac:source"])("denies unresolved provenance %s", async sourceId => {
    const f = await fixture();
    expect(await f.t.run(ctx => getReadableManagebacSourceRecord(ctx, f.actor, sourceId))).toBeNull();
  });
});
