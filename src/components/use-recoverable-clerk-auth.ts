"use client";

import { useAuth } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { useCallback, useLayoutEffect, useRef } from "react";
import { syncRetryDelayMs } from "../../shared/sync-retry-policy";

type TokenOptions = Parameters<ReturnType<typeof useAuth>["getToken"]>[0];

function isTransientTokenFailure(error: unknown) {
  return error instanceof TypeError ||
    (error instanceof Error && error.name === "NetworkError") ||
    (isClerkAPIResponseError(error) && (error.status === 429 || error.status >= 500));
}

/** Wait without polling offline; cancel all listeners/timers with the session. */
function waitForTokenRetry(signal: AbortSignal, attempt: number) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("online", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    window.addEventListener("online", finish);
    signal.addEventListener("abort", finish, { once: true });
    if (navigator.onLine) timer = setTimeout(finish, syncRetryDelayMs(attempt, "clerk-token"));
  });
}

/**
 * Keep transient token transport failures out of the Clerk adapter's terminal
 * null-token path. Convex still decides whether the returned token is valid.
 */
export function useRecoverableClerkAuth() {
  const auth = useAuth();
  const owner = JSON.stringify([auth.userId, auth.sessionId, auth.orgId, auth.orgRole]);
  const latest = useRef({ auth, owner });
  latest.current = { auth, owner };
  const active = useRef<{ owner: string; controller: AbortController } | null>(null);
  useLayoutEffect(() => {
    const scope = { owner, controller: new AbortController() };
    active.current = scope;
    return () => scope.controller.abort();
  }, [owner]);
  const getToken = useCallback(async (options?: TokenOptions) => {
    const scope = active.current;
    if (!scope || scope.owner !== owner) return null;
    const signal = scope.controller.signal;
    let attempt = 0;
    while (!signal.aborted && latest.current.owner === owner) {
      try {
        const token = await latest.current.auth.getToken(options);
        return !signal.aborted && latest.current.owner === owner ? token : null;
      } catch (error) {
        if (!isTransientTokenFailure(error)) throw error;
        await waitForTokenRetry(signal, ++attempt);
      }
    }
    return null;
  }, [owner]);
  // ConvexProviderWithClerk retains its audience/template selection and lifecycle.
  return { ...auth, getToken };
}
