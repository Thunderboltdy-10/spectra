"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { desktopCan, useDesktop } from "./desktop";
import { handoffCode, handoffId, handoffUrl, newHandoffSecret, openTicket } from "./handoff";

/** How long the window waits for the browser before offering to start again. */
const WAIT_MS = 10 * 60_000;

type Waiting = { secret: string; id: string; code: string; until: number };

/*
 * In Spectra for desktop, the sign-in page leads with the person's own browser:
 * accounts that sign in with Google or Microsoft (and anything a password
 * manager fills) work there. Email sign-in stays below for anyone who prefers
 * it. A browser tab never shows any of this.
 */
export function DesktopSignInChoice({ redirectUrl, action = "Sign in" }: { redirectUrl?: string; action?: "Sign in" | "Sign up" }) {
  const desktop = useDesktop();
  const able = desktopCan("sign-in-handoff", desktop);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [problem, setProblem] = useState("");
  const cancel = useCallback((message?: string) => { setWaiting(null); setProblem(message ?? ""); }, []);
  useEffect(() => {
    if (!able) return;
    // Clerk's Google and Microsoft buttons cannot finish inside the app's window.
    document.documentElement.dataset.spectraDesktop = "";
    return () => { delete document.documentElement.dataset.spectraDesktop; };
  }, [able]);
  if (!able) return null;

  const start = async () => {
    setProblem("");
    const secret = newHandoffSecret();
    const [id, code] = await Promise.all([handoffId(secret), handoffCode(secret)]);
    setWaiting({ secret, id, code, until: Date.now() + WAIT_MS });
    // The app opens this address in the person's browser, not in its window.
    window.open(handoffUrl(window.location.origin, secret), "_blank", "noopener");
  };

  return (
    <section className="auth-desktop" aria-live="polite">
      {waiting ? (
        <HandoffWait
          waiting={waiting}
          redirectUrl={redirectUrl}
          onCancel={cancel}
          onReopen={() => window.open(handoffUrl(window.location.origin, waiting.secret), "_blank", "noopener")}
        />
      ) : (
        <>
          <button type="button" className="auth-handoff-button" onClick={() => void start()}>
            {action} with your browser
          </button>
          <p className="auth-desktop-note">
            For Google or Microsoft accounts. Your browser opens, you confirm there, and Spectra signs in here.
          </p>
          {problem ? <p className="auth-desktop-problem" role="alert">{problem}</p> : null}
          <div className="auth-desktop-or" aria-hidden><span>or with your email</span></div>
        </>
      )}
    </section>
  );
}

function HandoffWait({
  waiting,
  redirectUrl,
  onCancel,
  onReopen,
}: {
  waiting: Waiting;
  redirectUrl?: string;
  onCancel: (message?: string) => void;
  onReopen: () => void;
}) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const ready = useQuery(api.desktopSignIn.waiting, { handoffId: waiting.id });
  const take = useMutation(api.desktopSignIn.take);
  const taking = useRef(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => onCancel("The browser didn't finish in time. Start again when you're ready."),
      Math.max(0, waiting.until - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [onCancel, waiting.until]);

  useEffect(() => {
    if (!ready || !isLoaded || taking.current) return;
    taking.current = true;
    setFinishing(true);
    void (async () => {
      try {
        const sealed = await take({ handoffId: waiting.id });
        if (!sealed) throw new Error("expired");
        const ticket = await openTicket(waiting.secret, sealed);
        const attempt = await signIn.create({ strategy: "ticket", ticket });
        if (attempt.status !== "complete" || !attempt.createdSessionId) throw new Error(attempt.status ?? "incomplete");
        await setActive({ session: attempt.createdSessionId });
        const target = redirectUrl?.startsWith("/") && !redirectUrl.startsWith("//") ? redirectUrl : "/workspace";
        // A full load carries the new session's cookies, as after any sign-in.
        window.location.replace(target);
      } catch {
        onCancel("That sign-in didn't go through. Start again from here.");
      }
    })();
  }, [isLoaded, onCancel, ready, redirectUrl, setActive, signIn, take, waiting.id, waiting.secret]);

  return (
    <div className="auth-desktop-wait">
      <p className="auth-desktop-step">
        {finishing ? "Signing in…" : "Finish in your browser. It shows this code, so you know it's this window asking:"}
      </p>
      <p className="auth-code" aria-label={`Code ${waiting.code.replace(" ", "")}`}>{waiting.code}</p>
      {finishing ? null : (
        <div className="auth-desktop-actions">
          <button type="button" className="auth-text-button" onClick={onReopen}>Open the browser again</button>
          <button type="button" className="auth-text-button" onClick={() => onCancel()}>Cancel</button>
        </div>
      )}
    </div>
  );
}
