"use client";

export type ConsentCategory = "necessary" | "preferences" | "analytics";

export type ConsentState = {
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  updatedAt: string;
};

export const CONSENT_STORAGE_KEY = "ai-school-cookie-consent-v1";

export function createDefaultConsent(): ConsentState {
  return {
    necessary: true,
    preferences: false,
    analytics: false,
    updatedAt: new Date().toISOString(),
  };
}

export function readConsentState(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      necessary: true,
      preferences: Boolean(parsed.preferences),
      analytics: Boolean(parsed.analytics),
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeConsentState(next: ConsentState) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("ai-school:consent-updated", { detail: next }));
    return true;
  } catch {
    return false;
  }
}

export function hasConsent(category: ConsentCategory, state?: ConsentState | null) {
  const active = state ?? readConsentState();
  if (!active) return false;
  if (category === "necessary") return true;
  if (category === "preferences") return active.preferences;
  return active.analytics;
}
