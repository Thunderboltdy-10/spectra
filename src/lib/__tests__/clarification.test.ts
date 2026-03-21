import { describe, expect, it } from "vitest";
import {
  buildRecentContextSnapshot,
  formatClarificationAsText,
  needsClarification,
  parseRecentContext,
  serializeRecentContext,
} from "@/lib/orchestrator/clarification";

describe("needsClarification", () => {
  it("asks clarification for vague research requests in T2+", () => {
    const decision = needsClarification({
      requestClass: "T2",
      mode: "research",
      message: "Research climate change",
    });

    expect(decision).not.toBeNull();
    expect(decision?.block.questions.length).toBeGreaterThan(0);
  });

  it("does not ask clarification for clear research scopes", () => {
    const decision = needsClarification({
      requestClass: "T2",
      mode: "research",
      message: "Research the impact of carbon taxes in the EU since 2020 with 5 sources.",
    });

    expect(decision).toBeNull();
  });

  it("does not ask clarification for T1 requests", () => {
    const decision = needsClarification({
      requestClass: "T1",
      mode: "research",
      message: "Research climate change",
    });

    expect(decision).toBeNull();
  });

  it("asks clarification on conflicting recency vs no-search directives", () => {
    const decision = needsClarification({
      requestClass: "T2",
      mode: "research",
      message: "Give me the latest AI policy updates but do not search the web.",
    });

    expect(decision).not.toBeNull();
    expect(decision?.reason.toLowerCase()).toContain("recency");
  });
});

describe("recent context cache", () => {
  it("round-trips serialized cache when TTL is valid", () => {
    const now = Date.now();
    const snapshot = buildRecentContextSnapshot({
      requestClass: "T2",
      mode: "research",
      retrieval: {
        citations: [
          {
            filename: "source.pdf",
            sourceType: "pack",
            text: "retrieved context",
          },
        ],
        sourceBlock: "retrieved block",
        diagnostics: {
          scopesAttempted: ["pack"],
          status: "retrieved",
          reason: "ok",
          embeddingModel: "openai/text-embedding-3-large",
        },
      },
      search: {
        text: "search summary",
        urls: ["https://example.com/a"],
        sources: [
          {
            url: "https://example.com/a",
            title: "Example",
            domain: "example.com",
            snippet: "snippet",
          },
        ],
        provider: "searxng",
      },
      clarification: {
        context: "Need clarification",
        questions: [
          {
            id: "scope",
            text: "What scope?",
            type: "free_text",
          },
        ],
      },
      now,
    });

    const parsed = parseRecentContext({
      raw: serializeRecentContext(snapshot),
      savedAt: now,
      now: now + 60_000,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.search.provider).toBe("searxng");
    expect(parsed?.retrieval.citations.length).toBe(1);
  });

  it("expires cache beyond ttl", () => {
    const now = Date.now();
    const snapshot = buildRecentContextSnapshot({
      requestClass: "T2",
      mode: "research",
      retrieval: {
        citations: [],
        sourceBlock: "",
      },
      search: {
        text: "",
        urls: [],
        sources: [],
        provider: "disabled",
      },
      clarification: {
        context: "Need clarification",
        questions: [
          {
            id: "scope",
            text: "What scope?",
            type: "free_text",
          },
        ],
      },
      now,
    });

    const parsed = parseRecentContext({
      raw: serializeRecentContext(snapshot),
      savedAt: now,
      now: now + 10 * 60_000,
    });

    expect(parsed).toBeNull();
  });
});

describe("formatClarificationAsText", () => {
  it("formats context and question lines", () => {
    const formatted = formatClarificationAsText({
      context: "Before I continue",
      questions: [
        {
          id: "scope",
          text: "What scope should I use?",
          type: "single_choice",
          options: [
            { id: "a", label: "Short" },
            { id: "b", label: "Deep" },
          ],
        },
      ],
    });

    expect(formatted).toContain("Before I continue");
    expect(formatted).toContain("1. What scope should I use?");
    expect(formatted).toContain("Options: Short / Deep");
  });
});
