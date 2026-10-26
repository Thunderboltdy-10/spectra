"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Backdrop } from "@/app/landing/spectra/backdrop";
import { LivePrism } from "@/app/landing/spectra/prism";
import { noteFor } from "@/app/landing/spectra/scenes/finale";
import { Header } from "@/app/landing/spectra/spectra-page";

/*
 * The one place on the site where a visitor sends anything. A school asks
 * for a walkthrough; a student, who cannot bring Spectra in alone, gets a
 * note to pass to a teacher instead. The request goes to /api/contact, which
 * guards itself (a field only bots fill, a minimum time, rate limits).
 */

type Role = "student" | "teacher" | "leader" | "it";

const ROLES: { id: Role; label: string }[] = [
  { id: "student", label: "Student" },
  { id: "teacher", label: "Teacher" },
  { id: "leader", label: "School leader" },
  { id: "it", label: "IT" },
];

const ROLE_NAMES: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  leader: "School leader",
  it: "IT",
};

const WHAT_HAPPENS: { glyph: IconName; title: string; text: string }[] = [
  { glyph: "school", title: "A walkthrough with your classes", text: "We show Spectra on a school like yours, from Home to the morning letter." },
  { glyph: "shield", title: "Answers for IT and safeguarding", text: "What Spectra can see, where data lives, and what you control." },
  { glyph: "people", title: "Set up on ManageBac", text: "Classes, tasks and teachers arrive by themselves on day one." },
];

const PLACEHOLDER: Record<Exclude<Role, "student">, string> = {
  teacher: "Which classes you teach, and what you'd like to see",
  leader: "How many students, and what you'd like to know",
  it: "Anything you need to check before a pilot",
};

type Sending = { state: "idle" } | { state: "sending" } | { state: "sent"; email: string } | { state: "failed"; message: string };

export function ContactClient() {
  const [role, setRole] = useState<Role>("teacher");
  return (
    <div className="sp-page sp-contact-page">
      <Backdrop />
      <Header />
      <main className="sp-contact">
        <section className="sp-contact-statement">
          <LivePrism width="clamp(120px, 12vw, 170px)" interactive label="Spectra's prism. Drag it to spin it." />
          <h1 className="sp-contact-title">Tell us about your school.</h1>
          <p className="sp-contact-lede">We&apos;ll show you Spectra with classes like yours and answer what your teachers and IT team will ask. There&apos;s no price list; every school starts with a conversation.</p>
          <ul className="sp-contact-what">
            {WHAT_HAPPENS.map((item) => (
              <li key={item.title}>
                <Icon name={item.glyph} size={18} />
                <span>
                  <strong>{item.title}</strong>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sp-contact-sheet" aria-label="Contact Spectra">
          <span className="sp-contact-tab">
            <Icon name="mail" size={14} />
            {role === "student" ? "A note for your teacher" : "Walkthrough"}
          </span>
          <div className="sp-contact-face">
            <fieldset className="sp-contact-roles">
              <legend>I&apos;m a</legend>
              <div className="sp-contact-switch" role="radiogroup">
                {ROLES.map((entry) => (
                  <button key={entry.id} type="button" role="radio" aria-checked={role === entry.id} data-on={role === entry.id || undefined} onClick={() => setRole(entry.id)}>
                    {entry.label}
                  </button>
                ))}
              </div>
            </fieldset>
            {role === "student" ? <StudentNote /> : <Walkthrough role={role} />}
          </div>
        </section>
      </main>
      <footer className="sp-footer sp-contact-footer">
        <Link href="/" className="sp-footer-brand">
          Spectra
        </Link>
        <nav aria-label="Legal">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </footer>
    </div>
  );
}

function StudentNote() {
  const [origin, setOrigin] = useState("https://spectra.school");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const text = noteFor(origin);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="sp-contact-student">
      <p className="sp-contact-hint">Spectra comes to students through their school. Pass this to a teacher you trust; it goes from your own email, and Spectra sends nothing.</p>
      <p className="sp-note-text">{text}</p>
      <div className="sp-note-actions">
        <button type="button" className="landing-button" data-tone="primary" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? "Copied" : "Copy the note"}
        </button>
        <a className="landing-button" href={`mailto:?subject=${encodeURIComponent("Could our class try Spectra?")}&body=${encodeURIComponent(text)}`}>
          <Icon name="mail" size={15} />
          Open in email
        </a>
      </div>
    </div>
  );
}

function Walkthrough({ role }: { role: Exclude<Role, "student"> }) {
  const opened = useRef(Date.now());
  const [sending, setSending] = useState<Sending>({ state: "idle" });
  const [managebac, setManagebac] = useState(true);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    const email = value("email").trim();
    const note = value("message").trim();
    setSending({ state: "sending" });
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "walkthrough",
          name: value("name"),
          email,
          school: value("school"),
          role: ROLE_NAMES[role],
          message: [`Uses ManageBac: ${managebac ? "yes" : "no"}`, note].filter(Boolean).join("\n\n"),
          website: value("website"),
          elapsedMs: Date.now() - opened.current,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSending({ state: "failed", message: result.error ?? "The request did not go through. Please try again." });
        return;
      }
      setSending({ state: "sent", email });
    } catch {
      setSending({ state: "failed", message: "The request did not go through. Check your connection and try again." });
    }
  };

  if (sending.state === "sent") {
    return (
      <div className="sp-contact-sent" role="status">
        <LivePrism width="64px" mode="done" turns={1} />
        <p className="sp-contact-sent-title">Request sent.</p>
        <p className="sp-contact-hint">We&apos;ll write back to {sending.email} to find a time that suits your school.</p>
        <Link href="/" className="landing-button">
          Back to Spectra
        </Link>
      </div>
    );
  }

  return (
    <form className="sp-contact-form" onSubmit={submit}>
      <div className="sp-contact-row">
        <label className="sp-field">
          <span>Your name</span>
          <input name="name" autoComplete="name" required />
        </label>
        <label className="sp-field">
          <span>School email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
      </div>
      <label className="sp-field">
        <span>School</span>
        <input name="school" autoComplete="organization" required />
      </label>
      <button type="button" className="sp-contact-toggle" role="switch" aria-checked={managebac} onClick={() => setManagebac((current) => !current)}>
        <span className="sp-contact-toggle-track" data-on={managebac || undefined}>
          <span />
        </span>
        Our school uses ManageBac
      </button>
      <label className="sp-field">
        <span>Anything we should know (optional)</span>
        <textarea name="message" rows={4} placeholder={PLACEHOLDER[role]} />
      </label>
      {/* Only bots fill this in. */}
      <label className="sp-contact-trap" aria-hidden>
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {sending.state === "failed" ? (
        <p className="sp-contact-error" role="alert">
          {sending.message}
        </p>
      ) : null}
      <div className="sp-contact-submit">
        <button type="submit" className="landing-button" data-tone="primary" disabled={sending.state === "sending"}>
          {sending.state === "sending" ? <Icon name="working" size={15} animate /> : null}
          {sending.state === "sending" ? "Sending" : "Ask for a walkthrough"}
        </button>
        <span className="sp-contact-fine">
          We use these details only to reply. <Link href="/legal/privacy">Privacy</Link>
        </span>
      </div>
    </form>
  );
}
