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
import { setupDue } from "./setup-state";

/*
 * Spectra's tour of the app (SHELL.md, "Onboarding tour"). It starts by itself
 * on Home once Setup is done and the class shelves are chosen; the account
 * menu's "Take the tour" plays it again from the start. Ended early, it is put
 * away for this visit and carries on from the same step the next time Spectra
 * opens; only reaching the end finishes it.
 */

/** Put away during this visit: it waits for the next one. */
let endedThisVisit = false;

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
  const { preferences, accountReady, update } = useSpectraPreferences();
  const index = useTourStore((state) => state.index);
  const { start, next, back, stop } = useTourStore.getState();
  const { classShelvesStatus, tourStatus, tourStep } = preferences.integrations;
  // Read from the account, never the defaults before it arrives; after Setup,
  // and once the class shelves are chosen (or passed over).
  const due =
    accountReady &&
    tourStatus === "pending" &&
    !setupDue(preferences.integrations) &&
    classShelvesStatus !== "pending" &&
    person.school !== null;

  useEffect(() => {
    if (!due || endedThisVisit || index !== null || pathname !== HOME_PATH) return;
    const timer = setTimeout(() => start(tourStep), START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, index, pathname, start, tourStep]);

  useEffect(() => spectraBus.on("tour.start", () => start(0)), [start]);

  // Where it is, kept on the account so it carries on from there.
  useEffect(() => {
    if (index === null || tourStatus === "done" || index === tourStep) return;
    update("integrations", { tourStep: index });
  }, [index, tourStatus, tourStep, update]);

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
    endedThisVisit = true;
    stop();
  }, [stop]);

  const finishOrNext = useCallback(() => {
    if (index !== null && index + 1 >= TOUR_STEPS.length) {
      endedThisVisit = true;
      stop();
      update("integrations", { tourStatus: "done", tourStep: 0 });
      spectraBus.emit("island.compose", {});
    } else next();
  }, [index, next, stop, update]);

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
