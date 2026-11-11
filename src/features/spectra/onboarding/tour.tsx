"use client";

import { useCallback, useEffect, useEffectEvent } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useSession } from "@/features/spectra/data/use-session";
import { spectraBus } from "../events";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { useSpectraPreferences } from "../settings/preference-store";
import { HOME_PATH } from "../chat/home-routes";
import { TOUR_STEPS, type TourPerson } from "./tour-steps";
import { TourLayer } from "./tour-layer";
import { TourAskControl } from "./tour-asks";
import { useTourStore } from "./tour-store";

/*
 * Spectra's tour of the app (SHELL.md, "Onboarding tour"). It starts by itself
 * once, on Home, right after a new student's school is synced and their class
 * shelves are chosen; the account menu's "Take the tour" plays it again. Each
 * step can be skipped, the whole tour can be ended at any point, and either
 * way it is not offered again by itself.
 */

/** A moment for Home to settle before Spectra starts talking. */
const START_DELAY_MS = 900;

type Membership = { status: string; school: { name: string } | null };

function useTourPerson(): TourPerson {
  const { user } = useUser();
  const memberships = useSession()?.memberships as Membership[] | undefined;
  const school = memberships?.find((membership) => membership.status === "active")?.school?.name ?? null;
  const firstName = user?.firstName?.trim() || user?.fullName?.split(/\s+/)[0] || "there";
  return { firstName, school };
}

export function TourMount() {
  const pathname = usePathname();
  const router = useSpectraRouter();
  const person = useTourPerson();
  const { preferences, update } = useSpectraPreferences();
  const index = useTourStore((state) => state.index);
  const { start, next, back, stop } = useTourStore.getState();
  const { classShelvesStatus, tourStatus } = preferences.integrations;
  // The class shelves are chosen only after the school's first sync, and they
  // are read from the account, so a "pending" default never starts the tour.
  const due = tourStatus === "pending" && classShelvesStatus !== "pending" && person.school !== null;

  useEffect(() => {
    if (!due || index !== null || pathname !== HOME_PATH) return;
    const timer = setTimeout(start, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, index, pathname, start]);

  useEffect(() => spectraBus.on("tour.start", start), [start]);

  const step = index === null ? null : TOUR_STEPS[index];
  // Only a step change moves the student; wandering off mid-step is theirs to do.
  const goTo = useEffectEvent((path: string) => {
    if (pathname !== path) router.push(path);
  });
  const stepPath = step?.path;
  useEffect(() => {
    if (stepPath) goTo(stepPath);
  }, [index, stepPath]);

  const end = useCallback(() => {
    stop();
    if (tourStatus !== "done") update("integrations", { tourStatus: "done" });
  }, [stop, tourStatus, update]);

  // Finishing the last step ends the tour the same way ending it early does.
  const finishOrNext = useCallback(() => {
    if (index !== null && index + 1 >= TOUR_STEPS.length) {
      end();
      spectraBus.emit("island.compose", {});
    } else next();
  }, [end, index, next]);

  if (!step || index === null) return null;
  return (
    <TourLayer
      stepKey={step.id}
      targets={step.targets}
      text={step.say(person)}
      position={index + 1}
      total={TOUR_STEPS.length}
      onBack={back}
      onNext={finishOrNext}
      onEnd={end}
    >
      {step.ask ? <TourAskControl ask={step.ask} /> : null}
    </TourLayer>
  );
}
