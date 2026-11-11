"use client";

import { useConvexAuth } from "convex/react";
import { useSession } from "@/features/spectra/data/use-session";

/** School reads wait for membership; account reads can bootstrap that identity. */
export function useAuthedArgs<T>(
  args: T | "skip",
  scope: "school" | "account" = "school",
): T | "skip" {
  const { isAuthenticated } = useConvexAuth();
  const identity = useSession(scope === "school" && args !== "skip")?.catalog;
  if (scope === "account") return isAuthenticated === true ? args : "skip";
  return isAuthenticated === true && identity ? args : "skip";
}
