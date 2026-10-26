"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { SpectraLogo } from "@/components/spectra-logo";

/*
 * The door. Schools start with a walkthrough on their own classes, so the
 * page ends by asking for one, a real request that reaches the team. A
 * student can't buy Spectra, so they can show it to a teacher instead.
 */

type Sent = { state: "idle" } | { state: "sending" } | { state: "sent" } | { state: "failed"; message: string };

const ROLES = ["Teacher", "School leader", "IT or admin", "Student", "Parent"];

export function Door() {
  const [sent, setSent] = useState<Sent>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  const openedAt = useRef(Date.now());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSent({ state: "sending" });
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "walkthrough",
          name: form.get("name"),
          email: form.get("email"),
          school: form.get("school"),
          role: form.get("role"),
          message: form.get("message"),
          website: form.get("website"),
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The request did not go through.");
      setSent({ state: "sent" });
    } catch (error) {
      setSent({ state: "failed", message: error instanceof Error ? error.message : "The request did not go through." });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/landing`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  /** Opens the visitor's own mail app with a note to a teacher; nothing is sent from here. */
  function emailTeacher() {
    const link = `${window.location.origin}/landing`;
    const body = `I found Spectra, one place for schoolwork that works with ManageBac. Could our class try it?

${link}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("Could our class try Spectra?")}&body=${encodeURIComponent(body)}`;
  }

  return (
    <section id="door" className="landing-section landing-door" data-stage="door" data-island="on" data-rail="off" aria-labelledby="door-title">
      <div className="landing-door-inner">
        <div className="landing-copy">
          <h2 id="door-title" className="landing-heading">
            See it with your own classes.
          </h2>
          <p className="landing-lede">
            Schools start with a walkthrough on their own ManageBac classes. Tell us where you teach or study and we will
            write back to arrange one.
          </p>
          <div className="landing-door-student">
            <p>A student? Spectra comes through your school, so show it to a teacher.</p>
            <div className="landing-door-share">
              <button type="button" className="landing-button" onClick={emailTeacher}>
                Email this page to a teacher
              </button>
              <button type="button" className="landing-button" data-tone="quiet" onClick={() => void copyLink()}>
                {copied ? "Link copied" : "Copy the link"}
              </button>
            </div>
          </div>
        </div>

        {sent.state === "sent" ? (
          <div className="landing-form landing-form-sent" role="status">
            <h3>Request sent.</h3>
            <p>We will write back within two school days to find a time.</p>
          </div>
        ) : (
          <form className="landing-form" onSubmit={(event) => void submit(event)} aria-label="Ask for a walkthrough">
            <label>
              Your name
              <input name="name" required maxLength={200} autoComplete="name" />
            </label>
            <label>
              School email
              <input name="email" type="email" required maxLength={320} autoComplete="email" />
            </label>
            <label>
              School
              <input name="school" required maxLength={300} autoComplete="organization" />
            </label>
            <label>
              You are
              <select name="role" defaultValue="Teacher">
                {ROLES.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label className="landing-form-wide">
              Anything we should know <span>(optional)</span>
              <textarea name="message" rows={3} maxLength={2000} placeholder="How many classes, which subjects, when you would like to start" />
            </label>
            {/* Left empty by people; filled by bots. */}
            <label className="landing-form-trap" aria-hidden>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <div className="landing-form-foot">
              <button type="submit" className="landing-button" data-tone="primary" disabled={sent.state === "sending"}>
                {sent.state === "sending" ? "Sending" : "Ask for a walkthrough"}
              </button>
              {sent.state === "failed" ? (
                <p className="landing-form-error" role="alert">
                  {sent.message}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </div>

      <footer className="landing-footer">
        <span className="landing-footer-brand">
          <SpectraLogo size={18} />
          Spectra
        </span>
        <nav aria-label="Footer">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
        </nav>
      </footer>
    </section>
  );
}
