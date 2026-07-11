import { isSuperAdminEmail, requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { hasConvexUrl } from "@/lib/env";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function GET() {
  return withRouteErrorHandling(async () => {
    if (!hasConvexUrl()) {
      return ok({
        actor: {
          clerkId: "local-demo-admin",
          email: "local-admin@school.local",
          name: "Local Demo Admin",
          role: "admin",
          orgId: "local-demo-org",
          userId: "local-demo-user",
          onboardingComplete: true,
        },
        isSuperAdmin: false,
        chats: [],
        models: [],
        orgSettings: {
          org: {
            name: "Spectra",
            welcomeMessage: "Running in local demo mode. Configure Convex to load school data.",
          },
          openRouterWarnings: [],
        },
        agents: [],
        userSpending: {
          totalSpentEur: 0,
          totalCostCents: 0,
          tier: "normal",
          softLimitReached: false,
          hardLimitReached: false,
          softLimitCents: 0,
          cheapOnlyLimitCents: 0,
          hardLimitCents: 0,
          budgetUsagePercent: 0,
          activityUsagePercent: 0,
          tokenUsagePercent: 0,
          monthlyTokens: 0,
          monthlyEvents: 0,
          monthlyTokenBudget: 0,
          monthlyCostCentsFromEvents: 0,
          marginPercent: 0,
        },
        userMemory: {
          updatedAt: 0,
          summary: "",
          entryCount: 0,
        },
      });
    }

    const actor = await requireActor();

    await convexMutation("models:seedCatalogIfEmpty", { actorClerkId: actor.clerkId });

    const [models, orgSettings, agents, userSpending, userMemory] = await Promise.all([
      convexQuery("models:listModels", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("agents:listAgents", { actorClerkId: actor.clerkId }) as Promise<unknown>,
      convexQuery("usage:checkUserBudget", { actorClerkId: actor.clerkId }) as Promise<{
        totalSpentEur: number;
        totalCostCents: number;
        knownCostCents?: number;
        estimatedUnpricedCostCents?: number;
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

    // Override openRouter status using the Next.js env — Convex env vars are separate
    // from Next.js env vars and the Convex startup warning fires even when the key
    // is properly configured in .env.local / Vercel env.
    const openRouterKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
    const patchedOrgSettings = {
      ...(orgSettings as Record<string, unknown>),
      openRouterConfigured: openRouterKeyConfigured,
      openRouterWarnings: openRouterKeyConfigured
        ? []
        : ((orgSettings as Record<string, unknown>).openRouterWarnings as string[] ?? []),
    };

    return ok({
      actor,
      isSuperAdmin,
      chats: [],
      models,
      orgSettings: patchedOrgSettings,
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
