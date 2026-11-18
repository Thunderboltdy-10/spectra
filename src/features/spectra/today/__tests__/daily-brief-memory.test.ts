import { describe, expect, it } from "vitest";
import { briefMessages, type BriefContext } from "../daily-brief";

const context: BriefContext = {
  day: "2026-11-18",
  timeZone: "Europe/Madrid",
  yesterdayThreads: [],
  yesterdayWorks: [],
  recentWorks: [],
  today: [],
  due: [{ id: "school:abc", title: "Macro IA commentary", at: Date.UTC(2026, 10, 20) }],
  later: [],
  places: [],
  late: [],
  open: [],
};

describe("morning brief memory", () => {
  it("gives the model what Spectra remembers and tells it memory wins over the lists", () => {
    const [system, user] = briefMessages({ ...context, memory: "Macro IA commentary is already handed in." });
    expect(user!.content).toContain("What Spectra remembers about the student:\nMacro IA commentary is already handed in.");
    expect(system!.content).toContain("never suggest, mention or count a task or deadline the student said is done");
  });

  it("leaves memory out when there is none", () => {
    const [, user] = briefMessages(context);
    expect(user!.content).not.toContain("What Spectra remembers");
  });
});
