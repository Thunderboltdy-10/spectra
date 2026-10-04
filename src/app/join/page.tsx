"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, LoaderCircle, School, ShieldCheck } from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
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
        )
          clearJoinTokenCookie(document);
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
        ? "Checking invitation"
        : previewState === "loading"
          ? "Checking invitation"
        : "Join school";

  return (
    <main className="relative isolate grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--accent-mint)_11%,transparent),transparent_42%),var(--bg-primary)] p-5 text-[var(--text-primary)]">
      <section className="w-full max-w-[470px] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-7 shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-2">
          <SpectraLogo size={28} />
          <span className="font-[var(--font-serif)] text-title font-medium">
            Spectra
          </span>
        </div>
        <span className="mt-8 grid size-12 place-items-center rounded-surface bg-[color-mix(in_oklab,var(--accent-mint)_10%,var(--bg-primary))] text-[var(--accent-mint)]">
          {status === "accepted" ? <Check size={22} /> : <School size={22} />}
        </span>
        <h1 className="mt-5 font-[var(--font-serif)] text-display font-medium tracking-[-.025em]">
          {heading}
        </h1>
        <p className="mt-2 text-caption leading-5 text-[var(--text-tertiary)]">
          {detail}
        </p>
        {status === "error" ? (
          <div
            role="alert"
            className="mt-5 rounded-control border border-[color-mix(in_oklab,var(--accent-coral)_28%,var(--bg-elevated))] bg-[color-mix(in_oklab,var(--accent-coral)_8%,var(--bg-elevated))] p-3 text-micro leading-5 text-[var(--danger)]"
          >
            <p>{error}</p>
            {previewRetryable && previewState === "error" ? (
              <button
                type="button"
                onClick={retryPreview}
                className="mt-2 inline-flex h-8 items-center rounded-control border border-current px-2.5 text-micro font-medium hover:bg-[color-mix(in_oklab,var(--accent-coral)_10%,transparent)]"
              >
                Retry invitation check
              </button>
            ) : null}
          </div>
        ) : null}
        {token ? (
          <>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={
                status === "accepting" ||
                status === "accepted" ||
                previewState === "loading" ||
                previewState === "error" ||
                preview?.emailMatches === false
              }
              className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-control bg-[var(--text-primary)] text-caption font-medium text-[var(--bg-primary)] disabled:opacity-50"
            >
              {status === "accepting" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              {buttonLabel}
            </button>
            {/* Anyone on this page is already signed in, so a "Sign in" link
                came straight back here. Switching means signing out first;
                the invitation link is kept for the sign-in that follows. */}
            <div className="mt-5 border-t border-[var(--border-subtle)] pt-4 text-micro leading-4 text-[var(--text-tertiary)]">
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
                className="font-medium text-[var(--text-primary)] underline"
              >
                Use a different account
              </button>
            </div>
          </>
        ) : (
          <Link
            href="/request-access"
            className="mt-6 flex h-11 w-full items-center justify-center rounded-control border border-[var(--border-default)] text-caption font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            How to get an invitation
          </Link>
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
