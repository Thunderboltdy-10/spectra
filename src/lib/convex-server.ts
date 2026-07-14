import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { auth } from "@clerk/nextjs/server";
import { getConvexUrl } from "@/lib/env";
import { getWorkerConvexToken } from "@/lib/convex-worker-context";

async function getConvexClient() {
  const token = getWorkerConvexToken() ?? await (await auth()).getToken({ template: "convex" });
  if (!token) throw new Error("AUTH_CONVEX_TOKEN_MISSING: The authenticated Convex token is unavailable.");
  return new ConvexHttpClient(getConvexUrl(), { logger: false, auth: token });
}

function ref<T extends "query" | "mutation" | "action">(name: string) {
  return makeFunctionReference<T>(name);
}

function authenticatedArgs<TArgs extends object>(args: TArgs) {
  // Identity is always derived from the Clerk JWT installed on this client.
  // Never forward an actor identifier from a route, worker payload, or model
  // operation even while older server-only orchestration is being replaced.
  const { actorClerkId: _discardedActor, ...trustedArgs } = args as TArgs & { actorClerkId?: unknown };
  return trustedArgs;
}

export async function convexQuery<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"query">(name);
  return (await getConvexClient()).query(fn, authenticatedArgs(args)) as Promise<TResult>;
}

export async function convexMutation<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"mutation">(name);
  return (await getConvexClient()).mutation(fn, authenticatedArgs(args)) as Promise<TResult>;
}

export async function convexAction<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"action">(name);
  return (await getConvexClient()).action(fn, authenticatedArgs(args)) as Promise<TResult>;
}
