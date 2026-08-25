"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  migratePreferences,
  resolvePreferences,
  updatePreference,
  type PreferenceSection,
  type PreferenceLayerValues,
  type PreferenceScope,
  type SpectraPreferences,
} from "./schema";
import { spectraBus } from "../events";

export const SPECTRA_PREFERENCES_STORAGE_KEY = "spectra:preferences:v2";
const LEGACY_KEYS = ["spectra:preferences:v1", "spectra-preferences"];
const MIGRATION_KEY = "spectra:preferences:account-migrated:v2";
const DEVICE_ID_KEY = "spectra:preferences:device-id";
const DEVICE_SECTIONS = new Set<PreferenceSection>([
  "appearance",
  "accessibility",
  "compute",
]);

function deviceId(storage: Pick<Storage, "getItem" | "setItem">) {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}`;
  storage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function layerFromPreferences(
  preferences: SpectraPreferences,
  sections: "account" | "device",
): PreferenceLayerValues {
  const values: PreferenceLayerValues = {};
  for (const section of Object.keys(preferences).filter(
    (key) => key !== "version",
  ) as PreferenceSection[]) {
    const isDevice = DEVICE_SECTIONS.has(section);
    if ((sections === "device") === isDevice) {
      (values as Record<string, unknown>)[section] = preferences[section];
    }
  }
  return values;
}

export function readDevicePreferences(
  storage: Pick<Storage, "getItem">,
): SpectraPreferences {
  const resolveDevice = (value: unknown) => {
    const migrated = migratePreferences(value);
    const { version: _version, ...values } = migrated;
    return resolvePreferences([{ scope: "device", values }]);
  };
  const current = storage.getItem(SPECTRA_PREFERENCES_STORAGE_KEY);
  if (current) {
    try {
      return resolveDevice(JSON.parse(current));
    } catch {
      return DEFAULT_SPECTRA_PREFERENCES;
    }
  }
  for (const key of LEGACY_KEYS) {
    const value = storage.getItem(key);
    if (!value) continue;
    try {
      return resolveDevice(JSON.parse(value));
    } catch {
      continue;
    }
  }
  return DEFAULT_SPECTRA_PREFERENCES;
}

export function writeDevicePreferences(
  storage: Pick<Storage, "setItem">,
  preferences: SpectraPreferences,
) {
  storage.setItem(SPECTRA_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function applyDocumentPreferences(preferences: SpectraPreferences) {
  const root = document.documentElement;
  root.dataset.spectraDensity = preferences.appearance.density;
  root.dataset.spectraContrast =
    preferences.appearance.contrast === "high" ||
    preferences.accessibility.highContrast
      ? "high"
      : "standard";
  root.dataset.spectraMotion =
    preferences.appearance.reducedMotion ||
    preferences.accessibility.reducedMotion
      ? "reduced"
      : preferences.appearance.motionLevel;
  root.dataset.spectraStreamingReveal = preferences.appearance.streamingReveal
    ? "true"
    : "false";
  root.dataset.spectraTailShimmer = preferences.appearance.activeTailShimmer
    ? "true"
    : "false";
  root.dataset.spectraEditorText = preferences.appearance.editorTextScale;
  root.dataset.spectraInterfaceText = preferences.appearance.interfaceTextScale;
  root.dataset.spectraFocus = preferences.accessibility.alwaysVisibleFocus
    ? "always"
    : "automatic";
}

export function useSpectraPreferences({
  workspaceId,
  workType,
}: { workspaceId?: string; workType?: string } = {}) {
  const [preferences, setPreferences] = useState(DEFAULT_SPECTRA_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const convex = useConvex() as ReturnType<typeof useConvex> | undefined;
  /*
   * Account-scoped queries require a session. Public surfaces (the landing
   * page among them) mount this hook signed out; subscribing anyway made the
   * server answer AUTH_NOT_SIGNED_IN on a loop. A signed-out device keeps its
   * local preferences and nothing else. In this app a mounted Convex client
   * implies the auth provider is mounted too, so this call cannot throw.
   */
  const { isAuthenticated } = useConvexAuth();
  const signedIn = isAuthenticated === true;
  const [remoteLayers, setRemoteLayers] = useState<
    Array<{
      scope: PreferenceScope;
      values: unknown;
      updatedAt: number;
    }>
  >();
  const writeLayer = useCallback(
    (args: {
      scope: PreferenceScope;
      scopeKey: string;
      values: PreferenceLayerValues;
    }) => {
      if (!convex || !signedIn) return Promise.resolve(null);
      return convex.mutation(api.accountPreferences.writeLayer, args);
    },
    [convex, signedIn],
  );
  const migrated = useRef(false);
  const initialCache = useRef<SpectraPreferences | null>(null);

  useEffect(() => {
    const next = readDevicePreferences(window.localStorage);
    initialCache.current = next;
    setCurrentDeviceId(deviceId(window.localStorage));
    setPreferences(next);
    applyDocumentPreferences(next);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!convex || !currentDeviceId || !signedIn) return;
    const watch = convex.watchQuery(api.accountPreferences.layers, {
      deviceId: currentDeviceId,
      workspaceId,
      workType,
    });
    const publish = () => {
      try {
        const value = watch.localQueryResult();
        if (value) setRemoteLayers(value);
      } catch (error) {
        console.warn("[spectra:preferences] subscription unavailable", error);
      }
    };
    publish();
    return watch.onUpdate(publish);
  }, [convex, currentDeviceId, workspaceId, workType, signedIn]);

  const resolvedRemote = useMemo(() => {
    if (!remoteLayers) return null;
    return resolvePreferences(
      remoteLayers.map((layer) => ({
        scope: layer.scope,
        values: layer.values as PreferenceLayerValues,
      })),
    );
  }, [remoteLayers]);

  useEffect(() => {
    if (!resolvedRemote || !hydrated) return;
    if (!remoteLayers?.length && !window.localStorage.getItem(MIGRATION_KEY))
      return;
    setPreferences(resolvedRemote);
    writeDevicePreferences(window.localStorage, resolvedRemote);
    applyDocumentPreferences(resolvedRemote);
    spectraBus.emit("settings.changed", { preferences: resolvedRemote });
  }, [hydrated, remoteLayers?.length, resolvedRemote]);

  useEffect(() => {
    if (
      !convex ||
      !hydrated ||
      !currentDeviceId ||
      !remoteLayers ||
      migrated.current
    )
      return;
    migrated.current = true;
    if (window.localStorage.getItem(MIGRATION_KEY)) return;
    const cached =
      initialCache.current ?? readDevicePreferences(window.localStorage);
    const writes = [
      writeLayer({
        scope: "device" as const,
        scopeKey: currentDeviceId,
        values: layerFromPreferences(cached, "device"),
      }),
    ];
    if (!remoteLayers.some((layer) => layer.scope === "account")) {
      writes.push(
        writeLayer({
          scope: "account",
          scopeKey: "account",
          values: layerFromPreferences(cached, "account"),
        }),
      );
    }
    void Promise.all(writes).then(() =>
      window.localStorage.setItem(MIGRATION_KEY, "true"),
    );
  }, [convex, currentDeviceId, hydrated, remoteLayers, writeLayer]);

  const persistSection = useCallback(
    <K extends PreferenceSection>(section: K, next: SpectraPreferences) => {
      if (!currentDeviceId) return;
      const scope = DEVICE_SECTIONS.has(section) ? "device" : "account";
      const scopeKey = scope === "device" ? currentDeviceId : "account";
      void writeLayer({
        scope,
        scopeKey,
        values: { [section]: next[section] },
      });
    },
    [currentDeviceId, writeLayer],
  );

  const replace = useCallback(
    (next: SpectraPreferences) => {
      setPreferences(next);
      writeDevicePreferences(window.localStorage, next);
      applyDocumentPreferences(next);
      spectraBus.emit("settings.changed", { preferences: next });
      if (currentDeviceId) {
        void Promise.all([
          writeLayer({
            scope: "account",
            scopeKey: "account",
            values: layerFromPreferences(next, "account"),
          }),
          writeLayer({
            scope: "device",
            scopeKey: currentDeviceId,
            values: layerFromPreferences(next, "device"),
          }),
        ]);
      }
    },
    [currentDeviceId, writeLayer],
  );

  const update = useCallback(
    <K extends PreferenceSection>(
      section: K,
      patch: Partial<SpectraPreferences[K]>,
    ) => {
      setPreferences((current) => {
        const next = updatePreference(current, section, patch);
        writeDevicePreferences(window.localStorage, next);
        applyDocumentPreferences(next);
        spectraBus.emit("settings.changed", { preferences: next });
        persistSection(section, next);
        return next;
      });
    },
    [persistSection],
  );

  const reset = useCallback(
    () => replace(DEFAULT_SPECTRA_PREFERENCES),
    [replace],
  );
  return { preferences, hydrated, update, replace, reset };
}
