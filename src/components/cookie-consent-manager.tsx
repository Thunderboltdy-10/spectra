"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const [saveError, setSaveError] = useState<string>();

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
    if (!writeConsentState(payload)) {
      setSaveError("Your cookie choices could not be saved. Check browser storage and try again.");
      return;
    }
    setSaveError(undefined);
    setConsent(payload);
    setSettingsOpen(false);
  }

  const openSettings = useCallback(() => {
    setSaveError(undefined);
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
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      {showBanner ? (
        // A small note in the corner, never a sheet over the page: it waits
        // there until it is answered, and the page stays usable meanwhile.
        <section
          aria-label="Cookies"
          className="fixed bottom-4 left-4 z-toast w-[min(calc(100vw-2rem),21rem)] rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] px-4 pb-3 pt-3.5 shadow-[var(--shadow-card)] max-sm:bottom-24"
        >
          <p className="text-caption leading-[1.5] text-[var(--text-secondary)]">
            Spectra uses the cookies it needs to work. Optional ones remember your settings and show us how it is used.{" "}
            <Link href="/legal/cookies" className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text-primary)]">
              Cookie policy
            </Link>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() =>
                persist({
                  necessary: true,
                  preferences: true,
                  analytics: true,
                })}
            >
              Allow all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                persist({
                  necessary: true,
                  preferences: false,
                  analytics: false,
                })}
            >
              Only necessary
            </Button>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="ghost" onClick={openSettings}>
                Choose
              </Button>
            </DialogTrigger>
          </div>
          {saveError ? (
            <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
              {saveError}
            </p>
          ) : null}
        </section>
      ) : null}

      <DialogContent
        layer="toast"
        className="w-[min(94vw,30rem)] max-w-none gap-0 p-4"
      >
        <DialogHeader className="pr-10">
          <p className="text-xs text-[var(--text-secondary)]">Cookie settings</p>
          <DialogTitle className="font-display text-2xl font-normal">Manage consent</DialogTitle>
          <DialogDescription className="sr-only">
            Choose which optional cookies Spectra may use.
          </DialogDescription>
        </DialogHeader>
        {prettyTimestamp ? (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Last updated: {prettyTimestamp}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Necessary</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Required for login, security, and essential app behavior.
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Always active.</p>
          </div>

          <label className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Preferences</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Saves optional UI preferences and personalization.
              </p>
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
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Helps us understand usage and improve performance.
              </p>
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
            Allow all
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
            Only necessary
          </Button>
        </div>

        {saveError ? (
          <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
            {saveError}
          </p>
        ) : null}

        <p className="mt-3 text-micro text-[var(--text-secondary)]">
          Stored locally under <code>{CONSENT_STORAGE_KEY}</code> with a timestamp.
        </p>
      </DialogContent>
    </Dialog>
  );
}
