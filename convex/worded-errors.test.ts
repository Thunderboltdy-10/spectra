/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { describeFailure } from "../src/components/ui/truthful-state";
import { treeFailureMessage } from "../src/features/spectra/organization/tree-client";
import { withRouteErrorHandling } from "../src/lib/route-handler";
import { deployed } from "../src/test/convex-redaction";
import { api } from "./_generated/api";
import schema from "./schema";

// Production Convex redacts every thrown message to "Server Error"; only a
// ConvexError's data reaches the caller. These tests run the real functions and
// then deliver each failure the way a production deployment would.

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "worded-errors-test",
  email: "worded-errors@example.test",
  emailVerified: true,
};

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Worded Errors School",
      slug: `worded-errors-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Worded Errors",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const blockId = await ctx.db.insert("calendarItems", {
      ownerAccountId: accountId,
      schoolId,
      kind: "scheduled_work_block",
      title: "Revise biology essay",
      startAt: 10_000,
      endAt: 20_000,
      allDay: false,
      timezone: "Europe/Madrid",
      timePrecision: "exact",
      status: "active",
      sourceLocked: false,
      linkedArtifactIds: [],
      revision: 2,
      createdBy: "human",
      createdAt: now,
      updatedAt: now,
    });
    return { blockId };
  });
}

async function routeFailure(call: () => Promise<unknown>) {
  const response = (await withRouteErrorHandling(call)) as Response;
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  return { status: response.status, ...body.error };
}

async function clientFailure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
}

describe("worded Convex errors under production redaction", () => {
  it("keeps the Calendar gesture conflict code, so a stale tab reloads", async () => {
    const t = convexTest(schema, modules);
    const { blockId } = await seed(t);
    const failure = await routeFailure(() =>
      deployed(
        t.withIdentity(identity).mutation(api.calendar.moveWorkBlock, {
          itemId: blockId,
          startAt: 30_000,
          endAt: 40_000,
          expectedRevision: 1,
        }),
        { surface: "http", udf: "M(calendar:moveWorkBlock)" },
      ),
    );
    expect(failure).toMatchObject({
      status: 409,
      code: "CALENDAR_GESTURE_CONFLICT",
      message: "Re-resolve the block before moving it.",
    });
  });

  it("keeps an invitation decision final and maps it to 404", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const failure = await routeFailure(() =>
      deployed(
        t.withIdentity(identity).mutation(api.memberships.acceptInvitation, {
          tokenHash: "no-such-invitation",
        }),
        { surface: "http", udf: "M(memberships:acceptInvitation)" },
      ),
    );
    expect(failure).toMatchObject({
      status: 404,
      code: "INVITATION_INVALID",
      message: "This invitation is unavailable.",
    });
  });

  it("shows the Library's own sentence, not the fallback", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const error = await clientFailure(
      deployed(
        t.withIdentity(identity).mutation(api.orgTree.createFolder, { name: "  " }),
        { surface: "react", udf: "M(orgTree:createFolder)" },
      ),
    );
    expect(treeFailureMessage(error, "Could not create the folder.")).toBe(
      "A name is required.",
    );
  });

  it("names an identity failure instead of blaming the connection", async () => {
    const t = convexTest(schema, modules);
    const error = await clientFailure(
      deployed(
        t
          .withIdentity({ ...identity, subject: "no-account" })
          .mutation(api.orgTree.createFolder, { name: "Notes" }),
        { surface: "react", udf: "M(orgTree:createFolder)" },
      ),
    );
    expect(
      describeFailure(error, { fallback: "Check your connection." }).message,
    ).toBe("This account does not have an active school membership.");
  });
});
