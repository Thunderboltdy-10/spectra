import { DEADLINES, DAYS } from "./school";
import { dayName } from "./story";
import { WORKS } from "./works";

/*
 * What Spectra answers on the landing page. Henry's own questions are vague
 * on purpose ("what do I actually have to do"), because the point is that
 * Spectra knows what he means from his work. A visitor can type too: the
 * questions people ask about Spectra itself have answers here, and anything
 * else is answered honestly as what this is, a preview on Henry's example work.
 */

export type ReplyStep = { label: string; work?: string };

export type Reply = {
  key: string;
  /** Does this reply answer `text`? */
  matches: (text: string) => boolean;
  title: string;
  steps: ReplyStep[];
  sources?: Array<{ id: string; title: string; workId: string }>;
  /** Markdown, with Spectra's [[cite:…]] links. */
  text: string;
  /** Works it made or changed, shown as the run's results. */
  touched?: Array<{ id: string; type: string; title: string; action: "created" | "edited" | "referenced" }>;
  /** The scene it belongs to, when the reply moves the story on. */
  effect?: "planned" | "planned-lab" | "made" | "tidied";
};

const has = (...words: RegExp[]) => (text: string) => words.some((word) => word.test(text));

const source = DEADLINES.sourceAnalysis;
const test = DEADLINES.biologyTest;

