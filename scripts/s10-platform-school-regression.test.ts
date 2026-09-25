/// <reference types="vite/client" />
/** Audit witnesses for known School truncation. Passing means reproduced,
 * never repaired. No provider calls or deployed database writes occur here. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs, FunctionReturnType, WithoutSystemFields } from "convex/server";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import { adminOverview, recordsForPurpose } from "../convex/managebac";
import { agentGovernance } from "../convex/administration";
import { observeDatabase, serializedBytes } from "./perf-read-ledger";

const modules = import.meta.glob("../convex/**/*.ts");
const identity = { subject: "s10-school-audit", email: "school-audit@example.test", emailVerified: true };
const observations: object[] = [];
type PurposeArgs = FunctionArgs<typeof api.managebac.recordsForPurpose>;
const purposeHandler = Reflect.get(recordsForPurpose, "_handler") as (
  ctx: QueryCtx, args: PurposeArgs,
) => Promise<FunctionReturnType<typeof api.managebac.recordsForPurpose>>;
const adminHandler = Reflect.get(adminOverview, "_handler") as (
  ctx: QueryCtx, args: Record<string, never>,
) => Promise<FunctionReturnType<typeof api.managebac.adminOverview>>;
const governanceHandler = Reflect.get(agentGovernance, "_handler") as (
  ctx: QueryCtx, args: Record<string, never>,
) => Promise<FunctionReturnType<typeof api.administration.agentGovernance>>;

