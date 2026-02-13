import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { openRouterEmbedding } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = body.query?.trim() ?? "";

    if (query.length < 2) {
      return ok({ results: [] });
    }

    const queryEmbedding = await openRouterEmbedding(query, MODEL_CONFIG.embedding);

    const models = await convexQuery("models:listWithEmbeddings", {
      actorClerkId: actor.clerkId,
    }) as Array<Record<string, unknown>>;

    const scored = models
      .filter((model) => Array.isArray(model.strengthEmbedding) && model.strengthEmbedding.length > 0)
      .map((model) => ({
        ...model,
        score: cosineSimilarity(queryEmbedding, model.strengthEmbedding as number[]),
      }))
      .filter((model) => model.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return ok({ results: scored });
  });
}
