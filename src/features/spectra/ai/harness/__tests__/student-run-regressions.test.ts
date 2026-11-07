import { describe, expect, it } from "vitest";
import { workPreview } from "../../../artifacts/work-preview";
import { authorNew } from "../authoring";
import { openQuizForPractice } from "../authoring/items";
import { parseBlocks } from "../authoring/markdown";
import { sheetsFromSpec } from "../authoring/sheets";
import { createRoomLoadCache, loadRoomThroughCache, mergeRoomLoad } from "../../../../../../scripts/collaboration-room-state.mjs";

const nodeTypes = (nodes: Array<{ type: string; content?: unknown[] }>): string[] =>
  nodes.flatMap((node) => [node.type, ...nodeTypes((node.content ?? []) as Array<{ type: string; content?: unknown[] }>)]);

describe("maths written with backslash brackets", () => {
  it("becomes equations instead of bare brackets", () => {
    const nodes = parseBlocks("Wave speed \\(v = f\\lambda\\) holds.\n\n\\[ f_{obs}=f_s\\frac{v}{v-v_s} \\]");
    const types = nodeTypes(nodes);
    expect(types).toContain("inlineEquation");
    expect(JSON.stringify(nodes)).not.toContain("[ f_");
    expect(JSON.stringify(nodes)).not.toContain("(v = f");
  });

  it("leaves code fences as written", () => {
    const nodes = parseBlocks("```latex\n\\(x\\)\n```");
    expect((nodes[0]!.content?.[0] as { text?: string }).text).toBe("\\(x\\)");
    expect(nodeTypes(nodes)).not.toContain("inlineEquation");
  });
});

describe("sheets the model writes", () => {
  const sheet = (rows: unknown[][]) =>
    sheetsFromSpec({ sheets: [{ name: "Planner", rows: rows as never }] }).content.sheets[0]!;

  it("grow columns to fit their text, keyed the way the grid reads them", () => {
    const written = sheet([["Object", "Why it fits the prompt"], ["Error bars", "Shows how much we trust a number"]]);
    expect(written.columnWidths?.["1"]).toBeGreaterThan(122);
    expect(written.columnWidths?.A).toBeUndefined();
  });

  it("wrap text too long for any column", () => {
    const long = "A teacher's comment on a returned essay shows how knowledge is judged by someone with authority in the subject.";
    const written = sheet([["Note"], [long]]);
    expect(written.cells.A2?.format?.wrap).toBe(true);
    expect(written.rowHeights?.["1"]).toBeGreaterThan(31);
  });

  it("put an explicit width where the grid reads it", () => {
    const written = sheetsFromSpec({ sheets: [{ name: "S", rows: [["a"]], columnWidths: { B: 200 } }] }).content.sheets[0]!;
    expect(written.columnWidths?.["1"]).toBe(200);
  });
});

describe("a student's quiz", () => {
  const made = () =>
    authorNew(
      "quiz",
      { items: [{ type: "multiple_choice", prompt: "2 + 2?", options: ["3", "4"], answer: "4" }] },
      { timeZone: "UTC" },
    ).content;

  it("opens when complete", () => {
    expect(openQuizForPractice(made())?.published).toBe(true);
  });

  it("stays closed with no questions", () => {
    expect(openQuizForPractice({ questions: [] })).toBeNull();
  });
});

describe("a page in the Library", () => {
  it("is shown by its words, not its markup", () => {
    const source = "<!doctype html><html><head><title>t</title><style>a{}</style></head><body><h1>Doppler lab</h1><p>Move the source.</p><script>let x=1</script></body></html>";
    const preview = workPreview("code", { entryFileId: "f", files: [{ id: "f", path: "index.html", source }] });
    expect(preview).toMatchObject({ kind: "text", heading: "Doppler lab" });
    expect(JSON.stringify(preview)).not.toContain("doctype");
  });
});

describe("a gateway room copy", () => {
  const known = { roomId: "r", schemaVersion: 1, nextSequence: 3, lastSnapshotAt: 5, snapshot: { update: "s" }, updates: [{ sequence: 1 }, { sequence: 2 }] };

  it("adds what came after it", () => {
    const merged = mergeRoomLoad(known, { roomId: "r", schemaVersion: 1, nextSequence: 4, lastSnapshotAt: 5, updates: [{ sequence: 3 }] });
    expect(merged?.updates).toHaveLength(3);
    expect(merged?.snapshot).toEqual({ update: "s" });
  });

  it("never keeps a room shut when its copy has fallen behind a snapshot", async () => {
    const cache = createRoomLoadCache();
    const payload = { artifactId: "a", partitionKey: "root", policyVersion: 1 };
    cache.put("a", "root", 1, known);
    const whole = { roomId: "r", schemaVersion: 1, nextSequence: 18, snapshot: { update: "folded", throughSequence: 11 }, updates: [] };
    const asked: Array<number | undefined> = [];
    const load = async (request: { afterSequence?: number }) => {
      asked.push(request.afterSequence);
      // The rows the copy wanted were folded away, so the read refuses.
      if (request.afterSequence) throw new Error("COLLABORATION_REPLAY_GENERATION_CHANGED");
      return whole;
    };
    await expect(loadRoomThroughCache(cache, load, payload)).resolves.toBe(whole);
    expect(asked).toEqual([2, undefined]);
  });

  it("passes on any other trouble reading a room", async () => {
    const cache = createRoomLoadCache();
    cache.put("a", "root", 1, known);
    const load = async () => { throw new Error("COLLABORATION_ACCESS_REVOKED"); };
    await expect(loadRoomThroughCache(cache, load, { artifactId: "a", partitionKey: "root", policyVersion: 1 })).rejects.toThrow("REVOKED");
  });

  it("is dropped when the room was reset or a piece is missing", () => {
    expect(mergeRoomLoad(known, { roomId: "other", schemaVersion: 1, nextSequence: 4, updates: [] })).toBeNull();
    expect(mergeRoomLoad(known, { roomId: "r", schemaVersion: 1, nextSequence: 2, updates: [] })).toBeNull();
    expect(mergeRoomLoad(known, { roomId: "r", schemaVersion: 1, nextSequence: 6, lastSnapshotAt: 5, updates: [{ sequence: 5 }] })).toBeNull();
    expect(mergeRoomLoad(known, { roomId: "r", schemaVersion: 1, nextSequence: 4, lastSnapshotAt: 1, updates: [] })).toBeNull();
  });
});
