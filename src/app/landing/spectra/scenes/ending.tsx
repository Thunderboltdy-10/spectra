"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { useNear } from "../../kit/build";
import { Written } from "../../kit/written";
import { dimAll, shine } from "../light/light";

/*
 * The end of the page, and the one place a visitor sends anything. A school
 * asks for a walkthrough here; a student, who cannot bring Spectra in alone,
 * gets a note to pass to a teacher instead, sent from their own email. The
 * request goes to /api/contact, which guards itself (a field only bots fill,
 * a minimum time, rate limits) and keeps one request per address for the
 * platform team. Every colour of the page meets here.
 */

type Role = "student" | "teacher" | "leader" | "it";

const ROLES: { id: Role; label: string }[] = [
  { id: "student", label: "Student" },
  { id: "teacher", label: "Teacher" },
  { id: "leader", label: "School leader" },
  { id: "it", label: "IT" },
];

const PLACEHOLDER: Record<Exclude<Role, "student">, string> = {
  teacher: "Which classes you teach, and what you'd like to see",
  leader: "How many students, and what you'd like to know",
  it: "Anything you need to check before a pilot",
};

const WHAT_HAPPENS = [
  {
    title: "A walkthrough on classes like yours",
    text: "Home, the morning brief, the editors and Bridge, with your subjects in them.",
  },
  {
    title: "Answers for IT and safeguarding",
    text: "What Spectra can see, where data lives, and what your school controls.",
  },
  {
    title: "Set up on ManageBac",
    text: "Classes, tasks and teachers arrive by themselves on the first day.",
  },
];

export function noteFor(origin: string) {
  return `Hi! I've been looking at Spectra. It keeps our classes, notes and files in one place, connects to ManageBac, and helps with revision and assignments. I think it could really help our class. Could you take a look? ${origin}`;
}

type Sending =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; email: string }
  | { state: "failed"; message: string };

export function Ending() {
  const sectionRef = useRef<HTMLElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const arrived = useNear(sectionRef, "0px 0px -35% 0px");
  const [role, setRole] = useState<Role>("teacher");

  // Every colour on the page gathers behind the last line.
  useEffect(() => {
    const line = lineRef.current;
    if (!arrived || !line) return;
    shine("ending-line", {
      el: line,
      at: [0.5, 0.55],
      rx: 760,
      ry: 260,
      strength: 0.62,
      hues: [0, 6.8],
      flow: 0.9,
      ease: 1600,
    });
    return () => dimAll("ending");
  }, [arrived]);

  return (
    <section
      ref={sectionRef}
      id="talk"
      className="sp-scene sp-ending"
      data-seen={arrived ? "" : undefined}
      aria-labelledby="sp-ending-title"
    >
      <div ref={lineRef}>
        <Written
          id="sp-ending-title"
          className="sp-ending-line"
          text={"Bring Spectra\nto your school."}
        />
      </div>

      <div className="sp-talk">
        <div className="sp-talk-copy">
          <p className="sp-lede">
            We show Spectra on classes like yours, and answer what your teachers
            and IT team will ask.
          </p>
          <ul className="sp-talk-what">
            {WHAT_HAPPENS.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="sp-talk-sheet">
          <fieldset className="sp-talk-roles">
            <legend>I&rsquo;m a</legend>
            <div
              className="sp-talk-switch"
              role="radiogroup"
              aria-label="I'm a"
            >
              {ROLES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={role === entry.id}
                  onClick={() => setRole(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </fieldset>
          {role === "student" ? <StudentNote /> : <Walkthrough role={role} />}
        </div>
      </div>

      <footer className="sp-footer">
        <span className="sp-footer-brand">
          <SpectraMark size={18} />
          Spectra
        </span>
        <nav aria-label="Legal">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </footer>
    </section>
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
    <div className="sp-talk-student">
      <p className="sp-talk-hint">
        Spectra comes to students through their school. Pass this to a teacher
        you trust: it goes from your own email, and Spectra sends nothing.
      </p>
      <p className="sp-talk-note">{text}</p>
      <div className="sp-talk-actions">
        <button
          type="button"
          className="landing-button"
          data-tone="primary"
          onClick={copy}
        >
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? "Copied" : "Copy the note"}
        </button>
        <a
          className="landing-button"
          href={`mailto:?subject=${encodeURIComponent("Could our class try Spectra?")}&body=${encodeURIComponent(text)}`}
        >
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
          role: ROLES.find((entry) => entry.id === role)!.label,
          message: note,
          usesManageBac: managebac,
          website: value("website"),
          elapsedMs: Date.now() - opened.current,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setSending({
          state: "failed",
          message: result.error ?? "The request didn't go through. Try again.",
        });
        return;
      }
      setSending({ state: "sent", email });
    } catch {
      setSending({
        state: "failed",
        message:
          "The request didn't go through. Check your connection, then try again.",
      });
    }
  };

  if (sending.state === "sent") {
    return (
      <div className="sp-talk-sent" role="status">
        <p className="sp-talk-sent-title">Request sent.</p>
        <p className="sp-talk-hint">
          We&rsquo;ll write to {sending.email} to find a time that suits your
          school.
        </p>
      </div>
    );
  }

  return (
    <form className="sp-talk-form" onSubmit={submit}>
      <div className="sp-talk-row">
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
      <button
        type="button"
        className="sp-talk-toggle"
        role="switch"
        aria-checked={managebac}
        onClick={() => setManagebac((current) => !current)}
      >
        <span className="sp-talk-toggle-track" aria-hidden>
          <span />
        </span>
        Our school uses ManageBac
      </button>
      <label className="sp-field">
        <span>Anything we should know (optional)</span>
        <textarea name="message" rows={3} placeholder={PLACEHOLDER[role]} />
      </label>
      {/* Only bots fill this in. */}
      <label className="sp-talk-trap" aria-hidden>
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {sending.state === "failed" ? (
        <p className="sp-talk-error" role="alert">
          {sending.message}
        </p>
      ) : null}
      <div className="sp-talk-submit">
        <button
          type="submit"
          className="landing-button"
          data-tone="primary"
          disabled={sending.state === "sending"}
        >
          {sending.state === "sending" ? (
            <Icon name="working" size={15} animate />
          ) : null}
          {sending.state === "sending" ? "Sending" : "Ask for a walkthrough"}
        </button>
        <span className="sp-talk-fine">
          We use these details only to reply.{" "}
          <Link href="/legal/privacy">Privacy</Link>
        </span>
      </div>
    </form>
  );
}
