import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { auth } from "@clerk/nextjs/server";
import { getConvexUrl } from "@/lib/env";
import { getWorkerConvexToken } from "@/lib/convex-worker-context";

type CachedConvexToken = {
  token: string;
  expiresAt: number;
};

const convexTokenCache = new Map<string, CachedConvexToken>();
const pendingConvexTokens = new Map<string, Promise<string | null>>();

function tokenExpiry(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1_000 : Date.now() + 30_000;
  } catch {
    return Date.now() + 30_000;
  }
}

async function getCachedSessionToken(
  cacheKey: string,
  loader: () => Promise<string | null>,
) {
  const cached = convexTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 15_000 > Date.now()) return cached.token;

  const pending = pendingConvexTokens.get(cacheKey);
  if (pending) return pending;

  const request = loader()
    .then((token) => {
      if (token) {
        if (convexTokenCache.size >= 500) {
          for (const [key, value] of convexTokenCache) {
            if (value.expiresAt <= Date.now()) convexTokenCache.delete(key);
          }
          if (convexTokenCache.size >= 500) {
            const oldestKey = convexTokenCache.keys().next().value;
            if (oldestKey) convexTokenCache.delete(oldestKey);
          }
        }
        convexTokenCache.set(cacheKey, {
          token,
          expiresAt: tokenExpiry(token),
        });
      }
      return token;
    })
    .finally(() => pendingConvexTokens.delete(cacheKey));
  pendingConvexTokens.set(cacheKey, request);
  return request;
}

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
      const cacheKey = `${authState!.userId ?? "anonymous"}:${authState!.sessionId ?? "no-session"}:${usesNativeConvexIntegration ? "native" : "template"}`;
      token = await getCachedSessionToken(cacheKey, () =>
        authState!.getToken(
          usesNativeConvexIntegration ? undefined : { template: "convex" },
        ),
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
  const trustedArgs = { ...args } as TArgs & { actorClerkId?: unknown };
  delete trustedArgs.actorClerkId;
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
