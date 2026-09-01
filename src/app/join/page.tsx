"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, LoaderCircle, School, ShieldCheck } from "lucide-react";
import { SpectraLogo } from "@/components/spectra-logo";
import { mutateAdministration } from "@/features/spectra/administration/api";
import {
  clearJoinTokenCookie,
  persistJoinTokenCookie,
  resolveJoinToken,
} from "@/lib/invitation-session";

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

  useEffect(() => {
    if (token) persistJoinTokenCookie(token, document);
  }, [token]);

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
      await mutateAdministration("acceptInvitation", { token });
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

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_50%_0%,rgba(77,174,147,.11),transparent_42%),var(--bg-primary)] p-5 text-[var(--text-primary)]">
      <section className="w-full max-w-[470px] rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-7 shadow-[0_30px_100px_rgba(36,29,20,.12)]">
        <div className="flex items-center gap-2">
          <SpectraLogo size={28} />
          <span className="font-[var(--font-serif)] text-[17px] font-medium">
            Spectra
          </span>
        </div>
        <span className="mt-8 grid size-12 place-items-center rounded-[13px] bg-[#e8f5ef] text-[#16805f]">
          {status === "accepted" ? <Check size={22} /> : <School size={22} />}
        </span>
        <h1 className="mt-5 font-[var(--font-serif)] text-[28px] font-medium tracking-[-.025em]">
          {status === "accepted"
            ? "Welcome to your school"
            : "Accept your school invitation"}
        </h1>
        <p className="mt-2 text-[12px] leading-5 text-[var(--text-tertiary)]">
          {status === "accepted"
            ? "Your single school membership is active. Spectra is opening your workspace."
            : "Sign in with the exact verified email that received this invitation. Joining never changes your ordinary artifact or agent capabilities."}
        </p>
        {status === "error" ? (
          <div className="mt-5 rounded-[8px] border border-[#efc0b8] bg-[#fff5f3] p-3 text-[11px] leading-5 text-[#8d3d34]">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void accept()}
          disabled={!token || status === "accepting" || status === "accepted"}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--text-primary)] text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-50"
        >
          {status === "accepting" ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <ShieldCheck size={15} />
          )}
          {status === "accepted"
            ? "Accepted"
            : status === "accepting"
              ? "Checking invitation"
              : "Accept invitation"}
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
