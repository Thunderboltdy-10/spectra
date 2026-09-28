/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { exportPage, requestLifecycleJob } from "./administration";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "platform-fixture", email: "platform-fixture@example.test", emailVerified: true };
const requestHandler = Reflect.get(requestLifecycleJob, "_handler") as (
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; type: "suspend"; reason: string },
) => Promise<unknown>;

type ExportPosition = {
  section: number; range: number; cursor: string | null;
  parentCursor?: string | null; parentsDone?: boolean; pendingParents?: string[];
};
const pageHandler = Reflect.get(exportPage, "_handler") as (
  ctx: QueryCtx,
  args: { schoolId: Id<"schools">; position: ExportPosition },
) => Promise<{ section: string; rows: Record<string, unknown>[]; next: ExportPosition | null }>;

afterEach(() => vi.unstubAllEnvs());

/** A small school beside other tenants whose artifacts carry real content. */
async function tenantsFixture() {
  vi.stubEnv("SUPER_ADMIN_EMAILS", identity.email);
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const operatorId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Operator fixture", status: "active", createdAt: now, updatedAt: now,
    });
    const school = (slug: string) => ctx.db.insert("schools", {
      name: slug, slug, verifiedDomains: [], status: "active", timezone: "Europe/Madrid",
      policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const artifact = (schoolId: Id<"schools">, status: "active" | "archived", body: string) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: operatorId, schoolId, blueprintKey: "document", title: "Essay", content: { body },
        textIndex: "", tags: [], status, createdAt: now, updatedAt: now,
      });
    const integration = (schoolId: Id<"schools">) => ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "X-API-Key",
      authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "fixture", manifestVersion: 1,
      capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      createdByAccountId: operatorId, updatedByAccountId: operatorId, createdAt: now, updatedAt: now,
    });
    const target = await school("target-school");
    await artifact(target, "active", "short");
    await artifact(target, "archived", "short");
    await integration(target);
    for (let index = 0; index < 4; index += 1) {
      const other = await school(`other-school-${index}`);
      const integrationId = await integration(other);
      for (let row = 0; row < 60; row += 1) {
        await artifact(other, "active", "x".repeat(8_000));
        await ctx.db.insert("externalRecords", {
          integrationId, schoolId: other, providerRecordId: `record-${row}`, providerRecordKey: `task:${row}`,
          recordType: "task", classification: "class", audienceScope: "class_members",
          normalized: { description: "x".repeat(4_000) }, payloadVersion: "fixture-v1", sourceHash: "v1",
          tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
        });
      }
    }
    const exportJobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: target, type: "export", status: "running", requestedByAccountId: operatorId,
      approvedByAccountIds: [operatorId], reason: "Legal export before purge",
      impact: { activeMembers: 0, artifacts: 2, workspaces: 0, integrations: 1 }, createdAt: now, updatedAt: now,
    });
    return { target, exportJobId };
  });
  return { t, ...ids };
}

const scanned = (reads: { table: string; operation: string; documentsReturned: number }[], table: string) =>
  reads.filter(row => row.table === table && row.operation !== "get").reduce((sum, row) => sum + row.documentsReturned, 0);

describe("school lifecycle impact", () => {
  it("counts one school's artifacts and integrations without scanning other tenants", async () => {
    const f = await tenantsFixture();
    const measured = await f.t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const auth = { getUserIdentity: async () => ({ ...identity, tokenIdentifier: `fixture|${identity.subject}`, issuer: "fixture" }) };
      await requestHandler({ ...ctx, db: observer.db, auth }, {
        schoolId: f.target, type: "suspend", reason: "Safeguarding incident under review",
      });
      const job = await ctx.db.query("schoolLifecycleJobs").withIndex("by_school_created", q => q.eq("schoolId", f.target)).first();
      return { impact: job?.impact, ...observer.snapshot() };
    });
    expect(measured.impact).toEqual({ activeMembers: 0, artifacts: 2, workspaces: 0, integrations: 1 });
    expect(scanned(measured.reads, "spectraArtifacts")).toBe(2);
    expect(scanned(measured.reads, "schoolIntegrations")).toBe(1);
  });

  it("stops counting a large school's artifacts at a read budget", async () => {
    const f = await tenantsFixture();
    await f.t.run(async ctx => {
      const owner = (await ctx.db.query("accounts").first())!._id;
      const now = Date.now();
      for (let index = 0; index < 260; index += 1)
        await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: owner, schoolId: f.target, blueprintKey: "document", title: "Essay",
          content: { body: "x".repeat(20_000) }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
        });
    });
    const measured = await f.t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const auth = { getUserIdentity: async () => ({ ...identity, tokenIdentifier: `fixture|${identity.subject}`, issuer: "fixture" }) };
      await requestHandler({ ...ctx, db: observer.db, auth }, {
        schoolId: f.target, type: "suspend", reason: "Safeguarding incident under review",
      });
      const job = await ctx.db.query("schoolLifecycleJobs").withIndex("by_school_created", q => q.eq("schoolId", f.target)).order("desc").first();
      return { impact: job?.impact, ...observer.snapshot() };
    });
    // 262 artifacts of about 20 KB exceed the 4 MB budget: the count is a floor.
    expect(measured.impact?.artifactsAtLeast).toBe(true);
    expect(measured.impact?.artifacts).toBeLessThan(262);
    const artifactBytes = measured.reads.filter(row => row.table === "spectraArtifacts")
      .reduce((sum, row) => sum + row.serializedDocumentBytes, 0);
    expect(artifactBytes).toBeLessThan(4_200_000);
  });
});

