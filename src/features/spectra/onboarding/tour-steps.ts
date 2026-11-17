import { HOME_PATH } from "../chat/home-routes";

/*
 * The tour Spectra gives after Setup (SHELL.md,
 * "Onboarding tour"). It is written as Spectra speaking, in the order a
 * student needs it: where to talk to Spectra and how to set up a thread (the
 * mark in the island), then the Library, Calendar, School and Devices, ending
 * back on Home with the day's personal note.
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
    id: "composer",
    path: HOME_PATH,
    targets: ["[data-island-composer]", "[data-island-root]"],
    say: ({ firstName, school }) =>
      `Hi ${firstName}, I'm Spectra. ${school ? `Your classes at ${school} are synced from ManageBac` : "Your classes are synced from ManageBac"}, so I already know your subjects and what's due. This is where you talk to me: ask a question, hand me a task, drop in a file or just speak, and watch every change I make as I make it.`,
  },
  {
    id: "thread-settings",
    path: HOME_PATH,
    targets: ["[data-agent-switch]", "[data-island-composer]"],
    say: () =>
      "Press my mark, here at the start of the island, to set up the thread you're in: which agent answers, which model I use and how hard I think. Each thread keeps its own choice.",
  },
  {
    id: "library",
    path: "/library",
    targets: ["section[aria-labelledby='shelf-classes']", PAGE],
    say: () =>
      "The Library holds everything we make, on a shelf for each of your classes. Open any artifact and I can edit it beside you, or you can follow along as I go.",
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
    id: "devices",
    path: "/devices",
    targets: [PAGE],
    say: () =>
      "Devices is where your computers and Spectra meet. With Spectra Bridge on a computer, its folders stay in sync both ways, and for each folder and file you can see what is still on its way to the computer and what is still on its way to Spectra.",
  },
  {
    id: "start",
    path: HOME_PATH,
    targets: ["[data-home-lead]", "[data-island-composer]", "[data-island-root]"],
    say: ({ firstName }) =>
      `That's it, ${firstName}. Home is where each day starts: I write you a note on what's coming and what to do first. Ask me anything from here.`,
  },
];
