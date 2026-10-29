"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { SpectraMark } from "@/components/spectra-mark";
import { FoundryNav, type FoundryView } from "@/features/spectra/components/agent/foundry-nav";
import { createEmptyExtraction, type EvidenceBinding } from "@/features/spectra/agents/foundry";
import { ContextFiles } from "@/features/spectra/agents/interview/context-files";
import { InterviewQuestion, InterviewThinking } from "@/features/spectra/agents/interview/interview-question";
import { Written } from "../../kit/written";
import { PEOPLE, useHands } from "../hands";
import { dimAll, flash, shine, travel } from "../light/light";
import { useLoop, type Beat } from "../loop";
import { Window } from "../window";

/*
 * Ms Gonzalez makes an agent for her History HL class, in Spectra's own
 * Foundry. She says what it is for in a sentence; she hands it the IB
 * criteria and two IAs she marked last year, and it reads them; she releases
 * it to the class. Then it is at work: on Henry's draft it says what she
 * would say, criterion by criterion, and cites her files where it does.
 */

const ANSWER =
  "Give my History HL students feedback on their IA drafts the way I would: against the IB criteria, one thing to fix at a time, and never write it for them.";
const KNOWS = ["what you want", "your criteria", "your class"] as const;

type Source = { id: string; name: string; kind: EvidenceBinding["kind"]; note: string; criteria: string[]; examples: number };
const FILES: Source[] = [
  {
    id: "criteria",
    name: "IA criteria 2027.pdf",
    kind: "rubric",
    note: "IB, 3 criteria",
    criteria: ["A: Identification and evaluation of sources", "B: Investigation", "C: Reflection"],
    examples: 0,
  },
  { id: "marked", name: "Marked IAs, 2026.docx", kind: "annotated_work", note: "Two, with your comments", criteria: [], examples: 2 },
];

const bindingOf = (file: Source, confirmed = false): EvidenceBinding => {
  const extraction = createEmptyExtraction(file.id, file.kind, 0);
  extraction.criteria = file.criteria.map((name, index) => ({
    id: `${file.id}-${index}`,
    name,
    description: name,
    levels: [],
    evidenceSpanIds: [],
  }));
  extraction.examples = Array.from({ length: file.examples }, (_, index) => ({
    id: `${file.id}-example-${index}`,
    input: "",
    output: "",
    polarity: "positive",
    evidenceSpanIds: [],
  }));
  return { id: file.id, sourceId: file.id, kind: file.kind, label: file.name.replace(/\.[a-z]+$/, ""), confirmed, extraction };
};

/** What the agent says on Henry's draft, and where it learned it. */
const FEEDBACK = [
  {
    on: "Its value is that it was spoken by an opponent in the room",
    say: "Say what Wels's origin lets the speech show about your question, not only that he was there.",
    from: "IA criteria 2027, A",
  },
  {
    on: "444 votes to 94",
    say: "Good use of a figure. Tie it back: does a legal vote with SA in the room answer 'to what extent'?",
    from: "Marked IAs, 2026",
  },
  {
    on: "Historians disagree",
    say: "Name the historians. Your marked examples did, and that is where the top band starts.",
    from: "IA criteria 2027, B",
  },
];

const noop = () => undefined;

