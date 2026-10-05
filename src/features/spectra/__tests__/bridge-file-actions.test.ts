// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_URL,
  clearBridgeSession,
  openBridgeFile,
  persistBridgeSession,
  revealBridgeFile,
} from "../bridge/client";

const FILE = { grantId: "grant_ab", relativePath: "Essays/Cells.docx" };

describe("a work's file on this computer", () => {
  afterEach(() => {
    clearBridgeSession();
    vi.unstubAllGlobals();
  });

  it("asks the paired Bridge to open the file or show it in its folder", async () => {
    persistBridgeSession("session-token");
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await openBridgeFile(FILE);
    await revealBridgeFile(FILE);
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([`${BRIDGE_URL}/v1/file/open`, `${BRIDGE_URL}/v1/file/reveal`]);
    for (const [, init] of calls) {
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual(FILE);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-token");
    }
  });

  it("passes on Bridge's own sentence when it refuses", async () => {
    persistBridgeSession("session-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("This file is no longer in its folder on this computer.", { status: 400 })));
    await expect(openBridgeFile(FILE)).rejects.toThrow("This file is no longer in its folder on this computer.");
  });

  it("says to connect this computer when Bridge is not paired", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(revealBridgeFile(FILE)).rejects.toThrow("Connect this computer before showing its files.");
  });

  it("offers both actions in the work's status when its folder is on this computer", () => {
    const studio = fs.readFileSync(path.join(process.cwd(), "src/features/spectra/components/artifact-studio.tsx"), "utf8");
    expect(studio).toContain('"open-in-office": Boolean(statusLocalFile) && nativeOfficeDocument');
    expect(studio).toContain('"show-in-folder": Boolean(statusLocalFile)');
    expect(studio).toMatch(/kind === "open-in-office" \? openBridgeFile : revealBridgeFile/);
  });
});
