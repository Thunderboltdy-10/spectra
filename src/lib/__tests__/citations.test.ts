import { describe, expect, it } from "vitest";
import { inferCitations, rewriteCitationMarkers } from "@/lib/orchestrator/post-process";

describe("inferCitations", () => {
  it("adds validated web source metadata to search citations", () => {
    const citations = inferCitations(
      "Summarized research response",
      [],
      [
        {
          url: "https://example.com/research-paper",
          title: "Example Research Paper",
          domain: "example.com",
        },
      ],
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      sourceType: "search",
      url: "https://example.com/research-paper",
      filename: "Example Research Paper",
      title: "Example Research Paper",
      domain: "example.com",
    });
  });

  it("deduplicates search citations by URL while preserving stronger metadata", () => {
    const citations = inferCitations(
      "Research answer",
      [],
      [
        {
          url: "https://example.com/topic",
          title: "Topic",
          domain: "example.com",
        },
        {
          url: "https://example.com/topic",
          title: "Topic Deep Dive",
          domain: "example.com",
        },
      ],
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.filename).toBe("Topic Deep Dive");
    expect(citations[0]?.domain).toBe("example.com");
  });

  it("removes inline numeric citation markers while preserving text flow", () => {
    const rewritten = rewriteCitationMarkers(
      "Water boils at 100C [1] at sea level [2].",
      [
        { filename: "Source 1", sourceType: "search", url: "https://example.com/1" },
        { filename: "Source 2", sourceType: "search", url: "https://example.com/2" },
      ],
    );

    expect(rewritten).toBe("Water boils at 100C at sea level.");
  });

  it("does not strip markdown link labels", () => {
    const rewritten = rewriteCitationMarkers(
      "Read [OpenAI](https://openai.com) for details [1].",
      [{ filename: "OpenAI", sourceType: "search", url: "https://openai.com" }],
    );

    expect(rewritten).toContain("[OpenAI](https://openai.com)");
    expect(rewritten).not.toContain("[1]");
  });
});
