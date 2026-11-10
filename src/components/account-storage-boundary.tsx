"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../convex/_generated/api";
import { bindAccountStorageScope, retireAccountStorageRequests } from "@/lib/account-storage";

const AccountStorageReady = createContext(true);
export function useAccountStorageReady() {
  return useContext(AccountStorageReady);
}

/** Prepare persisted references before AppShell can mount its restoring readers. */
export function AccountStorageBoundary({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.identity.account, isAuthenticated ? {} : "skip");
  const owner = isLoaded
    ? JSON.stringify([process.env.NEXT_PUBLIC_CONVEX_URL, userId ?? null])
    : null;
  const scope =
    isLoaded && (!userId || (isAuthenticated && account !== undefined))
      ? JSON.stringify([
          process.env.NEXT_PUBLIC_CONVEX_URL,
          userId ?? null,
          account?.accountId ?? null,
        ])
      : null;
  const [prepared, setPrepared] = useState<{
    owner: string;
    scope: string;
  } | null>(null);
  useLayoutEffect(() => () => retireAccountStorageRequests(), [owner]);
  useLayoutEffect(() => {
    if (scope === null || owner === null) return;
    bindAccountStorageScope(scope);
    setPrepared({ owner, scope });
  }, [owner, scope]);
  // Token refresh can temporarily suspend the backend identity query. Keep
  // the prepared shell only while Clerk and the deployment identify its owner.
  return (
    <AccountStorageReady.Provider
      value={
        owner !== null &&
        prepared?.owner === owner &&
        (scope === null || scope === prepared.scope)
      }
    >
      {children}
    </AccountStorageReady.Provider>
  );
}
