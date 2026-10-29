"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";

/*
 * Spectra as it is on Henry's screen: the desk, the rail with its
 * destinations and his recent threads, and the page as a sheet of paper on
 * the desk. The rail is collapsed to its glyphs so the page has the room,
 * and opens over the page (never pushing it) while the pointer is on it. The page inside is whatever the story is showing, usually the
 * app's own component. It is a picture of the shell, not the shell: a
 * destination, a thread or the account in the rail asks the visitor to sign
 * in to their own.
 */

export type RailPlace =
  "home" | "library" | "calendar" | "school" | "agents" | "devices";

const PLACES: Array<{ key: RailPlace; label: string; glyph: IconName }> = [
  { key: "home", label: "Home", glyph: "home" },
  { key: "library", label: "Library", glyph: "library" },
  { key: "calendar", label: "Calendar", glyph: "calendar" },
  { key: "school", label: "School", glyph: "school" },
  { key: "agents", label: "Agents", glyph: "agents" },
  { key: "devices", label: "Devices", glyph: "devices" },
];

export function AppWindow({
  at,
  threads = [],
  who = "Henry",
  rail = "slim",
  className,
  children,
  label,
}: {
  /** The destination open in the rail. */
  at: RailPlace;
  /** Recent threads under the destinations, newest first. */
  threads?: string[];
  /** Whose Spectra it is, for the account line. */
  who?: string;
  /** "slim" keeps only the glyphs until the pointer opens it; "full" holds it open; "none" shows the page alone. */
  rail?: "full" | "slim" | "none";
  className?: string;
  children: ReactNode;
  /** What the window shows, for assistive technology. */
  label: string;
}) {
  return (
    <figure
      className={className ? `landing-window ${className}` : "landing-window"}
      data-rail={rail}
      aria-label={label}
    >
      {rail === "none" ? null : (
      <aside className="landing-window-rail" aria-hidden>
        <div className="landing-window-brand">
          <SpectraMark size={20} />
          <span>Spectra</span>
        </div>
        <ul className="landing-window-places">
          {PLACES.map((place) => (
            <li key={place.key} data-current={place.key === at || undefined}>
              <Link
                href="/sign-in"
                tabIndex={-1}
                title={`Sign in to open your ${place.label}`}
              >
                <Icon name={place.glyph} size={17} />
                <span>{place.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        {threads.length ? (
          <div className="landing-window-threads">
            <p>Threads</p>
            <ul>
              {threads.map((thread) => (
                <li key={thread}>
                  <Link
                    href="/sign-in"
                    tabIndex={-1}
                    title="Sign in to see your threads"
                  >
                    <span className="landing-window-thread-mark" />
                    <span>{thread}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="landing-window-account">
          <span className="landing-window-face">
            <Icon name="identity" size={14} />
          </span>
          <span>{who}</span>
        </div>
      </aside>
      )}
      <div className="landing-window-sheet">{children}</div>
    </figure>
  );
}
