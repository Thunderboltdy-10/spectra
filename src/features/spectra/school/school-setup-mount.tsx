"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ClassShelfOnboarding } from "../components/class-shelf-onboarding";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";

/*
 * Choosing this year's classes, wherever the student is. School setup lists
 * their classes first; until they choose (or choose none) nothing is filed
 * onto class shelves and the morning brief waits, so the choice opens on any
 * page rather than only at the Library's root. A reader who never chose on
 * this account also gets it once their classes are in.
 */
export function SchoolSetupMount() {
  const { isAuthenticated } = useConvexAuth();
  const setup = useQuery(api.managebac.onboardingStatus, isAuthenticated ? {} : "skip");
  const { preferences, hydrated } = useSpectraPreferences();
  const phase = setup?.phase;
  const pending = preferences.integrations.classShelvesStatus === "pending";
  const due = hydrated && (phase === "choose_classes" || (pending && (phase === "syncing" || phase === "ready")));
  // Once open it stays until the choice is saved and synced, even as the phase moves on under it.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (due) setHeld(true);
  }, [due]);

  return (
    <ClassShelfOnboarding
      open={due || held}
      onCompleted={() => {
        setHeld(false);
        spectraBus.emit("workspace.refreshRequested", {});
      }}
    />
  );
}
