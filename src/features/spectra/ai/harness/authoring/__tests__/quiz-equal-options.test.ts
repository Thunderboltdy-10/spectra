import { describe, expect, it } from "vitest";
import { authorNew } from "../index";
import { sequentialIdFactory } from "../shared";

const context = { timeZone: "Europe/Madrid", ids: sequentialIdFactory() };
const quizWith = (options: string[], answer = options[0]) => ({
  items: [{ type: "multiple_choice", prompt: "Which value is the answer?", options, answer, explanation: "Because." }],
});

describe("quiz options that are the same answer in another form", () => {
  it.each([
    [["0.5", "1/2", "2", "4"]],
    [["50%", "0.5", "0.25", "1"]],
    [["1,000", "1000", "10", "100"]],
    [["3.0 m", "3 m", "6 m", "9 m"]],
    [["1.5 × 10^3 J", "1500 J", "150 J", "15 J"]],
    [["Paris", " paris", "Lyon", "Nice"]],
  ])("rejects %j", (options) => {
    expect(() => authorNew("quiz", quizWith(options), context)).toThrow(/same answer/);
  });

  it("allows different numbers and different units", () => {
    expect(() => authorNew("quiz", quizWith(["1.5 N", "5 N", "6 N", "0.67 N"], "6 N"), context)).not.toThrow();
    expect(() => authorNew("quiz", quizWith(["3 m", "3 s", "3 kg", "3 N"]), context)).not.toThrow();
    expect(() => authorNew("quiz", quizWith(["x = 2", "x = 3", "x = -2", "x = 4"]), context)).not.toThrow();
  });
});
