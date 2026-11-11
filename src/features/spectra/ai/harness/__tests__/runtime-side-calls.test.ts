import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ oneShot: vi.fn() }));
vi.mock("../subscription-runtime", async importOriginal => ({
  ...await importOriginal<typeof import("../subscription-runtime")>(), subscriptionOneShot: io.oneShot,
}));
import { modelThreadTitleWriter } from "../thread-title";
import { modelMemoryReflector } from "../memory-reflection";
import { defaultCompactor, modelSummariser } from "../run";
import { callSpectraModel } from "../model";

beforeEach(() => {
  io.oneShot.mockReset().mockResolvedValue({ text: '{"thread_title":"Physics revision","changes":[]}', toolCalls: [] });
  vi.stubEnv("SPECTRA_AI_RUNTIME", undefined);
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
  vi.stubEnv("SPECTRA_MODEL_CONTEXT_TOKENS", "9000");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["title", "compaction", "fold", "memory"])("keeps the foreground %s on its selected account and Codex model", async kind => {
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const runtime = { provider: "codex", accountId: "selected-owner", model: "gpt-6-luna", reasoning: "medium" as const };
  if (kind === "title") await modelThreadTitleWriter({ prompt: "physics revision", runtime }, signal);
  if (kind === "compaction") await defaultCompactor(runtime)({ system: { role: "system", content: "Summarize" },
    messages: Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: "x".repeat(3000) })), signal });
  if (kind === "fold") await modelSummariser({ transcript: "Earlier physics revision", runtime, signal });
  if (kind === "memory") await modelMemoryReflector({ prompt: "I study Physics HL", reply: "Understood", runtime,
    head: { enabled: true, about: "", preferences: "", topics: [] } }, signal);
  expect(io.oneShot).toHaveBeenCalledWith("codex", expect.objectContaining({ accountId: "selected-owner", model: "gpt-6-luna" }));
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["default", "daily"])("preserves the configured %s OpenRouter route", async kind => {
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] }));
  vi.stubGlobal("fetch", fetcher);
  await callSpectraModel({ messages: [], signal: new AbortController().signal,
    ...(kind === "daily" ? { purpose: "daily", runtime: { provider: "codex" } } as const : {}) });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(io.oneShot).not.toHaveBeenCalled();
});

it("honors a forced Codex route even when the paid provider is configured", async () => {
  vi.stubEnv("SPECTRA_AI_RUNTIME", "codex");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await callSpectraModel({ messages: [], signal: new AbortController().signal });
  expect(io.oneShot).toHaveBeenCalledWith("codex", expect.anything());
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ["title", "none", true],
  ["memory", "none", undefined],
  ["fold", "low", undefined],
] as const)("runs the %s side call at %s thinking, never at the run's own level", async (kind, level, small) => {
  const signal = new AbortController().signal;
  const runtime = { provider: "claude", accountId: "owner", model: "opus", reasoning: "high" as const };
  if (kind === "title") await modelThreadTitleWriter({ prompt: "physics revision", runtime }, signal);
  if (kind === "fold") await modelSummariser({ transcript: "Earlier physics revision", runtime, signal });
  if (kind === "memory") await modelMemoryReflector({ prompt: "I study Physics HL", reply: "Understood", runtime,
    head: { enabled: true, about: "", preferences: "", topics: [] } }, signal);
  expect(io.oneShot).toHaveBeenCalledWith("claude", expect.objectContaining({ reasoning: level, small }));
});

it("picks the smallest Codex model in the account's list for titles", async () => {
  const { smallestCodexModel } = await import("../subscription-runtime");
  expect(smallestCodexModel([{ id: "gpt-6-luna" }, { id: "gpt-6-luna-mini" }, { id: "gpt-6-luna-nano" }])).toBe("gpt-6-luna-nano");
  expect(smallestCodexModel([{ id: "gpt-6-luna" }, { id: "gpt-6-luna-mini" }])).toBe("gpt-6-luna-mini");
  expect(smallestCodexModel([{ id: "gpt-6-luna" }])).toBeUndefined();
});
