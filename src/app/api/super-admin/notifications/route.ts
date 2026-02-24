import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const payloadSchema = z
  .object({
    audience: z.enum(["all", "org", "email"]),
    title: z.string().trim().min(1).max(180),
    body: z.string().trim().min(1).max(2000),
    actionUrl: z.string().trim().max(400).optional(),
    orgId: z.string().optional(),
    userEmail: z.string().email().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.audience === "org" && !value.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orgId"],
        message: "orgId is required when audience is org",
      });
    }
    if (value.audience === "email" && !value.userEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userEmail"],
        message: "userEmail is required when audience is email",
      });
    }
  });

export async function POST(request: Request) {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid payload");
    }

    const result = await convexMutation<Record<string, unknown>, { sentCount: number }>("notifications:sendSuperAdminAnnouncement", {
      actorClerkId: actor.clerkId,
      audience: parsed.data.audience,
      title: parsed.data.title,
      body: parsed.data.body,
      actionUrl: parsed.data.actionUrl,
      orgId: parsed.data.orgId,
      userEmail: parsed.data.userEmail,
    });

    return ok(result);
  });
}
