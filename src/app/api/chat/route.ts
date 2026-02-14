import { NextRequest } from "next/server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { runChatPipeline } from "@/lib/orchestrator/pipeline";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => runChatPipeline(request));
}
