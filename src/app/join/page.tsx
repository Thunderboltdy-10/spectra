"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, Check } from "@/components/icons/glyph-icons";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { mutateAdministration } from "@/features/spectra/administration/api";
import {
  authHrefForRedirect,
  clearJoinTokenCookie,
  invitationFailureText,
  invitationPreviewCanRetry,
  joinHrefForToken,
  persistJoinTokenCookie,
  resolveJoinToken,
} from "@/lib/invitation-session";

function roleLabel(role: string) {
  if (role === "school_admin") return "school administrator";
  if (role === "teacher") return "teacher";
  return "student";
}

/** The sentence after a machine code; the code itself never reaches the page. */
function invitationSentence(raw: string) {
  return raw.replace(/^[A-Z][A-Z0-9_]{3,}:\s*/, "").trim();
}

type InvitationPreview = {
  outcome?: "available";
  schoolName: string;
  role: "student" | "teacher" | "school_admin";
  emailMatches: boolean;
  alreadyMember: boolean;
};

/** An unknown, revoked or expired link: a final answer, never retried. */
type UnavailableInvitation = {
  outcome: "unavailable";
  reason: "invalid" | "expired" | "school_unavailable";
  message: string;
};

function JoinSchoolContent() {
  const { signOut } = useClerk();
  const searchParams = useSearchParams();
  const token = resolveJoinToken(
    searchParams.toString(),
    typeof document === "undefined" ? "" : document.cookie,
  );
  const [status, setStatus] = useState<
    "ready" | "accepting" | "accepted" | "error"
  >("ready");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >(token ? "loading" : "idle");
  const [previewRetryable, setPreviewRetryable] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  /** An unknown, withdrawn or expired link: nothing here can make it work. */
  const [ended, setEnded] = useState(false);
  /** Signed up without confirming the email: Spectra needs it confirmed first. */
  const [unverified, setUnverified] = useState(false);
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<"idle" | "sending" | "sent" | "checking">("idle");
  const { user } = useUser();
  const { session } = useClerk();

  useEffect(() => {
    if (token) persistJoinTokenCookie(token, document);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setPreviewState("loading");
    setPreviewRetryable(false);
    void mutateAdministration<InvitationPreview | UnavailableInvitation>(
      "previewInvitation",
      { token },
    )
      .then((next) => {
        if (!active) return;
        if (next.outcome === "unavailable") {
          clearJoinTokenCookie(document);
          setEnded(true);
          setPreview(null);
          setPreviewState("error");
          setStatus("error");
          setError(next.message);
          return;
        }
        setPreview(next);
        setPreviewState("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        const raw = invitationFailureText(nextError);
        if (/AUTH_EMAIL_UNVERIFIED/.test(raw)) {
          setUnverified(true);
          setPreviewState("error");
          return;
        }
        const retryable = invitationPreviewCanRetry(raw, previewAttempt);
        if (
          /INVITATION_INVALID|INVITATION_EXPIRED|INVITATION_SCHOOL_UNAVAILABLE/.test(
            raw,
          )
        ) {
          clearJoinTokenCookie(document);
          setEnded(true);
        }
        setPreview(null);
        setPreviewState("error");
        setPreviewRetryable(retryable);
        setStatus("error");
        setError(
          invitationSentence(raw) ||
            "This invitation could not be checked. Sign in with the invited email and try again.",
        );
      });
    return () => {
      active = false;
    };
  }, [previewAttempt, token]);

  async function sendCode() {
    const email = user?.primaryEmailAddress;
    if (!email) return;
    setCodeState("sending");
    setError("");
    try {
      await email.prepareVerification({ strategy: "email_code" });
      setCodeState("sent");
    } catch (nextError) {
      setCodeState("idle");
      setError(clerkMessage(nextError, "The code could not be sent. Try again."));
    }
  }

  async function checkCode() {
    const email = user?.primaryEmailAddress;
    if (!email || !code.trim()) return;
    setCodeState("checking");
    setError("");
    try {
      await email.attemptVerification({ code: code.trim() });
      // The next requests must carry the verified claim, not a cached token.
      await session?.getToken({ skipCache: true });
      setUnverified(false);
      setCodeState("idle");
      setCode("");
      retryPreview();
    } catch (nextError) {
      setCodeState("sent");
      setError(clerkMessage(nextError, "That code didn't work. Check it and try again."));
    }
  }

  function retryPreview() {
    setStatus("ready");
    setError("");
    setPreviewRetryable(false);
    setPreviewAttempt((attempt) => attempt + 1);
  }

  async function accept() {
    if (!token) {
      setStatus("error");
      setError("This invitation link is incomplete.");
      return;
    }
    persistJoinTokenCookie(token, document);
    setStatus("accepting");
    setError("");
    try {
      const result = await mutateAdministration<{ expired?: boolean }>(
        "acceptInvitation",
        { token },
      );
      if (result?.expired) {
        clearJoinTokenCookie(document);
        setStatus("error");
        setError("This invitation has expired.");
        return;
      }
      clearJoinTokenCookie(document);
      setStatus("accepted");
      // A full load, so the app mounts with the new membership in the session.
      window.setTimeout(() => window.location.replace("/workspace"), 900);
    } catch (nextError) {
      const raw = invitationFailureText(nextError);
      if (
        /INVITATION_INVALID|INVITATION_EXPIRED|INVITATION_SCHOOL_UNAVAILABLE/.test(
          raw,
        )
      )
        clearJoinTokenCookie(document);
      setStatus("error");
      setError(
        invitationSentence(raw) || "The invitation could not be accepted.",
      );
    }
  }

  const schoolName = preview?.schoolName;
  const verifyEmail = user?.primaryEmailAddress?.emailAddress ?? "your email";
  if (unverified && token && !ended)
    return (
      <AuthShell home="joining">
        <div>
          <h1 className="auth-title">Confirm your email</h1>
          <p className="auth-lede">
            {codeState === "sent" || codeState === "checking"
              ? `Enter the code we sent to ${verifyEmail}. Then you'll join your school.`
              : `One step before you join: confirm ${verifyEmail} with a code.`}
          </p>
        </div>
        {error ? (
          <p role="alert" className="mt-5 border-l-2 border-[var(--danger)] pl-3 text-ui leading-6">
            {error}
          </p>
        ) : null}
        {codeState === "sent" || codeState === "checking" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void checkCode();
            }}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-label="Verification code"
              placeholder="6-digit code"
              className="h-11 rounded-control border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-body tracking-[0.3em] text-[var(--text-primary)]"
            />
            <Button variant="primary" size="lg" className="w-full" type="submit" disabled={codeState === "checking" || !code.trim()}>
              {codeState === "checking" ? <LoaderCircle size={15} className="animate-spin" /> : null}
              Confirm and continue
            </Button>
            <button
              type="button"
              onClick={() => void sendCode()}
              className="text-caption font-medium text-[var(--text-secondary)] underline underline-offset-2"
            >
              Send a new code
            </button>
          </form>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={() => void sendCode()} disabled={codeState === "sending"}>
            {codeState === "sending" ? <LoaderCircle size={15} className="animate-spin" /> : null}
            Send the code
          </Button>
        )}
      </AuthShell>
    );
  const heading =
    status === "accepted"
      ? schoolName
        ? `You joined ${schoolName}`
        : "Welcome to your school"
      : ended
        ? "This invitation can’t be used"
        : schoolName
          ? `Join ${schoolName}`
          : token
            ? "Accept your school invitation"
            : "Open your invitation link";
  // Without a token there is nothing to accept. Say where the link comes from
  // instead of showing a Join button that can never enable.
  const detail =
    status === "accepted"
      ? "Spectra is opening your workspace."
      : ended
        ? "Ask the teacher or school administrator who invited you to send a new one."
        : !token
          ? "You join a school through the invitation link your school emailed you. Open that link on this device. No invitation yet? Ask your teacher or school administrator to invite the email you sign in with."
          : preview?.emailMatches === false
            ? "Sign in with the invited email, then return to this page."
            : schoolName
              ? `This invitation is for a ${roleLabel(preview?.role ?? "student")} at ${schoolName}.`
              : "Sign in with the invited email, then accept to join this school.";
  const buttonLabel =
    status === "accepted"
      ? "Accepted"
      : status === "accepting"
        ? "Joining"
        : previewState === "loading"
          ? "Checking the invitation"
          : schoolName
            ? `Join as a ${roleLabel(preview?.role ?? "student")}`
            : "Join school";

  return (
    <AuthShell home="joining">
      <div>
        <h1 className="auth-title">{heading}</h1>
        <p className="auth-lede">{detail}</p>
      </div>
      {status === "error" ? (
        <div
          role="alert"
          className="mt-5 border-l-2 border-[var(--danger)] pl-3 text-ui leading-6 [color:color-mix(in_oklab,var(--danger)_80%,var(--text-primary))]"
        >
          <p>{error}</p>
          {previewRetryable && previewState === "error" ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={retryPreview}
            >
              Check the invitation again
            </Button>
          ) : null}
        </div>
      ) : null}
      {token && !ended ? (
        <>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => void accept()}
            disabled={
              status === "accepting" ||
              status === "accepted" ||
              previewState === "loading" ||
              previewState === "error" ||
              preview?.emailMatches === false
            }
          >
            {status === "accepting" || previewState === "loading" ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : status === "accepted" ? (
              <Check size={15} />
            ) : null}
            {buttonLabel}
          </Button>
          {/* Anyone on this page is already signed in, so a "Sign in" link
                came straight back here. Switching means signing out first;
                the invitation link is kept for the sign-in that follows. */}
          <p className="text-caption leading-5 text-[var(--text-tertiary)]">
            Signed in with a different email than the one invited?{" "}
            <button
              type="button"
              onClick={() => {
                persistJoinTokenCookie(token, document);
                void signOut({
                  redirectUrl: authHrefForRedirect(
                    "/sign-in",
                    joinHrefForToken(token),
                  ),
                });
              }}
              className="font-medium text-[var(--text-primary)] underline underline-offset-2"
            >
              Use a different account
            </button>
          </p>
        </>
      ) : (
        <Button asChild variant="secondary" size="lg" className="w-full">
          {ended ? (
            <Link href="/workspace">Open Spectra</Link>
          ) : (
            <Link href="/request-access">How to get an invitation</Link>
          )}
        </Button>
      )}
    </AuthShell>
  );
}

/** Clerk's own sentence for a failed step, when it gives one. */
function clerkMessage(error: unknown, fallback: string) {
  const first = (error as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors?.[0];
  return first?.longMessage || first?.message || fallback;
}

export default function JoinSchoolPage() {
  return (
    <Suspense fallback={null}>
      <JoinSchoolContent />
    </Suspense>
  );
}
