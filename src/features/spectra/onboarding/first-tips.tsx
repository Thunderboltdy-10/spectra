"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";
import { useTourStore } from "./tour-store";

/*
 * Tips that arrive the first time the student does the thing they are about,
 * after the tour has shown them around. Each one is said once, through the
 * island like any other word, and remembered on the account so another
 * computer does not say it again. A tip never interrupts the tour.
 */

export const FIRST_TIPS = {
  message: "Type @ to point me at one of your artifacts, or drop files on the island to attach them.",
  work: "The mark at the top right of an artifact says where it is saved. Press it for the desktop file and the version history.",
  search: `Press ${shortcutLabel()} anywhere to search everything and run commands.`,
  task: "Drag a task onto another day to move it. Moving a ManageBac task makes your own copy, so your teacher's stays as they set it.",
  agent: "Your agent is ready. When a request is squarely what it is for, I hand it over.",
  bridge: "Bridge is connected. Add a folder on Devices and its files appear in the Library, filed with their class.",
} as const;

export type FirstTipId = keyof typeof FIRST_TIPS;

/** How long a tip stays, long enough to read twice. */
const TIP_MS = 14_000;

function shortcutLabel() {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
}

/** Says a tip the first time its moment comes. Call it where the moment happens. */
export function firstTipMoment(id: FirstTipId) {
  spectraBus.emit("tip.moment", { id });
}

export function FirstTipsMount() {
  const { preferences, update } = useSpectraPreferences();
  const { tipsSeen, tourStatus } = preferences.integrations;
  const said = useRef(new Set<string>());
  const latest = useRef({ tipsSeen, tourStatus, update });
  latest.current = { tipsSeen, tourStatus, update };

  useEffect(() => {
    const say = (id: FirstTipId) => {
      const { tipsSeen: seen, tourStatus: tour, update: save } = latest.current;
      if (tour !== "done" || useTourStore.getState().index !== null) return;
      if (seen.includes(id) || said.current.has(id)) return;
      said.current.add(id);
      toast.info(FIRST_TIPS[id], { id: `tip:${id}`, duration: TIP_MS, closeButton: true });
      save("integrations", { tipsSeen: [...seen, id] });
    };
    const releases = [
      spectraBus.on("tip.moment", ({ id }) => say(id)),
      spectraBus.on("agent.compiled", () => say("agent")),
    ];
    return () => releases.forEach((release) => release());
  }, []);

  return null;
}
