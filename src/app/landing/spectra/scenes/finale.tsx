"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { LivePrism } from "../prism";
import { RevealLine } from "../reveal-line";
import { useArrived } from "../use-motion";

/*
 * Where the light ends: back in the prism, now large, with the one thing to
 * do next. A student can pass Spectra to a teacher with a note written for
 * them; it is copied or opened in their own email, and Spectra sends nothing.
 */

export function noteFor(origin: string) {
  return `Hi! I've been looking at Spectra. It keeps our classes, notes and files in one place, connects to ManageBac, and helps with revision and assignments. I think it could really help our class. Could you take a look? ${origin}`;
}

export function Finale() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref, "0px 0px -20% 0px");
  const [note, setNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("https://spectra.school");
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
    <section ref={ref} className="sp-finale" data-on={on || undefined} aria-labelledby="sp-finale-title">
      <div className="sp-finale-light" aria-hidden />
      <div className="sp-finale-prism" data-beam>
        <LivePrism width="clamp(220px, 26vw, 380px)" mode={on ? "done" : "rest"} turns={on ? 1 : 0} interactive label="Spectra's prism. Drag it to spin it." />
      </div>
      <h2 id="sp-finale-title" className="sp-finale-title">
        <RevealLine as="span" on={on} text="Bring Spectra to your school." />
      </h2>
      <div className="sp-finale-actions">
        <Link href="/contact" className="landing-button" data-tone="primary">
          Talk to us
        </Link>
        <button type="button" className="landing-button" aria-expanded={note} onClick={() => setNote((current) => !current)}>
          <Icon name="mail" size={16} />
          Send it to a teacher
        </button>
      </div>
      <div className="sp-note" data-open={note || undefined} aria-hidden={!note}>
        <div className="sp-note-card">
          <p className="sp-note-label">A note for your teacher</p>
          <p className="sp-note-text">{text}</p>
          <div className="sp-note-actions">
            <button type="button" className="landing-button" data-size="compact" onClick={copy} tabIndex={note ? 0 : -1}>
              <Icon name={copied ? "check" : "copy"} size={14} />
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              className="landing-button"
              data-size="compact"
              data-tone="quiet"
              tabIndex={note ? 0 : -1}
              href={`mailto:?subject=${encodeURIComponent("Could our class try Spectra?")}&body=${encodeURIComponent(text)}`}
            >
              <Icon name="mail" size={14} />
              Open in email
            </a>
          </div>
        </div>
      </div>
      <p className="sp-finale-signin">
        Already using Spectra? <Link href="/sign-in">Sign in</Link>
      </p>
      <footer className="sp-footer">
        <span className="sp-footer-brand">Spectra</span>
        <nav aria-label="Legal">
          <Link href="/contact">Contact</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </footer>
    </section>
  );
}
