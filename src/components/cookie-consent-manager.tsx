"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CONSENT_STORAGE_KEY,
  createDefaultConsent,
  readConsentState,
  type ConsentState,
  writeConsentState,
} from "@/lib/consent";

function applyConsentToDocument(consent: ConsentState | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.consentPreferences = consent?.preferences ? "granted" : "denied";
  root.dataset.consentAnalytics = consent?.analytics ? "granted" : "denied";
  root.dataset.consentTimestamp = consent?.updatedAt ?? "";
}

export function CookieConsentManager() {
  const [hydrated, setHydrated] = useState(false);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPreferences, setDraftPreferences] = useState(false);
  const [draftAnalytics, setDraftAnalytics] = useState(false);

  useEffect(() => {
    const initial = readConsentState();
    setConsent(initial);
    setHydrated(true);
    applyConsentToDocument(initial);
  }, []);

  useEffect(() => {
    if (!consent) return;
    applyConsentToDocument(consent);
  }, [consent]);

  function persist(next: Omit<ConsentState, "updatedAt">) {
    const payload: ConsentState = {
      ...next,
      updatedAt: new Date().toISOString(),
    };
    writeConsentState(payload);
    setConsent(payload);
    setSettingsOpen(false);
  }

  const openSettings = useCallback(() => {
    const source = consent ?? createDefaultConsent();
    setDraftPreferences(source.preferences);
    setDraftAnalytics(source.analytics);
    setSettingsOpen(true);
  }, [consent]);

  useEffect(() => {
    const onOpenSettings = () => openSettings();
    window.addEventListener("ai-school:open-cookie-settings", onOpenSettings);
    return () => window.removeEventListener("ai-school:open-cookie-settings", onOpenSettings);
  }, [openSettings]);

  const showBanner = hydrated && !consent;
  let prettyTimestamp: string | null = null;
  if (consent?.updatedAt) {
    const parsed = new Date(consent.updatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      prettyTimestamp = parsed.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  if (!hydrated) return null;

  return (
    <>
      {showBanner ? (
        <section className="fixed inset-x-4 bottom-4 z-[110] mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)] sm:inset-x-0">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Cookie Preferences</p>
          <h2 className="mt-1 font-display text-2xl text-[var(--text-primary)]">Your privacy choices</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            We use required cookies for core functionality. Optional cookies help personalize settings and measure product
            usage. You can change this anytime.
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            See our <Link href="/legal/privacy" className="underline underline-offset-2">Privacy Notice</Link>,{" "}
            <Link href="/legal/cookies" className="underline underline-offset-2">Cookie Policy</Link>, and{" "}
            <Link href="/legal/terms" className="underline underline-offset-2">Terms</Link>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                persist({
                  necessary: true,
                  preferences: true,
                  analytics: true,
                })}
            >
              Accept all
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                persist({
                  necessary: true,
                  preferences: false,
                  analytics: false,
                })}
            >
              Reject all
            </Button>
            <Button type="button" variant="ghost" onClick={openSettings}>
              Configure
            </Button>
          </div>
        </section>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-[115]">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close cookie settings"
          />
          <aside className="absolute left-1/2 top-1/2 w-[min(94vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]">
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Cookie settings</p>
            <h3 className="mt-1 font-display text-2xl text-[var(--text-primary)]">Manage consent</h3>
            {prettyTimestamp ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">Last updated: {prettyTimestamp}</p>
            ) : null}

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Necessary</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Required for login, security, and essential app behavior.</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Always active.</p>
              </div>

              <label className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Preferences</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Saves optional UI preferences and personalization.</p>
                </div>
                <input
                  type="checkbox"
                  checked={draftPreferences}
                  onChange={(event) => setDraftPreferences(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--accent-cyan)]"
                />
              </label>

              <label className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Analytics</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Helps us understand usage and improve performance.</p>
                </div>
                <input
                  type="checkbox"
                  checked={draftAnalytics}
                  onChange={(event) => setDraftAnalytics(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--accent-cyan)]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() =>
                  persist({
                    necessary: true,
                    preferences: draftPreferences,
                    analytics: draftAnalytics,
                  })}
              >
                Save choices
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  persist({
                    necessary: true,
                    preferences: true,
                    analytics: true,
                  })}
              >
                Accept all
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  persist({
                    necessary: true,
                    preferences: false,
                    analytics: false,
                  })}
              >
                Reject all
              </Button>
            </div>

            <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
              Stored locally under <code>{CONSENT_STORAGE_KEY}</code> with a timestamp.
            </p>
          </aside>
        </div>
      ) : null}
    </>
  );
}
