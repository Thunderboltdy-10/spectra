import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { RELAY_END_FRAME, installRunRelay, readRunRelayTicket, signRunRelayTicket } from "./run-relay.mjs";

const key = "k".repeat(40);
const soon = () => Date.now() + 60_000;
const opened = [];

async function relay(options = {}) {
  const http = createServer();
  const installed = installRunRelay(http, { key, endGraceMs: 5, ...options });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const url = `ws://127.0.0.1:${http.address().port}/_spectra/run-relay`;
  opened.push(() => {
    installed.close();
    http.close();
  });
  return { url, installed };
}

function connect(url, role, sub = "run-1", signingKey = key, headers) {
  const ticket = signRunRelayTicket({ sub, role, exp: soon() }, signingKey);
  const socket = new WebSocket(`${url}/${role}`, ["spectra-run-relay", ticket], { headers });
  socket.on("error", () => undefined);
  opened.push(() => socket.terminate());
  return socket;
}

const collect = (socket) => {
  const frames = [];
  socket.on("message", (data) => frames.push(String(data)));
  return frames;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check) => {
  for (let tries = 0; tries < 200 && !check(); tries += 1) await wait(5);
  expect(check()).toBe(true);
};

afterEach(() => {
  for (const close of opened.splice(0)) close();
});

describe("run relay", () => {
  it("delivers frames as they are published", async () => {
    const { url } = await relay();
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    const watcher = connect(url, "watch");
    const frames = collect(watcher);
    await once(watcher, "open");
    publisher.send("one");
    publisher.send("two");
    await until(() => frames.length === 2);
    expect(frames).toEqual(["one", "two"]);
  });

  it("gives a page that subscribes late what it missed", async () => {
    const { url } = await relay();
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    publisher.send("early");
    await wait(20);
    const watcher = connect(url, "watch");
    const frames = collect(watcher);
    await until(() => frames.length === 1);
    publisher.send("later");
    await until(() => frames.length === 2);
    expect(frames).toEqual(["early", "later"]);
  });

  it("still gives a whole run to a page that subscribes after it ended", async () => {
    const { url } = await relay();
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    publisher.send("all of it");
    publisher.close();
    await once(publisher, "close");
    await wait(20);
    const watcher = connect(url, "watch");
    const frames = collect(watcher);
    await until(() => frames.length === 2);
    expect(frames).toEqual(["all of it", RELAY_END_FRAME]);
  });

  it("tells watchers when the worker goes, so they fall back to the saved log", async () => {
    const { url } = await relay();
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    const watcher = connect(url, "watch");
    const frames = collect(watcher);
    await once(watcher, "open");
    publisher.terminate();
    await once(watcher, "close");
    expect(frames).toEqual([RELAY_END_FRAME]);
  });

  it("keeps runs apart", async () => {
    const { url } = await relay();
    const a = connect(url, "publish", "run-a");
    await once(a, "open");
    const watcher = connect(url, "watch", "run-b");
    const frames = collect(watcher);
    await once(watcher, "open");
    a.send("not yours");
    await wait(30);
    expect(frames).toEqual([]);
  });

  it("refuses forged tickets, a watcher publishing and a browser publishing", async () => {
    const { url } = await relay();
    const refused = (socket) =>
      new Promise((resolve) => socket.on("unexpected-response", (_request, response) => resolve(response.statusCode)));
    expect(await refused(connect(url, "watch", "run-1", "x".repeat(40)))).toBe(401);
    const ticket = signRunRelayTicket({ sub: "run-1", role: "watch", exp: soon() }, key);
    const wrongRole = new WebSocket(`${url}/publish`, ["spectra-run-relay", ticket]);
    wrongRole.on("error", () => undefined);
    opened.push(() => wrongRole.terminate());
    expect(await refused(wrongRole)).toBe(401);
    expect(await refused(connect(url, "publish", "run-1", key, { origin: "https://example.com" }))).toBe(403);
  });

  it("keeps only a window of recent frames", async () => {
    const { url } = await relay({ windowBytes: 10 });
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    publisher.send("aaaaaaaa");
    publisher.send("bbbbbbbb");
    await wait(20);
    const watcher = connect(url, "watch");
    const frames = collect(watcher);
    await until(() => frames.length >= 1);
    expect(frames).toEqual(["bbbbbbbb"]);
  });

  it("forgets a finished run after a while", async () => {
    const { url, installed } = await relay({ idleMs: 10 });
    const publisher = connect(url, "publish");
    await once(publisher, "open");
    publisher.close();
    await once(publisher, "close");
    await until(() => installed.channelCount() === 0);
  });

  it("reads only its own tickets", () => {
    const ticket = signRunRelayTicket({ sub: "r", role: "watch", exp: soon() }, key);
    expect(readRunRelayTicket(ticket, key)?.sub).toBe("r");
    expect(readRunRelayTicket(ticket, "y".repeat(40))).toBeNull();
    expect(readRunRelayTicket(signRunRelayTicket({ sub: "r", role: "watch", exp: 1 }, key), key)).toBeNull();
    expect(readRunRelayTicket(signRunRelayTicket({ sub: "r", role: "admin", exp: soon() }, key), key)).toBeNull();
  });
});
