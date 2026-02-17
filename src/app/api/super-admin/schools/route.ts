import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const orgs = await convexQuery<{ actorClerkId: string }, unknown[]>(
      "superAdmin:listAllOrgs",
      { actorClerkId: actor.clerkId },
    );

    return ok({ orgs });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const body = (await request.json()) as {
      name?: string;
      slug?: string;
      description?: string;
      schoolType?: string;
      country?: string;
      timezone?: string;
      maxStudents?: number;
      adminEmail?: string;
    };

    if (!body.name?.trim()) return badRequest("name is required");
    if (!body.slug?.trim()) return badRequest("slug is required");

    const result = await convexMutation<{
      actorClerkId: string;
      name: string;
      slug: string;
      description?: string;
      schoolType?: string;
      country?: string;
      timezone?: string;
      maxStudents?: number;
    }, { orgId: string }>("superAdmin:createOrg", {
      actorClerkId: actor.clerkId,
      name: body.name.trim(),
      slug: body.slug.trim(),
      description: body.description?.trim() || undefined,
      schoolType: body.schoolType || undefined,
      country: body.country?.trim() || undefined,
      timezone: body.timezone?.trim() || undefined,
      maxStudents: body.maxStudents || undefined,
    });

    // If adminEmail provided, assign them as org admin
    if (body.adminEmail?.trim()) {
      await convexMutation("superAdmin:assignOrgAdmin", {
        actorClerkId: actor.clerkId,
        orgId: result.orgId,
        email: body.adminEmail.trim(),
      });
    }

    return ok(result);
  });
}
