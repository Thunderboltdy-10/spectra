import { NextRequest } from "next/server";
import { convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) return badRequest("token is required");

    const invitation = await convexQuery<{ token: string }, {
      status: string;
      email: string;
      role: string;
      orgId: string;
      expiresAt: number;
      orgName?: string;
      orgWelcomeMessage?: string;
      orgLogoUrl?: string;
    } | null>("schoolAdmin:getInvitationByToken", { token });

    if (!invitation) {
      return badRequest("Invitation not found or has expired", 404);
    }
    if (invitation.status === "expired" || Date.now() > invitation.expiresAt) {
      return badRequest("This invitation has expired", 410);
    }
    if (invitation.status === "accepted") {
      return badRequest("This invitation has already been accepted", 409);
    }

    return ok(invitation);
  });
}
