/*
 * Where Spectra AI can show the user something, and the one place that does
 * it. `navigation.show` comes from Follow (the followed actor moved to another
 * page) or from an explicit request (the user approved connecting this
 * computer). The handler lives in the app shell, so it works on every page and
 * moves with the client router, never a full reload. A page that can show a
 * destination in place (the workbench's workspace hub) registers an in-page
 * navigator and is asked first.
 */

import { spectraBus } from "../events";
import { getFollowedAiActorId, isFollowingAi } from "./follow-ai";
import { workspaceHref } from "../pages/shell-location";

export const FOLLOW_ROUTES = [
  "library",
  "calendar",
  "settings",
  "workspace",
  "artifact",
  "devices",
  "agents",
  "school",
  "analytics",
] as const;

export type FollowRoute = (typeof FOLLOW_ROUTES)[number];

export type NavigationShow = {
  actorId?: string;
  intent?: "explicit";
  route: FollowRoute;
  target?: string;
};

export function isFollowRoute(value: unknown): value is FollowRoute {
  return typeof value === "string" && (FOLLOW_ROUTES as readonly string[]).includes(value);
}

const segment = (value: string) => encodeURIComponent(value);

/** The page for a destination. A work item opens through work.open first. */
export function followRouteHref(route: FollowRoute, target?: string): string {
  switch (route) {
    case "library":
      return "/library";
    case "workspace":
      return workspaceHref(target);
    case "artifact":
      return target ? `/library/${segment(target)}` : "/library";
    case "settings":
      return target ? `/settings?section=${segment(target)}` : "/settings";
    case "devices":
      return target === "connect" ? "/devices?connect=1" : "/devices";
    case "agents":
      return target ? `/agents/${segment(target)}` : "/agents";
    case "school":
      return "/school";
    case "calendar":
      return "/calendar";
    case "analytics":
      return "/analytics";
  }
}

/** Whether this request may move the user's view: explicit, or from the actor they follow. */
export function navigationAllowed(detail: Pick<NavigationShow, "actorId" | "intent">): boolean {
  if (detail.intent === "explicit") return true;
  if (!isFollowingAi()) return false;
  const followed = getFollowedAiActorId();
  if (!followed) return true;
  return detail.actorId === followed;
}

type InPageNavigator = (detail: NavigationShow) => boolean;
const inPage = new Set<InPageNavigator>();

/** A page that can show some destinations without changing route. Return true when it did. */
export function registerInPageNavigation(navigator: InPageNavigator): () => void {
  inPage.add(navigator);
  return () => {
    inPage.delete(navigator);
  };
}

function currentHref() {
  return typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
}

/** Handle `navigation.show` for the whole app with the client router's push. */
export function startFollowNavigation(push: (href: string) => void): () => void {
  return spectraBus.handle("navigation.show", async (detail) => {
    if (!detail || !isFollowRoute(detail.route) || !navigationAllowed(detail)) return;
    for (const navigator of inPage) if (navigator(detail)) return;
    if (detail.route === "artifact" && detail.target) {
      // An open work surface (a panel or the studio) shows it in place.
      const listeners = await spectraBus.commandAsync("work.open", { workId: detail.target, surface: "panel" });
      if (listeners > 0) return;
    }
    const href = followRouteHref(detail.route, detail.target);
    if (href !== currentHref()) push(href);
  });
}
