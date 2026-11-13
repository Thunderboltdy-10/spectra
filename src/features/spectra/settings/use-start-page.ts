"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { HOME_PATH } from "../chat/home-routes";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { useSpectraPreferences } from "./preference-store";

const START_PATHS = { library: "/library", calendar: "/calendar" } as const;

// Decided once per page load: arriving at Home opens the start page; moving to
// Home later in the visit stays on Home.
let decided = false;

/** Settings → Your day → Start page. A link that names a thread or work is followed instead. */
export function useStartPage() {
  const { preferences, accountReady } = useSpectraPreferences();
  const router = useSpectraRouter();
  const pathname = usePathname();
  const startPage = preferences.general.startPage;
  useEffect(() => {
    if (decided || !accountReady) return;
    decided = true;
    // The account's choice arrived after the reader began on Home: they stay.
    if (pathname !== HOME_PATH || window.location.search || performance.now() > 10_000) return;
    const target = startPage === "library" || startPage === "calendar" ? START_PATHS[startPage] : null;
    if (target) router.replace(target);
  }, [accountReady, pathname, router, startPage]);
}
