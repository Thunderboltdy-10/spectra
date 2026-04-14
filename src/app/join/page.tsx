"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpectraLogo } from "@/components/spectra-logo";
import { hasClerkPublishableKey } from "@/lib/clerk-config";
import { getAppUrl } from "@/lib/app-url";

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

type JoinPageContentProps = {
  isLoaded: boolean;
  userId: string | null;
};

function JoinPageContent({ isLoaded, userId }: JoinPageContentProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [state, setState] = useState<PageState>({ status: "loading" });
  const [redeeming, setRedeeming] = useState(false);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !userId) {
      setViewerEmail(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/auth/access-state?includeIdentity=1", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as { email?: string } | null;
        setViewerEmail(payload?.email ?? null);
      } catch {
        setViewerEmail(null);
      }
    })();
  }, [isLoaded, userId]);

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
           } catch {
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
    const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
    const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
    const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(token ?? "")}`);
    const emailParam = `email_address=${encodeURIComponent(data.email)}`;
    window.location.href = `${signUpUrl}?${emailParam}&redirect_url=${redirect}`;
  }

  function handleSignIn() {
    const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
    const appUrl = getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined);
    const redirect = encodeURIComponent(`${appUrl}/join?token=${encodeURIComponent(token ?? "")}`);
    window.location.href = `${signInUrl}?redirect_url=${redirect}`;
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
              {userId ? "This invitation will only be accepted by the invited email address." : "This is a valid invitation. Sign in or create an account using the invited email address."}
            </p>
          </div>

          {userId && viewerEmail && viewerEmail.toLowerCase() !== data.email.toLowerCase() ? (
            <div className="mb-4 rounded-xl border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] px-4 py-3 text-xs text-[var(--warning)]">
              You are signed in as {viewerEmail}, but this invitation is for {data.email}. Sign out and continue with the invited account.
            </div>
          ) : null}

          {/* CTA */}
          <div className="space-y-3">
            <Button
              onClick={userId ? undefined : handleJoin}
              className="w-full cursor-pointer"
              disabled={redeeming || Boolean(userId)}
            >
              {redeeming ? "Joining..." : userId ? "Checking invitation..." : `Sign up to join ${data.orgName ?? "School"}`}
            </Button>
            {!userId ? (
              <Button onClick={handleSignIn} variant="secondary" className="w-full cursor-pointer">
                Sign in with existing account
              </Button>
            ) : viewerEmail && viewerEmail.toLowerCase() !== data.email.toLowerCase() ? (
              <Button variant="secondary" className="w-full cursor-pointer" onClick={handleSignIn}>
                Switch account
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function JoinPageContentWithClerk() {
  const { isLoaded, userId } = useAuth();
  return <JoinPageContent isLoaded={isLoaded} userId={userId ?? null} />;
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <SpectraLogo size={32} className="animate-pulse" />
      </div>
    }>
      {hasClerkPublishableKey() ? (
        <JoinPageContentWithClerk />
      ) : (
        <JoinPageContent isLoaded userId={null} />
      )}
    </Suspense>
  );
}
