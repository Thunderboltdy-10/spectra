"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, ImagePlus, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type BrandingData = {
  org?: {
    name?: string;
    primaryColor?: string;
    accentColor?: string;
    welcomeMessage?: string;
    logoUrl?: string;
  };
};

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-9 w-9 shrink-0 rounded-xl border border-[var(--border-default)] shadow-sm"
        style={{ background: color }}
      />
      <span className="font-mono text-sm text-[var(--text-secondary)]">{label}</span>
    </div>
  );
}

export default function SchoolBrandingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [primaryColor, setPrimaryColor] = useState("#0e8ee8");
  const [accentColor, setAccentColor] = useState("#20b8b2");
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome back. What should we work on today?");
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);

  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadSettings() {
    const response = await fetch("/api/admin/branding");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as BrandingData;
    setPrimaryColor(data.org?.primaryColor ?? "#0e8ee8");
    setAccentColor(data.org?.accentColor ?? "#20b8b2");
    setWelcomeMessage(data.org?.welcomeMessage ?? "Welcome back. What should we work on today?");
    setLogoUrl(data.org?.logoUrl);
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load branding");
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
        body: JSON.stringify({ primaryColor, accentColor, welcomeMessage }),
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
    if (!file.type.startsWith("image/")) { toast.error("File must be an image"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const response = await fetch("/api/admin/branding", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await response.text());
      await loadSettings();
      toast.success("Logo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload logo");
    } finally {
      setUploading(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void uploadLogo(file);
  }

  const inputClass =
    "h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]";

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link href="/admin/school" className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
                <ChevronLeft className="h-3 w-3" /> School Admin
              </Link>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <span className="text-xs text-[var(--text-primary)]">Branding</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">Branding</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Customize your school&apos;s visual identity and welcome message.
            </p>
          </div>
          <Button onClick={() => void saveBranding()} disabled={saving || loading} className="cursor-pointer">
            {saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Settings Panel */}
          <div className="space-y-5">
            {/* Logo Upload */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">School Logo</h2>
              <div
                ref={dropRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition ${
                  dragging
                    ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,transparent)]"
                    : "border-[var(--border-default)] hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {uploading ? (
                  <p className="text-sm text-[var(--text-secondary)]">Uploading...</p>
                ) : logoUrl ? (
                  <>
                    <Image
                      src={logoUrl}
                      alt="School logo"
                      width={64}
                      height={64}
                      className="h-16 w-16 rounded-xl border border-[var(--border-default)] object-cover"
                    />
                    <p className="text-xs text-[var(--text-secondary)]">
                      Click or drag to replace
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] text-[var(--accent-cyan)]">
                      <ImagePlus className="h-6 w-6" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-[var(--text-primary)]">Drop your logo here</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        PNG, JPG, SVG recommended. Max 4 MB.
                      </p>
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                }}
              />
            </div>

            {/* Colors */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Brand Colors</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Primary Color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-1"
                    />
                    <input
                      className={inputClass}
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      placeholder="#0e8ee8"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Accent Color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-1"
                    />
                    <input
                      className={inputClass}
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      placeholder="#20b8b2"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Welcome Message */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Welcome Message</h2>
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                className="min-h-[100px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]"
                placeholder="Welcome back! What shall we explore today?"
              />
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                Shown to students on the chat home screen.
              </p>
            </div>
          </div>

          {/* Live Preview */}
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="mb-5 text-sm font-semibold text-[var(--text-primary)]">Live Preview</h2>

            {/* Sidebar preview */}
            <div
              className="mb-4 overflow-hidden rounded-xl border border-[var(--border-default)]"
              style={{
                background: `linear-gradient(145deg, ${primaryColor}18 0%, ${accentColor}12 100%)`,
              }}
            >
              {/* Simulated sidebar header */}
              <div className="flex items-center gap-3 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_74%,transparent)] px-4 py-3">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Logo preview"
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-xl border border-[var(--border-default)] object-cover"
                  />
                ) : (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-sm"
                    style={{
                      background: `linear-gradient(132deg, ${primaryColor}, ${accentColor})`,
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Your School</p>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">studio</p>
                </div>
              </div>

              {/* Simulated chat area */}
              <div className="p-4">
                <div className="mb-3 text-center">
                  <p className="font-display text-base text-[var(--text-primary)]">
                    {welcomeMessage || "Welcome back!"}
                  </p>
                </div>
                {/* Fake composer */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_85%,transparent)] px-4 py-3">
                  <p className="text-xs text-[var(--text-secondary)]">Ask anything...</p>
                </div>
              </div>
            </div>

            {/* Color swatches preview */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Color Palette</p>
              <div className="space-y-2">
                <ColorSwatch color={primaryColor} label="Primary" />
                <ColorSwatch color={accentColor} label="Accent" />
                <ColorSwatch
                  color={`linear-gradient(132deg, ${primaryColor}, ${accentColor})`}
                  label="Brand Gradient"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
