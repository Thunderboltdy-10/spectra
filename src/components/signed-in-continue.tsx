"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import {
  joinHrefForToken,
  readJoinTokenCookie,
} from "@/lib/invitation-session";

const APP_HOME = "/workspace";

/**
 * After Clerk signs in, the first client navigation can still render a
 * signed-out RSC payload for `/`. A full document load carries the session
 * cookies, so the workspace actually mounts. This is that load.
 */
export function SignedInContinue({ to }: { to?: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const joinToken = readJoinTokenCookie(document.cookie);
    const recoveredJoin = joinToken ? joinHrefForToken(joinToken) : "";
    const here = `${window.location.pathname}${window.location.search}`;
    if (recoveredJoin) {
      if (window.location.pathname.startsWith("/join")) return;
      window.location.replace(recoveredJoin);
      return;
    }
    const target = to?.startsWith("/") ? to : APP_HOME;
    if (here === target || window.location.pathname.startsWith(`${APP_HOME}/`)) {
      return;
    }
    if (
      window.location.pathname === "/" ||
      window.location.pathname.startsWith("/sign-in") ||
      window.location.pathname.startsWith("/sign-up")
    ) {
      window.location.replace(target);
    }
  }, [isLoaded, isSignedIn, to]);
  return null;
}
