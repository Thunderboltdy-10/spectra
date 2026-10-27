"use client";

import { useCallback, useEffect, useRef } from "react";
import { editorIn, findText, markText, replaceText, waitForEditor } from "../../kit/doc-hand";
import { InlineStudio } from "../../kit/inline-studio";
import { typeIntoIsland } from "../../kit/landing-island";
import { Surface, usePresence, type Move } from "../../kit/presence";
import { useWorld, useWorldEvent } from "../../kit/world-context";
import type { CastId } from "../../world/story";
import { WORKS } from "../../world/works";
import { useScene } from "../director";
import { dimAll, flash, shine } from "../light/light";

/*
 * Henry's History IA in the real document studio, with Ms Gonzalez's comment
 * on it. He asks for it to be tidied; his AI does it in the document, the way
 * a collaborator's edits arrive: the vote count picked out, the setting in
 * italics, the paragraph she commented on said better. Then she is in it too,
 * from her own class, and sees her comment answered. Everyone is drawn by
 * Spectra's own presence layer, named and coloured as the product names them.
 */

const QUESTION = "tidy up my IA and make the second source paragraph read better";
const OLD = "Its value is that it was spoken by an opponent in the room, at the time, knowing the risk.";
const NEW = "Its value lies in its origin: Wels spoke for the SPD in the Reichstag on 23 March 1933, minutes before the vote, knowing what opposing it could cost.";

export function Together() {
  const world = useWorld();
  const sectionRef = useRef<HTMLElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const presence = usePresence("together");
  const { move, leave } = presence;
  const reads = useRef(0);
  const tidying = useRef<((value: void) => void) | null>(null);

  /** Points a collaborator at `text` in the document, as a selection the presence layer draws. */
  const pointAt = useCallback(
    (who: CastId, text: string, extra: Partial<Move> = {}) => {
      const editor = editorIn(studioRef.current);
      const range = editor ? findText(editor, text) : null;
      if (!range?.blockId) return null;
      move(who, {
        path: `/blocks/${range.blockId}`,
        primitive: "richtext",
        act: { kind: "select", span: { anchor: { offset: range.offset }, head: { offset: range.offset + text.length } } },
        ...extra,
      });
      return studioRef.current?.querySelector(`[data-block-id="${range.blockId}"], [data-id="${range.blockId}"]`) ?? studioRef.current;
    },
    [move],
  );

  // The AI starts on the document once it has read it, as its run says so.
  useWorldEvent((event) => {
    if (event.type === "run_started" && event.reply.key === "tidy") reads.current = 0;
    if (event.type === "reading" && event.workId === WORKS.ia._id && ++reads.current === 2) tidying.current?.();
  });

  useEffect(() => {
    const studio = studioRef.current;
    if (!studio) return;
    shine("together-doc", { el: studio, at: [0.5, 0.3], rx: 760, ry: 360, strength: 0.32, hues: [4.0, 5.2], flow: 0.5, ease: 1400 });
    return () => dimAll("together");
  }, []);

  useScene(
    sectionRef,
    async ({ wait, skipped, signal }) => {
      const editor = await waitForEditor(() => studioRef.current, signal).catch(() => null);
      if (!editor) return;
      const tidy = () => {
        markText(editor, "444 votes to 94", "bold");
        markText(editor, "Kroll Opera House", "italic");
        if (findText(editor, OLD)) replaceText(editor, OLD, NEW);
      };
      if (skipped) {
        tidy();
        return;
      }
      await world.whenIdle();
      world.pace = 0.35;
      const read = new Promise<void>((resolve) => {
        tidying.current = resolve;
        window.setTimeout(resolve, 4000);
      });
      void typeIntoIsland(QUESTION, { fresh: true, perLetter: 10 });
      await read;
      tidying.current = null;

      // Henry's AI, in the document.
      const flashAt = (element: Element | null | undefined, hues: [number, number]) =>
        element && flash({ el: element, rx: 260, ry: 120, strength: 0.6, hues, hold: 500 });
      flashAt(pointAt("henryAi", "444 votes to 94", { note: "Bold" }), [4.6, 5.6]);
      await wait(520);
      markText(editor, "444 votes to 94", "bold");
      await wait(380);
      pointAt("henryAi", "Kroll Opera House", { note: "Italic" });
      await wait(480);
      markText(editor, "Kroll Opera House", "italic");
      await wait(380);
      flashAt(pointAt("henryAi", OLD, { note: "Rewording" }), [4.6, 6.2]);
      await wait(700);
      replaceText(editor, OLD, NEW);
      pointAt("henryAi", NEW, { note: "Reworded" });
      await wait(900);
      leave("henryAi");

      // Ms Gonzalez comes in from her class to see whether her comment was taken.
      await wait(300);
      flashAt(pointAt("gonzalez", "Its value lies in its origin", { note: "That's what I meant. Well done." }), [0.7, 1.6]);
      shine("together-teacher", { el: studioRef.current, at: [0.72, 0.5], rx: 420, ry: 300, strength: 0.4, hues: [0.6, 1.8], flow: 0.6, ease: 900 });
      await wait(2600);
      leave("gonzalez");
    },
    2800,
  );

  return (
    <section ref={sectionRef} className="sp-scene sp-together" aria-labelledby="sp-together-title">
      <div className="sp-scene-copy" data-settle-to>
        <h2 id="sp-together-title" className="sp-heading" data-light-text>
          It works on your document with you, and so can your teacher.
        </h2>
        <p className="sp-lede">
          Spectra edits the way you would, in your own file: a word in bold, a paragraph said better. Your teacher&rsquo;s class is
          linked to yours, so she is one click from your draft, and you see each other working.
        </p>
      </div>
      <Surface id="together" states={presence.states} className="sp-together-doc">
        <div ref={studioRef} className="sp-together-studio">
          <InlineStudio work={WORKS.ia} instanceKey="landing-together-ia" className="sp-studio" />
        </div>
      </Surface>
    </section>
  );
}