export function Agents() {
  const sceneRef = useRef<HTMLElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { layer, hand } = useHands();
  const [knows, setKnows] = useState(0);
  const [view, setView] = useState<FoundryView>("overview");
  const [typed, setTyped] = useState(0);
  const [step, setStep] = useState<"mission" | "thinking" | "files">("mission");
  const [bindings, setBindings] = useState<EvidenceBinding[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [taken, setTaken] = useState<string[]>([]);
  const [released, setReleased] = useState(false);
  const [said, setSaid] = useState(0);

  useEffect(() => {
    const window_ = windowRef.current?.querySelector<HTMLElement>(".sp-window");
    if (window_) shine("agents-halo", { el: window_, halo: { radius: 16 }, rx: 120, ry: 90, strength: 0.65, hues: [0.6, 1.8], flow: 0.6, ease: 1400 });
    return () => dimAll("agents");
  }, []);

  const reset = () => {
    setView("overview");
    setTyped(0);
    setStep("mission");
    setBindings([]);
    setReading(null);
    setTaken([]);
    setReleased(false);
    setSaid(0);
    setKnows(0);
  };

  useLoop(sceneRef, {
    open: async ({ wait }) => {
      const title = sceneRef.current?.querySelector(".sp-heading");
      const stage = sceneRef.current?.querySelector(".sp-agents-stage");
      if (title && stage) {
        const box = title.getBoundingClientRect();
        travel("agents-title", [box.left + box.width * 0.5, box.top + window.scrollY + box.height * 0.6], stage, {
          at: [0.55, 0.35],
          rx: 460,
          ry: 220,
          strength: 0.45,
          hues: [0.4, 2],
          flow: 0.5,
          ease: 500,
          ms: 1700,
        });
        window.setTimeout(() => dimAll("agents-title", 1600), 2100);
      }
      await wait(400);
    },
    round: async (beat: Beat) => {
      const { wait, signal } = beat;
      reset();
      await wait(300);
      const gonzalez = hand(PEOPLE.gonzalez, signal);

      // What it is for, in her own words.
      await gonzalez.show(answerRef.current, [0.1, 0.3]);
      await gonzalez.press();
      for (let length = 0; length <= ANSWER.length && !signal.aborted; length += 2 + Math.round(Math.random() * 2)) {
        setTyped(Math.min(ANSWER.length, length));
        await wait(18);
      }
      setTyped(ANSWER.length);
      await wait(250);
      const next = windowRef.current?.querySelector<HTMLElement>(".interview-actions button:last-child");
      if (next) await gonzalez.click(next);
      setStep("thinking");
      await wait(900);
      setStep("files");
      setKnows(1);
      await wait(400);

      // The criteria and the IAs she marked, from her desktop into what it reads.
      for (const file of FILES) {
        if (signal.aborted) return;
        const chip = deskRef.current?.querySelector<HTMLElement>(`[data-file="${file.id}"]`);
        const into = filesRef.current?.querySelector<HTMLElement>(".interview-context") ?? filesRef.current;
        if (!chip || !into) continue;
        await gonzalez.move(chip, { ms: 520, aim: [0.3, 0.5] });
        await gonzalez.press({ light: false });
        gonzalez.grab(chip);
        setTaken((was) => [...was, file.id]);
        await gonzalez.move(into, { ms: 720, aim: [0.35, 0.6] });
        await gonzalez.drop();
        setReading(file.name.replace(/\.[a-z]+$/, ""));
        flash({ el: into, rx: 260, ry: 90, strength: 0.6, hues: [0.6, 1.6], hold: 700 });
        await wait(950);
        setReading(null);
        setBindings((was) => [...was, bindingOf(file)]);
        await wait(250);
      }

      // What it read from the criteria, and she says it read them right.
      const first = filesRef.current?.querySelector<HTMLElement>(".interview-file[data-state]");
      if (first && !signal.aborted) {
        await gonzalez.click(first);
        first.click();
        await wait(1100);
        const confirm = filesRef.current?.querySelector<HTMLElement>(".interview-file-detail .foundry-choice");
        if (confirm) {
          await gonzalez.click(confirm);
          setBindings((was) => was.map((binding) => (binding.id === "criteria" ? { ...binding, confirmed: true } : binding)));
        }
        await wait(700);
      }

      // Released to the class.
      const release = windowRef.current?.querySelector<HTMLElement>(".foundry-nav-primary");
      if (release) await gonzalez.click(release);
      setReleased(true);
      setKnows(2);
      if (release) flash({ el: release, rx: 200, ry: 80, strength: 0.7, hues: [0, 6.2], hold: 700 });
      await wait(600);
      await gonzalez.hide();
      gonzalez.remove();

      // At work on Henry's draft, in her words, citing her files.
      setView("bench");
      await wait(600);
      for (let index = 1; index <= FEEDBACK.length && !signal.aborted; index += 1) {
        setSaid(index);
        const note = windowRef.current?.querySelector<HTMLElement>(`[data-said="${index - 1}"]`);
        if (note) flash({ el: note, rx: 240, ry: 90, strength: 0.55, hues: [4.6, 5.8], hold: 500 });
        await wait(1350);
      }
      await wait(2200);
    },
  });

  const studentLine = (text: string, index: number) => (
    <mark className="sp-agent-mark" data-on={said > index || undefined}>
      {text}
    </mark>
  );

  return (
    <section ref={sceneRef} className="sp-scene sp-agents" aria-labelledby="sp-agents-title">
      <div className="sp-scene-copy" data-centred>
        <Written id="sp-agents-title" className="sp-heading" text={"An agent that knows\n{}."} flip={{ words: KNOWS, index: knows }} />
        <p className="sp-lede">
          Teachers make agents in a few sentences. Hand one your criteria and the work you have marked; it reads them, and then it helps
          every student in the class the way you would, citing where it learned it.
        </p>
      </div>

      <div className="sp-agents-stage">
        <ul ref={deskRef} className="sp-agents-desk" aria-label="Ms Gonzalez's files">
          <li className="sp-agents-desk-head">
            <Icon name="folder" size={14} />
            History HL
          </li>
          {FILES.map((file) => (
            <li key={file.id} data-file={file.id} data-taken={taken.includes(file.id) || undefined} className="sp-agents-file">
              <span className="sp-agents-file-kind" data-kind={file.name.endsWith(".pdf") ? "pdf" : "doc"}>
                {file.name.endsWith(".pdf") ? "PDF" : "DOC"}
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>{file.note}</small>
              </span>
            </li>
          ))}
        </ul>

        <div ref={windowRef} className="sp-agents-window">
          <Window at="agents" width={1080} height={760} label="Ms Gonzalez's agents">
            <div className="sp-agent-page spectra-agent-foundry">
              <header className="sp-agent-head">
                <span className="sp-agent-glyph" aria-hidden>
                  <Icon name="agents" size={18} />
                </span>
                <span className="sp-agent-name">
                  <small>Agent</small>
                  <strong>IA feedback coach</strong>
                </span>
                <span className="sp-agent-state" data-released={released || undefined}>
                  {released ? "Released to History HL, 22 students" : "Draft, only you"}
                </span>
              </header>
              <FoundryNav
                views={["overview", "bench", "checks", "releases"]}
                view={view}
                onView={noop}
                primary={{ id: "release", label: released ? "Released" : "Release to History HL", onSelect: noop }}
              />

              {view === "overview" ? (
                <div className="sp-agent-body">
                  {step === "mission" ? (
                    <InterviewQuestion
                      id="mission"
                      prompt="What should this agent help your students do?"
                      detail="A clear outcome is what it works toward with every student."
                      canContinue={typed > 20}
                      onContinue={noop}
                    >
                      <textarea ref={answerRef} className="foundry-input" rows={3} readOnly value={ANSWER.slice(0, typed)} placeholder="In your own words" />
                    </InterviewQuestion>
                  ) : step === "thinking" ? (
                    <InterviewThinking />
                  ) : (
                    <InterviewQuestion
                      id="files"
                      prompt="What should it read to give feedback the way you do?"
                      detail="Criteria, guides, work you have marked. It opens them when a draft needs them, and says which it used."
                      canContinue={bindings.length > 0}
                      continueLabel="Continue"
                      onContinue={noop}
                    >
                      <p className="sp-agent-mission">{ANSWER}</p>
                    </InterviewQuestion>
                  )}
                  <div ref={filesRef} className="sp-agent-files">
                    <ContextFiles
                      bindings={bindings}
                      canEdit={step === "files"}
                      reading={reading}
                      inputRef={inputRef}
                      onFiles={noop}
                      onPaste={noop}
                      onRemove={noop}
                      onConfirm={noop}
                    />
                  </div>
                </div>
              ) : (
                <div className="sp-agent-try">
                  <article className="sp-agent-draft">
                    <p className="sp-agent-draft-who">Henry&apos;s History IA draft</p>
                    <h4>Identification and evaluation of sources</h4>
                    <p>
                      The second source is a speech by Otto Wels, leader of the SPD, given in the Reichstag before the vote.{" "}
                      {studentLine(FEEDBACK[0]!.on, 0)}, at the time, knowing the risk.
                    </p>
                    <h4>Investigation</h4>
                    <p>
                      The Act was passed by {studentLine(FEEDBACK[1]!.on, 1)}, but the vote took place with SA men lining the Kroll Opera
                      House and the Communist deputies already arrested or in hiding.
                    </p>
                    <p>
                      {studentLine(FEEDBACK[2]!.on, 2)} about how much the Act mattered. Some argue that it was the legal foundation of the
                      dictatorship, others that power was really taken through terror on the streets.
                    </p>
                  </article>
                  <ol className="sp-agent-said" aria-live="polite">
                    {FEEDBACK.slice(0, said).map((item, index) => (
                      <li key={item.on} data-said={index}>
                        <span className="sp-agent-said-who">
                          <SpectraMark size={14} />
                          IA feedback coach
                        </span>
                        <p>{item.say}</p>
                        <span className="sp-agent-cite">
                          <Icon name="document" size={12} />
                          {item.from}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </Window>
        </div>
        {layer}
      </div>
    </section>
  );
}
