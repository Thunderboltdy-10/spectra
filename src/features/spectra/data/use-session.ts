"use client";

import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";

/**
 * Who is signed in: the account, school memberships, the school identity
 * catalog reads wait for, and whether a Bridge is paired. One subscription
 * shared by every reader (LAUNCH-REVIEW E4). Undefined while loading or
 * signed out.
 */
export function useSession(enabled = true) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.identity.session, isAuthenticated && enabled ? {} : "skip") ?? undefined;
}
