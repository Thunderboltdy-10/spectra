"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { bindAccountStorageScope } from "@/lib/account-storage";

const AccountStorageReady = createContext(true);
export function useAccountStorageReady() {
  return useContext(AccountStorageReady);
}

/** Prepare persisted references before AppShell can mount its restoring readers. */
export function AccountStorageBoundary({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.identity.account, isAuthenticated ? {} : "skip");
  const scope =
    isLoaded && (!userId || (isAuthenticated && account !== undefined))
      ? JSON.stringify([
          process.env.NEXT_PUBLIC_CONVEX_URL,
          userId ?? null,
          account?.accountId ?? null,
        ])
      : null;
  const [preparedScope, setPreparedScope] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (scope === null) return;
    bindAccountStorageScope(scope);
    setPreparedScope(scope);
  }, [scope]);
  return (
    <AccountStorageReady.Provider
      value={scope !== null && scope === preparedScope}
    >
      {children}
    </AccountStorageReady.Provider>
  );
}
