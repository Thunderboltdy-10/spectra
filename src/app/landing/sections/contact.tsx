"use client";

import { useState } from "react";

/**
 * Contact (Phase 15.5): the one real backend interaction on the page.
 */
export function ContactSection() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    school: "",
    role: "",
    message: "",
  });
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "fallback" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as {
        status?: string;
        mailto?: string;
        error?: string | { message?: string };
      };
      if (data.status === "sent") {
        setStatus("sent");
      } else if (data.status === "fallback" && data.mailto) {
        setFallbackUrl(data.mailto);
        setStatus("fallback");
      } else {
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Something went wrong.";
        setErrorMsg(errMsg);
        setStatus("error");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <section
      id="contact"
      className="py-24"
      style={{ background: "var(--bg-secondary)" }}
    >
      <div className="mx-auto max-w-xl px-6">
        <div className="mb-10 text-center" data-reveal>
          <h2 className="text-[clamp(1.6rem,3vw,2.25rem)] font-bold tracking-[-0.015em]">
            Get in touch
          </h2>
          <p className="mt-2 text-[14.5px] text-[var(--text-secondary)]">
            Want to bring Spectra to your school? Questions about specialists or
            pilots? We&apos;d love to hear from you.
          </p>
        </div>

        {status === "sent" ? (
          <div className="py-12 text-center" data-reveal>
            <p className="text-xl font-bold">Thanks for reaching out.</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              We&apos;ll get back to you soon.
            </p>
          </div>
        ) : status === "fallback" ? (
          <div className="py-12 text-center" data-reveal>
            <p className="text-xl font-bold">Almost there</p>
            <p className="mb-4 mt-2 text-sm text-[var(--text-secondary)]">
              Click below to send your message via email.
            </p>
            <a
              href={fallbackUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 py-3 text-sm font-bold text-white"
            >
              Open email client
            </a>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4"
            data-reveal
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-secondary)]">
                  Name *
                </span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
                  placeholder="Ada Lovelace"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-secondary)]">
                  Email *
                </span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
                  placeholder="ada@school.org"
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-secondary)]">
                  School / Institution
                </span>
                <input
                  value={form.school}
                  onChange={(e) => setForm({ ...form, school: e.target.value })}
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
                  placeholder="Riverside High"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-secondary)]">
                  Role
                </span>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand-primary)]"
                  style={{
                    color: form.role
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                  }}
                >
                  <option value="">Choose…</option>
                  <option value="Student">Student</option>
                  <option value="Teacher">Teacher</option>
                  <option value="Administrator">Administrator</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-secondary)]">
                Message *
              </span>
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={4}
                className="w-full resize-none rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
                placeholder="Tell us about your school and what you'd like to pilot."
              />
            </label>
            {status === "error" && errorMsg ? (
              <p className="text-sm text-[var(--danger)]">
                {errorMsg} — check the fields and try again.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-xl bg-[var(--brand-primary)] px-6 py-3.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
              style={{
                boxShadow:
                  "0 4px 16px color-mix(in oklab, var(--brand-primary) 25%, transparent)",
              }}
            >
              {status === "sending" ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
