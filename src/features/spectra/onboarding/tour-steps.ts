import { HOME_PATH } from "../chat/home-routes";

/*
 * The tour Spectra gives after Setup (SHELL.md,
 * "Onboarding tour"). It is written as Spectra speaking, in the order a
 * student meets the app: who Spectra is, where to talk to it, how to get
 * around, then each place in turn, ending back where they will start.
 * Each step names the page it happens on and what it points at; a step whose
 * target is not on the page speaks from the middle of the screen instead.
 */

export type TourPerson = { firstName: string; school: string | null };

/** A choice the step asks for, answered right in Spectra's note. */
export type TourAsk = "reminders" | "bridge" | "subscriptions" | "storage";

export type TourStep = {
  id: string;
  /** The page the step happens on. */
  path: string;
  /** What it points at, in order of preference; none speaks from the middle. */
  targets: string[];
  say: (person: TourPerson) => string;
  ask?: TourAsk;
};

const PAGE = "[data-spectra-app-surface]";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "hello",
    path: HOME_PATH,
    targets: [],
    say: ({ firstName, school }) =>
      `Hi ${firstName}, I'm Spectra. ${school ? `Your classes at ${school} are synced from ManageBac` : "Your classes are synced from ManageBac"}, so I already know your subjects, your teachers' tasks and when things are due. Let me show you around. It takes about a minute, and you can skip any part.`,
  },
  {
    id: "composer",
    path: HOME_PATH,
    targets: ["[data-island-composer]", "[data-island-root]"],
    say: () =>
      "This is where you talk to me. Ask a question, hand me a task, drop in a file or just speak. I can write documents, slides, sheets, flashcards, quizzes and code with you, and you can watch every change I make as I make it.",
  },
  {
    id: "rail",
    path: HOME_PATH,
    targets: ["nav[aria-label='Main destinations']"],
    say: () =>
      "Everything else is one click away here: Home for our conversations, then your Library, Calendar, School, Agents and Devices. I'll take you through each of them.",
  },
  {
    id: "threads",
    path: HOME_PATH,
    targets: ["[data-sidebar-recents]"],
    say: () =>
      "Our conversations collect here. I name each one and file it with the class it belongs to, so you never have to tidy up after us.",
  },
  {
    id: "library",
    path: "/library",
    targets: ["section[aria-labelledby='shelf-classes']", PAGE],
    say: () =>
      "The Library holds everything we make, on a shelf for each of your classes. Open any artifact and I can edit it beside you, or you can follow along as I go.",
  },
  {
    id: "select",
    path: "/library",
    targets: ["[data-library-select]"],
    say: () =>
      "Select lets you pick several artifacts at once. Ask me about all of them together, or lay them side by side to work across them.",
  },
  {
    id: "calendar",
    path: "/calendar",
    targets: [PAGE],
    say: () =>
      "Your calendar puts ManageBac deadlines next to your own plans. Ask me to plan your week and I'll fit work blocks around what's due, then move them when things change.",
  },
  {
    id: "school",
    path: "/school",
    targets: [PAGE],
    say: ({ school }) =>
      `School is ${school ?? "your school"}'s ManageBac, kept in sync: classes, tasks, grades and CAS. I read it so my help fits exactly what your teachers asked for.`,
  },
  {
    id: "agents",
    path: "/agents",
    targets: [PAGE],
    say: () =>
      "Agents are specialists you shape yourself, like a lab report coach or an essay reviewer. When a request is squarely what one is for, I hand it over.",
  },
  {
    id: "account",
    path: HOME_PATH,
    targets: ["[data-account-row]"],
    say: () =>
      "Your settings, theme and notifications live in your account menu. You can replay this tour from there whenever you like.",
  },
  {
    id: "start",
    path: HOME_PATH,
    targets: ["[data-island-composer]", "[data-island-root]"],
    say: ({ firstName }) =>
      `That's everything, ${firstName}. A good first question: ask me what's due this week and what to start on first.`,
  },
];
