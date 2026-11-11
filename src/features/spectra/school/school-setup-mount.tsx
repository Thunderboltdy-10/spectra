"use client";

import { useEffect, useState } from "react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import { ClassShelfOnboarding } from "../components/class-shelf-onboarding";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";

/*
 * Choosing this year's classes, wherever the student is. School setup lists
 * their classes first; until they choose (or choose none) nothing is filed
 * onto class shelves and the morning brief waits, so the choice opens on any
 * page rather than only at the Library's root. A reader who never chose on
 * this account also gets it once their classes are in. It closes like any
 * dialog; nothing is chosen for them when it does.
 */
export function SchoolSetupMount() {
  const { isAuthenticated } = useConvexAuth();
  const setup = useQuery(api.managebac.onboardingStatus, isAuthenticated ? {} : "skip");
  const { preferences, hydrated } = useSpectraPreferences();
  const phase = setup?.phase;
  const pending = preferences.integrations.classShelvesStatus === "pending";
  const due = hydrated && (phase === "choose_classes" || (pending && (phase === "syncing" || phase === "ready")));
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
