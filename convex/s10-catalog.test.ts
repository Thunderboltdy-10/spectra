/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { list as listArtifacts } from "./spectraArtifacts";
import { list as listWorkspaces } from "./spectraWorkspaces";
import {
  upsertArtifactSummary,
  ARTIFACT_SUMMARY_READ_MODEL_VERSION,
} from "./orgTreeShared";
import { evaluateAccessForActor, hasDirectReadGrant } from "./authorityShared";
import { getActorForAccountId } from "./identityShared";
import type { QueryCtx } from "./_generated/server";
import {
  artifactPage,
  workspacePage,
  CATALOG_CANDIDATES,
  CATALOG_PLACEMENTS,
  CATALOG_MIGRATION_KEY,
} from "./catalogPages";
import { openCatalogCursor, sealCatalogCursor } from "./catalogCursor";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "s10-catalog",
  email: "s10-catalog@example.test",
  emailVerified: true,
};
beforeEach(() =>
  vi.stubEnv(
    "SPECTRA_SECRET_BRIDGE_KEY",
    "s10-disposable-cursor-test-key-123456789",
  ),
);
afterEach(() => vi.unstubAllEnvs());
const artifactHandler = (
  listArtifacts as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { placement: "all"; limit: number },
    ) => Promise<Array<Record<string, unknown>>>;
  }
)._handler;
const workspaceHandler = (
  listWorkspaces as unknown as {
    _handler: (
      ctx: QueryCtx,
      args: { limit: number },
    ) => Promise<Array<Record<string, unknown>>>;
  }
)._handler;

