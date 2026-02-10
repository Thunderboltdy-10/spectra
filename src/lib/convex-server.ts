import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { getEnv } from "@/lib/env";

let convexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  if (!convexClient) {
    convexClient = new ConvexHttpClient(getEnv().NEXT_PUBLIC_CONVEX_URL, {
      logger: false,
    });
  }
  return convexClient;
}

function ref<T extends "query" | "mutation" | "action">(name: string) {
  return makeFunctionReference<T>(name);
}

export async function convexQuery<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"query">(name);
  return getConvexClient().query(fn, args) as Promise<TResult>;
}

export async function convexMutation<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"mutation">(name);
  return getConvexClient().mutation(fn, args) as Promise<TResult>;
}

export async function convexAction<TArgs extends object, TResult>(name: string, args: TArgs) {
  const fn = ref<"action">(name);
  return getConvexClient().action(fn, args) as Promise<TResult>;
}
