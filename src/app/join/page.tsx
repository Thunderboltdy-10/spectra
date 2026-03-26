"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpectraLogo } from "@/components/spectra-logo";

type InvitationData = {
  email: string;
  role: string;
  status: string;
  orgId: string;
  expiresAt: number;
  orgName?: string;
  orgWelcomeMessage?: string;
  orgLogoUrl?: string;
};

type PageState =
  | { status: "loading" }
  | { status: "valid"; data: InvitationData }
  | { status: "expired"; reason: string }
  | { status: "error"; message: string };

function JoinPageContent() {
  const searchParams = useSearchParams();
  const { isLoaded, userId } = useAuth();
  const token = searchParams.get("token");

  const [state, setState] = useState<PageState>({ status: "loading" });
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "No invitation token provided." });
      return;
    }

    void (async () => {
      try {
        const response = await fetch(`/api/join?token=${encodeURIComponent(token)}`);

        if (response.status === 410) {
          setState({ status: "expired", reason: "This invitation has expired." });
          return;
        }
        if (response.status === 409) {
          setState({ status: "expired", reason: "This invitation has already been accepted." });
          return;
        }
        if (response.status === 404) {
          setState({ status: "error", message: "Invitation not found. Please ask your school admin for a new link." });
          return;
        }
     if (!response.ok) {
           const text = await response.text();
           // Try to parse as JSON first, fallback to text
           let errorMessage = text || "Failed to load invitation.";
           try {
             const json = JSON.parse(text);
             errorMessage = json.error?.message || json.message || errorMessage;
           } catch (e) {
             // Keep original text if not JSON
           }
           setState({ status: "error", message: errorMessage });
           return;
         }

        const data = (await response.json()) as InvitationData;
        setState({ status: "valid", data });
      } catch {
        setState({ status: "error", message: "Could not verify invitation. Please try again." });
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!isLoaded || !userId || !token || state.status !== "valid" || redeeming) {
      return;
    }

    setRedeeming(true);
    void (async () => {
      try {
        const response = await fetch("/api/invitations/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(payload?.error?.message ?? "Could not accept invitation.");
        }
        window.location.href = "/";
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not accept invitation.",
        });
      } finally {
        setRedeeming(false);
      }
    })();
  }, [isLoaded, redeeming, state, token, userId]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <SpectraLogo size={56} showTile className="animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Verifying invitation...</p>
        </div>
      </div>
    );
  }

  if (state.status === "expired") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center shadow-[var(--shadow-soft)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--warning)_12%,transparent)]">
            <Clock className="h-7 w-7 text-[var(--warning)]" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">Invitation Expired</h1>
          <p className="text-sm text-[var(--text-secondary)]">{state.reason}</p>
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            Contact your school administrator for a fresh invitation link.
          </p>
          <Link href={userId ? "/no-access" : "/sign-in"}>
            <Button variant="secondary" className="mt-6 w-full cursor-pointer">
              Continue
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center shadow-[var(--shadow-soft)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]">
            <AlertTriangle className="h-7 w-7 text-[var(--danger)]" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">Invalid Invitation</h1>
          <p className="text-sm text-[var(--text-secondary)]">{state.message}</p>
          <Link href={userId ? "/no-access" : "/sign-in"}>
            <Button variant="secondary" className="mt-6 w-full cursor-pointer">
              Continue
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { data } = state;
  const expiryDate = new Date(data.expiresAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

    function handleJoin() {
        // Redirect to Clerk signup with the email pre-filled if possible
        const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? typeof window !== "undefined" ? window.location.origin : "";
        const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(token ?? "")}`);
        const emailParam = `email_address=${encodeURIComponent(data.email)}`;
        window.location.href = `${signUpUrl}?${emailParam}&redirect_url=${redirect}`;
    }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      {/* Background accent */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-hover)]">
          {/* School branding */}
          <div className="mb-6 flex flex-col items-center text-center">
            {data.orgLogoUrl ? (
              <Image
                src={data.orgLogoUrl}
                alt={data.orgName ?? "School"}
                width={64}
                height={64}
                className="mb-3 h-16 w-16 rounded-2xl border border-[var(--border-default)] object-cover shadow-[var(--shadow-card)]"
              />
            ) : (
              <SpectraLogo size={64} showTile className="mb-3" />
            )}
            <h1 className="font-display text-2xl text-[var(--text-primary)]">
              {data.orgName ?? "Spectra"}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              You&apos;ve been invited to join
            </p>
          </div>

          {/* Welcome message */}
          {data.orgWelcomeMessage && (
            <div className="mb-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
              <p className="text-sm text-[var(--text-primary)]">{data.orgWelcomeMessage}</p>
            </div>
          )}

          {/* Invitation details */}
          <div className="mb-6 space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Invited as</span>
              <span className="font-medium capitalize text-[var(--text-primary)]">{data.role}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Email</span>
              <span className="font-medium text-[var(--text-primary)]">{data.email}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Expires</span>
              <span className="text-[var(--text-secondary)]">{expiryDate}</span>
            </div>
          </div>

          {/* Accepted indicator */}
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)] px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
            <p className="text-xs text-[var(--success)]">
              This is a valid invitation. Create an account to join.
            </p>
          </div>

          {/* CTA */}
          <Button
            onClick={handleJoin}
            className="w-full cursor-pointer"
            disabled={redeeming}
          >
            {redeeming ? "Joining..." : `Join ${data.orgName ?? "School"}`}
          </Button>
          <p className="mt-3 text-center text-xs text-[var(--text-secondary)]">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-[var(--accent-cyan)] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <SpectraLogo size={32} className="animate-pulse" />
      </div>
    }>
      <JoinPageContent />
    </Suspense>
  );
}
