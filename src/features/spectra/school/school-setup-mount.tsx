"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import { ClassShelfOnboarding } from "../components/class-shelf-onboarding";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";
import { setupDue } from "../onboarding/setup-state";

/*
 * Choosing this year's classes, wherever the student is. School setup lists
 * their classes first; until they choose (or choose none) nothing is filed
 * onto class shelves and the morning brief waits, so the choice opens on any
 * page rather than only at the Library's root. A reader who never chose on
 * this account also gets it once their classes are in. It closes like any
 * dialog; nothing is chosen for them when it does.
 */
const STALE_SYNC_EVERY_MS = 15 * 60_000;

/** At most once in 15 minutes per tab: opening Spectra, or coming back to it. */
function openSyncIsDue() {
  try {
    const key = "spectra.school.openSyncAt";
    if (Date.now() - Number(window.sessionStorage.getItem(key) ?? 0) < STALE_SYNC_EVERY_MS) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Without storage it asks on each open, which the server keeps cheap.
  }
  return true;
}

export function SchoolSetupMount() {
  const { isAuthenticated } = useConvexAuth();
  const syncStale = useMutation(api.school.syncStaleOnOpen);
  // Auto syncs older than their cadence catch up when Spectra opens, not only
  // when the Calendar does; the server's own schedule covers the time between.
  useEffect(() => {
    if (!isAuthenticated) return;
    const run = () => {
      if (document.visibilityState === "visible" && openSyncIsDue()) void syncStale({}).catch(() => {});
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [isAuthenticated, syncStale]);
  const setup = useQuery(api.managebac.onboardingStatus, isAuthenticated ? {} : "skip");
  const { preferences, accountReady } = useSpectraPreferences();
  const phase = setup?.phase;
  const pending = preferences.integrations.classShelvesStatus === "pending";
  // The account's own answer, not the "pending" default read before it
  // arrives; and while Setup is on screen the choice is one of its steps.
  const due = accountReady && !setupDue(preferences.integrations) && (phase === "choose_classes" || (pending && (phase === "syncing" || phase === "ready")));
  // Once open it stays until the choice is saved, even as the phase moves on
  // under it, or until the reader puts it away. Put away, it waits for the
  // next visit; School's Sync holds the same choice meanwhile.
  const [held, setHeld] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (due && !dismissed) setHeld(true);
  }, [due, dismissed]);

  return (
    <ClassShelfOnboarding
      open={!dismissed && (due || held)}
      onCompleted={() => {
        setHeld(false);
        spectraBus.emit("workspace.refreshRequested", {});
      }}
      onDismiss={() => {
        setHeld(false);
        setDismissed(true);
      }}
    />
  );
}
