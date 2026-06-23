"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { ArrowRight, Check, CircleAlert, Loader2, LogOut, School, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpectraLogo } from "@/components/spectra-logo";
import { hasClerkPublishableKey } from "@/lib/clerk-config";

type InviteState =
  | "token_missing" | "token_invalid" | "token_expired" | "token_revoked" | "token_over_capacity"
  | "token_valid_signed_out" | "token_valid_signed_in_wrong_identity"
  | "token_valid_signed_in_other_school" | "token_valid_signed_in_match_pending_redeem"
  | "token_redeemed" | "token_already_redeemed_same_user" | "token_already_redeemed_other_user";

type JoinPayload = {
  state: InviteState;
  invitedEmail: string | null;
  invitation: null | { token: string; orgName?: string; role: string; orgLogoUrl?: string; expiresAt: number };
  viewer: { userId: string | null; primaryEmail: string | null; emails: string[] };
  canRedeemNow: boolean;
};

const copy: Record<InviteState, { title: string; body: string; tone: "ok" | "warn" | "neutral" }> = {
  token_missing: { title: "Invitation link missing", body: "Open the complete link from your invitation email, or request access to your school.", tone: "warn" },
  token_invalid: { title: "Invitation not found", body: "This link is not valid. Ask a school admin to send a new invitation.", tone: "warn" },
  token_expired: { title: "Invitation expired", body: "This invitation is no longer active. A school admin can resend it without changing your account.", tone: "warn" },
  token_revoked: { title: "Invitation revoked", body: "A school admin cancelled this invitation. Contact them if you still need access.", tone: "warn" },
  token_over_capacity: { title: "School is at capacity", body: "Your invitation is valid, but no seat is currently available. An admin must free a seat before you can join.", tone: "warn" },
  token_valid_signed_out: { title: "Your place is reserved", body: "Sign in or create an account with the invited email. You will return here to accept access.", tone: "neutral" },
  token_valid_signed_in_wrong_identity: { title: "This invitation is for another account", body: "Nothing is wrong with the link. Switch to the invited email to continue.", tone: "warn" },
  token_valid_signed_in_other_school: { title: "Already connected to another school", body: "Spectra accounts can belong to one school. Contact an administrator if your membership should be changed.", tone: "warn" },
  token_valid_signed_in_match_pending_redeem: { title: "Ready to join", body: "Your identity matches this invitation. Accept to activate your school access.", tone: "ok" },
  token_redeemed: { title: "Access activated", body: "Your membership is ready.", tone: "ok" },
  token_already_redeemed_same_user: { title: "You already have access", body: "This invitation was accepted previously. Continue to Spectra.", tone: "ok" },
  token_already_redeemed_other_user: { title: "Invitation already used", body: "This invitation has already been accepted. Ask an admin for help if you believe this is incorrect.", tone: "warn" },
};

