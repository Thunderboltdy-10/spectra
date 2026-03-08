import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
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
    const email = profile?.emailAddresses[0]?.emailAddress?.trim();
    const name = profile?.fullName ?? profile?.firstName ?? "Student";
    if (!email) {
      throw new Error("AUTH_PROFILE_UNAVAILABLE: Signed-in Clerk user profile could not be loaded. Retry sign-in.");
    }

    const body = (await request.json().catch(() => null)) as { orgId?: string; message?: string } | null;
    if (!body?.orgId) return badRequest("orgId is required");

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
