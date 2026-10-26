"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { workTypeMeta } from "@/features/spectra/artifacts/presentation";
import { useBuild } from "../kit/build";
import { editorIn, findText, markText, replaceText, waitForEditor } from "../kit/doc-hand";
import { InlineStudio } from "../kit/inline-studio";
import { typeIntoIsland } from "../kit/landing-island";
import { Surface, usePresence, type Move } from "../kit/presence";
import { useWorld, useWorldEvent } from "../kit/world-context";
import type { CastId } from "../world/story";
import { WORKS } from "../world/works";

/*
 * The IA from Henry's laptop, open in the real document studio. Henry asks
 * for it to be tidied; his AI picks out what matters and rewords the paragraph
 * Ms Gonzalez commented on, in the document, as a collaborator's edits arrive.
 * Then she is in it too, from her own class, which is linked into his.
 */

const QUESTION = "tidy up my IA and make the second source paragraph read better";
const OLD = "Its value is that it was spoken by an opponent in the room, at the time, knowing the risk.";
const NEW = "Its value lies in its origin: Wels spoke for the SPD in the Reichstag on 23 March 1933, minutes before the vote, knowing what opposing it could cost.";

const SHARED = ["Source pack: the Enabling Act", "Rubric: source analysis", "Paper 1 practice: the Reichstag Fire"];

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    });
  });

export function Together() {
  const ref = useRef<HTMLElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const build = useBuild(ref, 0.45);
  const world = useWorld();
  const presence = usePresence("together");
  const [tidied, setTidied] = useState(false);
  const [joined, setJoined] = useState(false);
  const asked = useRef(false);
  const reads = useRef(0);
  const playing = useRef<AbortController | null>(null);
  const { move, leave } = presence;

  /** Points a collaborator at `text` in the document, as a selection the presence layer draws. */
  const pointAt = useCallback(
    (who: CastId, text: string, extra: Partial<Move> = {}) => {
      const editor = editorIn(studioRef.current);
      const range = editor ? findText(editor, text) : null;
      if (!range?.blockId) return;
      move(who, {
        path: `/blocks/${range.blockId}`,
        primitive: "richtext",
        act: { kind: "select", span: { anchor: { offset: range.offset }, head: { offset: range.offset + text.length } } },
        ...extra,
      });
    },
    [move],
  );

  const tidy = useCallback(async () => {
    if (playing.current) return;
    const controller = new AbortController();
    playing.current = controller;
    const { signal } = controller;
    try {
      const editor = await waitForEditor(() => studioRef.current, signal);
      pointAt("henryAi", "444 votes to 94", { note: "Bold" });
      await wait(900, signal);
      markText(editor, "444 votes to 94", "bold");
      await wait(1100, signal);
      pointAt("henryAi", "Kroll Opera House", { note: "Italic" });
      await wait(900, signal);
      markText(editor, "Kroll Opera House", "italic");
      await wait(1100, signal);
      pointAt("henryAi", OLD, { note: "Rewording" });
      await wait(1400, signal);
      replaceText(editor, OLD, NEW);
      pointAt("henryAi", NEW, { note: "Reworded" });
      setTidied(true);
      await wait(2200, signal);
      leave("henryAi");
      // Ms Gonzalez comes in from her class to see whether her comment was taken.
      await wait(900, signal);
      setJoined(true);
      pointAt("gonzalez", "23 March 1933", { note: "That's the date. Well done." });
    } catch {
      // The visitor left the section mid-edit; the document keeps what was done.
    }
  }, [leave, pointAt]);

  useWorldEvent((event) => {
    if (event.type === "run_started" && event.reply.key === "tidy") reads.current = 0;
    if (event.type === "reading" && event.workId === WORKS.ia._id && ++reads.current === 3) void tidy();
  });

  useEffect(() => {
    if (!build.started || asked.current) return;
    asked.current = true;
    if (build.skipped) {
      setJoined(true);
      void tidy();
      return;
    }
    void world.whenIdle().then(() => typeIntoIsland(QUESTION, { fresh: true, perLetter: 34 }));
  }, [build.skipped, build.started, tidy, world]);

  useEffect(() => () => playing.current?.abort(), []);

  return (
    <section ref={ref} id="together" className="landing-section landing-together" data-stage="together" data-island="on" aria-labelledby="together-title">
      <div className="landing-copy">
        <h2 id="together-title" className="landing-heading">
          It works on your document with you, and so can your teacher.
        </h2>
        <p className="landing-lede">
          Spectra edits the way you would: a heading, a word in bold, a paragraph said better, in your own file. Ms
          Gonzalez&rsquo;s class is linked into Henry&rsquo;s, so she is one click from his draft, and they see each other
          working.
        </p>
      </div>
      <div className="landing-together-stage">
        <Surface id="together" states={presence.states} className="landing-together-doc">
          <div ref={studioRef} data-tidied={tidied || undefined}>
            <InlineStudio work={WORKS.ia} instanceKey="landing-together-ia" className="landing-studio landing-studio-tall" />
          </div>
        </Surface>
        <aside className="landing-linked" data-joined={joined || undefined} aria-label="Ms Gonzalez's class, linked">
          <p className="landing-linked-head">
            <span>History HL</span>
            Linked to Ms Gonzalez&rsquo;s class
          </p>
          <ul>
            {SHARED.map((title) => (
              <li key={title}>
                <Icon name={workTypeMeta.document.glyph} size={13} />
                {title}
              </li>
            ))}
          </ul>
          <p className="landing-linked-foot">Her classes come from ManageBac. More school systems are on the way.</p>
        </aside>
      </div>
    </section>
  );
}
