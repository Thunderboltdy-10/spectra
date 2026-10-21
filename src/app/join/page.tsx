"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, Check } from "@/components/icons/glyph-icons";
import { SpectraMark } from "@/components/spectra-mark";
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
  const router = useRouter();
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
      window.setTimeout(() => {
        router.replace("/workspace");
        router.refresh();
      }, 900);
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
    <main className="spectra-wave-y relative isolate grid min-h-dvh place-items-center bg-[var(--bg-primary)] px-4 py-8 text-[var(--text-primary)]">
      <section className="w-full max-w-[460px] rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-7 shadow-[var(--shadow-soft)] md:p-9">
        <Link href="/" aria-label="Spectra home" className="inline-flex items-center gap-2.5 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]">
          <SpectraMark size={28} />
          <span className="font-display text-subhead font-semibold">Spectra</span>
        </Link>
        <h1 className="mt-10 font-display text-display font-semibold leading-tight tracking-[-0.03em]">
          {heading}
        </h1>
        <p className="mt-3 text-ui leading-6 text-[var(--text-secondary)]">
          {detail}
        </p>
        {status === "error" ? (
          <div
            role="alert"
            className="mt-5 border-l-2 border-[var(--danger)] pl-3 text-ui leading-6 [color:color-mix(in_oklab,var(--danger)_80%,var(--text-primary))]"
          >
            <p>{error}</p>
            {previewRetryable && previewState === "error" ? (
              <Button variant="secondary" size="sm" className="mt-2" onClick={retryPreview}>
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
              className="mt-8 w-full"
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
            <p className="mt-6 text-caption leading-5 text-[var(--text-tertiary)]">
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
          <Button asChild size="lg" className="mt-8 w-full">
            {ended ? <Link href="/workspace">Open Spectra</Link> : <Link href="/request-access">How to get an invitation</Link>}
          </Button>
        )}
      </section>
    </main>
  );
}

export default function JoinSchoolPage() {
  return (
    <Suspense fallback={null}>
      <JoinSchoolContent />
    </Suspense>
  );
}
