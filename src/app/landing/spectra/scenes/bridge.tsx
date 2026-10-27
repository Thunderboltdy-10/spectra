"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import type { BridgeOfficeFile } from "@/features/spectra/bridge/client";
import { DeviceCard } from "@/features/spectra/devices/device-card";
import type { DeviceView, FolderView } from "@/features/spectra/devices/devices-model";
import { spectraBus } from "@/features/spectra/events";
import { useScene } from "../director";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { Window } from "../window";

/*
 * Henry's laptop and his Spectra, side by side. He drags his History folder
 * from the laptop onto his computer in Devices, Spectra's own card for it:
 * Bridge syncs the folder and files it with History HL. Then he opens the IA
 * in Word, writes a sentence and saves, and the save is in Spectra too,
 * because it is the same file. The card is the app's; only the laptop is drawn.
 */

const FOLDERS = ["Biology", "English", "History", "Maths"];
const FILES = ["History IA draft.docx", "Enabling Act source pack.pdf", "Wels speech notes.docx", "Reichstag vote.xlsx"];
const SENTENCE = " Wels knew the SA were in the room as he spoke.";
const SAVED_AT = Date.now() - 4 * 60_000;

const biology: FolderView = { id: "biology", name: "Biology", path: "Documents › School › Biology", tone: "ok", label: "Up to date", paused: false, actionable: true };

function history(synced: number, total: number): FolderView {
  const base = { id: "history", name: "History", path: "Documents › School › History", paused: false, actionable: true };
  return synced < total
    ? { ...base, tone: "busy", label: "Syncing", progress: { synced, total } }
    : { ...base, tone: "ok", label: "Up to date", detail: "in History HL" };
}

function laptop(folders: FolderView[], officeFiles: BridgeOfficeFile[]): DeviceView {
  const busy = folders.some((folder) => folder.tone === "busy");
  return {
    id: "henry-laptop",
    name: "Henry's MacBook Air",
    platformLabel: "Mac",
    isThisComputer: true,
    online: true,
    live: true,
    tone: busy ? "busy" : "ok",
    label: busy ? "Syncing" : "Connected",
    detail: busy ? "Making files available in Spectra." : "Everything is up to date.",
    paused: false,
    updateRequired: false,
    version: "1.6.0",
    lastSyncAt: SAVED_AT,
    folders,
    officeFiles,
  };
}

const noop = () => undefined;

