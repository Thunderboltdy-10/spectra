import { NextRequest } from "next/server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { requireActor } from "@/lib/auth-server";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    
    const body = (await request.json().catch(() => null)) as { token?: string } | null;
    const token = body?.token?.trim();
    
    if (!token) {
      return badRequest("Token is required");
    }

    const invitation = await convexQuery<{ token: string }, {
      _id: string;
      status: string;
      email: string;
      role: string;
      orgId: string;
      expiresAt: number;
      orgName?: string;
    } | null>("schoolAdmin:getInvitationByToken", { token });

    if (!invitation) {
      return badRequest("Invitation not found", 404);
    }

    if (invitation.status === "expired" || Date.now() > invitation.expiresAt) {
      return badRequest("This invitation has expired", 410);
    }

    if (invitation.status === "accepted") {
      return ok({ alreadyAccepted: true, orgName: invitation.orgName });
    }

    if (invitation.email.toLowerCase() !== actor.email.toLowerCase()) {
      return badRequest("This invitation was sent to a different email address", 403);
    }

    await convexMutation("schoolAdmin:acceptInvitation", {
      invitationId: invitation._id,
      clerkId: actor.clerkId,
      email: actor.email,
      name: actor.name,
      role: invitation.role,
      orgId: invitation.orgId,
    });

    return ok({ 
      success: true, 
      orgName: invitation.orgName,
      role: invitation.role 
    });
  });
}
