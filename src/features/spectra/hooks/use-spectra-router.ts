"use client";

import { useMemo, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { SPECTRA_REQUEST_UNREACHABLE } from "../data/request";

function navigationDestination(href: string) {
  try { return new URL(href, window.location.href); } catch { return null; }
}

/** Check at activation time so reconnecting immediately restores navigation. */
function preventOfflineNavigation(href: string) {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return false;
  const destination = navigationDestination(href);
  const current = window.location;
  if (href.startsWith("#") || (
    destination && destination.origin === current.origin &&
    destination.pathname === current.pathname &&
    destination.search === current.search && destination.hash
  )) return false;
  toast.error(SPECTRA_REQUEST_UNREACHABLE);
  return true;
}

/** Preserve the mounted shell before a failed route fetch can become a hard navigation. */
export function captureSpectraNavigation(event: MouseEvent<HTMLElement>) {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const link = event.target instanceof Element
    ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
  const href = link.getAttribute("href")!;
  const destination = navigationDestination(href);
  if (!destination || destination.origin !== window.location.origin || !["http:", "https:"].includes(destination.protocol)) return;
  if (!preventOfflineNavigation(href)) return;
  event.preventDefault();
  event.stopPropagation();
}

/** Links and commands share the same offline policy; history remains available. */
export function useSpectraRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push(...args: Parameters<typeof router.push>) {
      if (preventOfflineNavigation(args[0])) return false;
      router.push(...args);
      return true;
    },
    replace(...args: Parameters<typeof router.replace>) {
      if (preventOfflineNavigation(args[0])) return false;
      router.replace(...args);
      return true;
    },
    refresh() {
      if (!preventOfflineNavigation(window.location.href)) router.refresh();
    },
    prefetch(...args: Parameters<typeof router.prefetch>) {
      if (typeof navigator === "undefined" || navigator.onLine) router.prefetch(...args);
    },
  }), [router]);
}
