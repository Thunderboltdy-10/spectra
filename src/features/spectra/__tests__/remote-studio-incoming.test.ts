import { describe, expect, it } from "vitest";
import {
  decideRemoteStudioIncoming,
  richTextValuesEquivalent,
  shouldEmitRichTextChange,
} from "../components/artifact-studio-value-utils";

describe("rich text hydrate echoes", () => {
  it("treats TipTap paragraph wraps of plain prompts as equivalent", () => {
    expect(
      richTextValuesEquivalent(
        "What should this quiz check?",
        "<p>What should this quiz check?</p>",
      ),
    ).toBe(true);
    expect(richTextValuesEquivalent("", "<p></p>")).toBe(true);
    expect(
      richTextValuesEquivalent("What should this quiz check?", "<p>Changed</p>"),
    ).toBe(false);
  });

  it("does not emit hydrate or focus-blur echoes without typing", () => {
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>What should this quiz check?</p>",
        typedWhileFocused: false,
      }),
    ).toBe(false);
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>What should this quiz check?</p>",
        typedWhileFocused: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitRichTextChange({
        committedValue: "What should this quiz check?",
        nextHtml: "<p>A clearer question</p>",
        typedWhileFocused: true,
      }),
    ).toBe(true);
  });
});

describe("remote studio incoming decisions", () => {
  const base = {
    incomingKey: "incoming",
    baselineKey: "baseline",
    dismissedRemoteKey: null as string | null,
    isLocalSyncKey: false,
    isCollaborative: true,
    nativeOfficeDocument: false,
  };

  it("accepts bootstrap echoes when dirty without a human edit", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: false,
      }),
    ).toBe("accept-bootstrap");
  });

  it("treats matching local sync keys as acknowledgements", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        isLocalSyncKey: true,
      }),
    ).toBe("accept-local-sync");
  });

  it("rebases collaborative human drafts and conflicts otherwise", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
      }),
    ).toBe("rebase");
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        isCollaborative: false,
      }),
    ).toBe("conflict");
  });

  it("ignores same-key or dismissed incoming snapshots", () => {
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        incomingKey: "baseline",
        baselineKey: "baseline",
      }),
    ).toBe("ignore");
    expect(
      decideRemoteStudioIncoming({
        ...base,
        dirty: true,
        userHasEdited: true,
        dismissedRemoteKey: "incoming",
      }),
    ).toBe("ignore");
  });
});
