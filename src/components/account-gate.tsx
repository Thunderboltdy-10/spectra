"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { api } from "../../convex/_generated/api";

/*
 * Spectra opens only for an account that belongs to a school (or a platform
 * operator). A first sign-in makes the account here, once; an email nobody
 * invited is refused by the backend and told so, and an account with no
 * school is shown how to join one instead of an app full of failed reads.
 */

type Registration = "idle" | "pending" | "refused" | "in-use" | "failed";

async function register(): Promise<Registration> {
  try {
    const response = await fetch("/api/spectra/administration?action=identity", { cache: "no-store" });
    if (response.ok) return "pending";
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === "IDENTITY_NOT_INVITED") return "refused";
    if (body?.error?.code === "IDENTITY_EMAIL_IN_USE") return "in-use";
    return "failed";
  } catch {
    return "failed";
  }
}

function Blocked({
  title,
  detail,
  email,
  action,
}: {
  title: string;
  detail: string;
  email?: string;
  action?: ReactNode;
}) {
  const { signOut } = useClerk();
  return (
    <AuthShell home="joining">
      <div role="alert">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-lede">{detail}</p>
        {email ? (
          <p className="mt-3 text-ui text-[var(--text-secondary)]">
            Signed in as <span className="font-medium text-[var(--text-primary)]">{email}</span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {action}
        <Button size="lg" variant={action ? "ghost" : "secondary"} className="w-full" onClick={() => void signOut({ redirectUrl: "/sign-in" })}>
          Sign out
        </Button>
      </div>
    </AuthShell>
  );
}

export function AccountGate({
  children,
  bare,
}: {
  children: ReactNode;
  /** The page alone, without the school shell: a school-less operator's console. */
  bare?: ReactNode;
}) {
  const { isLoaded, userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const pathname = usePathname() ?? "";
  const session = useQuery(api.identity.session, isAuthenticated ? {} : "skip");
  const [registration, setRegistration] = useState<Registration>("idle");
  const [attempt, setAttempt] = useState(0);

  const missing = isLoaded && Boolean(userId) && isAuthenticated && session === null;
  useEffect(() => {
    if (!missing) return;
    let live = true;
    setRegistration("pending");
    void register().then((next) => {
      if (live) setRegistration(next);
    });
    return () => {
      live = false;
    };
  }, [missing, attempt]);

  // Signed out, or still loading: the pages and the shell's own wait handle it.
  if (!userId || session === undefined || !isAuthenticated) return <>{children}</>;
  const email = session?.account.email ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

  if (session === null) {
    if (registration === "refused")
      return (
        <Blocked
          title="No invitation for this email"
          detail="Spectra is by invitation. Your school invites the exact email you sign up with, and no invitation was sent to this one. Sign out and use the invited email, or ask your school to invite this one."
          email={email}
          action={
            <Button asChild variant="primary" size="lg" className="w-full">
              <Link href="/request-access">How to get an invitation</Link>
            </Button>
          }
        />
      );
    if (registration === "in-use")
      return (
        <Blocked
          title="This email already has an account"
          detail="Another Spectra account uses this email. Sign out and sign in to that account instead."
          email={email}
        />
      );
    if (registration === "failed")
      return (
        <Blocked
          title="Your account didn't open"
          detail="Spectra couldn't set up your account just now. Check your connection, then try again."
          email={email}
          action={
            <Button variant="primary" size="lg" className="w-full" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          }
        />
      );
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--bg-primary)] p-6" aria-busy="true">
        <p className="text-sm text-[var(--text-secondary)]" role="status">Setting up your account…</p>
      </div>
    );
  }

  // An operator with no school may still run the platform console.
  const operatorConsole = session.account.platformOperator && (pathname === "/superadmin" || pathname.startsWith("/superadmin/"));
  if (!session.catalog && operatorConsole) return <>{bare ?? children}</>;
  if (!session.catalog) {
    const inactiveSchool = session.memberships.some((row) => row.status === "active" && row.school?.status !== "active");
    return (
      <Blocked
        title={inactiveSchool ? "Your school is not active" : "Join your school first"}
        detail={
          inactiveSchool
            ? "Your school's Spectra is switched off for now. Ask your school administrator about it."
            : "This account isn't part of a school yet. Open the invitation link your school emailed you to join, or ask them to send a new one."
        }
        email={email}
        action={
          <>
            {inactiveSchool ? null : (
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href="/join">Open my invitation</Link>
              </Button>
            )}
            {session.account.platformOperator ? (
              <Button asChild variant="secondary" size="lg" className="w-full">
                <Link href="/superadmin">Open the platform console</Link>
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  return <>{children}</>;
}
