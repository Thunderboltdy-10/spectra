/*
 * The watchdog inside a show_widget frame. A widget's scripts run on a thread
 * the app may share, so a loop that never yields would freeze Spectra with it;
 * nothing outside the frame can interrupt it. Each loop in the widget's scripts
 * therefore asks the watchdog before every turn. When the scripts have run for
 * longer than the budget without giving the page a turn, the watchdog stops
 * them: every later loop check throws, the frame's timers are cleared, the
 * frame shows a plain note saying what happened, and the app is told.
 */

export const WIDGET_WATCHDOG = Object.freeze({
  /** How long scripts may run without yielding before they are stopped. */
  budgetMs: 2_000,
  /** How often the frame tells the app it is still answering. */
  heartbeatMs: 1_000,
  /** How long the app waits for a heartbeat before it removes the frame. */
  silenceMs: 6_000,
  tick: "__spectraTick",
});

export const WIDGET_STOPPED_NOTE = "This visual was stopped: a script kept running without a break. Ask Spectra to fix it.";

type Token = { kind: "word" | "punct" | "other"; value: string; start: number; end: number };

const REGEX_AFTER_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const REGEX_AFTER_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const PUNCT = "(){}[];,.:?!=<>+-*/%&|^~@#";

function isIdentifierChar(char: string | undefined) {
  return Boolean(char) && /[\w$\u0080-￿]/.test(char!);
}

/** Skips a template literal from its opening backtick; returns the index after it. */
function skipTemplate(source: string, index: number): number {
  let i = index + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === "`") return i + 1;
    else if (char === "$" && source[i + 1] === "{") {
      // Skip the expression, minding braces and nested strings.
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === "'" || inner === '"') i = skipString(source, i);
        else if (inner === "`") i = skipTemplate(source, i);
        else {
          if (inner === "{") depth += 1;
          else if (inner === "}") depth -= 1;
          i += 1;
        }
      }
    } else i += 1;
  }
  return i;
}

function skipString(source: string, index: number): number {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === quote || char === "\n") return i + 1;
    else i += 1;
  }
  return i;
}

function skipRegex(source: string, index: number): number {
  let i = index + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === "\n") return i;
    else {
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) {
        i += 1;
        while (isIdentifierChar(source[i])) i += 1;
        return i;
      }
      i += 1;
    }
  }
  return i;
}

/** The significant tokens of a script: words and punctuation, with strings, templates, regexes and comments as opaque spans. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const previous = () => tokens[tokens.length - 1];
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i += 1;
    } else if (char === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === "'" || char === '"') {
      const end = skipString(source, i);
      tokens.push({ kind: "other", value: "string", start: i, end });
      i = end;
    } else if (char === "`") {
      const end = skipTemplate(source, i);
      tokens.push({ kind: "other", value: "template", start: i, end });
      i = end;
    } else if (char === "/") {
      const before = previous();
      const regex = !before || (before.kind === "punct" && REGEX_AFTER_PUNCT.has(before.value)) || (before.kind === "word" && REGEX_AFTER_WORDS.has(before.value));
      if (regex) {
        const end = skipRegex(source, i);
        tokens.push({ kind: "other", value: "regex", start: i, end });
        i = end;
      } else {
        tokens.push({ kind: "punct", value: "/", start: i, end: i + 1 });
        i += 1;
      }
    } else if (isIdentifierChar(char)) {
      let end = i + 1;
      while (isIdentifierChar(source[end])) end += 1;
      tokens.push({ kind: "word", value: source.slice(i, end), start: i, end });
      i = end;
    } else if (PUNCT.includes(char)) {
      tokens.push({ kind: "punct", value: char, start: i, end: i + 1 });
      i += 1;
    } else {
      tokens.push({ kind: "other", value: char, start: i, end: i + 1 });
      i += 1;
    }
  }
  return tokens;
}

/** The index of the token closing the bracket at `open`, or -1. */
function closing(tokens: Token[], open: number) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "punct") continue;
    if (token.value === "(" || token.value === "[" || token.value === "{") depth += 1;
    else if (token.value === ")" || token.value === "]" || token.value === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Puts a watchdog check into the condition of every `while`, `do … while` and
 * three-part `for` loop, so a loop that never ends is stopped instead of
 * freezing the page. `for … of` and `for … in` walk finite collections and are
 * left as written. A script the scanner cannot follow is returned unchanged.
 */
export function guardWidgetScript(source: string, tick: string = WIDGET_WATCHDOG.tick): string {
  const tokens = tokenize(source);
  const inserts: Array<{ at: number; text: string }> = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "word" || (token.value !== "while" && token.value !== "for")) return;
    const before = tokens[index - 1];
    if (before?.kind === "punct" && before.value === ".") return; // a property named while/for
    const open = index + 1;
    if (tokens[open]?.kind !== "punct" || tokens[open]!.value !== "(") return;
    const close = closing(tokens, open);
    if (close < 0 || close === open + 1) return;
    if (token.value === "while") {
      inserts.push({ at: tokens[open]!.end, text: `${tick}()&&(` }, { at: tokens[close]!.start, text: ")" });
      return;
    }
    const semicolons: number[] = [];
    let depth = 0;
    for (let inner = open + 1; inner < close; inner += 1) {
      const part = tokens[inner]!;
      if (part.kind !== "punct") continue;
      if (part.value === "(" || part.value === "[" || part.value === "{") depth += 1;
      else if (part.value === ")" || part.value === "]" || part.value === "}") depth -= 1;
      else if (part.value === ";" && depth === 0) semicolons.push(inner);
    }
    if (semicolons.length !== 2) return;
    const [first, second] = semicolons as [number, number];
    if (second === first + 1) inserts.push({ at: tokens[first]!.end, text: `${tick}()` });
    else inserts.push({ at: tokens[first]!.end, text: `${tick}()&&(` }, { at: tokens[second]!.start, text: ")" });
  });
  if (!inserts.length) return source;
  inserts.sort((a, b) => b.at - a.at);
  let guarded = source;
  for (const insert of inserts) guarded = guarded.slice(0, insert.at) + insert.text + guarded.slice(insert.at);
  return guarded;
}

