"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "ai-school-theme";
const CONSENT_STORAGE_KEY = "ai-school-cookie-consent-v1";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const consentRaw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!consentRaw) return "light";
    const consent = JSON.parse(consentRaw) as { preferences?: boolean };
    if (!consent.preferences) return "light";
  } catch {
    return "light";
  }

  const persisted = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (persisted === "dark" || persisted === "light") {
    return persisted;
  }

  return "light";
}

function canPersistThemePreference() {
  if (typeof window === "undefined") return false;
  try {
    const consentRaw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!consentRaw) return false;
    const consent = JSON.parse(consentRaw) as { preferences?: boolean };
    return Boolean(consent.preferences);
  } catch {
    return false;
  }
}

function persistThemePreference(nextTheme: Theme) {
  if (typeof window === "undefined") return;
  if (!canPersistThemePreference()) {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const next = resolveInitialTheme();
    setThemeState(next);
    applyThemeToDocument(next);
  }, []);

  const setTheme = (nextTheme: Theme) => {
    setThemeState(nextTheme);
    persistThemePreference(nextTheme);
    applyThemeToDocument(nextTheme);
  };

  const toggleTheme = () => {
    setThemeState((current) => {
      const nextTheme: Theme = current === "dark" ? "light" : "dark";
      persistThemePreference(nextTheme);
      applyThemeToDocument(nextTheme);
      return nextTheme;
    });
  };

  useEffect(() => {
    const handleToggleTheme = () => {
      setThemeState((current) => {
        const nextTheme: Theme = current === "dark" ? "light" : "dark";
        persistThemePreference(nextTheme);
        applyThemeToDocument(nextTheme);
        return nextTheme;
      });
    };

    window.addEventListener("ai-school:toggle-theme", handleToggleTheme);
    return () => window.removeEventListener("ai-school:toggle-theme", handleToggleTheme);
  }, []);

  useEffect(() => {
    const onConsentUpdated = () => {
      if (!canPersistThemePreference()) {
        setThemeState("light");
        applyThemeToDocument("light");
        window.localStorage.removeItem(THEME_STORAGE_KEY);
        return;
      }
      const persisted = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (persisted === "dark" || persisted === "light") {
        setThemeState(persisted);
        applyThemeToDocument(persisted);
      }
    };
    window.addEventListener("ai-school:consent-updated", onConsentUpdated);
    return () => window.removeEventListener("ai-school:consent-updated", onConsentUpdated);
  }, []);

  const value = {
    theme,
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
