"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { ArrowLeft, CheckCircle2, Loader2, Search, School, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SchoolMatch = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
};

type RequestResult =
  | { status: "requested"; orgName?: string }
  | { status: "invite_pending"; orgName?: string }
  | { status: "already_member"; orgName?: string };

function RequestAccessForm() {
  const { isLoaded, userId } = useAuth();
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<SchoolMatch[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/request-access?query=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as { schools?: SchoolMatch[] };
        if (cancelled) return;
        const nextSchools = payload.schools ?? [];
        setSchools(nextSchools);
        if (!nextSchools.some((school) => school._id === selectedOrgId)) {
          setSelectedOrgId(nextSchools[0]?._id ?? "");
        }
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load schools");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const timeout = window.setTimeout(() => {
      void run();
    }, query ? 180 : 0);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query, selectedOrgId]);

  const selectedSchool = useMemo(
    () => schools.find((school) => school._id === selectedOrgId),
    [schools, selectedOrgId],
  );

  async function submitRequest() {
    if (!selectedOrgId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedOrgId,
          message,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as RequestResult;
      setResult(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit access request");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link href={userId ? "/no-access" : "/sign-in"} className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <div className="grid gap-6 rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid-cols-[1.05fr_0.95fr]">
          <section>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-secondary)] text-[var(--accent-cyan)]">
                <School className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl text-[var(--text-primary)]">Request school access</h1>
                <p className="text-sm text-[var(--text-secondary)]">Ask a school admin to review your request and send you an invitation.</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm">
              <p className="font-medium text-[var(--text-primary)]">Your account</p>
              <p className="mt-1 text-[var(--text-secondary)]">
                {userId
                  ? (user?.primaryEmailAddress?.emailAddress ?? "Signed in")
                  : "Sign in first to request access."}
              </p>
            </div>

            {!userId ? (
              <div className="mt-6 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                You need to sign in before a school can approve your access request.
                {" "}
                <Link href="/sign-in" className="text-[var(--accent-cyan)] hover:underline">
                  Sign in
                </Link>
              </div>
            ) : result ? (
              <div className="mt-6 rounded-xl border border-[color-mix(in_oklab,var(--success)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_8%,transparent)] p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--success)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {result.status === "requested"
                        ? `Request sent to ${result.orgName ?? "the school"}`
                        : result.status === "invite_pending"
                          ? `An invitation is already pending for ${result.orgName ?? "this school"}`
                          : `You already belong to ${result.orgName ?? "this school"}`}
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      {result.status === "requested"
                        ? "A school admin has been notified. You can return to the pending-access page while they review it."
                        : result.status === "invite_pending"
                          ? "Check your email for the existing invitation link or ask the school admin to resend it."
                          : "Try signing in again if access still looks unavailable."}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">Find your school</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--text-secondary)]" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search by school name or slug"
                      className="pl-9"
                    />
                  </div>
                </label>

                <div className="space-y-2">
                  {loading ? (
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                      Loading schools...
                    </div>
                  ) : schools.length > 0 ? (
                    schools.map((school) => {
                      const selected = school._id === selectedOrgId;
                      return (
                        <button
                          key={school._id}
                          type="button"
                          onClick={() => setSelectedOrgId(school._id)}
                          className={`block w-full rounded-xl border px-4 py-3 text-left transition ${
                            selected
                              ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)]"
                              : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:border-[var(--accent-cyan)]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-[var(--text-primary)]">{school.name}</p>
                              <p className="text-xs text-[var(--text-secondary)]">/{school.slug}</p>
                            </div>
                            {selected ? <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" /> : null}
                          </div>
                          {school.description ? (
                            <p className="mt-2 text-xs text-[var(--text-secondary)]">{school.description}</p>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                      No schools matched that search.
                    </div>
                  )}
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">Message for the admin</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    maxLength={600}
                    placeholder="Tell them who you are or which class you belong to."
                    className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)]"
                  />
                </label>

                {error ? (
                  <div className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_7%,transparent)] px-4 py-3 text-sm text-[var(--danger)]">
                    {error}
                  </div>
                ) : null}

                <Button
                  onClick={() => void submitRequest()}
                  disabled={!userId || !selectedSchool || submitting}
                  className="gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send access request
                </Button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">How this works</h2>
            <div className="mt-4 space-y-3 text-sm text-[var(--text-secondary)]">
              <p>1. Search for your school and submit a short access request.</p>
              <p>2. A school admin receives a notification inside AI School.</p>
              <p>3. Once approved, they send you a normal invitation email with your join link.</p>
              <p>4. Use that invitation to finish joining the workspace.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function RequestAccessPage() {
  return <RequestAccessForm />;
}
