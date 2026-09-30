"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/** School reads wait for membership; account reads can bootstrap that identity. */
export function useAuthedArgs<T>(
  args: T | "skip",
  scope: "school" | "account" = "school",
): T | "skip" {
  const { isAuthenticated } = useConvexAuth();
  const identity = useQuery(
    api.catalogGraph.identity,
    isAuthenticated === true && scope === "school" && args !== "skip"
      ? {}
      : "skip",
  );
  if (scope === "account") return isAuthenticated === true ? args : "skip";
  return isAuthenticated === true && identity ? args : "skip";
}
