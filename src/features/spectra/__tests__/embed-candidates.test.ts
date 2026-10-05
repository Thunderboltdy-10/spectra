import { describe, expect, it } from "vitest";
import { rankEmbedCandidates } from "../components/embed-candidates";
import type { SpectraArtifact } from "../data/api";

const work = (id: string, title: string, updatedAt: number, extra: Partial<SpectraArtifact> = {}) =>
  ({
    _id: id,
    title,
    blueprintKey: "document",
    status: "active",
    tags: [],
    updatedAt,
    ...extra,
  }) as SpectraArtifact;

const artifacts = [
  work("old", "Cell biology", 1),
  work("new", "Essay plan", 30),
  work("mid", "Lab report", 20, { summary: "Osmosis in potato cells" }),
  work("self", "This document", 99),
  work("gone", "Deleted notes", 50, { status: "deleted" }),
];

const ids = (list: SpectraArtifact[]) => list.map((entry) => entry._id);

describe("embed picker candidates", () => {
  it("puts related work first, then the most recently changed, and never the container", () => {
    expect(ids(rankEmbedCandidates({ artifacts, containerId: "self", query: "" }))).toEqual(["new", "mid", "old"]);
    expect(
      ids(rankEmbedCandidates({ artifacts, containerId: "self", query: "", relatedIds: ["old"] })),
    ).toEqual(["old", "new", "mid"]);
  });

  it("matches every word in any order, not one substring of the whole query", () => {
    expect(ids(rankEmbedCandidates({ artifacts, containerId: "self", query: "biology cell" }))).toEqual(["old"]);
    expect(ids(rankEmbedCandidates({ artifacts, containerId: "self", query: "potato osmosis" }))).toEqual(["mid"]);
  });

  it("lists semantic hits first, in their order, then the word matches", () => {
    expect(
      ids(rankEmbedCandidates({ artifacts, containerId: "self", query: "cell", searchIds: ["new", "self", "gone"] })),
    ).toEqual(["new", "mid", "old"]);
  });
});
