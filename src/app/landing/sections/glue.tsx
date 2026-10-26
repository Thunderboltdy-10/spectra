"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { AppWindow } from "../kit/app-window";
import { useScrub } from "../kit/build";
import { LibraryView } from "../kit/library-view";
import { Surface, usePresence } from "../kit/presence";
import { SceneHead } from "../kit/scene-head";
import { dayAt } from "../world/story";
import { ESSAYS, GluePage, type GlueKind } from "./glue-pages";

/*
 * The evening as it is now, played by the scroll while the page holds still.
 * Henry's tabs open one after another until their titles are too narrow to
 * read; he goes back to his files and the essay is there four times. Then his
 * AI presses the strip, the tabs fold into one, and the one is Spectra.
 */

const TABS: Array<{ title: string; hue: string; kind: GlueKind }> = [
  { title: "Tasks · School portal", hue: "#3d7fd1", kind: "portal" },
  { title: "School stuff · Cloud files", hue: "#2f9e6e", kind: "files" },
  { title: "Inbox (214)", hue: "#c9483b", kind: "inbox" },
  { title: "DP1 Bio", hue: "#3aa35b", kind: "group" },
  { title: "AI chat · New chat", hue: "#7a6a5c", kind: "bot" },
  { title: "History IA - final (2).docx", hue: "#2b5fb4", kind: "docx" },
  { title: "Week view · Calendar", hue: "#2e8fd4", kind: "week" },
  { title: "Flashcards: cell resp…", hue: "#d89a28", kind: "flash" },
  { title: "Untitled presentation", hue: "#e0a020", kind: "slides" },
  { title: "ch7_respiration_scan.pdf", hue: "#c43c3c", kind: "pdf" },
  { title: "rubric_v3_USE_THIS.pdf", hue: "#c43c3c", kind: "rubric" },
  { title: "Timer · 25:00", hue: "#5d5850", kind: "timer" },
];

/* The scroll marks: a tab each, back to the files, three more essays, the
   note, the press, the fold, the Library. */
const TAB_MARKS = TABS.map((_, index) => 0.02 + index * 0.03);
const BACK = 0.39;
const ESSAY_MARKS = [0.43, 0.47, 0.51];
const NOTE = 0.55;
const PRESS = 0.6;
const FOLD = 0.65;
const SETTLED = 0.72;
const MARKS = [...TAB_MARKS, BACK, ...ESSAY_MARKS, NOTE, PRESS, FOLD, SETTLED];

const AT = dayAt(0, 21, 41);

export function Glue() {
  const ref = useRef<HTMLElement>(null);
  const { step } = useScrub(ref, MARKS);
  const presence = usePresence("glue");

  const tabs = Math.max(1, Math.min(TABS.length, step));
  const back = step > TABS.length;
  const essays = back ? 1 + Math.min(ESSAY_MARKS.length, step - TABS.length - 1) : 1;
  const pressing = step >= TABS.length + 1 + ESSAY_MARKS.length + 2;
  const folded = step >= MARKS.length - 1;
  const settled = step >= MARKS.length;
  const active = back ? 1 : tabs - 1;

  const { move, leave } = presence;
  useEffect(() => {
    if (pressing && !settled) move("henryAi", { path: "glue/tabs", primitive: "viewSwitch", act: { kind: "press" }, label: "Tabs", note: "Putting it all in one place" });
    else leave("henryAi");
  }, [leave, move, pressing, settled]);

  return (
    <section
      ref={ref}
      data-stage="glue"
      data-island="on"
      className="landing-scene landing-glue"
      aria-labelledby="glue-title"
      data-folded={folded || undefined}
    >
      <div className="landing-scene-pin">
        <SceneHead
          id="glue-title"
          at={AT}
          className="landing-glue-head"
          title={
            <span className="landing-swap" data-to={folded ? "b" : "a"}>
              <span data-line="a">Twelve tabs, four copies of one essay, and you are the glue.</span>
              <span data-line="b">One tab. Everything in it.</span>
            </span>
          }
        />
        <Surface id="glue" states={presence.states} className="landing-glue-stage">
          <div className="landing-browser" data-folded={folded || undefined}>
            <div className="landing-browser-top">
              <span className="landing-browser-lights" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <div className="landing-browser-tabs" {...targetAttrs("glue/tabs", undefined, "viewSwitch")}>
                {folded ? (
                  <span className="landing-browser-tab" data-active data-one>
                    <SpectraMark size={13} />
                    <span>Library · Spectra</span>
                  </span>
                ) : (
                  TABS.slice(0, tabs).map((tab, index) => (
                    <span key={tab.title} className="landing-browser-tab" data-active={index === active || undefined}>
                      <span className="landing-browser-favicon" style={{ background: tab.hue }} aria-hidden />
                      <span>{tab.title}</span>
                    </span>
                  ))
                )}
                <span className="landing-browser-new" aria-hidden>
                  <Icon name="add" size={13} />
                </span>
              </div>
            </div>
            <div className="landing-browser-bar">
              <span className="landing-browser-nav" aria-hidden>
                <Icon name="arrowLeft" size={14} />
                <Icon name="arrowRight" size={14} />
              </span>
              <span className="landing-browser-address">{folded ? "Spectra  /  Library" : TABS[active]!.title}</span>
            </div>
            <div className="landing-browser-page">
              {folded ? (
                <AppWindow at="library" threads={["What's due this week", "Respiration, simply", "IA second source"]} label="Henry's Library in Spectra" className="landing-glue-app">
                  <LibraryView />
                </AppWindow>
              ) : (
                <GluePage key={TABS[active]!.kind} kind={TABS[active]!.kind} essays={essays} />
              )}
            </div>
          </div>
        </Surface>
        <p className="landing-scene-hint" data-hidden={step > 2 || undefined} aria-hidden>
          Keep scrolling
        </p>
      </div>
    </section>
  );
}
