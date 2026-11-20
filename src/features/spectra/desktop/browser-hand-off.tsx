"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  DESKTOP_SIGN_IN_PATH,
  HANDOFF_FRAGMENT,
  HANDOFF_STORAGE_KEY,
  handoffCode,
  handoffId,
  sealTicket,
  validHandoffSecret,
} from "./handoff";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; secret: string; code: string }
  | { kind: "sending"; secret: string; code: string }
  | { kind: "sent" }
  | { kind: "failed"; secret: string; code: string; message: string };

function readSecret() {
  const fragment = new URLSearchParams(window.location.hash.slice(1)).get(HANDOFF_FRAGMENT);
  try {
    if (validHandoffSecret(fragment)) {
      window.sessionStorage.setItem(HANDOFF_STORAGE_KEY, fragment);
      // The secret leaves the address bar (and this tab's history) at once.
      window.history.replaceState(null, "", DESKTOP_SIGN_IN_PATH);
      return fragment;
    }
    const kept = window.sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    return validHandoffSecret(kept) ? kept : null;
  } catch {
    return validHandoffSecret(fragment) ? fragment : null;
  }
}

function forget() {
  try { window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY); } catch { /* nothing kept */ }
}

/*
 * The browser half of signing in Spectra for desktop. The person signs in here
 * as usual if they need to, checks the code matches the app's, and confirms.
 */
export function BrowserHandOff() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const hand = useMutation(api.desktopSignIn.hand);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    const secret = readSecret();
    if (!secret) { setPhase({ kind: "missing" }); return; }
    void handoffCode(secret).then((code) => setPhase({ kind: "ready", secret, code }));
  }, []);

  const confirm = async (secret: string, code: string) => {
    setPhase({ kind: "sending", secret, code });
    try {
      const response = await fetch("/api/spectra/desktop/sign-in", { method: "POST", cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { ticket?: string; error?: string } | null;
      if (!response.ok || !body?.ticket) throw new Error(body?.error || "Spectra couldn't sign the app in just now. Try again.");
      await hand({ handoffId: await handoffId(secret), sealed: await sealTicket(secret, body.ticket) });
      forget();
      setPhase({ kind: "sent" });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message.replace(/^[A-Z_]+:\s*/, "") : "Try again.";
      setPhase({ kind: "failed", secret, code, message });
    }
  };

  if (phase.kind === "loading" || !isLoaded) {
    return <p className="auth-lede">Checking this browser…</p>;
  }
  if (phase.kind === "missing") {
    return (
      <div>
        <h1 className="auth-title">Open this from the app</h1>
        <p className="auth-lede">
          In Spectra for desktop, press Sign in with your browser. It opens this page with what it needs to finish.
        </p>
      </div>
    );
  }
  if (phase.kind === "sent") {
    return (
      <div>
        <h1 className="auth-title">Back to the app</h1>
        <p className="auth-lede">Spectra for desktop is signing in now. You can close this tab.</p>
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="auth-desktop">
        <div>
          <h1 className="auth-title">Sign in to continue</h1>
          <p className="auth-lede">
            Sign in to Spectra in this browser first. You&rsquo;ll come straight back here to finish signing in the app.
          </p>
        </div>
        <Link className="auth-handoff-button" href={`/sign-in?redirect_url=${encodeURIComponent(DESKTOP_SIGN_IN_PATH)}`}>
          Sign in
        </Link>
      </div>
    );
  }
  const who = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "your account";
  return (
    <div className="auth-desktop">
      <div>
        <h1 className="auth-title">Sign in Spectra for desktop?</h1>
        <p className="auth-lede">
          The app will be signed in as <strong>{who}</strong>. Continue only if you just pressed Sign in with your
          browser in Spectra for desktop, and it shows this same code.
        </p>
      </div>
      <p className="auth-code">{phase.code}</p>
      {phase.kind === "failed" ? <p className="auth-desktop-problem" role="alert">{phase.message}</p> : null}
      <button
        type="button"
        className="auth-handoff-button"
        disabled={phase.kind === "sending"}
        onClick={() => void confirm(phase.secret, phase.code)}
      >
        {phase.kind === "sending" ? "Signing in the app…" : "Sign in the app"}
      </button>
      <div className="auth-desktop-actions">
        <button
          type="button"
          className="auth-text-button"
          onClick={() => void signOut({ redirectUrl: `/sign-in?redirect_url=${encodeURIComponent(DESKTOP_SIGN_IN_PATH)}` })}
        >
          Use another account
        </button>
        <button type="button" className="auth-text-button" onClick={() => { forget(); setPhase({ kind: "missing" }); }}>
          It doesn&rsquo;t match
        </button>
      </div>
    </div>
  );
}
