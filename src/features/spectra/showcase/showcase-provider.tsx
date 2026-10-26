"use client";

import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { LocalOnlyCollaboration } from "../collaboration/local-only";
import { invalidateSpectraCache, invalidateSpectraRunTabsCache } from "../data/api";
import { clearRunTabs, refreshRunTabs } from "../island/run-tabs";
import { ShowcaseConvexClient, type ShowcaseMutation, type ShowcaseQuery } from "./showcase-client";
import { installShowcaseFetch, type ShowcaseRoute } from "./showcase-transport";

/*
 * The app, wearing a costume. Inside this provider Spectra's own components
 * read a story's world instead of the server: Convex queries from the
 * stand-in client, /api routes from the wrapped fetch. Nothing a visitor does
 * in here reaches the network, and a signed-in visitor's own data never shows.
 */

export type ShowcaseWorld = {
  queries: Record<string, ShowcaseQuery>;
  mutations?: Record<string, ShowcaseMutation>;
  route: ShowcaseRoute;
  /** Called when the world changes, so every open query reads again. */
  subscribe?: (listener: () => void) => () => void;
};

// One object for the life of the page: Convex re-authenticates whenever the
// token fetcher changes identity, and each round re-renders everything inside.
const SIGNED_IN = { isLoading: false, isAuthenticated: true, fetchAccessToken: async () => "showcase" };
const signedIn = () => SIGNED_IN;

export function ShowcaseProvider({ world, children }: { world: ShowcaseWorld; children: ReactNode }) {
  const [client] = useState(() => new ShowcaseConvexClient(world));
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => world.subscribe?.(() => client.changed()), [client, world]);

  // Before any child reads: the routes answer from the story, and nothing the
  // app cached for a signed-in visitor is shown, then or after leaving.
  useLayoutEffect(() => {
    invalidateSpectraCache();
    invalidateSpectraRunTabsCache();
    const uninstall = installShowcaseFetch(world.route);
    void refreshRunTabs(true).catch(() => undefined);
    setReady(true);
    return () => {
      uninstall();
      invalidateSpectraCache();
      // The story's tabs go with it; the app's island reads its own when it mounts.
      clearRunTabs();
    };
  }, [world.route]);

  if (!ready) return null;
  return (
    <ConvexProviderWithAuth client={client as unknown as ConvexReactClient} useAuth={signedIn}>
      <LocalOnlyCollaboration.Provider value={true}>{children}</LocalOnlyCollaboration.Provider>
    </ConvexProviderWithAuth>
  );
}

export { fn } from "./showcase-client";
