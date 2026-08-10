/**
 * Drive a real Chrome over CDP and photograph the landing page.
 *
 * The story is a scroll-driven film with a WebGL prism and a WebGL field in
 * it, so the only honest way to check a change is to look at it in a browser
 * that has a GPU path. Headless Chrome with SwiftShader gives us that without
 * a display, and CDP needs no dependency beyond Node's own WebSocket.
 *
 *   node scripts/shoot-landing.mjs [--out .shots] [--url http://localhost:3000/landing]
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const OUT = (() => {
  const raw = args.get("out") ?? ".shots";
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
})();
const URL_ = args.get("url") ?? "http://localhost:3000/landing";
const PORT = Number(args.get("port") ?? 9339);
const WIDTH = Number(args.get("width") ?? 1440);
const HEIGHT = Number(args.get("height") ?? 900);

const CHROME =
  args.get("chrome") ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((path) => existsSync(path));

if (!CHROME) throw new Error("No Chrome found. Pass --chrome <path>.");

/**
 * Scroll depths worth a look.
 *
 * Hard-coded depths rot the moment a scene's budget changes, and a run that
 * photographs the wrong scenes is worse than no run at all. So the plan is
 * measured instead: scroll the page in steps, ask which scene is centred in the
 * frame at each step, and keep the window over which each one held. The camera
 * parks for the whole of a scene's hold, so any depth inside that window frames
 * it — this takes one about two thirds through, by which point most of the
 * choreography has played but the scene has not yet started leaving.
 */
const EXPLICIT = args.get("shots")
  ? args
      .get("shots")
      .split(",")
      .map((pair, i) => {
        const [name, y] = pair.includes(":") ? pair.split(":") : [`${i}`, pair];
        return [name, Number(y)];
      })
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "spectra-cdp-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    /* SwiftShader so WebGL works without a GPU. The field and the prism are
       both GL, and a run that silently fell back would prove nothing. */
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let version;
for (let i = 0; i < 60; i++) {
  try {
    version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
    break;
  } catch {
    await sleep(500);
  }
}
if (!version) {
  chrome.kill();
  throw new Error("Chrome never opened a debugging port");
}

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiters = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiters.has(msg.id)) {
    waiters.get(msg.id)(msg);
    waiters.delete(msg.id);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const n = ++id;
    waiters.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { result: target } = await send("Target.createTarget", { url: "about:blank" });
const { result: att } = await send("Target.attachToTarget", {
  targetId: target.targetId,
  flatten: true,
});
const session = att.sessionId;
await send("Page.enable", {}, session);
await send("Runtime.enable", {}, session);
await send("Log.enable", {}, session);
/* React reports "Maximum update depth exceeded" through console.error with the
   offending component stack as a later argument, and CDP only delivers those
   arguments on `Runtime.consoleAPICalled`. Without this the log says "Uncaught"
   and nothing else, which is exactly the case worth diagnosing. */
await send("Runtime.setAsyncCallStackDepth", { maxDepth: 32 }, session);
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
}, session);

await send("Page.navigate", { url: URL_ }, session);

/* Dev compiles on first request, and the story only publishes its real height
   once the engine is running. Poll for that rather than guessing a sleep: a
   fixed wait is either too short (and photographs a collapsed page) or too
   long (and wastes a minute on every run). */
const ready = async () => {
  for (let i = 0; i < 90; i++) {
    const { result } = await send(
      "Runtime.evaluate",
      {
        returnByValue: true,
        expression: `({
          height: document.documentElement.scrollHeight,
          grain: !!document.querySelector(".spectra-grain-canvas"),
        })`,
      },
      session,
    );
    const value = result?.result?.value;
    if (value?.height > 5000 && value.grain) return true;
    await sleep(1000);
  }
  return false;
};
if (!(await ready())) {
  console.warn("! story never reached full height; shooting anyway");
}

/* The consent dialog is real product chrome, but it covers the composition we
   came to look at. Accept it the way a visitor would. */
await send(
  "Runtime.evaluate",
  {
    expression: `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((b) => /accept all/i.test(b.textContent || ""));
      button?.click();
    })()`,
  },
  session,
);
await sleep(Number(args.get("settle") ?? 2500));

/**
 * Measure which scene is framed at each depth, and derive the shot list.
 *
 * The probe is deliberately coarse and cheap — no waiting for the camera to
 * settle, because it only needs to know which composition *will* be framed, not
 * what it looks like when it arrives.
 */
