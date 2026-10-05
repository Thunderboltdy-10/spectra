import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { WIDGET_MESSAGE, buildWidgetDocument } from "../widget-document";
import { WIDGET_STOPPED_NOTE, WIDGET_WATCHDOG, guardWidgetScript, guardWidgetScripts, widgetWatchdogScript } from "../widget-watchdog";

const tick = WIDGET_WATCHDOG.tick;

/** A frame-like global: timers fire only on turn(), and the clock moves 1 ms a read. */
function frame() {
  let clock = 0;
  let timerId = 0;
  const posted: unknown[] = [];
  const replaced: Array<{ textContent: string; attributes: Record<string, string> }> = [];
  const cleared: number[] = [];
  const pending = new Map<number, () => void>();
  const sandbox: Record<string, unknown> = {
    setTimeout: (callback: () => void) => {
      pending.set(++timerId, callback);
      return timerId;
    },
    setInterval: () => ++timerId,
    clearTimeout: (id: number) => cleared.push(id),
    clearInterval: (id: number) => cleared.push(id),
    performance: { now: () => (clock += 1) },
    parent: { postMessage: (message: unknown) => posted.push(message) },
    document: {
      createElement: () => {
        const attributes: Record<string, string> = {};
        return { attributes, style: {}, textContent: "", setAttribute: (name: string, value: string) => (attributes[name] = value) };
      },
      body: { replaceChildren: (node: { textContent: string; attributes: Record<string, string> }) => replaced.push(node) },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(widgetWatchdogScript(WIDGET_MESSAGE), context);
  /** The page gets a turn: the timers due now run. */
  const turn = () => {
    const due = [...pending.values()];
    pending.clear();
    due.forEach((callback) => callback());
  };
  return { context, posted, replaced, cleared, turn, run: (code: string) => vm.runInContext(guardWidgetScript(code), context) };
}

describe("widget watchdog: guarding loops", () => {
  it("checks the watchdog in while, do-while and three-part for loops", () => {
    expect(guardWidgetScript("while (x < 3) x++;")).toBe(`while (${tick}()&&(x < 3)) x++;`);
    expect(guardWidgetScript("do { x++ } while (x)")).toBe(`do { x++ } while (${tick}()&&(x))`);
    expect(guardWidgetScript("for (let i = 0; i < n; i++) {}")).toBe(`for (let i = 0;${tick}()&&( i < n); i++) {}`);
    expect(guardWidgetScript("for (;;) {}")).toBe(`for (;${tick}();) {}`);
  });

  it("leaves for-of, for-in, properties, strings, comments, templates and regexes as written", () => {
    for (const code of [
      "for (const item of items) total += item;",
      "for (const key in record) keys.push(key);",
      "api.while(1); config.for = 2;",
      "const s = 'while (true) {}'; const d = \"for (;;)\";",
      "// while (true) {}\n/* for (;;) {} */ const a = 1;",
      "const t = `while (true) ${ 'for (;;)' }`;",
      "const r = /while (true)/g.test(x) ? a / b : c;",
    ])
      expect(guardWidgetScript(code)).toBe(code);
  });

  it("guards only JavaScript blocks of a widget", () => {
    const html = '<p>x</p><script>while (go) step()</script><script type="application/json">{"while (a)":1}</script><script type="module">for (;;) {}</script>';
    const guarded = guardWidgetScripts(html);
    expect(guarded).toContain(`while (${tick}()&&(go)) step()`);
    expect(guarded).toContain('{"while (a)":1}');
    expect(guarded).toContain(`for (;${tick}();) {}`);
  });

  it("keeps what finite loops compute", () => {
    const { run } = frame();
    expect(run("var total = 0; for (var i = 1; i <= 100; i++) { total += i } var j = 0; while (j < 10) j++; do { j-- } while (j > 5); [total, j]")).toEqual([5050, 5]);
  });
});

describe("widget watchdog: stopping a busy loop", () => {
  it("stops a loop that never yields, shows a plain note and tells the app", () => {
    const { run, posted, replaced, cleared } = frame();
    run("setTimeout(function () {}, 10); setInterval(function () {}, 10)");
    expect(() => run("var n = 0; while (true) { n++ }")).toThrow(/stopped this visual's scripts/);
    expect(posted).toContainEqual({ type: WIDGET_MESSAGE.stopped });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.textContent).toBe(WIDGET_STOPPED_NOTE);
    expect(replaced[0]!.attributes.role).toBe("status");
    expect(cleared.length).toBeGreaterThanOrEqual(2);
    // It stays stopped: any later loop ends at once, and the check cannot be replaced.
    expect(() => run("for (;;) {}")).toThrow(/stopped/);
    expect(() => run(`${tick} = function () { return true }; for (;;) {}`)).toThrow();
  });

  it("lets a long but yielding script run", () => {
    const { run, turn, posted } = frame();
    // Each stretch runs about 1.2 s; the page gets a turn between them.
    for (let stretch = 0; stretch < 5; stretch += 1) {
      run("for (var i = 0; i < 20000; i++) {}");
      turn();
    }
    expect(posted).toEqual([]);
  });
});

describe("widget document", () => {
  it("runs the watchdog before the widget's own scripts, which are guarded", () => {
    const doc = buildWidgetDocument({ title: "Loop", html: "<script>while (true) {}</script>", theme: "light" });
    expect(doc.indexOf(`"${tick}"`)).toBeGreaterThan(0);
    expect(doc.indexOf(`"${tick}"`)).toBeLessThan(doc.indexOf(`while (${tick}()&&(true))`));
  });
});