/** A school larger than one export page beside tenants that must stay out. */
async function largeSchoolFixture() {
  vi.stubEnv("SUPER_ADMIN_EMAILS", identity.email);
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const operatorId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true,
      name: "Operator fixture", status: "active", createdAt: now, updatedAt: now,
    });
    const seed = async (slug: string, scale: { members: number; artifacts: number; threads: number }) => {
      const schoolId = await ctx.db.insert("schools", {
        name: slug, slug, verifiedDomains: [], status: "active", timezone: "Europe/Madrid",
        policyVersion: 1, createdAt: now, updatedAt: now,
      });
      const groupId = await ctx.db.insert("schoolGroups", {
        schoolId, name: "10A", type: "class", source: "manual", status: "active",
        createdByAccountId: operatorId, createdAt: now, updatedAt: now,
      });
      const accounts: Id<"accounts">[] = [];
      for (let index = 0; index < scale.members; index += 1) {
        const accountId = await ctx.db.insert("accounts", {
          clerkId: `${slug}-${index}`, email: `${index}@${slug}.test`, emailVerified: true,
          name: `Student ${index}`, status: "active", createdAt: now, updatedAt: now,
        });
        accounts.push(accountId);
        await ctx.db.insert("schoolMemberships", {
          schoolId, accountId, role: "student", status: "active", createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("schoolGroupMembers", {
          schoolId, groupId, accountId, role: "member", createdByAccountId: operatorId, createdAt: now, updatedAt: now,
        });
      }
      for (const status of ["pending", "pending", "accepted"] as const)
        await ctx.db.insert("membershipInvitations", {
          schoolId, email: `invitee-${status}@${slug}.test`, role: "student", tokenHash: `secret-${slug}`,
          status, invitedByAccountId: operatorId, expiresAt: now + 60_000, createdAt: now, updatedAt: now,
        });
      for (const [status, nodes] of [["active", 10], ["archived", 1]] as const) {
        const workspaceId = await ctx.db.insert("spectraWorkspaces", {
          schoolId, ownerAccountId: accounts[0]!, title: "Biology", status, defaultView: "cards",
          lastActivityAt: now, createdAt: now, updatedAt: now,
        });
        for (let index = 0; index < nodes; index += 1)
          await ctx.db.insert("orgNodes", {
            accountId: accounts[0]!, schoolId, workspaceContextId: workspaceId, parentId: null,
            kind: "folder", name: `Folder ${index}`, orderKey: `a${index}`, createdAt: now, updatedAt: now,
          });
      }
      const statuses = [...Array(scale.artifacts).fill("active"), "draft", "deleted"] as ("active" | "draft" | "deleted")[];
      for (const [index, status] of statuses.entries()) {
        const artifactId = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: accounts[index % accounts.length]!, schoolId, blueprintKey: "document", title: `Essay ${index}`,
          content: { body: "x".repeat(20_000) }, textIndex: "", tags: [], status, createdAt: now, updatedAt: now,
        });
        for (let version = 0; version < (index === 0 ? 30 : 1); version += 1)
          await ctx.db.insert("spectraArtifactVersions", {
            artifactId, ownerAccountId: accounts[0]!, schoolId, source: "manual", after: { version }, createdAt: now,
          });
      }
      for (let index = 0; index < scale.threads; index += 1) {
        const threadId = await ctx.db.insert("spectraThreads", {
          ownerAccountId: accounts[index % accounts.length]!, schoolId, title: `Chat ${index}`, origin: "chat",
          status: "active", createdAt: now, updatedAt: now,
        });
        for (let message = 0; message < (index === 0 ? 12 : 2); message += 1)
          await ctx.db.insert("spectraMessages", { threadId, schoolId, role: "user", content: `Question ${message}`, createdAt: now });
      }
      const integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId, provider: "managebac", baseUrl: "https://provider.example.test", authHeaderName: "X-API-Key",
        authScheme: "raw", status: "connected", tokenMode: "read_only", secretPurpose: "fixture", manifestVersion: 1,
        capabilityCoverage: { discovered: 1, verifiedReadable: 1, unverified: 0, failed: 0, quarantined: 0 },
        syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: true, autoApplySafeUpdates: true, conflictMode: "review" },
        freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
        createdByAccountId: operatorId, updatedByAccountId: operatorId, createdAt: now, updatedAt: now,
      });
      const recordId = await ctx.db.insert("externalRecords", {
        integrationId, schoolId, providerRecordId: "record", providerRecordKey: "task:1",
        recordType: "task", classification: "class", audienceScope: "class_members",
        normalized: { description: "Essay" }, payloadVersion: "fixture-v1", sourceHash: "v1",
        tombstone: false, fetchedAt: now, createdAt: now, updatedAt: now,
      });
      for (const accountId of accounts.slice(0, 5))
        await ctx.db.insert("externalRecordOverlays", {
          recordId, schoolId, accountId, tags: ["mine"], linkedArtifactIds: [], sourceHashAtEdit: "v1",
          createdAt: now, updatedAt: now,
        });
      return schoolId;
    };
    const target = await seed("target-school", { members: 120, artifacts: 150, threads: 70 });
    for (const slug of ["other-a", "other-b"]) await seed(slug, { members: 40, artifacts: 20, threads: 5 });
    const exportJobId = await ctx.db.insert("schoolLifecycleJobs", {
      schoolId: target, type: "export", status: "queued", requestedByAccountId: operatorId,
      approvedByAccountIds: [operatorId], reason: "Legal export before purge",
      impact: { activeMembers: 120, artifacts: 152, workspaces: 1, integrations: 1 }, createdAt: now, updatedAt: now,
    });
    return { target, exportJobId };
  });
  return { t, ...ids };
}

