import { isSuperAdminEmail, requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    await convexMutation("models:seedCatalogIfEmpty", { actorClerkId: actor.clerkId });

    const [chats, models, orgSettings, agents, userSpending, userMemory] = await Promise.all([
      convexQuery("chats:listChats", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("models:listModels", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("agents:listAgents", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("usage:checkUserBudget", { actorClerkId: actor.clerkId }) as Promise<{
        totalSpentEur: number;
        totalCostCents: number;
        tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
        softLimitReached: boolean;
        hardLimitReached: boolean;
        softLimitCents: number;
        cheapOnlyLimitCents: number;
        hardLimitCents: number;
        budgetUsagePercent: number;
        activityUsagePercent?: number;
        tokenUsagePercent?: number;
        monthlyTokens?: number;
        monthlyEvents?: number;
        monthlyTokenBudget?: number;
        monthlyCostCentsFromEvents?: number;
        marginPercent: number;
      }>,
      convexQuery("memory:getUserMemory", { actorClerkId: actor.clerkId }) as Promise<{
        rawMemoryText: string;
        entries: Array<unknown>;
        updatedAt: number;
      }>,
    ]);

    const isSuperAdmin = isSuperAdminEmail(actor.email);

    return ok({
      actor,
      isSuperAdmin,
      chats,
      models,
      orgSettings,
      agents,
      userSpending,
      userMemory: {
        updatedAt: userMemory.updatedAt,
        summary:
          userMemory.rawMemoryText && userMemory.rawMemoryText.length > 0
            ? userMemory.rawMemoryText.slice(0, 240)
            : "",
        entryCount: userMemory.entries.length,
      },
    });
  });
}
