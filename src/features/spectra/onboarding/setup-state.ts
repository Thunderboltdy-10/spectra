"use client";

import { useUser } from "@clerk/nextjs";

// Accounts already present when Setup was disabled must not be forced back
// through it, including accounts with a saved, unfinished Setup step.
export const SETUP_NEW_ACCOUNTS_FROM = Date.parse("2026-11-16T08:23:14Z");

type SetupPreferences = { setupStatus: "pending" | "done" };

export function setupDue(integrations: SetupPreferences, accountCreatedAt?: number) {
  return accountCreatedAt !== undefined && accountCreatedAt >= SETUP_NEW_ACCOUNTS_FROM &&
    integrations.setupStatus === "pending";
}

export function useSetupDue(integrations: SetupPreferences) {
  const { user } = useUser();
  return setupDue(integrations, user?.createdAt?.getTime());
}
