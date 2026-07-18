import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { auth } from "@clerk/nextjs/server";
import { getConvexUrl } from "@/lib/env";
import { getWorkerConvexToken } from "@/lib/convex-worker-context";

async function getConvexClient() {
  const workerToken = getWorkerConvexToken();
  const authState = workerToken ? null : await auth();
  const audience = authState?.sessionClaims?.aud;
  const usesNativeConvexIntegration =
    audience === "convex" ||
    (Array.isArray(audience) && audience.includes("convex"));
  let token: string | null | undefined = workerToken;
  if (!token) {
    try {
      token = await authState!.getToken(
        usesNativeConvexIntegration ? undefined : { template: "convex" },
      );
    } catch (error) {
      if (
        !usesNativeConvexIntegration &&
        error instanceof Error &&
        error.message.toLowerCase().includes("not found")
      ) {
        throw new Error(
          "AUTH_MISCONFIGURED: Activate Clerk's Convex integration or configure the convex JWT template.",
        );
      }
      throw error;
    }
  }
  if (!token)
    throw new Error(
      "AUTH_CONVEX_TOKEN_MISSING: The authenticated Convex token is unavailable.",
    );
  return new ConvexHttpClient(getConvexUrl(), { logger: false, auth: token });
}

function getPublicConvexClient() {
  return new ConvexHttpClient(getConvexUrl(), { logger: false });
}

function ref<T extends "query" | "mutation" | "action">(name: string) {
  return makeFunctionReference<T>(name);
}

function authenticatedArgs<TArgs extends object>(args: TArgs) {
  // Identity is always derived from the Clerk JWT installed on this client.
  // Never forward an actor identifier from a route, worker payload, or model
  // operation even while older server-only orchestration is being replaced.
  const { actorClerkId: _discardedActor, ...trustedArgs } = args as TArgs & {
    actorClerkId?: unknown;
  };
  return trustedArgs;
}

export async function convexQuery<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"query">(name);
  return (await getConvexClient()).query(
    fn,
    authenticatedArgs(args),
  ) as Promise<TResult>;
}

export async function convexMutation<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"mutation">(name);
  return (await getConvexClient()).mutation(
    fn,
    authenticatedArgs(args),
  ) as Promise<TResult>;
}

export async function convexAction<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"action">(name);
  return (await getConvexClient()).action(
    fn,
    authenticatedArgs(args),
  ) as Promise<TResult>;
}

export async function convexPublicQuery<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"query">(name);
  return getPublicConvexClient().query(fn, args) as Promise<TResult>;
}

export async function convexPublicMutation<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"mutation">(name);
  return getPublicConvexClient().mutation(fn, args) as Promise<TResult>;
}

export async function convexPublicAction<TArgs extends object, TResult>(
  name: string,
  args: TArgs,
) {
  const fn = ref<"action">(name);
  return getPublicConvexClient().action(fn, args) as Promise<TResult>;
}
