"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { RevealLine } from "../reveal-line";
import { prefersStill, useArrived, useSteps, useTyped } from "../use-motion";
import { ESSAY } from "../world";

/*
 * The file on Maya's laptop. A Word document leaves its folder and opens in
 * Spectra as itself: the first sentence is rewritten as a tracked change,
 * Spectra leaves a note in the margin, and the save lands back in the same
 * file, whose row in the folder says so. Nothing was uploaded or converted.
 */

export function Files() {
  const ref = useRef<HTMLElement>(null);
  const on = useArrived(ref);
  const [still, setStill] = useState(false);
  useEffect(() => setStill(prefersStill()), []);
  // windows → row picked → it travels → it opens → the change → the note → saved → the line
  const step = useSteps(on, [0, 900, 1500, 2300, 3200, 6000, 6800, 7600], still);
  const typed = useTyped(ESSAY.after, step >= 5, still, 26);
  const rowRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [trip, setTrip] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (step !== 3 || still) return;
    const stage = stageRef.current?.getBoundingClientRect();
    const row = rowRef.current?.getBoundingClientRect();
    const doc = docRef.current?.getBoundingClientRect();
    if (!stage || !row || !doc) return;
    setTrip({
      left: row.left - stage.left + 14,
      top: row.top - stage.top + row.height / 2 - 18,
      "--dx": `${doc.left - row.left + doc.width * 0.42}px`,
      "--dy": `${doc.top - row.top + 60}px`,
    } as CSSProperties);
    const timer = window.setTimeout(() => setTrip(null), 820);
    return () => window.clearTimeout(timer);
  }, [step, still]);

  return (
    <section ref={ref} className="sp-files" aria-label="Your Word files stay Word files">
      <div className="sp-files-line">
        <RevealLine as="h2" on={step >= 8} text="Your Word files stay Word files." className="sp-say" />
        <RevealLine as="p" on={step >= 8} text="Open it in Word tonight and in Spectra tomorrow. It's the same file, on your laptop." className="sp-say sp-say--soft" delay={5} />
      </div>
      <div ref={stageRef} className="sp-files-stage" data-on={step >= 1 || undefined}>
        <div className="sp-folder" aria-hidden data-beam>
          <div className="sp-folder-bar">
            <span className="sp-folder-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="sp-folder-path">
              {ESSAY.folder.map((part, index) => (
                <span key={part}>
                  {index ? <Icon name="chevronRight" size={12} /> : null}
                  {part}
                </span>
              ))}
            </span>
          </div>
          <div className="sp-folder-head">
            <span>Name</span>
            <span>Modified</span>
          </div>
          <div ref={rowRef} className="sp-folder-row" data-picked={(step >= 2 && step < 4) || undefined} data-saved={step >= 7 || undefined}>
            <span className="sp-docx">W</span>
            <span className="sp-folder-name">{ESSAY.file}</span>
            <span className="sp-folder-when">{step >= 7 ? "Just now" : "Yesterday, 22:41"}</span>
          </div>
          {ESSAY.others.map((other) => (
            <div key={other.name} className="sp-folder-row">
              <span className="sp-docx" data-kind={other.name.split(".").pop()}>
                {other.name.endsWith(".pdf") ? "PDF" : other.name.endsWith(".xlsx") ? "X" : "W"}
              </span>
              <span className="sp-folder-name">{other.name}</span>
              <span className="sp-folder-when">{other.when}</span>
            </div>
          ))}
          <p className="sp-folder-foot">
            <Icon name="devices" size={13} />
            On Maya&apos;s laptop
          </p>
        </div>

        <div ref={docRef} className="sp-doc" data-open={step >= 4 || undefined} aria-hidden>
          <div className="sp-doc-bar">
            <SpectraMark size={16} />
            <span className="sp-doc-file">
              <span className="sp-docx">W</span>
              {ESSAY.file}
            </span>
            <span className="sp-doc-state" data-saved={step >= 7 || undefined}>
              {step >= 7 ? (
                <>
                  <Icon name="saved" size={13} />
                  Saved to your laptop
                </>
              ) : step >= 5 ? (
                <>
                  <Icon name="edit" size={13} />
                  Suggesting
                </>
              ) : (
                "Opened from your laptop"
              )}
            </span>
          </div>
          <div className="sp-doc-body">
            <div className="sp-doc-page">
              <p className="sp-doc-title">{ESSAY.title}</p>
              <p className="sp-doc-para">
                <span className="sp-doc-old" data-struck={step >= 5 || undefined}>
                  {ESSAY.before}
                </span>
                {step >= 5 ? (
                  <span className="sp-doc-new">
                    {" "}
                    {typed}
                    {typed.length < ESSAY.after.length ? <span className="sp-caret" /> : null}
                  </span>
                ) : null}{" "}
                {ESSAY.rest}
              </p>
              <p className="sp-doc-para sp-doc-para--ghost">
                <span />
                <span />
                <span />
              </p>
            </div>
            <div className="sp-doc-margin">
              <div className="sp-comment" data-shown={step >= 6 || undefined}>
                <span className="sp-comment-who">
                  <SpectraMark size={14} />
                  Spectra
                </span>
                <p>{ESSAY.comment}</p>
              </div>
            </div>
          </div>
          <div className="sp-toast" data-shown={step >= 7 || undefined}>
            <Icon name="done" size={15} />
            Saved to {ESSAY.file}
          </div>
        </div>

        {trip ? (
          <span className="sp-trip" style={trip} aria-hidden>
            <span className="sp-docx">W</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