function JoinContent() {
  const search = useSearchParams();
  const { isLoaded } = useAuth();
  const clerk = useClerk();
  const token = search.get("token");
  const [payload, setPayload] = useState<JoinPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    void fetch(token ? `/api/join?token=${encodeURIComponent(token)}` : "/api/join", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Invitation status could not be loaded.");
        return response.json() as Promise<JoinPayload>;
      })
      .then((result) => { if (!cancelled) setPayload(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Invitation status could not be loaded."); });
    return () => { cancelled = true; };
  }, [isLoaded, token]);

  const returnPath = `/join${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  const authReturn = encodeURIComponent(returnPath);

  async function accept() {
    if (!payload?.invitation || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: payload.invitation.token }),
      });
      const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(result?.error?.message ?? "Invitation could not be accepted.");
      window.location.replace("/onboarding");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invitation could not be accepted.");
      setBusy(false);
    }
  }

  async function switchAccount() {
    await fetch("/api/invitations/redeem", { method: "DELETE" }).catch(() => undefined);
    await clerk.signOut({ redirectUrl: `/sign-in?redirect_url=${authReturn}` });
  }

  if (!payload && !error) return <div className="flex min-h-screen items-center justify-center bg-[#f2f0e9]"><Loader2 className="h-6 w-6 animate-spin text-[#315c56]" /></div>;

  const state = payload?.state ?? "token_invalid";
  const message = copy[state];
  const signedOut = state === "token_valid_signed_out";
  const switchNeeded = state === "token_valid_signed_in_wrong_identity";
  const canEnter = state === "token_already_redeemed_same_user" || state === "token_redeemed";
  const icon = message.tone === "ok" ? <Check className="h-5 w-5" /> : message.tone === "warn" ? <CircleAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f2f0e9] px-5 py-8 text-[#182522] sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 opacity-[0.28]" style={{ backgroundImage: "linear-gradient(#9ba8a2 1px, transparent 1px), linear-gradient(90deg, #9ba8a2 1px, transparent 1px)", backgroundSize: "38px 38px" }} />
      <div className="relative mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-[#aab4ae] pb-5">
          <SpectraLogo size={30} />
          <Link href="/landing" className="text-xs font-semibold uppercase tracking-[0.18em] text-[#53635e] hover:text-[#182522]">Home</Link>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.24em] text-[#b15136]">School access / verified handoff</p>
            <h1 className="max-w-2xl font-display text-5xl leading-[0.98] tracking-[-0.045em] sm:text-7xl">{message.title}</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#52615d]">{message.body}</p>
          </div>

          <div className="border border-[#899890] bg-[#fbfaf5] shadow-[12px_12px_0_#cad0ca]">
            <div className="flex items-center gap-3 border-b border-[#b5beb8] px-6 py-5">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${message.tone === "ok" ? "bg-[#d9eadc] text-[#236142]" : message.tone === "warn" ? "bg-[#f4dfd5] text-[#9b432e]" : "bg-[#d9e5e2] text-[#315c56]"}`}>{icon}</span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#66736f]">Invitation status</p>
                <p className="mt-0.5 font-semibold">{message.tone === "ok" ? "Eligible" : message.tone === "warn" ? "Action needed" : "Identity required"}</p>
              </div>
            </div>

            <div className="space-y-5 p-6">
              {payload?.invitation ? (
                <div className="space-y-3 border-l-2 border-[#315c56] pl-4">
                  <div className="flex items-center gap-2"><School className="h-4 w-4 text-[#315c56]" /><span className="font-semibold">{payload.invitation.orgName ?? "Your school"}</span></div>
                  <p className="text-sm text-[#5e6b67]">Invited as <span className="font-medium text-[#182522]">{payload.invitation.role}</span></p>
                  <p className="break-all text-sm text-[#5e6b67]">For <span className="font-medium text-[#182522]">{payload.invitedEmail}</span></p>
                </div>
              ) : null}
              {switchNeeded ? <p className="rounded-sm bg-[#f3e7df] px-4 py-3 text-sm text-[#704133]">Currently signed in as {payload?.viewer.primaryEmail ?? "another account"}.</p> : null}
              {error ? <p role="alert" className="border border-[#cf8f7e] bg-[#fff1eb] px-4 py-3 text-sm text-[#8f3521]">{error}</p> : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {payload?.canRedeemNow ? <Button onClick={() => void accept()} disabled={busy} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Accept and enter Spectra</Button> : null}
                {signedOut ? <><Button asChild><Link href={`/sign-in?redirect_url=${authReturn}`}>Sign in <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild variant="outline"><Link href={`/sign-up?redirect_url=${authReturn}`}>Create account</Link></Button></> : null}
                {switchNeeded ? <Button onClick={() => void switchAccount()} variant="outline" className="gap-2"><LogOut className="h-4 w-4" />Switch account</Button> : null}
                {canEnter ? <Button asChild><Link href="/chat">Continue to Spectra <ArrowRight className="ml-2 h-4 w-4" /></Link></Button> : null}
                {!signedOut && !switchNeeded && !payload?.canRedeemNow && !canEnter ? <Button asChild variant="outline"><Link href="/request-access">Request access</Link></Button> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function JoinPage() {
  const clerkEnabled = hasClerkPublishableKey();
  if (!clerkEnabled) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f2f0e9] px-6 text-[#182522]">
        <div className="max-w-md border border-[#899890] bg-[#fbfaf5] p-8 shadow-[10px_10px_0_#cad0ca]">
          <h1 className="font-display text-3xl">Authentication is not configured</h1>
          <p className="mt-3 text-sm leading-6 text-[#52615d]">Configure Clerk to test invitation handoffs. The rest of the local Spectra demo remains available.</p>
          <Button asChild variant="outline" className="mt-5"><Link href="/">Go home</Link></Button>
        </div>
      </main>
    );
  }
  return <Suspense fallback={<div className="min-h-screen bg-[#f2f0e9]" />}><JoinContent /></Suspense>;
}
