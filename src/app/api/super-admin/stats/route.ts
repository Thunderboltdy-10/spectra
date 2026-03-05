import { requireSuperAdmin } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireSuperAdmin();

    const [stats, usage] = await Promise.all([
      convexQuery<{ actorClerkId: string }, {
        totalOrgs: number;
        totalUsers: number;
        totalMessages: number;
        totalAdmins: number;
      }>("superAdmin:getGlobalStats", { actorClerkId: actor.clerkId }),
      convexQuery<
        { actorClerkId: string; days: number },
        {
          days: number;
          totals: { events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number; estimatedCostCents: number; unpricedEvents: number };
          byDay: Array<{ day: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number; uniqueUsers: number }>;
          byWeek: Array<{ weekStart: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>;
          topModels: Array<{ modelId: string; modelLabel: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>;
          topUsers: Array<{
            userId: string;
            name: string;
            email: string;
            role: string;
            orgName: string;
            events: number;
            totalTokens: number;
            totalCostCents: number;
            effectiveCostCents: number;
            topModels: Array<{ modelId: string; modelLabel: string; tokens: number }>;
          }>;
          topOrgs: Array<{ orgId: string; orgName: string; events: number; totalTokens: number; totalCostCents: number; effectiveCostCents: number }>;
        }
      >("superAdmin:getUsageOverview", { actorClerkId: actor.clerkId, days: 60 }),
    ]);

    return ok({ ...stats, usage });
  });
}