async function planShots() {
  const { result } = await send(
    "Runtime.evaluate",
    {
      returnByValue: true,
      awaitPromise: true,
      expression: `(async () => {
        const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const total = document.documentElement.scrollHeight - innerHeight;
        const seen = new Map();
        for (let y = 0; y <= total; y += Math.max(40, Math.round(total / 260))) {
          scrollTo(0, y);
          await wait();
          const middle = innerHeight / 2;
          let best = null;
          let bestGap = Infinity;
          for (const node of document.querySelectorAll("[data-scene]")) {
            const box = node.getBoundingClientRect();
            if (box.height < 4) continue;
            const gap = Math.abs(box.top + box.height / 2 - middle);
            if (gap < bestGap) { bestGap = gap; best = node.dataset.scene; }
          }
          /* Only count a scene as framed when its centre is genuinely near the
             frame's centre; mid-travel neither scene is, and photographing a
             transition tells us nothing about either composition. */
          if (!best || bestGap > innerHeight * 0.3) continue;
          const range = seen.get(best) ?? [y, y];
          range[1] = y;
          seen.set(best, range);
        }
        scrollTo(0, 0);
        return [...seen].map(([scene, [from, to]]) => [scene, Math.round(from + (to - from) * 0.66)]);
      })()`,
    },
    session,
  );
  const measured = result?.result?.value ?? [];
  return measured.map(([scene, y], i) => [
    `${String(i).padStart(2, "0")}-${scene}`,
    y,
  ]);
}

const SHOTS = EXPLICIT ?? (await planShots());
console.log(`plan: ${SHOTS.map(([n, y]) => `${n}@${y}`).join("  ")}\n`);
await sleep(1200);

for (const [name, y] of SHOTS) {
  await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` }, session);
  /* The camera is damped, so the composition arrives a beat after the scroll. */
  await sleep(Number(args.get("hold") ?? 2400));
  const { result: shot } = await send("Page.captureScreenshot", { format: "png" }, session);
  if (shot?.data) {
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    process.stdout.write(`shot ${name} @ ${y}\n`);
  }
}

const { result: diag } = await send(
  "Runtime.evaluate",
  {
    returnByValue: true,
    expression: `(() => {
      const canvas = document.querySelector(".spectra-grain-canvas");
      const host = document.querySelector(".landing-field");
      const prism = document.querySelector("[data-prism-layer] canvas");
      return {
        docHeight: document.documentElement.scrollHeight,
        grainCanvas: !!canvas,
        grainLive: canvas?.dataset.live ?? null,
        grainGpu: host?.dataset.gpu ?? null,
        grainDevice: canvas ? canvas.width + "x" + canvas.height : null,
        prismCanvas: !!prism,
        fieldCell: host ? getComputedStyle(host).getPropertyValue("--field-cell").trim() : null,
      };
    })()`,
  },
  session,
);
console.log("\ndiagnostics:", JSON.stringify(diag?.result?.value, null, 2));

const bad = events.filter(
  (e) =>
    (e.method === "Log.entryAdded" && e.params.entry.level === "error") ||
    e.method === "Runtime.exceptionThrown" ||
    (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"),
);
console.log(`\nconsole errors: ${bad.length}`);
const seen = new Set();
for (const e of bad) {
  const detail = e.params.entry ?? e.params.exceptionDetails ?? e.params;
  const parts = [];
  const push = (value) => {
    if (value === undefined || value === null || value === "") return;
    parts.push(String(value));
  };
  push(detail.text);
  push(detail.exception?.description);
  for (const arg of e.params.args ?? detail.args ?? []) {
    push(arg.description ?? (arg.value !== undefined ? JSON.stringify(arg.value) : ""));
  }
  for (const call of detail.stackTrace?.callFrames?.slice(0, 8) ?? []) {
    push(`  at ${call.functionName || "(anon)"} ${call.url.split("/").pop()}:${call.lineNumber + 1}`);
  }
  const text = parts.join("\n");
  /* React repeats the same warning on every re-render; the first one carries
     the same stack as the thousandth. */
  const key = text.slice(0, 120);
  if (seen.has(key)) continue;
  seen.add(key);
  console.log("\n---\n" + text.slice(0, 2600));
}

ws.close();
chrome.kill();
