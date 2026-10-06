import { describe, expect, it } from "vitest";
import { authorNew } from "../authoring";
import type { ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { DEFAULT_PERMISSION_PREFS } from "../permissions";
import { SPECTRA_SYSTEM_PROMPT } from "../prompt";
import { runHarness, type HarnessEvent } from "../run";
import { citedSources, mergeSources, webSourceId, withoutCitations } from "../sources";
import type { ModelTurn } from "../types";

/*
 * Citations: what a run reads becomes a source its reply can cite, and the
 * saved reply keeps only the sources it really cites.
 */

const model = (turns: ModelTurn[]): ModelCaller => {
  let index = 0;
  return async ({ onText }) => {
    const turn = turns[Math.min(index++, turns.length - 1)]!;
    if (turn.text) onText(turn.text);
    return turn;
  };
};

const URL_A = "https://example.org/photosynthesis";

const backend = () =>
  new MemoryBackend({
    artifacts: [
      {
        id: "doc1",
        type: "document",
        title: "Week 6 notes",
        content: authorNew("document", { markdown: "# Light reactions\n\nChlorophyll absorbs light." }, { timeZone: "UTC" }).content,
      },
    ],
    webSearch: async () => [{ title: "Photosynthesis explained", url: URL_A, snippet: "Light reactions happen in the thylakoids." }],
  });

describe("run sources", () => {
  it("gives a web page the same id every time, without characters a citation cannot hold", () => {
    expect(webSourceId(URL_A)).toBe(webSourceId(URL_A));
    expect(webSourceId(URL_A)).not.toBe(webSourceId(`${URL_A}/2`));
    expect(webSourceId(URL_A)).toMatch(/^web-[0-9a-z]+$/);
  });

  it("keeps one entry per source, first read first", () => {
    const merged = mergeSources(
      [{ id: "a", title: "A", workId: "a" }],
      [
        { id: "b", title: "B", url: "https://b.example" },
        { id: "a", title: "A, renamed", workId: "a" },
      ],
    );
    expect(merged.map((source) => [source.id, source.title])).toEqual([
      ["a", "A, renamed"],
      ["b", "B"],
    ]);
  });

  it("keeps only what the reply cites, and plain text drops the citations", () => {
    const read = [
      { id: "doc1", title: "Week 6 notes", workId: "doc1" },
      { id: "web-x", title: "Site", url: "https://x.example" },
    ];
    const reply = "Chlorophyll absorbs light [[cite:doc1:light-reactions|Week 6 notes]]. See [[ref:doc2|Lab report]].";
    expect(citedSources(reply, read)).toEqual([read[0]]);
    expect(citedSources("No citations here.", read)).toEqual([]);
    expect(withoutCitations(reply)).toBe("Chlorophyll absorbs light. See Lab report.");
  });

  it("collects what the run read and streams it, so the live reply's citations open", async () => {
    const events: HarnessEvent[] = [];
    const id = webSourceId(URL_A);
    const result = await runHarness({
      runId: "r1",
      backend: backend(),
      signal: new AbortController().signal,
      prompt: "How do light reactions work?",
      environment: { now: 0 },
      permissions: DEFAULT_PERMISSION_PREFS,
      captionWriter: null,
      compactor: null,
      callModel: model([
        {
          text: "",
          toolCalls: [
            { id: "t1", name: "web_search", arguments: JSON.stringify({ query: "light reactions" }) },
            { id: "t2", name: "read_artifact", arguments: JSON.stringify({ id: "doc1" }) },
          ],
        },
        { text: `They happen in the thylakoids [[cite:${id}:page|Photosynthesis explained]].`, toolCalls: [] },
      ]),
      sink: { emit: (event) => events.push(event), checkpoint: async () => {} },
    });
    // Independent reads run together, so they may land in either order.
    expect(result.state.sources).toHaveLength(2);
    expect(result.state.sources).toEqual(
      expect.arrayContaining([
        { id, title: "Photosynthesis explained", url: URL_A },
        { id: "doc1", title: "Week 6 notes", workId: "doc1" },
      ]),
    );
    const streamed = events.filter((event) => event.type === "sources");
    expect(streamed.at(-1)).toMatchObject({ sources: result.state.sources });
    expect(citedSources(result.state.text, result.state.sources)).toEqual([{ id, title: "Photosynthesis explained", url: URL_A }]);
  });

  it("tells the model how to cite", () => {
    expect(SPECTRA_SYSTEM_PROMPT).toContain("[[cite:SOURCE:WHERE|Label]]");
  });
});
