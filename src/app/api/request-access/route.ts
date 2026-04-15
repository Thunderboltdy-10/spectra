import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("AUTH_NOT_SIGNED_IN: Sign in to search schools.");
    }
    const query = request.nextUrl.searchParams.get("query") ?? "";
    const schools = await convexQuery("accessRequests:searchSchools", { query });
    return ok({ schools });
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("AUTH_NOT_SIGNED_IN: Sign in to request school access.");
    }

    const profile = await currentUser();
    const emails = (profile?.emailAddresses ?? [])
      .map((entry) => entry.emailAddress?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    const name = profile?.fullName ?? profile?.firstName ?? "Student";
    if (emails.length === 0) {
      throw new Error("AUTH_PROFILE_UNAVAILABLE: Signed-in Clerk user profile could not be loaded. Retry sign-in.");
    }

    const body = (await request.json().catch(() => null)) as { orgId?: string; message?: string; email?: string } | null;
    if (!body?.orgId) return badRequest("orgId is required");

    const selectedEmail = body.email?.trim().toLowerCase();
    const email = selectedEmail ?? emails[0];
    if (!email || !emails.includes(email)) {
      return badRequest("Select one of your signed-in email addresses");
    }

    const result = await convexMutation("accessRequests:createAccessRequest", {
      requesterClerkId: userId,
      orgId: body.orgId,
      email,
      name,
      message: body.message,
    });

    return ok(result);
  }, request);
}
