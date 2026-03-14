"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

const SCHOOL_TYPES = [
  { value: "", label: "Select type..." },
  { value: "Primary", label: "Primary School" },
  { value: "Secondary", label: "Secondary School" },
  { value: "University", label: "University" },
  { value: "Corporate", label: "Corporate Training" },
  { value: "Other", label: "Other" },
];

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

type FieldProps = {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
};

function Field({ label, required, hint, children }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
        </span>
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</p>}
    </div>
  );
}

export default function CreateSchoolPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [schoolType, setSchoolType] = useState("");
  const [country, setCountry] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [maxMembers, setMaxMembers] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  // Auto-generate slug from name unless the user has manually edited it
  useEffect(() => {
    if (!slugEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugEdited]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) { toast.error("School name is required"); return; }
    if (!slug.trim()) { toast.error("Slug is required"); return; }
    if (!adminEmail.trim()) { toast.error("Initial admin email is required"); return; }
    if (!adminEmail.includes("@")) { toast.error("Enter a valid email for the admin"); return; }

    setSaving(true);
    try {
      const response = await fetch("/api/super-admin/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          schoolType: schoolType || undefined,
          country: country.trim() || undefined,
          timezone,
          maxMembers: maxMembers ? parseInt(maxMembers, 10) : undefined,
          adminEmail: adminEmail.trim(),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }

      const result = (await response.json()) as { orgId: string };
      toast.success("School created successfully");
      router.push(`/super-admin/schools/${result.orgId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create school");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]";
  const selectClass =
    "h-10 w-full cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]";

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link href="/super-admin" className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
              Super Admin
            </Link>
            <span className="text-xs text-[var(--text-secondary)]">/</span>
            <Link href="/super-admin/schools" className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
              Schools
            </Link>
            <span className="text-xs text-[var(--text-secondary)]">/</span>
            <span className="text-xs text-[var(--text-primary)]">New</span>
          </div>
          <h1 className="font-display text-3xl text-[var(--text-primary)]">Create School</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Provision a new school org on the platform.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
            <div className="space-y-5">
              {/* Identity */}
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
                  School Identity
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="School Name" required>
                    <input
                      className={inputClass}
                      placeholder="Greenfield Academy"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="URL Slug" required hint="Used in internal URLs. Letters, numbers and hyphens only.">
                    <input
                      className={inputClass}
                      placeholder="greenfield-academy"
                      value={slug}
                      onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
                      pattern="[a-z0-9\-]+"
                      required
                    />
                  </Field>
                </div>
              </div>

              <Field label="Description">
                <textarea
                  className="min-h-[90px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]"
                  placeholder="Brief description of the school..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              {/* Classification */}
              <div className="border-t border-[var(--border-default)] pt-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
                  Classification
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="School Type">
                    <select
                      className={selectClass}
                      value={schoolType}
                      onChange={(e) => setSchoolType(e.target.value)}
                    >
                      {SCHOOL_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Country">
                    <input
                      className={inputClass}
                      placeholder="United Kingdom"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    />
                  </Field>
                  <Field label="Timezone">
                    <select
                      className={selectClass}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              {/* Limits */}
              <div className="border-t border-[var(--border-default)] pt-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
                  Limits
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Member Allocation" hint="Leave blank for unlimited.">
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      placeholder="500"
                      value={maxMembers}
                      onChange={(e) => setMaxMembers(e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              {/* Admin */}
              <div className="border-t border-[var(--border-default)] pt-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
                  Initial Admin
                </p>
                <Field label="Admin Email" required hint="This person will be set as the school admin. They can sign in immediately.">
                  <input
                    className={inputClass}
                    type="email"
                    placeholder="admin@greenfield.edu"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-3">
            <Link href="/super-admin/schools">
              <Button type="button" variant="secondary" className="cursor-pointer">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving} className="cursor-pointer">
              {saving ? "Creating..." : "Create School"}
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
