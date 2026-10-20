import { describe, expect, it } from "vitest";
import { matchClass } from "./bridgePlacement";

const classes = [
  "Physics HL",
  "Computer Science HL",
  "CS Drop-In DP2",
  "Mathematics",
  "Maths Analysis HL",
  "Economics SL",
  "Theory of Knowledge",
  "General",
].map((name) => ({ name }));

const match = (folder: string) => matchClass(folder, classes)?.name ?? null;

describe("matchClass", () => {
  it("puts a subject folder in its class", () => {
    expect(match("Physics")).toBe("Physics HL");
    expect(match("IB Physics notes")).toBe("Physics HL");
    expect(match("physics_hl")).toBe("Physics HL");
    expect(match("Econ")).toBe("Economics SL");
    expect(match("TOK")).toBe("Theory of Knowledge");
  });

  it("prefers the class whose name is closest", () => {
    expect(match("CS")).toBe("Computer Science HL");
    expect(match("Maths")).toBe("Mathematics");
    expect(match("Maths Analysis")).toBe("Maths Analysis HL");
  });

  it("leaves folders that name no class, or two equally", () => {
    expect(match("Downloads")).toBeNull();
    expect(match("HL")).toBeNull();
    expect(matchClass("Biology", [{ name: "Biology HL" }, { name: "Biology SL" }])).toBeNull();
  });
});
