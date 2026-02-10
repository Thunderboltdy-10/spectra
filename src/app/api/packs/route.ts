import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const [packs, personalResources] = await Promise.all([
      convexQuery("packs:listPacks", { actorClerkId: actor.clerkId }),
      convexQuery("resources:listPersonalResources", { actorClerkId: actor.clerkId }),
    ]);

    return ok({ packs, personalResources, role: actor.role });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      name?: string;
      subject?: string;
      academicYear?: string;
    };

    if (!body.name || !body.subject || !body.academicYear) {
      return badRequest("name, subject, and academicYear are required");
    }

    const result = await convexMutation("packs:createPack", {
      actorClerkId: actor.clerkId,
      name: body.name,
      subject: body.subject,
      academicYear: body.academicYear,
    });

    return ok(result);
  });
}
