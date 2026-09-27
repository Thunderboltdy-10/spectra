/** Offline capture at the real request boundary. Fetch is intercepted; no provider call. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getEncoding } from "js-tiktoken";
import { callModel } from "../../../src/app/api/spectra/run/loop/plan";
import type { ProvisionalCreation } from "../../../src/app/api/spectra/run/loop/intake";

async function main() {
  const label = process.argv[2];
  if (label !== "before" && label !== "after") throw new Error("Supply before or after.");
  const encoding = getEncoding("o200k_base");
  const directory = path.resolve(".spectra-local/launch-s11/craft/request-corpus", label);
  mkdirSync(directory, { recursive: true });
  const sourceFiles = [
    "src/app/api/spectra/run/loop/plan.ts", "src/features/spectra/ai/workspace-assistant-prompt.ts",
    "src/features/spectra/tools/registry/application-tools.ts", "src/features/spectra/quality/rubrics.ts",
    ...(label === "after" ? ["src/features/spectra/ai/prompt-messages.ts", "src/features/spectra/artifacts/skill-guidance.ts"] : []),
  ];
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (label === "before" && source !== execFileSync("git", ["show", `f9b5c686:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n"))
      throw new Error(`Before request capture requires pre-prefix f9b5c686 source for ${file}.`);
    return [file, createHash("sha256").update(source).digest("hex")];
  }));
  const cases: Array<{ id: string; prompt: string; context: unknown; assignment?: ProvisionalCreation }> = [
    { id: "simple", prompt: "Explain why we have leap years in two sentences.", context: {} },
    { id: "document", prompt: "Create a short letter thanking the workshop volunteers, without section headings.", context: {}, assignment: { blueprintKey: "document", label: "Document", clause: "Create the requested thank-you letter." } },
    { id: "presentation", prompt: "Create an eight-slide handout comparing two rehearsal plans using the same two-column layout throughout and 18px body text.", context: {}, assignment: { blueprintKey: "presentation", label: "Presentation", clause: "Create the requested comparison handout." } },
    { id: "sheets", prompt: "Create a rehearsal budget workbook with labelled inputs, calculated costs, clear units and a total.", context: {} },
    { id: "mixed", prompt: "Create a decision note and a three-slide briefing about two rehearsal plans, and explain their tradeoffs.", context: {} },
    { id: "continuation", prompt: "Explain the uncertainty in one sentence.", context: { currentView: "library", conversation: [{ role: "user", content: "We observed two rehearsals." }, { role: "assistant", content: "That is a small sample." }] } },
  ];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalInstance = process.env.SPECTRA_LOCAL_INSTANCE;
  const results: Array<Record<string, unknown>> = [];
  try {
    process.env.OPENROUTER_API_KEY = "offline-intercept-only";
    process.env.SPECTRA_LOCAL_INSTANCE = "";
    for (const entry of cases) {
      const controller = new AbortController();
      let packet: { messages: Array<{ role: string; content: unknown }>; tools?: unknown } | undefined;
      globalThis.fetch = async (url, options) => {
        if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Unexpected offline fetch boundary");
        packet = JSON.parse(String(options?.body));
        controller.abort();
        throw new DOMException("Offline request captured", "AbortError");
      };
      try {
        await callModel("chat", entry.prompt, entry.context, [], undefined, undefined, controller.signal,
          undefined, undefined, undefined, undefined, undefined, entry.assignment);
      } catch (error) {
        if (!controller.signal.aborted || !packet) throw error;
      }
      if (!packet) throw new Error(`No packet captured for ${entry.id}`);
      const messageTokens = packet.messages.map((message) => ({
        role: message.role,
        tokens: encoding.encode(typeof message.content === "string" ? message.content : JSON.stringify(message.content)).length,
      }));
      const toolSchemaTokens = encoding.encode(JSON.stringify(packet.tools ?? [])).length;
      const measured = {
        id: entry.id, assignment: entry.assignment ?? null,
        systemTokens: messageTokens.filter((message) => message.role === "system").reduce((sum, message) => sum + message.tokens, 0),
        stableFirstSystemTokens: messageTokens[0]?.tokens ?? 0, messageTokens, toolSchemaTokens,
        componentTokenSum: messageTokens.reduce((sum, message) => sum + message.tokens, 0) + toolSchemaTokens,
        requestJsonBytes: Buffer.byteLength(JSON.stringify(packet)),
      };
      results.push(measured);
      writeFileSync(path.join(directory, `${entry.id}.json`), JSON.stringify({ packet, measured }, null, 2));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalInstance === undefined) delete process.env.SPECTRA_LOCAL_INSTANCE; else process.env.SPECTRA_LOCAL_INSTANCE = originalInstance;
  }
  const output = { label, encoding: "o200k_base", sourceHashes, sourceHashNewlines: "LF", results,
    scope: "Real application request assembly with fetch intercepted before dispatch. Exact component tokenizer counts exclude provider framing/serialization. No provider usage, cache-hit, latency or saved-artifact claim." };
  writeFileSync(path.join(directory, "token-counts.json"), JSON.stringify(output, null, 2));
  process.stdout.write(JSON.stringify(output));
}

void main().catch((error: unknown) => { process.stderr.write(String(error)); process.exitCode = 1; });
