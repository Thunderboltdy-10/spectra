"use client";

import { ClerkFailed, ClerkLoaded, ClerkLoading } from "@clerk/nextjs";
import { useEffect, useState } from "react";

/** Quiet first, so a normal sign-in restore never flashes a message. */
export const ACCOUNT_CONNECTION_NOTICE_MS = 1_500;
/** Long enough for a cold dev compile; short enough that a stall is not a blank page. */
export const ACCOUNT_CONNECTION_STALL_MS = 15_000;

function useElapsedPhase() {
  const [phase, setPhase] = useState<"quiet" | "waiting" | "stalled">("quiet");
  useEffect(() => {
    const notice = setTimeout(() => setPhase("waiting"), ACCOUNT_CONNECTION_NOTICE_MS);
    const stall = setTimeout(() => setPhase("stalled"), ACCOUNT_CONNECTION_STALL_MS);
    return () => {
      clearTimeout(notice);
      clearTimeout(stall);
    };
  }, []);
  return phase;
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center" role="alert">
      <p className="text-sm text-[var(--text-primary)]">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
      >
        Try again
      </button>
    </div>
  );
}

const SIGN_IN_UNAVAILABLE = "Spectra can't reach the sign-in service right now. Check your connection, then try again.";

/**
 * What the shell shows while it waits for the account. Sign-in (Clerk) and the
 * account record (Convex) must both answer before the shell can restore its
 * saved state. A failed or stalled connection says so and offers a retry
 * instead of leaving an empty page.
 */
export function AccountConnectionState() {
  const phase = useElapsedPhase();
  return (
    <div
      className="grid min-h-dvh place-items-center bg-[var(--bg-primary)] p-6"
      aria-busy="true"
    >
      <ClerkFailed>
        <Unavailable message={SIGN_IN_UNAVAILABLE} />
      </ClerkFailed>
      <ClerkLoading>
        {phase === "stalled" ? (
          <Unavailable message={SIGN_IN_UNAVAILABLE} />
        ) : phase === "waiting" ? (
          <p className="text-sm text-[var(--text-secondary)]" role="status">Connecting to your account…</p>
        ) : null}
      </ClerkLoading>
      <AccountRecordWait phase={phase} />
    </div>
  );
}

/** Sign-in answered; the account record is what the shell still waits for. */
function AccountRecordWait({ phase }: { phase: "quiet" | "waiting" | "stalled" }) {
  return (
    <ClerkLoaded>
      {phase === "stalled" ? (
        <Unavailable message="Spectra can't load your account right now. Check your connection, then try again." />
      ) : phase === "waiting" ? (
        <p className="text-sm text-[var(--text-secondary)]" role="status">Opening your workspace…</p>
      ) : null}
    </ClerkLoaded>
  );
}

/**
 * The sign-in form's own placeholder. Clerk renders nothing until its script
 * loads, so without this a failed load leaves the card without any controls.
 */
export function SignInConnectionState() {
  const phase = useElapsedPhase();
  return (
    <>
      <ClerkFailed>
        <div className="grid place-items-center p-6"><Unavailable message={SIGN_IN_UNAVAILABLE} /></div>
      </ClerkFailed>
      <ClerkLoading>
        <div className="grid min-h-48 place-items-center p-6" aria-busy="true">
          {phase === "stalled" ? (
            <Unavailable message={SIGN_IN_UNAVAILABLE} />
          ) : phase === "waiting" ? (
            <p className="text-sm text-[var(--text-secondary)]" role="status">Loading sign-in…</p>
          ) : null}
        </div>
      </ClerkLoading>
    </>
  );
}
