"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../../../../convex/_generated/api";
import {
  SOUL_CHARACTER_CAP,
  normalizeSoulText,
} from "../../memory/soul-policy";

function saveFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SOUL_TOO_LONG"))
    return "This is too long. Keep it within 1,400 characters.";
  if (message.includes("MEMORY_CAPTURE_REJECTED"))
    return "Remove secrets or sensitive personal information before saving.";
  return "This could not be saved. Your previous version is still in use.";
}

export function SoulSettings() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const soul = useQuery(api.memory.soul, isAuthenticated ? {} : "skip");
  const saveSoul = useMutation(api.memory.updateSoul);
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "neutral" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!soul) return;
    if (!initialized || normalizeSoulText(draft) === savedText) {
      setDraft(soul.text);
      setSavedText(soul.text);
      setInitialized(true);
    }
  }, [draft, initialized, savedText, soul]);

  const normalizedDraft = normalizeSoulText(draft);
  const changed = initialized && normalizedDraft !== savedText;
  const remaining = Math.max(0, SOUL_CHARACTER_CAP - draft.length);

  async function persist(text: string, reset = false) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveSoul({ text });
      setDraft(result.text);
      setSavedText(result.text);
      setInitialized(true);
      setMessage({
        tone: "neutral",
        text: reset
          ? "Spectra is using the version built from what you have shared."
          : "Saved. New conversations will use this version.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: saveFailureMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const loading = authLoading || (isAuthenticated && soul === undefined);
  return (
    <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <header className="pt-2">
        <h2 className="font-display text-heading font-semibold text-[var(--text-primary)]">
          How Spectra knows you
        </h2>
        <p className="mt-1 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]">
          Keep the few details Spectra should carry into every conversation,
          including a quick hello.
        </p>
      </header>
      <div className="rounded-card bg-[var(--bg-secondary)] px-4 py-4 sm:px-5">
        {loading ? (
          <div
            aria-label="Loading what Spectra knows about you"
            className="h-[196px] animate-pulse rounded-control bg-[var(--bg-tertiary)] motion-reduce:animate-none"
            role="status"
          />
        ) : !isAuthenticated ? (
          <p className="text-caption leading-5 text-[var(--text-secondary)]">
            Sign in to review and edit what Spectra knows about you.
          </p>
        ) : (
          <>
            <label
              className="text-ui font-medium text-[var(--text-primary)]"
              htmlFor="spectra-soul-text"
            >
              What should Spectra keep in mind?
            </label>
            <p
              className="mt-1 text-micro leading-[18px] text-[var(--text-secondary)]"
              id="spectra-soul-help"
            >
              {soul?.userEdited
                ? "Your wording takes priority over the version Spectra builds from past conversations."
                : soul?.text
                  ? "This starts with durable details you asked Spectra to remember. Save to use your own wording."
                  : "Add durable preferences or background that will help Spectra work with you."}
            </p>
            <Textarea
              aria-describedby="spectra-soul-help spectra-soul-count"
              className="mt-3 min-h-[168px] resize-y leading-6"
              disabled={busy}
              id="spectra-soul-text"
              maxLength={SOUL_CHARACTER_CAP}
              onChange={(event) => {
                setDraft(event.target.value);
                setMessage(null);
              }}
              value={draft}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p
                className="text-micro text-[var(--text-secondary)]"
                id="spectra-soul-count"
              >
                {remaining.toLocaleString()} characters remaining
              </p>
              <div className="flex items-center gap-2">
                {soul?.userEdited ? (
                  <Button
                    disabled={busy}
                    onClick={() => void persist("", true)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Use learned version
                  </Button>
                ) : null}
                <Button
                  disabled={busy || !changed}
                  onClick={() => void persist(normalizedDraft)}
                  size="sm"
                  type="button"
                >
                  {busy ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
            {message ? (
              <p
                className={`mt-3 text-micro leading-[18px] ${
                  message.tone === "error"
                    ? "text-[var(--danger)]"
                    : "text-[var(--text-secondary)]"
                }`}
                role="status"
              >
                {message.text}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