// Count actual documents returned by database operations, rather than only the
// final response. Test-only instrumentation leaves the database query intact.
function meter(ctx: QueryCtx) {
  const rows: Record<string, number> = {};
  const queries: Record<string, number> = {};
  const readBytes: Record<string, number> = {};
  let gets = 0;
  const wrapQuery = (query: object, table: string): object =>
    new Proxy(query, {
      get(target, key) {
        const method = Reflect.get(target, key);
        if (typeof method !== "function") return method;
        return (...args: unknown[]) => {
          const result = method.apply(target, args);
          if (
            ["take", "collect", "unique", "first", "paginate"].includes(
              String(key),
            )
          ) {
            queries[table] = (queries[table] ?? 0) + 1;
            return Promise.resolve(result).then((value) => {
              const documents = Array.isArray(value)
                ? value
                : (value?.page ?? (value ? [value] : []));
              rows[table] = (rows[table] ?? 0) + documents.length;
              readBytes[table] =
                (readBytes[table] ?? 0) +
                documents.reduce(
                  (total: number, doc: unknown) =>
                    total +
                    new TextEncoder().encode(JSON.stringify(doc)).byteLength,
                  0,
                );
              return value;
            });
          }
          return result && typeof result === "object"
            ? wrapQuery(result, table)
            : result;
        };
      },
    });
  const db = new Proxy(ctx.db, {
    get(target, key) {
      if (key === "query")
        return (table: Parameters<typeof target.query>[0]) =>
          wrapQuery(target.query(table), table);
      if (key === "get")
        return (...args: Parameters<typeof target.get>) => {
          gets++;
          return target.get(...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    ctx: { ...ctx, db },
    rows,
    queries,
    readBytes,
    get gets() {
      return gets;
    },
  };
}

async function fixture(history: number, bodyBytes = 32) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "S10 disposable school",
      slug: "s10",
      verifiedDomains: [],
      status: "active",
      timezone: "UTC",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const ownerId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "S10 reader",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const peerId = await ctx.db.insert("accounts", {
      clerkId: "s10-peer",
      email: "s10-peer@example.test",
      emailVerified: true,
      name: "S10 peer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId: ownerId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: ownerId,
      schoolId,
      title: "S10 workspace",
      status: "active",
      defaultView: "library",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: peerId,
      schoolId,
      blueprintKey: "document",
      title: "S10 shared document",
      content: { text: "x".repeat(bodyBytes) },
      textIndex: "x".repeat(bodyBytes),
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await upsertArtifactSummary(ctx, (await ctx.db.get(artifactId))!);
    for (let i = 0; i < history; i++)
      await ctx.db.insert("accessGrants", {
        schoolId,
        resourceType: "artifact",
        resourceId: `historical-${i}`,
        principalType: "account",
        principalId: ownerId,
        level: "read",
        capabilities: ["read"],
        source: "workspace_inheritance",
        inheritedFromWorkspaceId: workspaceId,
        createdByAccountId: peerId,
        createdAt: now,
        updatedAt: now,
      });
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId,
      resourceType: "artifact",
      resourceId: artifactId,
      principalType: "account",
      principalId: ownerId,
      level: "read",
      capabilities: ["read"],
      source: "direct",
      createdByAccountId: peerId,
      createdAt: now,
      updatedAt: now,
    });
    return { schoolId, ownerId, peerId, workspaceId, artifactId, grantId };
  });
  await t.mutation(internal.spectraArtifacts.backfillSummaries, {
    cursor: null,
  });
  return { t, ids, user: t.withIdentity(identity) };
}

describe("S10 catalog indexed access budgets", () => {
  it.each([0, 1_200])(
    "discovers a direct share with %i inherited historical grants without reading them",
    async (history) => {
      const { t, ids, user } = await fixture(history, history ? 300_000 : 32);
      const measured = await user.run(async (ctx) => {
        const m = meter(ctx);
        const result = await artifactHandler(m.ctx, {
          placement: "all",
          limit: 60,
        });
        return { result, rows: m.rows, queries: m.queries, gets: m.gets };
      });
      expect(measured.result).toHaveLength(1);
      expect(measured.result[0]).toMatchObject({
        _id: ids.artifactId,
        ownership: "shared",
        accessLevel: "read",
      });
      expect(measured.rows.accessGrants).toBe(1);
      expect(measured.rows.accounts).toBe(1);
      expect(measured.gets).toBe(1); // School only; no canonical artifact read.
      expect(JSON.stringify(measured.result).length).toBeLessThan(2_000);
      await t.run((ctx) =>
        ctx.db.patch(ids.grantId, { revokedAt: Date.now() }),
      );
      expect(
        await user.query(api.spectraArtifacts.list, {
          placement: "all",
          limit: 60,
        }),
      ).toEqual([]);
    },
  );

  it("authenticates workspace listing once and avoids owner grant reads", async () => {
    const { ids, user } = await fixture(0);
    const measured = await user.run(async (ctx) => {
      const m = meter(ctx);
      const result = await workspaceHandler(m.ctx, { limit: 30 });
      return { result, rows: m.rows, gets: m.gets };
    });
    expect(measured.result[0]).toMatchObject({
      _id: ids.workspaceId,
      accessLevel: "modify",
      ownership: "owned",
    });
    expect(measured.rows.accounts).toBe(1);
    expect(measured.rows.accessGrants ?? 0).toBe(0);
    expect(measured.gets).toBe(1);
  });

  it("keeps cross-school ownership behind the direct account grant policy", async () => {
    const { t, ids } = await fixture(0);
    const decision = await t.run(async (ctx) => {
      const otherSchool = await ctx.db.insert("schools", {
        name: "Other school",
        slug: "other",
        verifiedDomains: [],
        status: "active",
        timezone: "UTC",
        policyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(ids.workspaceId, { schoolId: otherSchool });
      const actor = (await getActorForAccountId(ctx, ids.ownerId))!;
      return evaluateAccessForActor(ctx, actor, "workspace", ids.workspaceId);
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "school_boundary",
    });
  });
});

describe("S10 bounded resumable catalog pages", () => {
  it("measures sparse-school progress before 24 owned items behind 10000 private items", async () => {
    const { t, ids, user } = await fixture(0);
    const seededAt = performance.now();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.artifactId, { status: "archived" });
      await upsertArtifactSummary(ctx, (await ctx.db.get(ids.artifactId))!);
      const privateWorkspace = await ctx.db.insert("spectraWorkspaces", {
        ownerAccountId: ids.peerId,
        schoolId: ids.schoolId,
        title: "Private context",
        status: "active",
        defaultView: "library",
        createdAt: 1,
        updatedAt: 1,
        lastActivityAt: 1,
      });
      for (let i = 0; i < 10_024; i++) {
        const privateItem = i < 10_000;
        const ownerAccountId = privateItem ? ids.peerId : ids.ownerId;
        const updatedAt = privateItem ? 1_000_000 : 100;
        const title = privateItem ? "Private school work" : "Owned school work";
        const artifactId = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId,
          schoolId: ids.schoolId,
          blueprintKey: "document",
          title,
          content: {},
          tags: [],
          status: "active",
          createdAt: 1,
          updatedAt,
        });
        await ctx.db.insert("spectraArtifactSummaries", {
          readModelVersion: ARTIFACT_SUMMARY_READ_MODEL_VERSION,
          artifactId,
          ownerAccountId,
          schoolId: ids.schoolId,
          blueprintKey: "document",
          status: "active",
          updatedAt,
          searchText: title.toLowerCase(),
          createdAt: 1,
          projection: {
            _id: artifactId,
            ownerAccountId,
            schoolId: ids.schoolId,
            blueprintKey: "document",
            title,
            tags: [],
            status: "active",
            createdAt: 1,
            updatedAt,
          },
        });
        // Half the owned corpus is deliberately unplaced legacy work.
        if (privateItem || i % 2 === 0)
          await ctx.db.insert("orgNodes", {
            accountId: ownerAccountId,
            schoolId: ids.schoolId,
            parentId: null,
            kind: "work",
            sourceId: artifactId,
            name: title,
            orderKey: `item-${i}`,
            workspaceContextId: privateItem
              ? privateWorkspace
              : ids.workspaceId,
            accessProjection: true,
            createdAt: 1,
            updatedAt,
          });
      }
    });
    const seedMs = performance.now() - seededAt;
    let cursor: string | undefined;
    const measurements = [];
    const consumedKeys = new Set<string>();
    for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
      const start = performance.now();
      const measurement = await user.run(async (ctx) => {
        const m = meter(ctx);
        const page = await artifactPage(m.ctx, { cursor, limit: 24 });
        return {
          page,
          rows: m.rows,
          queries: m.queries,
          readBytes: m.readBytes,
          gets: m.gets,
        };
      });
      measurements.push({
        elapsedMs: performance.now() - start,
        rows: measurement.rows,
        queries: measurement.queries,
        readBytes: measurement.readBytes,
        gets: measurement.gets,
      });
      expect(measurement.page.items).toEqual([]);
      expect(measurement.page.isDone).toBe(false);
      cursor = measurement.page.continueCursor!;
      const decoded = (await openCatalogCursor(
        cursor,
        JSON.stringify([
          "artifacts-v1",
          ids.ownerId,
          ids.schoolId,
          "school",
          "active",
          null,
          "all",
          "",
        ]),
      )) as { after: { artifactId: string; updatedAt: number } };
      expect(decoded.after.updatedAt).toBe(1_000_000);
      consumedKeys.add(decoded.after.artifactId);
      expect(measurement.rows.orgNodes).toBe(1);
      expect(measurement.rows.spectraArtifactSummaries).toBe(25);
    }
    expect(consumedKeys.size).toBe(3);
    const actorStart = performance.now();
    const actorCandidates = await user.run(async (ctx) => {
      const m = meter(ctx);
      const page = await artifactPage(m.ctx, { scope: "owned", limit: 24 });
      expect(page.scope).toBe("owned");
      expect(
        page.items.every((item) => item.ownerAccountId === ids.ownerId),
      ).toBe(true);
      expect(page.isDone).toBe(true);
      expect(page.continueCursor).toBeNull();
      return {
        count: page.items.length,
        rows: m.rows,
        queries: m.queries,
        readBytes: m.readBytes,
        gets: m.gets,
      };
    });
    const actorCandidateMs = performance.now() - actorStart;
    expect(actorCandidates.count).toBe(24);
    expect(actorCandidates.rows.spectraArtifactSummaries).toBe(24);
    expect(actorCandidates.rows.orgNodes).toBeUndefined();
    expect(actorCandidates.rows.accessGrants).toBeUndefined();
    expect(actorCandidates.gets).toBe(1);
    expect(
      Object.values(actorCandidates.queries).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(4);
    mkdirSync(".spectra-local/s10-convex", { recursive: true });
    writeFileSync(
      ".spectra-local/s10-convex/density.json",
      JSON.stringify(
        {
          privateItems: 10_000,
          olderOwnedItems: 24,
          seedMs,
          actualPrefixPages: 3,
          ownedPage: {
            ...actorCandidates,
            elapsedMs: actorCandidateMs,
            note: "Complete authenticated owned-scope page, including 12 owned artifacts without placement nodes.",
          },
          measurements,
          derivedRequestsBeforeFirstOwned: 10_001,
          note: "Three actual prefix pages; total derives from exactly one private candidate consumed per page, not a completed 10001-request run. Timings are convex-test, not served Convex.",
        },
        null,
        2,
      ),
    );
  }, 60_000);

  it("keeps a direct share without a personal node in the explicit school scope", async () => {
    const { ids, user } = await fixture(0);
    const owned = await user.run((ctx) =>
      artifactPage(ctx, { scope: "owned" }),
    );
    expect(owned).toMatchObject({ scope: "owned", items: [], isDone: true });
    const school = await user.run((ctx) =>
      artifactPage(ctx, { scope: "school" }),
    );
    expect(school.scope).toBe("school");
    expect(school.items[0]).toMatchObject({
      _id: ids.artifactId,
      ownership: "shared",
    });
  });

  it("fails explicitly before the complete summary migration instead of returning a partial empty catalog", async () => {
    const { t, user } = await fixture(0);
    await t.run(async (ctx) => {
      const marker = await ctx.db
        .query("spectraReadModelMigrations")
        .withIndex("by_key", (q) => q.eq("key", CATALOG_MIGRATION_KEY))
        .unique();
      await ctx.db.delete(marker!._id);
    });
    await expect(user.run((ctx) => artifactPage(ctx, {}))).rejects.toThrow(
      "CATALOG_READ_MODEL_REQUIRED",
    );
  });
  it("finds a current grant after expired history and preserves legacy zero timestamp semantics", async () => {
    const { t, ids } = await fixture(0);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.grantId, { expiresAt: Date.now() - 10 });
      for (let i = 0; i < 80; i++)
        await ctx.db.insert("accessGrants", {
          schoolId: ids.schoolId,
          resourceType: "artifact",
          resourceId: ids.artifactId,
          principalType: "account",
          principalId: ids.ownerId,
          level: "read",
          capabilities: ["read"],
          source: "direct",
          expiresAt: Date.now() - i - 100,
          createdByAccountId: ids.peerId,
          createdAt: i,
          updatedAt: i,
        });
      await ctx.db.insert("accessGrants", {
        schoolId: ids.schoolId,
        resourceType: "artifact",
        resourceId: ids.artifactId,
        principalType: "account",
        principalId: ids.ownerId,
        level: "read",
        capabilities: ["read"],
        source: "direct",
        revokedAt: 0,
        expiresAt: 0,
        createdByAccountId: ids.peerId,
        createdAt: 99,
        updatedAt: 99,
      });
    });
    const measured = await t.run(async (ctx) => {
      const actor = (await getActorForAccountId(ctx, ids.ownerId))!;
      const m = meter(ctx);
      const allowed = await hasDirectReadGrant(
        m.ctx,
        actor,
        "artifact",
        ids.artifactId,
      );
      return { allowed, rows: m.rows, queries: m.queries };
    });
    expect(measured.allowed).toBe(true);
    expect(measured.rows.accessGrants).toBe(2);
    expect(measured.queries.accessGrants).toBeLessThanOrEqual(7);
  });

  it("encrypts scanned private identities and rejects tampering or another actor scope", async () => {
    const value = { privateArtifactId: "must-never-leak", updatedAt: 123456 };
    const cursor = await sealCatalogCursor(value, "actor-one/search");
    expect(
      Buffer.from(cursor.slice(3), "base64url").toString("utf8"),
    ).not.toContain("must-never-leak");
    expect(await openCatalogCursor(cursor, "actor-one/search")).toEqual(value);
    await expect(openCatalogCursor(cursor, "actor-two/search")).rejects.toThrow(
      "CATALOG_CURSOR_INVALID",
    );
    await expect(
      openCatalogCursor(cursor.slice(0, -6) + "abcdef", "actor-one/search"),
    ).rejects.toThrow("CATALOG_CURSOR_INVALID");
    vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", "");
    await expect(sealCatalogCursor(value, "actor-one/search")).rejects.toThrow(
      "CATALOG_CURSOR_CONFIG_REQUIRED",
    );
  });
  it("paginates every tied-key artifact exactly once beyond the former 3x cap", async () => {
    const { t, ids, user } = await fixture(0);
    await t.run(async (ctx) => {
      for (let index = 0; index < 83; index++) {
        const id = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: ids.ownerId,
          schoolId: ids.schoolId,
          blueprintKey: "document",
          title: `Equal-time item ${index}`,
          tags: [],
          status: "active",
          content: {},
          createdAt: 20,
          updatedAt: 20,
        });
        await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      }
    });
    const found: string[] = [];
    let cursor: string | undefined;
    for (let request = 0; request < 30; request++) {
      const page = await user.run((ctx) =>
        artifactPage(ctx, { limit: 7, cursor }),
      );
      found.push(...page.items.map((item) => String(item._id)));
      if (page.isDone) break;
      expect(page.continueCursor).not.toBe(cursor);
      cursor = page.continueCursor!;
    }
    expect(found).toHaveLength(84);
    expect(new Set(found).size).toBe(84);
    const ownedFirst = await user.run((ctx) =>
      artifactPage(ctx, { scope: "owned", limit: 7 }),
    );
    await expect(
      user.run((ctx) =>
        artifactPage(ctx, {
          scope: "school",
          limit: 7,
          cursor: ownedFirst.continueCursor!,
        }),
      ),
    ).rejects.toThrow("CATALOG_CURSOR_INVALID");
    const ownedFound = ownedFirst.items.map((item) => String(item._id));
    cursor = ownedFirst.continueCursor!;
    for (let request = 0; request < 20; request++) {
      const page = await user.run((ctx) =>
        artifactPage(ctx, { scope: "owned", limit: 7, cursor }),
      );
      ownedFound.push(...page.items.map((item) => String(item._id)));
      if (page.isDone) break;
      cursor = page.continueCursor!;
    }
    expect(ownedFound).toHaveLength(83);
    expect(new Set(ownedFound).size).toBe(83);
  });

  it("makes filtered empty pages explicitly nonfinal and binds cursors to the search", async () => {
    const { t, ids, user } = await fixture(0);
    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index++) {
        const id = await ctx.db.insert("spectraArtifacts", {
          ownerAccountId: ids.peerId,
          schoolId: ids.schoolId,
          blueprintKey: "document",
          title: "Private newer work",
          tags: [],
          status: "active",
          content: {},
          createdAt: 30,
          updatedAt: Date.now() + index + 1_000,
        });
        await upsertArtifactSummary(ctx, (await ctx.db.get(id))!);
      }
    });
    const page = await user.run((ctx) =>
      artifactPage(ctx, { search: "shared", limit: 10 }),
    );
    expect(page.items).toEqual([]);
    expect(page.isDone).toBe(false);
    await expect(
      user.run((ctx) =>
        artifactPage(ctx, {
          search: "different",
          cursor: page.continueCursor!,
        }),
      ),
    ).rejects.toThrow("CATALOG_CURSOR_INVALID");
    let cursor = page.continueCursor!;
    let found = false;
    for (let i = 0; i < 10; i++) {
      const next = await user.run((ctx) =>
        artifactPage(ctx, { search: "shared", cursor, limit: 10 }),
      );
      found ||= next.items.some((item) => item._id === ids.artifactId);
      if (next.isDone) break;
      cursor = next.continueCursor!;
    }
    expect(found).toBe(true);
  });

  it("resumes inherited discovery after eight placements, rechecking revocation", async () => {
    const { t, ids, user } = await fixture(0);
    const target = await t.run(async (ctx) => {
      await ctx.db.delete(ids.grantId);
      let grantId = ids.grantId;
      for (let i = 0; i < 18; i++) {
        const workspaceId = await ctx.db.insert("spectraWorkspaces", {
          ownerAccountId: ids.peerId,
          schoolId: ids.schoolId,
          title: `Placement ${i}`,
          status: "active",
          defaultView: "library",
          createdAt: i,
          updatedAt: i,
          lastActivityAt: i,
        });
        await ctx.db.insert("orgNodes", {
          accountId: ids.peerId,
          schoolId: ids.schoolId,
          kind: "work",
          sourceId: ids.artifactId,
          name: "Shared document",
          parentId: null,
          orderKey: `a${i}`,
          workspaceContextId: workspaceId,
          accessProjection: true,
          createdAt: i,
          updatedAt: i,
        });
        if (i === 17)
          grantId = await ctx.db.insert("accessGrants", {
            schoolId: ids.schoolId,
            resourceType: "workspace",
            resourceId: workspaceId,
            principalType: "account",
            principalId: ids.ownerId,
            level: "read",
            capabilities: ["read"],
            source: "direct",
            createdByAccountId: ids.peerId,
            createdAt: i,
            updatedAt: i,
          });
      }
      return grantId;
    });
    let cursor: string | undefined;
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const m = await user.run(async (ctx) => {
        const measured = meter(ctx);
        const page = await artifactPage(measured.ctx, { cursor });
        return { page, rows: measured.rows, gets: measured.gets };
      });
      pages.push(m);
      expect(m.rows.orgNodes ?? 0).toBeLessThanOrEqual(CATALOG_PLACEMENTS);
      expect(m.gets).toBeLessThanOrEqual(CATALOG_PLACEMENTS + 1);
      if (m.page.items.length) break;
      expect(m.page.isDone).toBe(false);
      cursor = m.page.continueCursor!;
    }
    expect(pages).toHaveLength(3);
    expect(pages[2]!.page.items[0]).toMatchObject({
      _id: ids.artifactId,
      ownership: "shared",
    });
    await t.run((ctx) => ctx.db.patch(target, { revokedAt: Date.now() }));
    const revoked = await user.run((ctx) => artifactPage(ctx, { cursor }));
    expect(revoked.items).toEqual([]);
  });

  it.each([32, 300_000])(
    "keeps metadata reads independent of %i-byte body and grant history",
    async (bodyBytes) => {
      const { user } = await fixture(1_200, bodyBytes);
      const measured = await user.run(async (ctx) => {
        const m = meter(ctx);
        const page = await artifactPage(m.ctx, { limit: 100 });
        return {
          page,
          rows: m.rows,
          gets: m.gets,
          queries: m.queries,
          readBytes: m.readBytes,
        };
      });
      expect(measured.page.items).toHaveLength(1);
      expect(measured.rows.spectraArtifactSummaries).toBeLessThanOrEqual(
        CATALOG_CANDIDATES + 1,
      );
      expect(measured.rows.accessGrants).toBe(1);
      expect(measured.queries.accessGrants).toBe(1);
      expect(measured.readBytes.spectraArtifactSummaries).toBeLessThan(5_000);
      expect(measured.gets).toBe(1);
      expect(JSON.stringify(measured.page).length).toBeLessThan(2_000);
      expect(measured.page.items[0]).not.toHaveProperty("sharedWithCount");
      expect(measured.page.items[0]).not.toHaveProperty("accessLevel");
    },
  );

  it("pages workspaces without audience hydration and rejects a deactivated actor", async () => {
    const { t, ids, user } = await fixture(0);
    const measured = await user.run(async (ctx) => {
      const m = meter(ctx);
      const page = await workspacePage(m.ctx, {});
      return { page, rows: m.rows, gets: m.gets };
    });
    expect(measured.page.items[0]).toMatchObject({
      _id: ids.workspaceId,
      title: "S10 workspace",
    });
    expect(measured.rows.shareInvitations).toBeUndefined();
    expect(measured.rows.accessGrants).toBeUndefined();
    expect(measured.gets).toBe(1);
    await t.run((ctx) => ctx.db.patch(ids.ownerId, { status: "deactivated" }));
    await expect(user.run((ctx) => workspacePage(ctx, {}))).rejects.toThrow();
  });
});