export function Bridge() {
  const sectionRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLLIElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const laptopRef = useRef<HTMLDivElement>(null);
  const { layer, hand } = useHands();
  const [folders, setFolders] = useState<FolderView[]>([biology]);
  const [office, setOffice] = useState<BridgeOfficeFile[]>([]);
  const [moved, setMoved] = useState(false);
  const [wordOpen, setWordOpen] = useState(false);
  const [typed, setTyped] = useState(0);
  const [saved, setSaved] = useState<"no" | "saving" | "yes">("no");

  useEffect(() => {
    const desk = laptopRef.current;
    if (desk) shine("bridge-laptop", { el: desk, at: [0.3, 0.4], rx: 520, ry: 380, strength: 0.32, hues: [2.6, 3.6], flow: 0.5, ease: 1400 });
    return () => dimAll("bridge");
  }, []);

  const finish = () => {
    setMoved(true);
    setFolders([biology, history(4, 4)]);
    setWordOpen(true);
    setTyped(SENTENCE.length);
    setSaved("yes");
  };

  useScene(
    sectionRef,
    async ({ wait, skipped, signal }) => {
      if (skipped) return finish();
      const source = historyRef.current;
      const card = cardRef.current;
      if (!source || !card) return;
      const henry = hand(PEOPLE.henry, signal);

      // The folder, from the laptop onto the computer's card in Spectra.
      await henry.show(source, [0.5, 0.42]);
      await wait(140);
      await henry.press({ light: false });
      henry.grab(source);
      setMoved(true);
      const add = card.querySelector<HTMLElement>(".device-folder-add") ?? card;
      await henry.move(add, { ms: 900, aim: [0.5, 0.5] });
      await henry.drop();
      if (signal.aborted) return;
      setFolders([biology, history(0, FILES.length)]);
      const from = source.getBoundingClientRect();
      travel("bridge-files", [from.left + from.width / 2, from.top + window.scrollY + from.height / 2], card, {
        at: [0.6, 0.55],
        rx: 220,
        ry: 160,
        strength: 0.7,
        hues: [2.7, 3.8],
        flow: 0.9,
        ms: 1100,
      });
      void henry.hide();
      for (let synced = 1; synced <= FILES.length; synced += 1) {
        await wait(300);
        setFolders([biology, history(synced, FILES.length)]);
      }
      shine("bridge-card", { el: card, at: [0.5, 0.5], rx: 420, ry: 320, strength: 0.36, hues: [2.8, 4.2], flow: 0.6, ease: 1000 });
      spectraBus.emit("island.notify", { id: "landing-bridge-linked", title: "History is in History HL", detail: "4 files from Henry's MacBook Air", tone: "done" });

      // He opens the IA in Word, adds a sentence and saves.
      await wait(700);
      setWordOpen(true);
      setOffice([{ folder: "History", name: FILES[0] }]);
      await wait(380);
      await henry.show(caretRef.current, [0, 0.6]);
      await henry.press();
      for (let index = 0; index < SENTENCE.length; index += 2) {
        await wait(26);
        setTyped(Math.min(SENTENCE.length, index + 2));
      }
      await wait(260);
      setSaved("saving");
      await wait(420);
      setSaved("yes");
      setFolders([biology, history(0, 1)]);
      const word = wordRef.current;
      if (word) {
        const box = word.getBoundingClientRect();
        travel("bridge-save", [box.left + box.width / 2, box.top + window.scrollY + 60], card, { at: [0.6, 0.55], rx: 200, ry: 140, strength: 0.6, hues: [3.6, 4.6], flow: 0.9, ms: 900 });
      }
      await wait(600);
      setFolders([biology, history(1, 1)]);
      if (card) flash({ el: card, rx: 260, ry: 200, strength: 0.5, hues: [3.6, 4.4], hold: 500 });
      spectraBus.emit("island.notify", { id: "landing-bridge-saved", title: "History IA draft saved in Word", detail: "Spectra has the new version", tone: "info" });
      await henry.hide();
    },
    2600,
  );

  return (
    <section ref={sectionRef} className="sp-scene sp-bridge" aria-labelledby="sp-bridge-title">
      <div className="sp-scene-copy" data-settle-to>
        <h2 id="sp-bridge-title" className="sp-heading" data-light-text>
          The files on your laptop are in it too.
        </h2>
        <p className="sp-lede">
          Spectra Bridge keeps the folders you choose in sync with their class. Nothing is uploaded twice: the IA you save in Word
          is the IA in Spectra, and a change in either one is in both.
        </p>
      </div>

      <div className="sp-bridge-stage">
        <div ref={laptopRef} className="sp-laptop" aria-label="Henry's laptop">
          <div className="sp-finder">
            <div className="sp-os-bar">
              <span className="sp-os-lights" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="sp-os-title">School</span>
            </div>
            <p className="sp-finder-path">Documents › School</p>
            <ul className="sp-finder-items">
              {FOLDERS.map((name) => (
                <li key={name} ref={name === "History" ? historyRef : undefined} data-moved={(name === "History" && moved) || undefined}>
                  <span className="sp-finder-folder" aria-hidden>
                    <Icon name="folder" size={44} />
                  </span>
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          </div>

          <div ref={wordRef} className="sp-word" data-open={wordOpen || undefined}>
            <div className="sp-os-bar">
              <span className="sp-os-lights" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="sp-os-title">
                <span className="sp-word-badge" aria-hidden>
                  W
                </span>
                History IA draft.docx
              </span>
              <span className="sp-word-state">{saved === "saving" ? "Saving…" : saved === "yes" ? "Saved" : "Edited"}</span>
            </div>
            <div className="sp-word-page">
              <p className="sp-word-heading">Identification and evaluation of sources</p>
              <p>
                The second source is a speech by Otto Wels, leader of the SPD, given in the Reichstag before the vote. Its value lies
                in its origin: Wels spoke for the SPD on 23 March 1933, minutes before the vote.
                <span className="sp-word-new">{SENTENCE.slice(0, typed)}</span>
                <span ref={caretRef} className="sp-word-caret" data-on={wordOpen || undefined} />
              </p>
              <p className="sp-word-ghost" aria-hidden>
                <span />
                <span />
                <span />
              </p>
            </div>
          </div>
        </div>

        <div ref={cardRef} className="sp-bridge-app">
          <Window at="devices" width={940} height={700} threads={["IA source paragraph", "Revision for Thursday"]} label="Devices in Henry's Spectra">
            <div className="sp-devices">
              <PageBody>
                <PageHeader title="Devices" description="Use files from your computers in Spectra. Bridge keeps the folders you choose in sync." />
                <h2 className="device-section-heading sp-devices-heading">Your computers</h2>
                <DeviceCard device={laptop(folders, office)} now={Date.now()} busy={null} fresh={false} lifeKey="landing-laptop" onAction={noop} onRemove={noop} />
              </PageBody>
            </div>
          </Window>
        </div>
        {layer}
      </div>
    </section>
  );
}
