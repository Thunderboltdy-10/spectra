"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  MailPlus,
  Palette,
  ShieldCheck,
  Sparkles,
  Users2,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { StepContainer } from "@/components/onboarding/steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AdminOnboardingProps = {
  orgName: string;
  monthlyBudgetCentsPerUser?: number | null;
  budgetMarginPercent?: number | null;
  onComplete: () => Promise<void>;
  onSkip: () => Promise<void>;
};

type BrandingData = {
  org?: {
    primaryColor?: string;
    accentColor?: string;
    welcomeMessage?: string;
    logoUrl?: string;
  };
};

const STEP_META: Array<{ title: string; subtitle: string; icon: LucideIcon }> = [
  { title: "Welcome", subtitle: "Your admin mission", icon: ShieldCheck },
  { title: "School Setup", subtitle: "Logo and colors", icon: Palette },
  { title: "School Soul", subtitle: "Behavior and policy", icon: BookOpen },
  { title: "Members", subtitle: "Invite your team", icon: Users2 },
  { title: "Analytics", subtitle: "Track engagement", icon: BarChart3 },
  { title: "Budget", subtitle: "Usage guardrails", icon: WalletCards },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function ProgressRail({ currentStep }: { currentStep: number }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {STEP_META.map((step, index) => {
        const Icon = step.icon;
        const completed = index < currentStep;
        const active = index === currentStep;

        return (
          <div
            key={step.title}
            className={cn(
              "rounded-xl border px-3 py-2.5 transition-all",
              completed
                ? "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-elevated))]"
                : active
                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,var(--bg-elevated))]"
                  : "border-[var(--border-default)] bg-[var(--bg-elevated)]",
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  completed
                    ? "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]"
                    : active
                      ? "bg-[color-mix(in_oklab,var(--accent-cyan)_18%,transparent)] text-[var(--accent-cyan)]"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                  Step {index + 1}
                </p>
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{step.title}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AdminOnboarding({
  orgName,
  monthlyBudgetCentsPerUser,
  budgetMarginPercent,
  onComplete,
  onSkip,
}: AdminOnboardingProps) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const [primaryColor, setPrimaryColor] = useState("#0e8ee8");
  const [accentColor, setAccentColor] = useState("#20b8b2");
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome back. What should we work on today?");
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [loadingBranding, setLoadingBranding] = useState(true);
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"student" | "teacher">("teacher");
  const [inviting, setInviting] = useState(false);
  const [invitesSent, setInvitesSent] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/branding");
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as BrandingData;
        setPrimaryColor(data.org?.primaryColor ?? "#0e8ee8");
        setAccentColor(data.org?.accentColor ?? "#20b8b2");
        setWelcomeMessage(data.org?.welcomeMessage ?? "Welcome back. What should we work on today?");
        setLogoUrl(data.org?.logoUrl);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load branding defaults");
      } finally {
        setLoadingBranding(false);
      }
    })();
  }, []);

  const budgetInfo = useMemo(() => {
    const hardLimitCents =
      typeof monthlyBudgetCentsPerUser === "number" &&
      Number.isFinite(monthlyBudgetCentsPerUser) &&
      monthlyBudgetCentsPerUser > 0
        ? Math.round(monthlyBudgetCentsPerUser)
        : 900;

    const marginPercent = Math.min(
      40,
      Math.max(
        5,
        typeof budgetMarginPercent === "number" && Number.isFinite(budgetMarginPercent)
          ? budgetMarginPercent
          : 20,
      ),
    );
    const softLimitCents = Math.max(0, Math.floor(hardLimitCents * (1 - marginPercent / 100)));
    const cheapOnlyLimitCents = Math.max(0, Math.floor(hardLimitCents * 0.9));

    return {
      configured:
        typeof monthlyBudgetCentsPerUser === "number" &&
        Number.isFinite(monthlyBudgetCentsPerUser) &&
        monthlyBudgetCentsPerUser > 0,
      marginPercent,
      hardLimitCents,
      softLimitCents,
      cheapOnlyLimitCents,
    };
  }, [budgetMarginPercent, monthlyBudgetCentsPerUser]);

  const atLastStep = step === STEP_META.length - 1;

  async function saveSchoolSetup() {
    setSavingBranding(true);
    try {
      const response = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryColor: primaryColor.trim(),
          accentColor: accentColor.trim(),
          welcomeMessage: welcomeMessage.trim(),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("School setup saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save school setup");
    } finally {
      setSavingBranding(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Logo must be 4MB or less");
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const response = await fetch("/api/admin/branding", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());

      const refresh = await fetch("/api/admin/branding");
      if (refresh.ok) {
        const data = (await refresh.json()) as BrandingData;
        setLogoUrl(data.org?.logoUrl);
      }
      toast.success("Logo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }

    setInviting(true);
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!response.ok) throw new Error(await response.text());
      setInviteEmail("");
      setInvitesSent((value) => value + 1);
      toast.success(`Invitation sent to ${email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function finishOnboarding() {
    setFinishing(true);
    try {
      await onComplete();
      toast.success("Admin onboarding complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete onboarding");
    } finally {
      setFinishing(false);
    }
  }

  async function skipOnboarding() {
    setSkipping(true);
    try {
      await onSkip();
      toast.success("Admin onboarding skipped");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to skip onboarding");
    } finally {
      setSkipping(false);
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-5xl py-8"
      style={{
        background: `
          radial-gradient(circle at 4% 10%, color-mix(in oklab, var(--accent-cyan) 20%, transparent), transparent 36%),
          radial-gradient(circle at 88% 92%, color-mix(in oklab, var(--accent-coral) 18%, transparent), transparent 42%),
          transparent
        `,
      }}
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            Admin Onboarding
          </p>
          <h1 className="font-display text-3xl text-[var(--text-primary)]">
            Configure {orgName}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Step {step + 1} of {STEP_META.length} &middot; {STEP_META[step]?.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void skipOnboarding()}
          disabled={skipping || finishing}
          className="cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {skipping ? "Skipping..." : "Skip for now"}
        </button>
      </div>

      <ProgressRail currentStep={step} />

      <div
        className="mt-5 rounded-2xl border border-[var(--border-default)] p-6 sm:p-8"
        style={{
          background: "var(--gradient-surface)",
          backdropFilter: "var(--glass-blur)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {step === 0 && (
          <StepContainer className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--bg-secondary))]">
              <Building2 className="h-10 w-10 text-[var(--accent-cyan)]" />
            </div>
            <h2 className="font-display text-3xl text-[var(--text-primary)]">
              You&apos;re an admin for {orgName}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
              This setup takes about three minutes and prepares your school workspace for teachers
              and students. You&apos;ll configure branding, guidance, access, analytics, and usage rules.
            </p>
            <div className="mx-auto mt-7 grid max-w-3xl gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left">
                <Palette className="mb-2 h-5 w-5 text-[var(--accent-cyan)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">Set your identity</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Logo, colors, and welcome voice.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left">
                <Users2 className="mb-2 h-5 w-5 text-[var(--accent-coral)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">Launch your team</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Invite teachers and students safely.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left">
                <Sparkles className="mb-2 h-5 w-5 text-[var(--success)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">Set governance</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Control quality, behavior, and spend.</p>
              </div>
            </div>
          </StepContainer>
        )}

        {step === 1 && (
          <StepContainer>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">School Setup</h2>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              Set logo, colors, and a welcome message students see when they open AI School.
            </p>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                  School Logo
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="School logo" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-[var(--text-secondary)]" />
                    )}
                  </div>
                  <label className="cursor-pointer rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadLogo(file);
                      }}
                    />
                    {uploadingLogo ? "Uploading..." : "Upload logo"}
                  </label>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Primary Color
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                      className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--border-default)] bg-transparent p-1"
                    />
                    <Input value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Accent Color
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                      className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--border-default)] bg-transparent p-1"
                    />
                    <Input value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                Welcome Message
              </label>
              <textarea
                value={welcomeMessage}
                onChange={(event) => setWelcomeMessage(event.target.value)}
                className="min-h-24 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_28%,transparent)]"
                placeholder="Welcome message for students"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void saveSchoolSetup()}
                disabled={savingBranding || loadingBranding}
                className="cursor-pointer"
              >
                {savingBranding ? "Saving..." : "Save school setup"}
              </Button>
              <Link
                href="/admin/school/branding"
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
              >
                Open full branding editor <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </StepContainer>
        )}

        {step === 2 && (
          <StepContainer>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">School Soul</h2>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              Define how AI should speak, teach, and enforce your school standards.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Voice and tone</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Set formal or conversational style, clarity level, and expected response structure.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Safety boundaries</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Add non-negotiable rules for citations, integrity, and harmful content handling.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Teaching approach</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Configure instruction quality with examples, pacing, and rubric alignment.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Policy updates</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Publish updates instantly so all future assistant responses follow the latest policy.
                </p>
              </div>
            </div>

            <Link
              href="/admin/school/soul"
              className="mt-4 inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              Open School Soul editor <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </StepContainer>
        )}

        {step === 3 && (
          <StepContainer>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Members</h2>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              Invite teachers and students to your workspace. You can manage role changes anytime.
            </p>

            <form
              onSubmit={(event) => void sendInvite(event)}
              className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
            >
              <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <MailPlus className="h-4 w-4 text-[var(--accent-cyan)]" />
                Quick Invite
              </p>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teacher@school.edu"
                />
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as "student" | "teacher")}
                  className="h-10 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)]"
                >
                  <option value="teacher">Teacher</option>
                  <option value="student">Student</option>
                </select>
                <Button type="submit" disabled={inviting} className="cursor-pointer">
                  {inviting ? "Sending..." : "Send"}
                </Button>
              </div>

              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                {invitesSent > 0
                  ? `${invitesSent} invitation${invitesSent === 1 ? "" : "s"} sent during onboarding.`
                  : "Invitations are emailed immediately with secure join links."}
              </p>
            </form>

            <Link
              href="/admin/school/members"
              className="mt-4 inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              Open member management <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </StepContainer>
        )}

        {step === 4 && (
          <StepContainer>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Analytics Tour</h2>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              School analytics helps you monitor engagement, mode adoption, and learning outcomes.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Engagement</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Messages over time</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Spot drops in activity quickly.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Mode Usage</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">What students use most</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Tutor, Quiz, Flashcards, and more.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Outcomes</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Quiz performance</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Track average scores and attempts.</p>
              </div>
            </div>

            <Link
              href="/admin/school/analytics"
              className="mt-4 inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              Open analytics dashboard <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </StepContainer>
        )}

        {step === 5 && (
          <StepContainer>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Budget Guardrails</h2>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              Understand when model access tiers tighten as monthly usage grows.
            </p>

            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
              {budgetInfo.configured ? (
                <p className="text-sm text-[var(--text-primary)]">
                  Your school has a configured monthly per-user budget. Limits below are active now.
                </p>
              ) : (
                <p className="text-sm text-[var(--text-primary)]">
                  No custom monthly budget is configured, so platform defaults are active.
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Margin: {budgetInfo.marginPercent}% &middot; calculations run per user per month.
              </p>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Expensive blocked</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatMoney(budgetInfo.softLimitCents)}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">High-cost models stop first.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Cheap-only mode</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatMoney(budgetInfo.cheapOnlyLimitCents)}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Only low-cost models remain.</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Hard limit</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatMoney(budgetInfo.hardLimitCents)}</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">System moves to free-only.</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--success)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-elevated))] px-3 py-2 text-sm text-[var(--text-primary)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              On completion, onboarding is marked done and the admin console opens.
            </div>
          </StepContainer>
        )}

        <div className="mt-7 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || finishing || skipping}
            className="cursor-pointer gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          <Button
            type="button"
            onClick={() => {
              if (atLastStep) {
                void finishOnboarding();
                return;
              }
              setStep((value) => Math.min(STEP_META.length - 1, value + 1));
            }}
            disabled={finishing || skipping}
            className="cursor-pointer gap-1.5"
            size="lg"
          >
            {atLastStep ? (
              finishing ? (
                "Finishing..."
              ) : (
                "Complete onboarding"
              )
            ) : (
              <>
                Continue
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
