"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type BrandingSettings = {
  org?: {
    name?: string;
    primaryColor?: string;
    accentColor?: string;
    welcomeMessage?: string;
    logoUrl?: string;
  };
};

export default function BrandingAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#0f7fef");
  const [accentColor, setAccentColor] = useState("#20b18c");
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome back. What should we work on today?");
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);

  async function loadSettings() {
    const response = await fetch("/api/admin/branding");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as BrandingSettings;
    setPrimaryColor(data.org?.primaryColor ?? "#0f7fef");
    setAccentColor(data.org?.accentColor ?? "#20b18c");
    setWelcomeMessage(data.org?.welcomeMessage ?? "Welcome back. What should we work on today?");
    setLogoUrl(data.org?.logoUrl);
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load branding settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveBranding() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryColor,
          accentColor,
          welcomeMessage,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadSettings();
      toast.success("Branding saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save branding");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const response = await fetch("/api/admin/branding", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      await loadSettings();
      toast.success("Logo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload logo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">Org Branding</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Configure colors, welcome message, and logo used across the product.
            </p>
          </div>
          <Button onClick={() => void saveBranding()} disabled={saving || loading}>
            {saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <label className="mb-3 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Primary Color</span>
              <input
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
                className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Accent Color</span>
              <input
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Welcome Message</span>
              <textarea
                value={welcomeMessage}
                onChange={(event) => setWelcomeMessage(event.target.value)}
                className="min-h-[120px] w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Logo</span>
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void uploadLogo(file);
                }}
              />
              <p className="mt-1 text-xs text-[var(--text-secondary)]">PNG, JPG, SVG recommended.</p>
              {uploading ? <p className="mt-1 text-xs text-[var(--text-secondary)]">Uploading...</p> : null}
            </label>
          </section>

          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Live Preview</h2>
            <div
              className="rounded-xl border border-[var(--border-default)] p-4"
              style={{
                background: `linear-gradient(145deg, ${primaryColor}15 0%, ${accentColor}12 100%)`,
              }}
            >
              <div className="mb-3 flex items-center gap-2">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Org logo"
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-lg border border-white/30 object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] bg-white/70 text-xs font-semibold">
                    LOGO
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Your School Workspace</p>
                  <p className="text-xs text-[var(--text-secondary)]">Branded assistant</p>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-default)] bg-white/75 px-3 py-2 text-sm text-slate-800">
                {welcomeMessage}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