/** The row ids the single-query version 1 export returned, by section. */
async function expectedExport(t: ReturnType<typeof convexTest>, schoolId: Id<"schools">) {
  return t.run(async ctx => {
    type Row = { _id: string } & Record<string, unknown>;
    const all = async (table: string) =>
      ((await ctx.db.query(table as "schoolGroupMembers").collect()) as unknown as Row[])
        .filter(row => row.schoolId === schoolId);
    const children = async (table: string, field: string, parents: Row[]) => {
      const parentIds = new Set(parents.map(parent => parent._id));
      return ((await ctx.db.query(table as "orgNodes").collect()) as unknown as Row[])
        .filter(row => parentIds.has(row[field] as string));
    };
    const ids = (rows: Row[]) => rows.map(row => row._id).sort();
    const memberships = await all("schoolMemberships");
    const workspaces = await all("spectraWorkspaces");
    const artifacts = await all("spectraArtifacts");
    const threads = await all("spectraThreads");
    const expected: Record<string, string[]> = {
      "identity.memberships": ids(memberships),
      "identity.accounts": memberships.map(row => row.accountId as string).sort(),
      "identity.invitations": ids((await all("membershipInvitations")).filter(row => row.status === "pending")),
      "identity.groups": ids(await all("schoolGroups")),
      "identity.groupMembers": ids(await all("schoolGroupMembers")),
      "product.workspaces": ids(workspaces),
      "product.orgNodes": ids(await children("orgNodes", "workspaceContextId", workspaces)),
      "product.artifacts": ids(artifacts),
      "product.artifactVersions": ids(await children("spectraArtifactVersions", "artifactId", artifacts)),
      "product.threads": ids(threads),
      "product.messages": ids(await children("spectraMessages", "threadId", threads)),
      "integrations.integrations": ids(await all("schoolIntegrations")),
      "integrations.externalRecords": ids(await all("externalRecords")),
      "integrations.overlays": ids(await all("externalRecordOverlays")),
    };
    return expected;
  });
}

