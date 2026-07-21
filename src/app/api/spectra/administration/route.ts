import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import {
  requireAccount,
  requireActor,
  requirePlatformOperator,
} from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { sendInvitationEmail } from "@/lib/invitations";

function text(value: unknown, maximum = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalText(value: unknown, maximum = 20_000) {
  const result = text(value, maximum);
  return result || undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" &&
        value.trim() &&
        Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
}

function boolean(value: unknown) {
  return value === true || value === "true";
}

function strings(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maximum)
    : [];
}

function bodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateRange(params: URLSearchParams) {
  const today = new Date().toISOString().slice(0, 10);
  const fallback = new Date(Date.now() - 29 * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
  return {
    fromDay: text(params.get("fromDay"), 10) || fallback,
    toDay: text(params.get("toDay"), 10) || today,
  };
}

function operatorSession(value: unknown) {
  return optionalText(value, 180);
}

const PLATFORM_READS = new Set([
  "platformOverview",
  "platformSecurityLog",
  "schoolDirectory",
  "onboardingSagas",
  "platformRequests",
  "lifecycleJobs",
  "lifecycleExport",
]);

const PLATFORM_WRITES = new Set([
  "createSchool",
  "startOperatorSession",
  "createIncident",
  "updateIncident",
  "respondSchoolRequest",
  "requestLifecycle",
  "approveLifecycle",
  "cancelLifecycle",
  "simulateLimits",
  "setLimitPolicy",
  "cancelOnboarding",
]);

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "identity";
    if (PLATFORM_READS.has(action)) await requirePlatformOperator();
    const operatorSessionId = operatorSession(params.get("operatorSessionId"));
    const range = dateRange(params);

    if (action === "identity") {
      const account = await convexQuery("identity:account", {});
      return ok({
        account,
        membership: {
          schoolId: actor.schoolId,
          role: actor.schoolRole,
          membershipId: actor.membershipId,
        },
      });
    }
    if (action === "schoolOverview")
      return ok(
        await convexMutation("administration:schoolOverview", {
          operatorSessionId,
          ...range,
          requestId: optionalText(params.get("requestId"), 120),
        }),
      );
    if (action === "agentGovernance")
      return ok(
        await convexQuery("administration:agentGovernance", {
          operatorSessionId,
        }),
      );
    if (action === "people")
      return ok({
        people: await convexQuery("administration:people", {
          operatorSessionId,
          search: optionalText(params.get("search"), 200),
          status: optionalText(params.get("status"), 40),
          limit: number(params.get("limit")),
        }),
      });
    if (action === "invitations")
      return ok({
        invitations: await convexQuery("administration:invitations", {
          operatorSessionId,
          status: optionalText(params.get("status"), 40),
        }),
      });
    if (action === "groups")
      return ok({
        groups: await convexQuery("administration:groups", {
          operatorSessionId,
        }),
      });
    if (action === "announcements")
      return ok({
        announcements: await convexQuery("administration:announcements", {
          operatorSessionId,
        }),
      });
    if (action === "myAnnouncements")
      return ok({
        announcements: await convexQuery("administration:myAnnouncements", {
          unreadOnly: boolean(params.get("unreadOnly")),
        }),
      });
    if (action === "myFeedback")
      return ok({
        feedback: await convexQuery("administration:myFeedback", {}),
      });
    if (action === "feedbackInbox")
      return ok({
        feedback: await convexMutation("administration:feedbackInbox", {
          operatorSessionId,
          status: optionalText(params.get("status"), 40),
          requestId: optionalText(params.get("requestId"), 120),
        }),
      });
    if (action === "requests")
      return ok({
        requests: await convexQuery("administration:mySchoolRequests", {}),
      });
    if (action === "platformRequests")
      return ok({
        requests: await convexMutation("administration:platformRequestInbox", {
          status: optionalText(params.get("status"), 40),
          requestId: optionalText(params.get("requestId"), 120),
        }),
      });
    if (action === "audit")
      return ok({
        events: await convexMutation("administration:auditLog", {
          operatorSessionId,
          actionPrefix: optionalText(params.get("actionPrefix"), 160),
          limit: number(params.get("limit")),
          requestId: optionalText(params.get("requestId"), 120),
        }),
      });
    if (action === "platformOverview")
      return ok(
        await convexMutation("administration:platformOverview", {
          ...range,
          requestId: optionalText(params.get("requestId"), 120),
        }),
      );
    if (action === "platformSecurityLog")
      return ok(
        await convexMutation("administration:platformSecurityLog", {
          limit: number(params.get("limit")),
          requestId: optionalText(params.get("requestId"), 120),
        }),
      );
    if (action === "schoolDirectory")
      return ok({
        schools: await convexQuery("administration:schoolDirectory", {
          includeInactive: boolean(params.get("includeInactive")),
          search: optionalText(params.get("search"), 200),
        }),
      });
    if (action === "onboardingSagas")
      return ok({
        sagas: await convexQuery("administration:onboardingSagas", {}),
      });
    if (action === "lifecycleJobs")
      return ok({
        jobs: await convexQuery("administration:lifecycleJobs", {
          schoolId: optionalText(params.get("schoolId"), 180),
        }),
      });
    if (action === "lifecycleExport")
      return ok(
        await convexMutation("administration:lifecycleExportUrl", {
          jobId: text(params.get("jobId"), 180),
          requestId: optionalText(params.get("requestId"), 120),
        }),
      );
    if (action === "operatorSession") {
      if (!operatorSessionId)
        return badRequest("Choose an active operator session.");
      return ok(
        await convexQuery("operatorSessions:current", {
          sessionId: operatorSessionId,
        }),
      );
    }
    return badRequest("Unknown administration action.");
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const body = bodyObject(await request.json());
    const action = text(body.action, 100);
    if (!action) return badRequest("Choose an administration action.");
    if (action === "acceptInvitation") {
      await requireAccount();
      const token = text(body.token, 500);
      if (!token)
        return badRequest("This invitation link is missing its token.");
      const tokenHash = createHash("sha256").update(token).digest("base64url");
      return ok(
        await convexMutation("memberships:acceptInvitation", { tokenHash }),
      );
    }
    const actor = await requireActor();
    if (PLATFORM_WRITES.has(action)) await requirePlatformOperator();
    const operatorSessionId = operatorSession(body.operatorSessionId);
    const requestId = optionalText(body.requestId, 120);

    if (action === "invite") {
      const targetSchoolId = operatorSessionId
        ? (
            await convexQuery<
              { sessionId: string },
              { school: { schoolId: string } }
            >("operatorSessions:current", { sessionId: operatorSessionId })
          ).school.schoolId
        : actor.schoolId;
      const invitationToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256")
        .update(invitationToken)
        .digest("base64url");
      const result = await convexMutation("memberships:invite", {
        schoolId: targetSchoolId,
        operatorSessionId,
        email: text(body.email, 320),
        role: text(body.role, 40),
        tokenHash,
        expiresAt: number(body.expiresAt) ?? Date.now() + 7 * 24 * 60 * 60_000,
        requestId,
      });
      const invitationUrl = new URL("/join", request.nextUrl.origin);
      invitationUrl.searchParams.set("token", invitationToken);
      const delivery = await sendInvitationEmail({
        to: text(body.email, 320),
        role: text(body.role, 40),
        joinUrl: invitationUrl.toString(),
      });
      return ok({
        ...bodyObject(result),
        delivery,
        manualInvitationUrl:
          delivery.status === "sent" ? undefined : invitationUrl.toString(),
      });
    }
    if (action === "changeMember")
      return ok(
        await convexMutation("administration:changeMember", {
          operatorSessionId,
          membershipId: text(body.membershipId, 180),
          role: optionalText(body.role, 40),
          status: optionalText(body.status, 40),
          requestId,
        }),
      );
    if (action === "revokeInvitation")
      return ok(
        await convexMutation("administration:revokeInvitation", {
          operatorSessionId,
          invitationId: text(body.invitationId, 180),
          requestId,
        }),
      );
    if (action === "createGroup" || action === "updateGroup") {
      const payload = {
        operatorSessionId,
        groupId: optionalText(body.groupId, 180),
        name: optionalText(body.name, 160),
        description: optionalText(body.description, 1_000),
        type: optionalText(body.type, 40),
        memberAccountIds: strings(body.memberAccountIds, 1_000),
        archived:
          body.archived === undefined ? undefined : boolean(body.archived),
        requestId,
      };
      return ok(
        await convexMutation(
          `administration:${action}`,
          action === "createGroup"
            ? {
                operatorSessionId,
                name: text(body.name, 160),
                description: optionalText(body.description, 1_000),
                type: text(body.type, 40),
                memberAccountIds: strings(body.memberAccountIds, 1_000),
                requestId,
              }
            : payload,
        ),
      );
    }
    if (action === "createAnnouncement")
      return ok(
        await convexMutation("administration:createAnnouncement", {
          operatorSessionId,
          title: text(body.title, 240),
          body: text(body.body, 30_000),
          targetKind: text(body.targetKind, 40),
          targetIds: strings(body.targetIds),
          scheduledAt: number(body.scheduledAt),
          sendNow: boolean(body.sendNow),
          requestId,
        }),
      );
    if (action === "updateScheduledAnnouncement")
      return ok(
        await convexMutation("administration:updateScheduledAnnouncement", {
          operatorSessionId,
          announcementId: text(body.announcementId, 180),
          title: text(body.title, 240),
          body: text(body.body, 30_000),
          targetKind: text(body.targetKind, 40),
          targetIds: strings(body.targetIds),
          scheduledAt: number(body.scheduledAt),
          requestId,
        }),
      );
    if (action === "cancelAnnouncement")
      return ok(
        await convexMutation("administration:cancelAnnouncement", {
          operatorSessionId,
          announcementId: text(body.announcementId, 180),
          requestId,
        }),
      );
    if (action === "markAnnouncementRead")
      return ok(
        await convexMutation("administration:markAnnouncementRead", {
          deliveryId: text(body.deliveryId, 180),
        }),
      );
    if (action === "submitFeedback")
      return ok(
        await convexMutation("administration:submitFeedback", {
          category: text(body.category, 60),
          sentiment: text(body.sentiment, 30),
          subject: text(body.subject, 240),
          message: text(body.message, 50_000),
        }),
      );
    if (action === "respondFeedback")
      return ok(
        await convexMutation("administration:respondFeedback", {
          operatorSessionId,
          feedbackId: text(body.feedbackId, 180),
          status: text(body.status, 40),
          response: optionalText(body.response, 20_000),
          requestId,
        }),
      );
    if (action === "createSchoolRequest")
      return ok(
        await convexMutation("administration:createSchoolRequest", {
          type: text(body.type, 60),
          subject: text(body.subject, 240),
          detail: text(body.detail, 50_000),
          priority: text(body.priority, 30),
          requestId,
        }),
      );
    if (action === "respondSchoolRequest")
      return ok(
        await convexMutation("administration:respondSchoolRequest", {
          requestRecordId: text(body.requestRecordId, 180),
          status: text(body.status, 40),
          response: optionalText(body.response, 30_000),
          requestId,
        }),
      );
    if (action === "updateSchoolProfile")
      return ok(
        await convexMutation("administration:updateSchoolProfile", {
          operatorSessionId,
          name: optionalText(body.name, 140),
          timezone: optionalText(body.timezone, 100),
          verifiedDomains: Array.isArray(body.verifiedDomains)
            ? strings(body.verifiedDomains, 20)
            : undefined,
          locale: optionalText(body.locale, 30),
          accentColor: optionalText(body.accentColor, 20),
          logoUrl: optionalText(body.logoUrl, 2_000),
          academicYearStart: optionalText(body.academicYearStart, 20),
          academicYearEnd: optionalText(body.academicYearEnd, 20),
          accessibilityDefaults:
            body.accessibilityDefaults === undefined
              ? undefined
              : {
                  reducedMotion: boolean(
                    bodyObject(body.accessibilityDefaults).reducedMotion,
                  ),
                  increasedContrast: boolean(
                    bodyObject(body.accessibilityDefaults).increasedContrast,
                  ),
                  largerText: boolean(
                    bodyObject(body.accessibilityDefaults).largerText,
                  ),
                },
          requestId,
        }),
      );
    if (action === "setLimitPolicy")
      return ok(
        await convexMutation("metering:setLimitPolicy", {
          schoolId: optionalText(body.schoolId, 180),
          operatorSessionId,
          rules: Array.isArray(body.rules) ? body.rules : [],
          enforcement: text(body.enforcement, 30),
          requestId,
        }),
      );
    if (action === "simulateLimits")
      return ok(
        await convexQuery("administration:simulateLimitPolicy", {
          schoolId: text(body.schoolId, 180),
          rules: Array.isArray(body.rules) ? body.rules : [],
        }),
      );
    if (action === "createSchool") {
      const invitationToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256")
        .update(invitationToken)
        .digest("base64url");
      const idempotencyKey =
        optionalText(body.idempotencyKey, 240) ??
        `school-onboarding:${randomBytes(18).toString("base64url")}`;
      const result = await convexMutation("schools:create", {
        name: text(body.name, 140),
        slug: optionalText(body.slug, 80),
        timezone: text(body.timezone, 100),
        verifiedDomains: strings(body.verifiedDomains, 20),
        initialAdminEmail: text(body.initialAdminEmail, 320),
        tokenHash,
        idempotencyKey,
        requestId,
      });
      const invitationUrl = new URL("/join", request.nextUrl.origin);
      invitationUrl.searchParams.set("token", invitationToken);
      const delivery = await sendInvitationEmail({
        to: text(body.initialAdminEmail, 320),
        role: "school admin",
        joinUrl: invitationUrl.toString(),
        orgName: text(body.name, 140),
      });
      return ok({
        ...bodyObject(result),
        delivery,
        manualInvitationUrl:
          delivery.status === "sent" ? undefined : invitationUrl.toString(),
      });
    }
    if (action === "cancelOnboarding")
      return ok(
        await convexMutation("schools:cancelOnboarding", {
          sagaId: text(body.sagaId, 180),
          reason: text(body.reason, 500),
          requestId,
        }),
      );
    if (action === "startOperatorSession")
      return ok(
        await convexMutation("operatorSessions:start", {
          schoolId: text(body.schoolId, 180),
          label: text(body.label, 80),
          reason: text(body.reason, 500),
          mode: text(body.mode, 20),
          durationMinutes: number(body.durationMinutes),
          requestId,
        }),
      );
    if (action === "endOperatorSession")
      return ok(
        await convexMutation("operatorSessions:end", {
          sessionId: text(body.operatorSessionId, 180),
          requestId,
        }),
      );
    if (action === "createIncident")
      return ok(
        await convexMutation("administration:createIncident", {
          title: text(body.title, 240),
          summary: text(body.summary, 20_000),
          affectedServices: strings(body.affectedServices, 30),
          severity: text(body.severity, 30),
          requestId,
        }),
      );
    if (action === "updateIncident")
      return ok(
        await convexMutation("administration:updateIncident", {
          incidentId: text(body.incidentId, 180),
          status: text(body.status, 40),
          summary: optionalText(body.summary, 20_000),
          requestId,
        }),
      );
    if (action === "requestLifecycle")
      return ok(
        await convexMutation("administration:requestLifecycleJob", {
          schoolId: text(body.schoolId, 180),
          type: text(body.type, 40),
          reason: text(body.reason, 1_000),
          typedConfirmation: optionalText(body.typedConfirmation, 100),
          requestId,
        }),
      );
    if (action === "approveLifecycle")
      return ok(
        await convexMutation("administration:approveLifecycleJob", {
          jobId: text(body.jobId, 180),
          requestId,
        }),
      );
    if (action === "cancelLifecycle")
      return ok(
        await convexMutation("administration:cancelLifecycleJob", {
          jobId: text(body.jobId, 180),
          reason: text(body.reason, 1_000),
          requestId,
        }),
      );
    return badRequest("Unknown administration action.");
  });
}
