"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, LoaderCircle, School, ShieldCheck } from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { SurfaceField } from "@/features/spectra/field/surface-field";
import { mutateAdministration } from "@/features/spectra/administration/api";
import {
  clearJoinTokenCookie,
  invitationPreviewCanRetry,
  persistJoinTokenCookie,
  resolveJoinToken,
} from "@/lib/invitation-session";

function roleLabel(role: string) {
  if (role === "school_admin") return "school administrator";
  if (role === "teacher") return "teacher";
  return "student";
}

type InvitationPreview = {
  schoolName: string;
  role: "student" | "teacher" | "school_admin";
  emailMatches: boolean;
  alreadyMember: boolean;
};

function JoinSchoolContent() {
  const router = useRouter();
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
    void mutateAdministration<InvitationPreview>("previewInvitation", { token })
      .then((next) => {
        if (!active) return;
        setPreview(next);
        setPreviewState("ready");
      })
      .catch((nextError) => {
        if (!active) return;
        const raw = nextError instanceof Error ? nextError.message : "";
        const retryable = invitationPreviewCanRetry(raw, previewAttempt);
        const human = raw.match(
          /(?:INVITATION_[A-Z_]+|MEMBERSHIP_[A-Z_]+):\s*(.+)/,
        );
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
          (human?.[1] ?? raw).trim() ||
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
      const raw = nextError instanceof Error ? nextError.message : "";
      if (
        /INVITATION_INVALID|INVITATION_EXPIRED|INVITATION_SCHOOL_UNAVAILABLE/.test(
          raw,
        )
      )
        clearJoinTokenCookie(document);
      const human = raw.match(
        /(?:INVITATION_[A-Z_]+|MEMBERSHIP_[A-Z_]+):\s*(.+)/,
      );
      setStatus("error");
      setError(
        (human?.[1] ?? raw).trim() || "The invitation could not be accepted.",
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
        : "Accept your school invitation";
  const detail =
    status === "accepted"
      ? "Spectra is opening your workspace."
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
      <SurfaceField scale="stage" behind />
      <section className="w-full max-w-[470px] rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] p-7 shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-2">
          <SpectraLogo size={28} />
          <span className="font-[var(--font-serif)] text-title font-medium">
            Spectra
          </span>
        </div>
        <span className="mt-8 grid size-12 place-items-center rounded-surface bg-[color-mix(in oklab, var(--accent-mint) 10%, var(--bg-primary))] text-[var(--accent-mint)]">
          {status === "accepted" ? <Check size={22} /> : <School size={22} />}
        </span>
        <h1 className="mt-5 font-[var(--font-serif)] text-display font-medium tracking-[-.025em]">
          {heading}
        </h1>
        <p className="mt-2 text-caption leading-5 text-[var(--text-tertiary)]">
          {detail}
        </p>
        {status === "error" ? (
          <div className="mt-5 rounded-control border border-[color-mix(in oklab, var(--accent-coral) 28%, var(--bg-elevated))] bg-[color-mix(in oklab, var(--accent-coral) 8%, var(--bg-elevated))] p-3 text-micro leading-5 text-[var(--danger)]">
            <p>{error}</p>
            {previewRetryable && previewState === "error" ? (
              <button
                type="button"
                onClick={retryPreview}
                className="mt-2 inline-flex h-8 items-center rounded-control border border-current px-2.5 text-micro font-medium hover:bg-[color-mix(in oklab,var(--accent-coral)_10%,transparent)]"
              >
                Retry invitation check
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void accept()}
          disabled={
            !token ||
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
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4 text-micro leading-4 text-[var(--text-tertiary)]">
          If Spectra asks you to sign in, use the invited address and return to
          this page.{" "}
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent(
              `/join?token=${token}`,
            )}`}
            className="font-medium text-[var(--text-primary)] underline"
          >
            Sign in
          </Link>
        </div>
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