async function setup(role: "student" | "school_admin" = "student") {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "S10 School audit", slug: "s10-school-audit", verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Audit fixture",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role, status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("schoolIntegrations", {
      schoolId, provider: "managebac", baseUrl: "https://school-audit.example.test",
      authHeaderName: "X-API-Key", authScheme: "raw", status: "connected", tokenMode: "read_only",
      secretPurpose: "fixture-only", manifestVersion: 1,
      capabilityCoverage: { discovered: 0, verifiedReadable: 0, unverified: 0, failed: 0, quarantined: 0 },
      syncPolicy: { frequencyMinutes: 60, autoCreateClasses: false, autoImportTasks: false,
        autoApplySafeUpdates: false, conflictMode: "review" },
      freshnessSlaMinutes: 60, requestBudgetPerMinute: 30, bootstrapVersion: 1,
      lastSyncAt: now, createdByAccountId: accountId, updatedByAccountId: accountId,
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("externalIdentityMappings", {
      integrationId, schoolId, accountId, providerUserId: "audit-student", verifiedEmailHash: "fixture",
      status: "verified", matchCount: 1, resolvedAt: now, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("managebacClassSelections", {
      integrationId, schoolId, accountId, providerClassId: "math", providerRecordKey: "class:math",
      academicPeriodKey: "2026", selected: true, retention: "keep_in_spectra",
      selectionRevision: 1, selectedAt: now, createdAt: now, updatedAt: now,
    });
    return { now, schoolId, integrationId, accountId };
  });
  return { t, ...fixture };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
type SourceFields = WithoutSystemFields<Doc<"externalRecords">>;
function source(fixture: Fixture, key: string, fields: Partial<SourceFields> = {}): SourceFields {
  return {
    integrationId: fixture.integrationId, schoolId: fixture.schoolId,
    providerRecordId: key, providerRecordKey: key, sourceIdentityKey: key,
    recordType: "class_resource", classification: "class", audienceScope: "class_members",
    providerClassId: "math", academicPeriodKey: "2026", normalized: { title: key },
    payloadVersion: "fixture-v1", sourceHash: key, tombstone: false, sourceState: "available",
    fetchedAt: fixture.now, createdAt: fixture.now, updatedAt: fixture.now, ...fields,
  };
}
async function addMembership(fixture: Fixture) {
  return fixture.t.run(ctx => ctx.db.insert("externalRecords", source(fixture, "membership:math", {
    recordType: "membership", classification: "personal", audienceScope: "mapped_user",
    mappedAccountId: fixture.accountId,
  })));
}
async function observe<R>(fixture: Fixture, handler: (ctx: QueryCtx) => Promise<R>) {
  return fixture.t.withIdentity(identity).run(async ctx => {
    const observer = observeDatabase(ctx.db);
    const result = await handler({ ...ctx, db: observer.db });
    const ledger = observer.snapshot();
    const externalReads = ledger.reads.filter(row => row.table === "externalRecords");
    expect(ledger.writes).toBe(0);
    return { result, ledger, responseBytes: serializedBytes(result),
      externalDocuments: externalReads.reduce((sum, row) => sum + row.documentsReturned, 0),
      externalBytes: externalReads.reduce((sum, row) => sum + row.serializedDocumentBytes, 0) };
  });
}
const summarize = (measurement: Awaited<ReturnType<typeof observe>>) => ({
  calls: measurement.ledger.calls, documents: measurement.ledger.documentsReturned,
  rowBytes: measurement.ledger.serializedDocumentBytes, externalDocuments: measurement.externalDocuments,
  externalBytes: measurement.externalBytes, responseBytes: measurement.responseBytes, writes: measurement.ledger.writes,
});

describe("S10 School known-failure audit witnesses", () => {
  it.each(["unselected class", "past date"] as const)("reproduces the 500-row tail omission after filtering by %s", async mode => {
    const fixture = await setup();
    await addMembership(fixture);
    const dateCase = mode === "past date";
    const targetFields: Partial<SourceFields> = dateCase ? {
      recordType: "assignment", classification: "personal", audienceScope: "mapped_user",
      mappedAccountId: fixture.accountId, normalized: { title: "Eligible deadline", dueAt: fixture.now + 60_000 },
    } : {};
    const targetId = await fixture.t.run(ctx => ctx.db.insert("externalRecords", source(fixture, "eligible-target", targetFields)));
    const args: PurposeArgs = {
      purpose: dateCase ? "upcoming_deadlines" : "class_resources", classId: "math", limit: 50,
      ...(dateCase ? { from: fixture.now, to: fixture.now + 120_000 } : {}),
    };
    const read = () => observe(fixture, ctx => purposeHandler(ctx, args));
    const before = await read();
    expect(before.result.records.map(row => row.id)).toEqual([targetId]);
    const fillerIds: Id<"externalRecords">[] = [];
    let fifty: Awaited<ReturnType<typeof read>> | undefined;
    for (const [start, count] of [[0, 50], [50, 450]]) {
      fillerIds.push(...await fixture.t.run(async ctx => {
        const ids = [];
        for (let index = start; index < start + count; index++) ids.push(await ctx.db.insert("externalRecords", source(fixture, `irrelevant-${index}`, {
          ...targetFields, providerClassId: dateCase ? "math" : "history",
          normalized: { title: "Irrelevant", description: "x".repeat(128), ...(dateCase ? { dueAt: fixture.now - 60_000 } : {}) },
        })));
        return ids;
      }));
      if (start === 0) {
        fifty = await read();
        expect(fifty.result.records.map(row => row.id)).toEqual([targetId]);
      }
    }
    const after = await read();
    expect(await fixture.t.run(ctx => ctx.db.get(targetId))).toMatchObject({ tombstone: false, providerClassId: "math" });
    expect(after.result.records).toEqual([]);
    expect(after.result).toMatchObject({ connected: true, stale: true });
    expect(after.result).not.toHaveProperty("continueCursor");
    expect(after.result).not.toHaveProperty("isDone");
    expect(after.externalDocuments).toBe(dateCase ? 1_001 : 501);
    await fixture.t.run(async ctx => {
      for (const id of fillerIds) {
        const row = await ctx.db.get(id);
        await ctx.db.patch(id, { normalized: { ...row!.normalized, description: "x".repeat(8_192) } });
      }
    });
    const grown = await read();
    expect(grown.result).toEqual(after.result);
    expect(grown.responseBytes).toBe(after.responseBytes);
    expect(grown.externalBytes).toBeGreaterThan(after.externalBytes * 5);
    observations.push({ case: mode, eligibleRecords: 1, returnedAfter500: 0,
      completenessBudgetPassed: false, bodyIndependenceBudgetPassed: false,
      before: summarize(before), after50: summarize(fifty!), after500: summarize(after), bodyGrowth: summarize(grown) });
  });

  it("reproduces lost current membership behind 500 older tombstones", async () => {
    const fixture = await setup();
    const tombstones = await fixture.t.run(async ctx => {
      const ids = [];
      for (let index = 0; index < 500; index++) ids.push(await ctx.db.insert("externalRecords", source(fixture, `old-membership-${index}`, {
        recordType: "membership", classification: "personal", audienceScope: "mapped_user",
        mappedAccountId: fixture.accountId, providerClassId: "retired", tombstone: true,
      })));
      return ids;
    });
    const membershipId = await addMembership(fixture);
    const targetId = await fixture.t.run(ctx => ctx.db.insert("externalRecords", source(fixture, "member-resource")));
    const args: PurposeArgs = { purpose: "class_resources", classId: "math", limit: 50 };
    const missing = await observe(fixture, ctx => purposeHandler(ctx, args));
    expect(await fixture.t.run(ctx => ctx.db.get(membershipId))).toMatchObject({ tombstone: false, providerClassId: "math" });
    expect(missing.result.records).toEqual([]);
    expect(missing.externalDocuments).toBe(501);
    // Positive control: moving equivalent current membership evidence into
    // the sampled prefix restores the same untouched source immediately.
    await fixture.t.run(ctx => ctx.db.patch(tombstones[0], { tombstone: false, providerClassId: "math" }));
    const prefixControl = await observe(fixture, ctx => purposeHandler(ctx, args));
    expect(prefixControl.result.records.map(row => row.id)).toEqual([targetId]);
    observations.push({ case: "membership tail", completenessBudgetPassed: false,
      missing: summarize(missing), prefixControl: summarize(prefixControl) });
  });

  it("reproduces empty admin preview after 500 newer personal records", async () => {
    const fixture = await setup("school_admin");
    const targetId = await fixture.t.run(ctx => ctx.db.insert("externalRecords", source(fixture, "school-preview", {
      classification: "school", audienceScope: "school", providerClassId: undefined,
    })));
    const read = () => observe(fixture, ctx => adminHandler(ctx, {}));
    const before = await read();
    expect(before.result.previews?.map(row => row._id)).toEqual([targetId]);
    await fixture.t.run(async ctx => {
      for (let index = 0; index < 500; index++) await ctx.db.insert("externalRecords", source(fixture, `private-record-${index}`, {
        classification: "personal", audienceScope: "mapped_user", mappedAccountId: fixture.accountId,
        normalized: { title: "Private fixture", description: "x".repeat(128) }, updatedAt: fixture.now + 1,
      }));
    });
    const after = await read();
    expect(await fixture.t.run(ctx => ctx.db.get(targetId))).not.toBeNull();
    expect(after.result.previews).toEqual([]);
    expect(after.result).not.toHaveProperty("continueCursor");
    expect(after.externalDocuments).toBe(500);
    observations.push({ case: "admin preview", eligibleRecords: 1, returnedAfter500: 0,
      completenessBudgetPassed: false, before: summarize(before), after500: summarize(after) });
  });

  it("reproduces deadlineAt being filtered as a date but excluded from chronological sorting", async () => {
    const fixture = await setup();
    await addMembership(fixture);
    const [earliestId, laterId] = await fixture.t.run(async ctx => Promise.all([
      ctx.db.insert("externalRecords", source(fixture, "earliest", {
        recordType: "deadline", normalized: { title: "Earliest", deadlineAt: fixture.now + 10_000 },
      })),
      ctx.db.insert("externalRecords", source(fixture, "later", {
        recordType: "deadline", normalized: { title: "Later", dueAt: fixture.now + 20_000 },
      })),
    ]));
    const measured = await observe(fixture, ctx => purposeHandler(ctx, {
      purpose: "upcoming_deadlines", classId: "math", from: fixture.now, to: fixture.now + 30_000,
    }));
    expect(measured.result.records.map(row => row.id)).toEqual([laterId, earliestId]);
    observations.push({ case: "deadlineAt order", chronologicalOrderBudgetPassed: false, measurement: summarize(measured) });
  });

  it("reproduces agent governance reading unrelated school artifact bodies", async () => {
    const fixture = await setup("school_admin");
    const artifactFields = {
      ownerAccountId: fixture.accountId, schoolId: fixture.schoolId,
      title: "Shared agent", blueprintKey: "agent", content: {}, tags: [],
      status: "active" as const, createdAt: fixture.now, updatedAt: fixture.now,
    };
    const agentId = await fixture.t.run(async ctx => {
      const id = await ctx.db.insert("spectraArtifacts", artifactFields);
      await ctx.db.insert("accessGrants", {
        schoolId: fixture.schoolId, resourceType: "agent", resourceId: id,
        principalType: "school", principalId: fixture.schoolId, level: "read", capabilities: ["read", "use"],
        source: "direct", createdByAccountId: fixture.accountId, createdAt: fixture.now, updatedAt: fixture.now,
      });
      return id;
    });
    const read = () => observe(fixture, ctx => governanceHandler(ctx, {}));
    const before = await read();
    expect(before.result.agents.map(row => row.agentId)).toEqual([agentId]);
    const unrelated: Id<"spectraArtifacts">[] = [];
    let twenty: Awaited<ReturnType<typeof read>> | undefined;
    for (const count of [20, 180]) {
      unrelated.push(...await fixture.t.run(async ctx => {
        const ids = [];
        for (let index = 0; index < count; index++) ids.push(await ctx.db.insert("spectraArtifacts", {
          ...artifactFields, title: "Private document", blueprintKey: "document", content: { body: "x".repeat(128) },
        }));
        return ids;
      }));
      if (count === 20) twenty = await read();
    }
    const twoHundred = await read();
    expect(twoHundred.result).toEqual(before.result);
    expect(twoHundred.ledger.reads.find(row => row.table === "spectraArtifacts")?.documentsReturned).toBe(201);
    await fixture.t.run(async ctx => {
      for (const id of unrelated) await ctx.db.patch(id, { content: { body: "x".repeat(8_192) } });
    });
    const grown = await read();
    expect(grown.result).toEqual(before.result);
    expect(grown.ledger.serializedDocumentBytes).toBeGreaterThan(twoHundred.ledger.serializedDocumentBytes * 5);
    observations.push({ case: "agent governance", visibleAgents: 1, offTypeDensityBudgetPassed: false,
      bodyIndependenceBudgetPassed: false, before: summarize(before), after20: summarize(twenty!),
      after200: summarize(twoHundred), bodyGrowth: summarize(grown) });
  });
});

afterAll(() => {
  const evidence = {
    semantics: "Known failures reproduced in isolated convex-test; returned-row UTF-8 JSON bytes, not engine scans, physical I/O, hosted latency or billing.",
    sourceSha256: Object.fromEntries(["../convex/managebac.ts", "../convex/administration.ts", "../convex/schema.ts", "./perf-read-ledger.ts"].map(path => [path,
      createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")])),
    observations,
  };
  const outputPath = process.env.S10_SCHOOL_AUDIT_OUTPUT;
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.info("S10 School audit witnesses", JSON.stringify(evidence));
});
