"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { knownCapabilityIds } from "../capabilities/catalog";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  migratePreferences,
  remotePreferenceLayersAreReady,
  resolvePreferences,
  restoreDefaultPreferences,
  updatePreference,
  type PreferenceSection,
  type PreferenceLayerValues,
  type PreferenceScope,
  type SpectraPreferences,
} from "./schema";
import { spectraBus } from "../events";

export const PREFERENCE_SAVE_FAILURE =
  "Settings could not be saved. Your last change was undone.";
const KNOWN_COMMAND_IDS = knownCapabilityIds();
const MERGE_OPTIONS = { knownCommandIds: KNOWN_COMMAND_IDS };

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
    return resolvePreferences([{ scope: "device", values }], MERGE_OPTIONS);
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const preferencesRef = useRef(preferences);
  const confirmedRef = useRef(DEFAULT_SPECTRA_PREFERENCES);
  const writeGeneration = useRef(0);
  const inflightWrites = useRef(0);
  preferencesRef.current = preferences;

  const commitLocal = useCallback((next: SpectraPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
    writeDevicePreferences(window.localStorage, next);
    applyDocumentPreferences(next);
    spectraBus.emit("settings.changed", { preferences: next });
  }, []);

  useEffect(() => {
    const next = readDevicePreferences(window.localStorage);
    initialCache.current = next;
    confirmedRef.current = next;
    preferencesRef.current = next;
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
    if (!remotePreferenceLayersAreReady(remoteLayers)) return null;
    return resolvePreferences(
      remoteLayers.map((layer) => ({
        scope: layer.scope,
        values: layer.values as PreferenceLayerValues,
      })),
      MERGE_OPTIONS,
    );
  }, [remoteLayers]);

  useEffect(() => {
    if (!resolvedRemote || !hydrated) return;
    if (inflightWrites.current > 0) return;
    confirmedRef.current = resolvedRemote;
    commitLocal(resolvedRemote);
    setSaveError(null);
  }, [commitLocal, hydrated, resolvedRemote]);

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

  const revertFailedWrite = useCallback((generation: number) => {
    if (generation !== writeGeneration.current) return;
    commitLocal(confirmedRef.current);
    setSaveError(PREFERENCE_SAVE_FAILURE);
  }, [commitLocal]);

  const persistSection = useCallback(
    async <K extends PreferenceSection>(section: K, next: SpectraPreferences, generation: number) => {
      if (!currentDeviceId || !signedIn) return;
      const scope = DEVICE_SECTIONS.has(section) ? "device" : "account";
      const scopeKey = scope === "device" ? currentDeviceId : "account";
      inflightWrites.current += 1;
      try {
        await writeLayer({
          scope,
          scopeKey,
          values: { [section]: next[section] as PreferenceLayerValues[K] },
        });
        if (generation === writeGeneration.current) {
          confirmedRef.current = next;
          setSaveError(null);
        }
      } catch {
        revertFailedWrite(generation);
      } finally {
        inflightWrites.current = Math.max(0, inflightWrites.current - 1);
      }
    },
    [currentDeviceId, revertFailedWrite, signedIn, writeLayer],
  );

  const replace = useCallback(
    (next: SpectraPreferences) => {
      const pruned = updatePreference(next, "workbar", next.workbar, MERGE_OPTIONS);
      const generation = ++writeGeneration.current;
      commitLocal(pruned);
      if (!currentDeviceId || !signedIn) {
        confirmedRef.current = pruned;
        return;
      }
      inflightWrites.current += 1;
      void Promise.all([
        writeLayer({
          scope: "account",
          scopeKey: "account",
          values: layerFromPreferences(pruned, "account"),
        }),
        writeLayer({
          scope: "device",
          scopeKey: currentDeviceId,
          values: layerFromPreferences(pruned, "device"),
        }),
      ]).then(
        () => {
          if (generation === writeGeneration.current) {
            confirmedRef.current = pruned;
            setSaveError(null);
          }
        },
        () => revertFailedWrite(generation),
      ).finally(() => {
        inflightWrites.current = Math.max(0, inflightWrites.current - 1);
      });
    },
    [commitLocal, currentDeviceId, revertFailedWrite, signedIn, writeLayer],
  );

  const update = useCallback(
    <K extends PreferenceSection>(
      section: K,
      patch: Partial<SpectraPreferences[K]>,
    ) => {
      const next = updatePreference(preferencesRef.current, section, patch, MERGE_OPTIONS);
      const generation = ++writeGeneration.current;
      commitLocal(next);
      void persistSection(section, next, generation);
    },
    [commitLocal, persistSection],
  );

  const reset = useCallback(
    () => replace(restoreDefaultPreferences(preferencesRef.current)),
    [replace],
  );
  return { preferences, hydrated, saveError, update, replace, reset };
}
