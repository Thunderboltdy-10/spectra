"use client";

import { useConvexAuth } from "convex/react";

/** Skip Convex reads until the session is actually signed in. */
export function useAuthedArgs<T>(args: T | "skip"): T | "skip" {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated === true ? args : "skip";
}
