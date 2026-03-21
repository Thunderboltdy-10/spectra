"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Clock, Mail, ArrowLeft, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SchoolOption = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
};

function NoAccessPageContent() {
  const { isLoaded, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<SchoolOption | null>(null);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestState, setRequestState] = useState<{
    status: "idle" | "requested" | "invite_pending" | "already_member" | "error";
    message?: string;
  }>({ status: "idle" });

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setSchools([]);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSchools([]);
      return;
    }

    const controller = new AbortController();
    setLoadingSchools(true);
    void fetch(`/api/request-access?query=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ schools?: SchoolOption[] }>;
      })
      .then((payload) => {
        setSchools(payload.schools ?? []);
      })
      .catch(() => {
        setSchools([]);
      })
      .finally(() => {
        setLoadingSchools(false);
      });

    return () => controller.abort();
  }, [isLoaded, isSignedIn, query]);

  async function submitRequest() {
    if (!selectedSchool?._id) {
      setRequestState({
        status: "error",
        message: "Choose your school first.",
      });
      return;
    }

    setSubmitting(true);
    setRequestState({ status: "idle" });
    try {
      const response = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedSchool._id,
          message: message.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: "requested" | "invite_pending" | "already_member"; orgName?: string; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not submit access request.");
      }

      const status = payload?.status ?? "requested";
      const orgName = payload?.orgName ?? selectedSchool.name;
      if (status === "invite_pending") {
        setRequestState({
          status,
          message: `An invitation for ${orgName} is already pending for your email.`,
        });
      } else if (status === "already_member") {
        setRequestState({
          status,
          message: `Your account is already linked to ${orgName}. Try signing in again.`,
        });
      } else {
        setRequestState({
          status: "requested",
          message: `Your access request for ${orgName} has been sent to the school admin.`,
        });
      }
    } catch (error) {
      setRequestState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not submit access request.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-xl">
        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-soft)]">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <Clock className="h-7 w-7 text-[var(--text-secondary)]" />
          </div>

          <h1 className="text-center font-display text-3xl text-[var(--text-primary)]">Approval pending</h1>
          <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-[var(--text-secondary)]">
            {reason === "inactive"
              ? "Your school workspace is currently inactive. Contact your school administrator to reactivate access."
              : "Your account is signed in, but it is not linked to a school yet. Use an invitation link if you have one, or request access below."}
          </p>

          <div className="mx-auto mt-8 grid gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-left">
              <Mail className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Already invited?</p>
                <p className="text-xs text-[var(--text-secondary)]">Open the invitation email and use the join link for your school.</p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">Request school access</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Search for your school, then send a request to its admin team.
              </p>

              <div className="mt-4 space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelectedSchool(null);
                    }}
                    placeholder="Search your school"
                    className="pl-9"
                  />
                </div>

                {loadingSchools ? (
                  <p className="text-xs text-[var(--text-secondary)]">Searching schools...</p>
                ) : schools.length > 0 ? (
                  <div className="space-y-2">
                    {schools.map((school) => (
                      <button
                        key={school._id}
                        type="button"
                        onClick={() => {
                          setSelectedSchool(school);
                          setQuery(school.name);
                          setSchools([]);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          selectedSchool?._id === school._id
                            ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
                            : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <p className="text-sm font-medium text-[var(--text-primary)]">{school.name}</p>
                        {school.description ? (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">{school.description}</p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : query.trim().length >= 2 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No matching schools found yet.</p>
                ) : null}

                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Optional note to the school admin"
                  className="min-h-[96px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/35"
                />

                {selectedSchool ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Requesting access for <span className="font-medium text-[var(--text-primary)]">{selectedSchool.name}</span>.
                  </p>
                ) : null}

                {requestState.message ? (
                  <p
                    className={`text-xs ${
                      requestState.status === "error"
                        ? "text-[var(--danger)]"
                        : "text-[var(--success)]"
                    }`}
                  >
                    {requestState.message}
                  </p>
                ) : null}

                {!isSignedIn && isLoaded ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Sign in first to send an access request.
                  </p>
                ) : null}

                <Button
                  type="button"
                  className="w-full gap-2"
                  disabled={!isLoaded || !isSignedIn || submitting || !selectedSchool}
                  onClick={() => void submitRequest()}
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "Sending request..." : "Request access"}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-in">
              <Button variant="secondary" className="gap-2">
                <ArrowLeft className="h-3.5 w-3.5" />
                Sign in again
              </Button>
            </Link>
            <a
              href="mailto:pablo.martinez.dovale@gmail.com?subject=Spectra%20Access%20Request"
              className="text-sm font-medium transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Contact us
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

function NoAccessPageFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-xl rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-soft)]">
        <h1 className="text-center font-display text-3xl text-[var(--text-primary)]">Loading access details...</h1>
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed text-[var(--text-secondary)]">
          Checking your workspace access status.
        </p>
      </div>
    </main>
  );
}

export default function NoAccessPage() {
  return (
    <Suspense fallback={<NoAccessPageFallback />}>
      <NoAccessPageContent />
    </Suspense>
  );
}