const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Guards every script block in a widget fragment; data blocks (JSON, templates) stay as written. */
export function guardWidgetScripts(html: string): string {
  return html.replace(SCRIPT_BLOCK, (block, attributes: string, body: string) => {
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1]?.toLowerCase() ?? "";
    if (!JS_TYPES.has(type)) return block;
    return `<script${attributes}>${guardWidgetScript(body)}</script>`;
  });
}

/**
 * The watchdog runtime, first in the frame's head. It notes when the page last
 * had a turn; a loop check finding the scripts have run past the budget since
 * then stops them for good.
 */
export function widgetWatchdogScript(messages: { stopped: string; alive: string }) {
  const { budgetMs, heartbeatMs, tick } = WIDGET_WATCHDOG;
  return `(function(){var w=window,st=w.setTimeout.bind(w),si=w.setInterval.bind(w),raf=w.requestAnimationFrame?w.requestAnimationFrame.bind(w):null,ct=w.clearTimeout.bind(w),ci=w.clearInterval.bind(w),caf=w.cancelAnimationFrame?w.cancelAnimationFrame.bind(w):null,now=function(){return w.performance?w.performance.now():Date.now()};var timers=new Set(),intervals=new Set(),frames=new Set(),stopped=false,started=0,count=0;
w.setTimeout=function(f,d){var a=Array.prototype.slice.call(arguments,2);var id=st(function(){timers.delete(id);if(!stopped&&typeof f==="function")f.apply(w,a)},d);timers.add(id);return id};
w.setInterval=function(f,d){var a=Array.prototype.slice.call(arguments,2);var id=si(function(){if(!stopped&&typeof f==="function")f.apply(w,a)},d);intervals.add(id);return id};
if(raf)w.requestAnimationFrame=function(f){var id=raf(function(t){frames.delete(id);if(!stopped)f(t)});frames.add(id);return id};
function beat(){started=0;if(!stopped)st(beat,50)}st(beat,50);
function stop(){if(stopped)return;stopped=true;timers.forEach(ct);intervals.forEach(ci);if(caf)frames.forEach(caf);try{var note=document.createElement("p");note.setAttribute("role","status");note.setAttribute("data-spectra-widget-stopped","");note.style.cssText="margin:0;padding:12px 14px;border-radius:10px;background:var(--paper-2);color:var(--ink-2);font:13px/1.5 var(--font-ui)";note.textContent=${JSON.stringify(WIDGET_STOPPED_NOTE)};(document.body||document.documentElement).replaceChildren(note)}catch(e){}try{parent.postMessage({type:"${messages.stopped}"},"*")}catch(e){}}
Object.defineProperty(w,"${tick}",{value:function(){if(stopped)throw new Error("Spectra stopped this visual's scripts.");if((++count&15)!==0)return true;var t=now();if(!started)started=t;else if(t-started>${budgetMs}){stop();throw new Error("Spectra stopped this visual's scripts: they ran for over ${budgetMs / 1000} seconds without a break.")}return true},writable:false,configurable:false});
si(function(){if(!stopped)parent.postMessage({type:"${messages.alive}"},"*")},${heartbeatMs});})();`;
}
