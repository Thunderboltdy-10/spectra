import { describe, expect, it } from "vitest";
import {
  resolveBranchedParentMessageId,
  selectMessagesForBranch,
  summarizeBranchedMessages,
} from "../chatBranching";

describe("chat branching helpers", () => {
  it("keeps only the message prefix up to the pivot", () => {
    const messages = [
      { _id: "m1", role: "user" as const, content: "first", createdAt: 1 },
      { _id: "m2", role: "assistant" as const, content: "reply", createdAt: 2 },
      { _id: "m3", role: "user" as const, content: "second", createdAt: 3 },
    ];

    expect(selectMessagesForBranch(messages, "m2").map((message) => message._id)).toEqual(["m1", "m2"]);
  });

  it("summarizes the latest user prompt from the cloned prefix", () => {
    const messages = [
      { _id: "m1", role: "user" as const, content: "first", createdAt: 1 },
      { _id: "m2", role: "assistant" as const, content: "reply", createdAt: 2 },
      { _id: "m3", role: "user" as const, content: "second question", createdAt: 3 },
    ];

    expect(summarizeBranchedMessages(messages)).toEqual({
      latestUserPrompt: "second question",
      messageCount: 3,
    });
  });

  it("remaps assistant parents to the cloned chat ids", () => {
    const sourceToBranchedId = new Map<string, string>([["user_1", "branched_user_1"]]);

    expect(resolveBranchedParentMessageId("user_1", sourceToBranchedId)).toBe("branched_user_1");
    expect(resolveBranchedParentMessageId("missing_user", sourceToBranchedId)).toBeUndefined();
  });
});
