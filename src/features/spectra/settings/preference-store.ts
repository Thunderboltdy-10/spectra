"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  migratePreferences,
  resolvePreferences,
  updatePreference,
  type PreferenceSection,
  type SpectraPreferences,
} from "./schema";
import { spectraBus } from "../events";

export const SPECTRA_PREFERENCES_STORAGE_KEY = "spectra:preferences:v2";
const LEGACY_KEYS = ["spectra:preferences:v1", "spectra-preferences"];

export function readDevicePreferences(storage: Pick<Storage, "getItem">): SpectraPreferences {
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
    preferences.appearance.contrast === "high" || preferences.accessibility.highContrast
      ? "high"
      : "standard";
  root.dataset.spectraMotion =
    preferences.appearance.reducedMotion || preferences.accessibility.reducedMotion
      ? "reduced"
      : preferences.appearance.motionLevel;
  root.dataset.spectraEditorText = preferences.appearance.editorTextScale;
  root.dataset.spectraInterfaceText = preferences.appearance.interfaceTextScale;
  root.dataset.spectraFocus = preferences.accessibility.alwaysVisibleFocus
    ? "always"
    : "automatic";
}

export function useSpectraPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_SPECTRA_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const next = readDevicePreferences(window.localStorage);
    setPreferences(next);
    applyDocumentPreferences(next);
    setHydrated(true);
  }, []);

  const replace = useCallback((next: SpectraPreferences) => {
    setPreferences(next);
    writeDevicePreferences(window.localStorage, next);
    applyDocumentPreferences(next);
    spectraBus.emit("settings.changed", { preferences: next });
  }, []);

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
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => replace(DEFAULT_SPECTRA_PREFERENCES), [replace]);
  return { preferences, hydrated, update, replace, reset };
}