export const WEEK_REPLY: Reply = {
  key: "week",
  matches: has(/\b(this|the) week\b/i, /\bhave to do\b/i, /\bwhat'?s due\b/i, /\bdue\b/i, /\bhomework\b/i),
  title: "What's due this week",
  steps: [
    { label: "Read your ManageBac tasks" },
    { label: "Read Cell respiration notes", work: WORKS.notes._id },
    { label: "Read Ms Gonzalez's comments on your IA draft", work: WORKS.ia._id },
  ],
  sources: [
    { id: WORKS.notes._id, title: WORKS.notes.title, workId: WORKS.notes._id },
    { id: WORKS.ia._id, title: WORKS.ia.title, workId: WORKS.ia._id },
  ],
  text: [
    `Three things, and one of them is close.`,
    ``,
    `- **Biology test, ${dayName(test.startAt!)}.** Cell respiration. Your notes cover all four stages, but the electron transport chain is the thinnest part [[cite:${WORKS.notes._id}:n-anaerobic|Cell respiration notes]].`,
    `- **Maths problem set 4, ${dayName(DEADLINES.problemSet.startAt!)}.** Questions 1 to 14.`,
    `- **English essay, ${dayName(DEADLINES.essay.startAt!)}.** Nothing started yet, so it can wait until the weekend.`,
    ``,
    `Your History IA has one open comment from Ms Gonzalez: your second source needs a date [[cite:${WORKS.ia._id}:ia-a2|History IA draft]].`,
  ].join("\n"),
};

export const MAKE_REPLY: Reply = {
  key: "make",
  matches: has(/\bquiz\b/i, /\bflash ?cards?\b/i, /\bslides?\b/i, /\brevise\b/i, /\bstudy\b/i, /\btest me\b/i),
  title: `Revision for ${dayName(test.startAt!)}`,
  steps: [
    { label: "Read Cell respiration notes", work: WORKS.notes._id },
    { label: "Made a quiz", work: WORKS.quiz._id },
    { label: "Made flashcards", work: WORKS.cards._id },
    { label: "Made slides", work: WORKS.deck._id },
  ],
  text: `Three ways to revise from your notes, filed in Biology SL: a five-question quiz, eight flashcards and a five-slide summary. The quiz checks the parts your notes are thinnest on.`,
  touched: [
    { id: WORKS.quiz._id, type: "quiz", title: WORKS.quiz.title, action: "created" },
    { id: WORKS.cards._id, type: "flashcard_deck", title: WORKS.cards.title, action: "created" },
    { id: WORKS.deck._id, type: "presentation", title: WORKS.deck.title, action: "created" },
  ],
  effect: "made",
};

const lab = DEADLINES.labReport;

export const LAB_REPLY: Reply = {
  key: "lab",
  matches: has(/\blab\b/i, /\byeast\b/i),
  title: "Planned the lab report",
  steps: [
    { label: "Read Mr Okafor's task" },
    { label: "Checked your week" },
    { label: "Planned 50 minutes" },
  ],
  text: `${dayName(DEADLINES.biologyTest.startAt!)[0]!.toUpperCase()}${dayName(DEADLINES.biologyTest.startAt!).slice(1)} at 17:30, after your test and the source analysis: 50 minutes to write it up, due ${dayName(lab.startAt!)}. Your results from the practical are in Biology SL.`,
  effect: "planned-lab",
};

export const PLAN_REPLY: Reply = {
  key: "plan",
  matches: has(/\bplan\b/i, /\bwhen should\b/i, /\bschedule\b/i, /\btime for\b/i),
  title: "Planned the source analysis",
  steps: [
    { label: "Read the new History task" },
    { label: "Looked at your week" },
    { label: "Planned two blocks" },
  ],
  text: `Two blocks before it is due ${dayName(source.startAt!)}: an hour tomorrow at 16:00 to read the two sources, and an hour and a quarter the day after to write it. Both are after your last lesson, and you can move them.`,
  effect: "planned",
};

export const TIDY_REPLY: Reply = {
  key: "tidy",
  matches: has(/\btidy\b/i, /\bformat/i, /\bpolish\b/i, /\bwording\b/i, /\bread better\b/i),
  title: "Tidied the IA",
  steps: [
    { label: "Read History IA draft", work: WORKS.ia._id },
    { label: "Read Ms Gonzalez's comment", work: WORKS.ia._id },
    { label: "Edited History IA draft", work: WORKS.ia._id },
  ],
  text: `Done, in your IA: the vote count and the setting are picked out, and the second source paragraph now gives the date and who Wels was speaking to, which is what Ms Gonzalez asked for [[cite:${WORKS.ia._id}:ia-a2|History IA draft]]. Your words otherwise.`,
  touched: [{ id: WORKS.ia._id, type: "document", title: WORKS.ia.title, action: "edited" }],
  effect: "tidied",
};

const ABOUT: Reply[] = [
  {
    key: "what",
    matches: has(/\bwhat is (spectra|this)\b/i, /\bwhat does (it|spectra) do\b/i, /\bwho (is|are) (this|it) for\b/i),
    title: "What Spectra is",
    steps: [{ label: "Read this page" }],
    text: `Spectra is one place for schoolwork: your classes and deadlines from ManageBac, the files on your computer, everything you make (notes, slides, quizzes, sheets, whiteboards) and an AI that has read all of it. Students do their work in it; teachers set, share and mark in it.`,
  },
  {
    key: "managebac",
    matches: has(/\bmanage ?bac\b/i, /\bschool system\b/i, /\blms\b/i, /\btoddle\b/i, /\bgoogle classroom\b/i),
    title: "Spectra and ManageBac",
    steps: [{ label: "Checked the ManageBac connection" }],
    text: `Spectra connects to ManageBac from the first day: classes, tasks, deadlines, grades, feedback, files and CAS arrive by themselves, so nobody enters anything twice. Other school systems are coming next.`,
  },
  {
    key: "bridge",
    matches: has(/\bbridge\b/i, /\bmy (own )?files\b/i, /\bcomputer\b/i, /\bword\b/i, /\boffline\b/i, /\bdesktop\b/i),
    title: "Your files and Bridge",
    steps: [{ label: "Checked Bridge" }],
    text: `With Spectra Bridge your own folders stay on your computer and show up in Spectra. The file on your desktop and the artifact in Spectra are the same file: edit it in Word or here, and it is never copied or uploaded twice.`,
  },
  {
    key: "price",
    matches: has(/\bprice\b/i, /\bcost\b/i, /\bfree\b/i, /\bpay\b/i, /\bhow much\b/i),
    title: "Bringing Spectra to a school",
    steps: [{ label: "Looked up how schools start" }],
    text: `Schools start with a walkthrough on their own classes. Ask for one at the bottom of this page, or show this page to a teacher: they can ask for it too.`,
  },
  {
    key: "teachers",
    matches: has(/\bteachers?\b/i, /\bmark(ing)?\b/i, /\bgrad(e|ing)\b/i, /\bagents?\b/i),
    title: "Spectra for teachers",
    steps: [{ label: "Read how teachers use Spectra" }],
    text: `Teachers get the same place their students have. They share work with a class, comment on a draft as it is written, and set agents to do the slow parts, like a first pass at marking twenty-four essays against the rubric, which they then check.`,
  },
];

const PREVIEW: Reply = {
  key: "preview",
  matches: () => true,
  title: "A preview",
  steps: [{ label: "Read Henry's artifacts" }],
  text: `This is a preview of Spectra on Henry's example artifact, so here I can only answer a few things: what is due, revising for Thursday, planning, and questions about Spectra itself (ManageBac, your files, teachers, getting it for your school). In your own Spectra I answer from your own notes, files and classes.`,
};

const STORY_REPLIES = [TIDY_REPLY, LAB_REPLY, MAKE_REPLY, PLAN_REPLY, WEEK_REPLY];

/** The reply for what someone typed: the story first, then questions about Spectra, then the honest preview. */
export function replyFor(text: string): Reply {
  return STORY_REPLIES.find((reply) => reply.matches(text)) ?? ABOUT.find((reply) => reply.matches(text)) ?? PREVIEW;
}

export const SUGGESTED = ["What do I actually have to do this week?", "Is this the same as ManageBac?", "Can it use the files on my computer?"];

export { DAYS };
