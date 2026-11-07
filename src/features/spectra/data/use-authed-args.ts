"use client";

import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
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