describe("school export", () => {
  it("pages a school larger than one query through its own indexes only", async () => {
    const f = await largeSchoolFixture();
    let position: ExportPosition | null = { section: 0, range: 0, cursor: null };
    const exported = new Map<string, string[]>();
    let pages = 0;
    while (position) {
      const current: ExportPosition = position;
      const measured = await f.t.run(async ctx => {
        const observer = observeDatabase(ctx.db);
        const page = await pageHandler({ ...ctx, db: observer.db } as QueryCtx, { schoolId: f.target, position: current });
        return { page, ...observer.snapshot() };
      });
      pages += 1;
      // Every range read is a school or parent index, never a table scan.
      expect(measured.reads.filter(row => row.operation !== "get" && (!row.index || row.postIndexFilter))).toEqual([]);
      expect(measured.documentsReturned).toBeLessThanOrEqual(2_400);
      expect(measured.serializedDocumentBytes).toBeLessThan(8_000_000);
      for (const row of measured.page.rows)
        exported.set(measured.page.section, [...(exported.get(measured.page.section) ?? []), String(row._id)]);
      position = measured.page.next;
    }
    // Artifacts exceed one page's bytes, the first artifact's versions exceed
    // the small-parent batch, and the threads exceed one parent page.
    expect(pages).toBeGreaterThan(30);
    const expected = await expectedExport(f.t, f.target);
    for (const [section, ids] of Object.entries(expected))
      expect([...(exported.get(section) ?? [])].sort(), section).toEqual(ids);
  });

  it("writes the whole school as parts and resumes after a stopped action", async () => {
    const f = await largeSchoolFixture();
    // A first action claims the export, commits one part, then stops.
    const first = await f.t.mutation(internal.administration.claimLifecycleExport, {});
    expect(first?.jobId).toBe(f.exportJobId);
    const page = await f.t.query(internal.administration.exportPage, { schoolId: f.target, position: first!.position! });
    const storageId = await f.t.run(ctx => ctx.storage.store(new Blob([JSON.stringify({
      format: "spectra-school-export-part", version: 2, index: 0, section: page.section, rows: page.rows,
    })], { type: "application/json" })));
    expect(await f.t.mutation(internal.administration.commitLifecycleExportPart, {
      jobId: f.exportJobId, leaseId: first!.leaseId, expectedParts: 0,
      part: { storageId, section: page.section, rows: page.rows.length, bytes: 1 },
      position: page.next, continueAfter: false,
    })).toBe(true);
    await f.t.run(async ctx => {
      const job = (await ctx.db.get(f.exportJobId))!;
      await ctx.db.patch(job._id, { exportProgress: { ...job.exportProgress!, leaseExpiresAt: 0 } });
    });

    await f.t.action(internal.administration.processLifecycleExports, {});

    // The stopped action's lease is gone, so it can no longer write.
    expect(await f.t.mutation(internal.administration.commitLifecycleExportPart, {
      jobId: f.exportJobId, leaseId: first!.leaseId, expectedParts: 0, position: null, continueAfter: false,
    })).toBe(false);
    const result = await f.t.run(async ctx => {
      const job = (await ctx.db.get(f.exportJobId))!;
      const parts = await ctx.db.query("schoolExportParts")
        .withIndex("by_job_index", q => q.eq("jobId", f.exportJobId)).collect();
      const read = async (id: Id<"_storage">) => JSON.parse(await (await ctx.storage.get(id))!.text());
      return {
        job,
        manifest: await read(job.exportStorageId!),
        parts: await Promise.all(parts.map(async part => ({ part, body: await read(part.storageId) }))),
      };
    });
    expect(result.job.status).toBe("completed");
    expect(result.job.exportProgress?.takeovers).toBe(1);
    expect(result.parts.map(({ part }) => part.index)).toEqual(result.parts.map((_, index) => index));
    const exported = new Map<string, Record<string, unknown>[]>();
    for (const { part, body } of result.parts) {
      expect(body.section).toBe(part.section);
      expect(body.rows).toHaveLength(part.rows);
      exported.set(part.section, [...(exported.get(part.section) ?? []), ...body.rows]);
    }
    const expected = await expectedExport(f.t, f.target);
    for (const [section, ids] of Object.entries(expected))
      expect((exported.get(section) ?? []).map(row => String(row._id)).sort(), section).toEqual(ids);
    expect(exported.get("identity.invitations")!.every(row => !("tokenHash" in row))).toBe(true);
    expect(result.manifest).toMatchObject({ format: "spectra-school-export", version: 2, school: { _id: f.target } });
    expect(result.manifest.parts).toHaveLength(result.parts.length);
    expect(result.manifest.sections.find((section: { name: string }) => section.name === "product.messages").rows)
      .toBe(expected["product.messages"]!.length);

    const download = await f.t.withIdentity(identity).mutation(api.administration.lifecycleExportUrl, { jobId: f.exportJobId });
    expect(download.parts).toHaveLength(result.parts.length);
  });
});
