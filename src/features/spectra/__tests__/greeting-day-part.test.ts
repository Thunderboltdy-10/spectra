import { describe, expect, it } from "vitest";
import { dayPart } from "../today/day-sky";
import { firstQuestions, greeting } from "../today/today-model";

describe("Home's greeting and its brief agree on the part of day (F7)", () => {
  it("names the same part for every hour", () => {
    for (let hour = 5; hour < 24; hour++) {
      expect(greeting(hour, "Andrew").toLowerCase(), `hour ${hour}`).toContain(dayPart(hour === 22 || hour === 23 ? 18 : hour));
    }
    expect(greeting(17, "Andrew")).toBe("Good evening, Andrew.");
    expect(greeting(2)).toBe("Still up.");
  });
});

describe("a new account's first questions (F9)", () => {
  const now = new Date(2026, 10, 11, 9).getTime();
  it("draw on a due date, the last work and a class, three at most", () => {
    const due = { id: "d", kind: "official_deadline", title: "Physics IA draft", startAt: now + 86_400_000 } as never;
    const questions = firstQuestions({ agenda: { today: [], upcoming: [due], open: [] }, recentWork: { title: "Waves notes" }, className: "Maths AA HL", now });
    expect(questions.map((question) => question.title)).toEqual(["Get started on Physics IA draft", "Ask about Waves notes", "Quiz me on Maths AA HL"]);
    expect(questions[0]!.why).toBe("It's due tomorrow.");
    expect(questions.every((question) => question.kind === "ask")).toBe(true);
  });
  it("are still three with nothing to draw on", () => {
    expect(firstQuestions({ agenda: null, now })).toHaveLength(3);
  });
});
