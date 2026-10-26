"use client";

import { useRef } from "react";
import { SpectraMark } from "@/components/spectra-mark";
import { openWorkInSide } from "@/features/spectra/components/side-open";
import { useBuild, useSteps } from "../kit/build";
import { WORKS } from "../world/works";

/*
 * The files on Henry's laptop. Bridge links his History folder to the History
 * class: the files travel the line once, and from then on the one on the
 * desktop and the one in Spectra are the same file. Pressing the IA opens it
 * beside the page, in the real document studio.
 */

const FILES = [
  { name: "History IA - final (2).docx", kind: "doc", work: WORKS.ia._id, title: WORKS.ia.title },
  { name: "Enabling Act source pack.pdf", kind: "pdf", work: null, title: "Enabling Act source pack" },
  { name: "Wels speech notes.docx", kind: "doc", work: null, title: "Wels speech notes" },
] as const;

const DURATIONS = [1400, 1800, 700, 700, 900, 1200];

export function Computer() {
  const ref = useRef<HTMLElement>(null);
  const step = useSteps(useBuild(ref, 0.45), DURATIONS);
  const linked = step >= 2;
  const arrived = Math.max(0, Math.min(FILES.length, step - 2));

  return (
    <section ref={ref} id="computer" className="landing-section landing-computer" data-stage="computer" aria-labelledby="computer-title">
      <div className="landing-copy">
        <h2 id="computer-title" className="landing-heading">
          The files on your laptop are in it too.
        </h2>
        <p className="landing-lede">
          Spectra Bridge links a folder on your computer to its class. Nothing is uploaded twice and nothing is copied: the
          IA you open in Word is the one you open in Spectra, and a change in either is in both.
        </p>
      </div>
      <div className="landing-bridge" data-linked={linked || undefined}>
        <div className="landing-desktop" aria-label="Henry's laptop">
          <div className="landing-desktop-bar">
            <span className="landing-desktop-lights" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            Documents › School › History
          </div>
          <ul className="landing-desktop-files">
            {FILES.map((file) => (
              <li key={file.name}>
                <span className="piece-file-icon" data-kind={file.kind} aria-hidden />
                {file.name}
              </li>
            ))}
          </ul>
          <p className="landing-desktop-foot" data-on={step >= 1 || undefined}>
            <SpectraMark size={12} />
            {linked ? "Linked to History HL by Spectra Bridge" : "Linking to History HL"}
          </p>
        </div>

        <svg className="landing-bridge-line" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden>
          <path d="M0 60 C 70 60, 130 60, 200 60" />
          {FILES.map((file, index) => (
            <circle key={file.name} r="3.2" data-go={index < arrived || undefined} style={{ "--i": index } as React.CSSProperties}>
              <title>{file.name}</title>
            </circle>
          ))}
        </svg>

        <div className="landing-library" aria-label="History HL in Spectra">
          <p className="landing-library-head">
            History HL
            <span>Ms Gonzalez</span>
          </p>
          <ul className="landing-library-rows">
            {FILES.map((file, index) => (
              <li key={file.name} data-here={index < arrived || undefined}>
                {file.work ? (
                  <button type="button" onClick={() => openWorkInSide(file.work!)} tabIndex={index < arrived ? 0 : -1}>
                    <span className="piece-file-icon" data-kind={file.kind} aria-hidden />
                    <span className="landing-library-title">{file.title}</span>
                    <span className="landing-library-where">On Henry&rsquo;s laptop</span>
                  </button>
                ) : (
                  <span className="landing-library-row">
                    <span className="piece-file-icon" data-kind={file.kind} aria-hidden />
                    <span className="landing-library-title">{file.title}</span>
                    <span className="landing-library-where">On Henry&rsquo;s laptop</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {arrived === FILES.length ? <p className="landing-library-hint">Press the IA to open it beside the page.</p> : null}
        </div>
      </div>
    </section>
  );
}
