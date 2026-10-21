import { normalizeCodeNetworkOrigins } from "../code/network-policy";
import {
  sanitizeSpectraThemeTokens,
  SPECTRA_EMBED_THEME_TOKENS,
  SPECTRA_EMBED_TOKEN_ALIASES,
  type SpectraSandboxTheme,
} from "./theme-tokens";

export const SPECTRA_EMBED_SDK_VERSION = "1.2" as const;

export const SPECTRA_EMBED_BUDGETS = Object.freeze({
  // React/TypeScript source is capped at 900 KB before compilation. The
  // isolated frame accepts the larger allowlisted bundle produced by esbuild.
  maxSourceBytes: 2_800_000,
  maxDomNodes: 3_500,
  maxHeight: 1_400,
  maxMessages: 240,
  maxMessageBytes: 16_000,
  maxExportBytes: 3_500_000,
  maxConsoleEntries: 80,
  startupTimeoutMs: 8_000,
});

export type SpectraSandboxFile = {
  path: string;
  language?: string;
  source: string;
};

export type SpectraSandboxTest = {
  id: string;
  name: string;
  source: string;
};

export type SpectraSandboxAsset = {
  id: string;
  path: string;
  mediaType: string;
  dataUrl: string;
};

export type SpectraSandboxFrameMessage =
  | {
      type: "spectra:ready";
      channel: string;
      sdkVersion: typeof SPECTRA_EMBED_SDK_VERSION;
    }
  | { type: "spectra:resize"; channel: string; height: number }
  | {
      type: "spectra:interaction";
      channel: string;
      name: string;
      detail?: unknown;
    }
  | {
      type: "spectra:console";
      channel: string;
      level: "log" | "info" | "warn" | "error";
      values: string[];
    }
  | {
      type: "spectra:test";
      channel: string;
      testId: string;
      name: string;
      status: "passed" | "failed";
      durationMs: number;
      message?: string;
    }
  | {
      type: "spectra:error";
      channel: string;
      code: string;
      message: string;
      line?: number;
    }
  | {
      type: "spectra:limit";
      channel: string;
      budget: keyof typeof SPECTRA_EMBED_BUDGETS;
      message: string;
    }
  | {
      type: "spectra:a11y";
      channel: string;
      title: boolean;
      headingCount: number;
      landmarkCount: number;
      focusableCount: number;
      imagesWithoutAlt: number;
      unnamedControls: number;
      duplicateIds: number;
      headingOrderIssues: number;
      unlabelledGraphics: number;
      language: string;
    }
  | {
      type: "spectra:export";
      channel: string;
      requestId: string;
      format: "svg" | "png" | "webm";
      data?: string;
      width?: number;
      height?: number;
      error?: string;
    };

export type SpectraSandboxHostMessage = {
  type: "spectra:host";
  channel: string;
  theme: "light" | "dark";
  reducedMotion: boolean;
  themeTokens?: SpectraSandboxTheme["themeTokens"];
  resources?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
  exportRequest?: { id: string; format: "svg" | "png" | "webm" };
};

export function isSpectraSandboxFrameMessage(
  value: unknown,
): value is SpectraSandboxFrameMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.channel !== "string" ||
    typeof candidate.type !== "string"
  )
    return false;
  try {
    const encodedLength = JSON.stringify(value).length;
    const maximum =
      candidate.type === "spectra:export"
        ? SPECTRA_EMBED_BUDGETS.maxExportBytes
        : SPECTRA_EMBED_BUDGETS.maxMessageBytes;
    if (encodedLength > maximum) return false;
  } catch {
    return false;
  }
  if (candidate.type === "spectra:ready")
    return candidate.sdkVersion === SPECTRA_EMBED_SDK_VERSION;
  if (candidate.type === "spectra:resize")
    return (
      typeof candidate.height === "number" && Number.isFinite(candidate.height)
    );
  if (candidate.type === "spectra:interaction")
    return (
      typeof candidate.name === "string" &&
      /^[a-z][a-z0-9_.:-]{0,63}$/i.test(candidate.name)
    );
  if (candidate.type === "spectra:console")
    return (
      ["log", "info", "warn", "error"].includes(String(candidate.level)) &&
      Array.isArray(candidate.values) &&
      candidate.values.length <= 24 &&
      candidate.values.every(
        (entry) => typeof entry === "string" && entry.length <= 1_200,
      )
    );
  if (candidate.type === "spectra:test")
    return (
      typeof candidate.testId === "string" &&
      candidate.testId.length > 0 &&
      candidate.testId.length <= 180 &&
      typeof candidate.name === "string" &&
      candidate.name.length <= 200 &&
      ["passed", "failed"].includes(String(candidate.status)) &&
      typeof candidate.durationMs === "number" &&
      Number.isFinite(candidate.durationMs) &&
      candidate.durationMs >= 0 &&
      candidate.durationMs <= 30_000 &&
      (candidate.message === undefined ||
        (typeof candidate.message === "string" &&
          candidate.message.length <= 1_600))
    );
  if (candidate.type === "spectra:error")
    return (
      typeof candidate.code === "string" &&
      candidate.code.length <= 80 &&
      typeof candidate.message === "string" &&
      candidate.message.length <= 1_600 &&
      (candidate.line === undefined ||
        (typeof candidate.line === "number" && Number.isFinite(candidate.line)))
    );
  if (candidate.type === "spectra:limit")
    return (
      Object.hasOwn(SPECTRA_EMBED_BUDGETS, String(candidate.budget)) &&
      typeof candidate.message === "string" &&
      candidate.message.length <= 1_600
    );
  if (candidate.type === "spectra:a11y")
    return (
      typeof candidate.title === "boolean" &&
      [
        candidate.headingCount,
        candidate.landmarkCount,
        candidate.focusableCount,
        candidate.imagesWithoutAlt,
        candidate.unnamedControls,
        candidate.duplicateIds,
        candidate.headingOrderIssues,
        candidate.unlabelledGraphics,
      ].every(
        (entry) =>
          typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
      ) &&
      typeof candidate.language === "string" &&
      candidate.language.length <= 35
    );
  if (candidate.type === "spectra:export")
    return (
      typeof candidate.requestId === "string" &&
      candidate.requestId.length <= 180 &&
      ["svg", "png", "webm"].includes(String(candidate.format)) &&
      (candidate.data === undefined || typeof candidate.data === "string") &&
      (candidate.error === undefined ||
        (typeof candidate.error === "string" && candidate.error.length <= 500))
    );
  return false;
}

function normalizePath(value: string) {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

function safeJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function localReference(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:"))
    return null;
  if (/^(?:[a-z]+:)?\/\//i.test(trimmed) || trimmed.startsWith("#"))
    return null;
  return normalizePath(trimmed.split(/[?#]/, 1)[0] ?? "");
}

export type SpectraSandboxDocument = {
  srcDoc: string | null;
  diagnostics: string[];
  sourceBytes: number;
};

export const normalizeSandboxNetworkOrigins = normalizeCodeNetworkOrigins;

export function buildSpectraSandboxDocument({
  files,
  tests = [],
  assets = [],
  channel,
  title,
  networkAllowlist = [],
  initialParameters = {},
  initialTheme,
}: {
  files: SpectraSandboxFile[];
  tests?: SpectraSandboxTest[];
  assets?: SpectraSandboxAsset[];
  channel: string;
  title: string;
  networkAllowlist?: string[];
  initialParameters?: Record<string, string | number | boolean>;
  initialTheme?: SpectraSandboxTheme;
}): SpectraSandboxDocument {
  const diagnostics: string[] = [];
  const cleanFiles = files
    .filter(
      (file) =>
        typeof file.path === "string" && typeof file.source === "string",
    )
    .map((file) => ({ ...file, normalizedPath: normalizePath(file.path) }));
  const sourceBytes = cleanFiles.reduce(
    (total, file) => total + new TextEncoder().encode(file.source).byteLength,
    0,
  );
  if (sourceBytes > SPECTRA_EMBED_BUDGETS.maxSourceBytes)
    return {
      srcDoc: null,
      diagnostics: [
        `Preview source exceeds the ${Math.round(SPECTRA_EMBED_BUDGETS.maxSourceBytes / 1000)} KB embed budget.`,
      ],
      sourceBytes,
    };

  const byPath = new Map(cleanFiles.map((file) => [file.normalizedPath, file]));
  let assetCharacters = 0;
  const cleanAssets = assets
    .filter((asset) => {
      if (
        !asset ||
        typeof asset.id !== "string" ||
        typeof asset.path !== "string" ||
        typeof asset.mediaType !== "string" ||
        typeof asset.dataUrl !== "string"
      )
        return false;
      const prefix = `data:${asset.mediaType.toLowerCase()};base64,`;
      if (!asset.dataUrl.startsWith(prefix)) return false;
      assetCharacters += asset.dataUrl.length;
      return assetCharacters <= 11_000_000;
    })
    .slice(0, 100)
    .map((asset) => ({
      id: asset.id.slice(0, 180),
      path: normalizePath(asset.path),
      mediaType: asset.mediaType.toLowerCase().slice(0, 150),
      dataUrl: asset.dataUrl,
    }));
  const assetByPath = new Map(cleanAssets.map((asset) => [asset.path, asset]));
  const portableAssets = Object.fromEntries(
    cleanAssets.map((asset) => [
      asset.id,
      {
        id: asset.id,
        path: asset.path,
        mediaType: asset.mediaType,
        url: asset.dataUrl,
      },
    ]),
  );
  const allowedNetworkOrigins =
    normalizeSandboxNetworkOrigins(networkAllowlist);
  const portableParameters = Object.fromEntries(
    Object.entries(initialParameters)
      .slice(0, 80)
      .filter(([, value]) =>
        ["string", "number", "boolean"].includes(typeof value),
      )
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === "string" ? value.slice(0, 2_000) : value,
      ]),
  );
  const htmlFile =
    cleanFiles.find((file) =>
      /(?:^|\/)index\.html?$/.test(file.normalizedPath),
    ) ?? cleanFiles.find((file) => /html?$/i.test(file.language ?? ""));
  const cssFiles = cleanFiles.filter(
    (file) =>
      /\.css$/.test(file.normalizedPath) || /css/i.test(file.language ?? ""),
  );
  const scriptFiles = cleanFiles.filter(
    (file) =>
      /\.(?:m?js|cjs)$/.test(file.normalizedPath) ||
      /^(?:javascript|js)$/i.test(file.language ?? ""),
  );
  let body =
    htmlFile?.source ?? '<main id="spectra-root" aria-live="polite"></main>';
  const scripts: string[] = [];
  const styles: string[] = [];
  const rewriteAssetReferences = (source: string) =>
    source.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (match, _quote: string, reference: string) => {
        const path = localReference(reference);
        const asset = path ? assetByPath.get(path) : undefined;
        return asset ? `url("${asset.dataUrl}")` : match;
      },
    );

  body = body.replace(
    /<script\b([^>]*)\bsrc\s*=\s*(["'])(.*?)\2[^>]*>\s*<\/script\s*>/gi,
    (_match, _attributes, _quote, reference: string) => {
      const path = localReference(reference);
      const file = path ? byPath.get(path) : undefined;
      if (file) scripts.push(file.source);
      else diagnostics.push(`Blocked script reference: ${reference}`);
      return "";
    },
  );
  body = body.replace(
    /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
    (_match, source: string) => {
      if (source.trim()) scripts.push(source);
      return "";
    },
  );
  body = body.replace(
    /<link\b([^>]*)\bhref\s*=\s*(["'])(.*?)\2[^>]*>/gi,
    (match, _attributes: string, _quote, reference: string) => {
      if (!/rel\s*=\s*(["'])?stylesheet\1?/i.test(match)) return "";
      const path = localReference(reference);
      const file = path ? byPath.get(path) : undefined;
      if (file) styles.push(file.source);
      else diagnostics.push(`Blocked stylesheet reference: ${reference}`);
      return "";
    },
  );
  body = body.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
    (_match, source: string) => {
      if (source.trim()) styles.push(source);
      return "";
    },
  );
  for (const file of cssFiles)
    if (!styles.includes(file.source)) styles.push(file.source);
  if (!htmlFile || scripts.length === 0) {
    for (const file of scriptFiles)
      if (!scripts.includes(file.source)) scripts.push(file.source);
  }
  const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bodyMatch) body = bodyMatch[1] ?? "";
  else
    body = body
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<\/?(?:html|head)\b[^>]*>/gi, "")
      .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
      .replace(/<meta\b[^>]*>/gi, "");
  body = body.replace(
    /\b(src|poster)\s*=\s*(["'])(.*?)\2/gi,
    (match, attribute: string, quote: string, reference: string) => {
      const path = localReference(reference);
      const asset = path ? assetByPath.get(path) : undefined;
      return asset ? `${attribute}=${quote}${asset.dataUrl}${quote}` : match;
    },
  );
  body = body.replace(
    /\bsrcset\s*=\s*(["'])(.*?)\1/gi,
    (match, quote: string, value: string) => {
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const [reference, ...descriptor] = candidate.trim().split(/\s+/);
          const path = reference ? localReference(reference) : null;
          const asset = path ? assetByPath.get(path) : undefined;
          return asset
            ? `${asset.dataUrl}${descriptor.length ? ` ${descriptor.join(" ")}` : ""}`
            : candidate.trim();
        })
        .join(", ");
      return rewritten === value.trim()
        ? match
        : `srcset=${quote}${rewritten}${quote}`;
    },
  );
  body = body.replace(
    /\bstyle\s*=\s*(["'])(.*?)\1/gi,
    (_match, quote: string, value: string) =>
      `style=${quote}${rewriteAssetReferences(value)}${quote}`,
  );
  for (let index = 0; index < styles.length; index += 1)
    styles[index] = rewriteAssetReferences(styles[index] ?? "");

  const unsupported = cleanFiles.filter((file) =>
    /\.(?:tsx?|jsx)$/.test(file.normalizedPath),
  );
  if (unsupported.length && scripts.length === 0)
    diagnostics.push(
      "React and TypeScript source requires a committed browser build before it can be embedded.",
    );
  let testCharacters = 0;
  const cleanTests = tests
    .filter(
      (test) =>
        test &&
        typeof test.id === "string" &&
        typeof test.name === "string" &&
        typeof test.source === "string",
    )
    .slice(0, 200)
    .flatMap((test) => {
      const source = test.source.slice(0, 300_000);
      testCharacters += source.length;
      return testCharacters <= 300_000
        ? [
            {
              id: test.id.slice(0, 180),
              name: test.name.slice(0, 200),
              source,
            },
          ]
        : [];
    });

  const bootstrap = `
(() => {
  'use strict';
  const channel = ${safeJson(channel)};
  const version = ${safeJson(SPECTRA_EMBED_SDK_VERSION)};
  const budgets = ${safeJson(SPECTRA_EMBED_BUDGETS)};
  const themeTokenNames = ${safeJson(SPECTRA_EMBED_THEME_TOKENS)};
  const tokenAliases = ${safeJson(SPECTRA_EMBED_TOKEN_ALIASES)};
  let themeTokenSnapshot = Object.freeze({});
  const applyTheme = (message) => {
    const root = document.documentElement;
    root.dataset.spectraTheme = message.theme === 'dark' ? 'dark' : 'light';
    root.dataset.spectraReducedMotion = message.reducedMotion ? 'true' : 'false';
    const hasTokens = message.themeTokens && typeof message.themeTokens === 'object' && !Array.isArray(message.themeTokens);
    const next = hasTokens ? {} : { ...themeTokenSnapshot };
    if (hasTokens) {
      for (const name of themeTokenNames) {
        const value = message.themeTokens[name];
        if (typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[<>;{}]|(?:url|expression)\\s*\\(/i.test(value)) {
          next[name] = value.trim();
        }
      }
    }
    themeTokenSnapshot = Object.freeze(next);
    // Defaults precede authored CSS, so an intentional visual theme wins.
    const sheet = document.getElementById('spectra-theme-tokens')?.sheet;
    if (sheet) {
      if (!sheet.cssRules.length) sheet.insertRule(':root{}', 0);
      // Keep the defaults sheet and its rule in place across host updates.
      // Replacing style text can reorder sheets in DOM-backed renderers.
      sheet.cssRules[0].style.cssText = 'color-scheme:' + root.dataset.spectraTheme + ';' + Object.entries(next).map(([name, value]) => name + ':' + value).join(';');
    }
  };
  applyTheme(${safeJson({
    theme: initialTheme?.theme === "dark" ? "dark" : "light",
    reducedMotion: initialTheme?.reducedMotion === true,
    themeTokens: sanitizeSpectraThemeTokens(initialTheme?.themeTokens),
  })});
  const sdkTokens = Object.freeze(Object.defineProperties({}, Object.fromEntries(
    Object.entries(tokenAliases).map(([name, [token, fallback]]) => [name, {
      enumerable: true, get: () => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || themeTokenSnapshot[token] || fallback,
    }]),
  )));
  const allowedNetworkOrigins = new Set(${safeJson(allowedNetworkOrigins)});
  let sent = 0;
  let consoleEntries = 0;
  let ready = false;
  let resourceSnapshot = Object.freeze({});
  let parameterSnapshot = Object.freeze(${safeJson(portableParameters)});
  const assetSnapshot = Object.freeze(${safeJson(portableAssets)});
  let guardStartedAt = performance.now();
  let guardLastTickAt = guardStartedAt;
  let guardTicks = 0;
  const resetGuard = () => { guardStartedAt = performance.now(); guardLastTickAt = guardStartedAt; guardTicks = 0; };
  Object.defineProperty(window, '__spectraResetGuard', { value: resetGuard, configurable: false });
  Object.defineProperty(window, '__spectraGuard', { value: () => {
    const now = performance.now();
    if (now - guardLastTickAt > 50) { guardStartedAt = now; guardTicks = 0; }
    guardLastTickAt = now;
    guardTicks += 1;
    if (guardTicks > 5000000 || now - guardStartedAt > 1500) throw new Error('Spectra stopped a long-running synchronous loop. Source remains unchanged.');
  }, configurable: false });
  for (const eventName of ['click','input','change','keydown','pointerdown']) document.addEventListener(eventName, resetGuard, { capture: true });
  const serialize = (value) => {
    try {
      if (typeof value === 'string') return value.slice(0, 1200);
      return JSON.stringify(value).slice(0, 1200);
    } catch { return String(value).slice(0, 1200); }
  };
  const post = (message) => {
    if (sent >= budgets.maxMessages) return;
    let value = { ...message, channel };
    let encoded = '';
    try { encoded = JSON.stringify(value); } catch { return; }
    const maximum = message.type === 'spectra:export' ? budgets.maxExportBytes : budgets.maxMessageBytes;
    if (encoded.length > maximum) value = { type: 'spectra:limit', budget: message.type === 'spectra:export' ? 'maxExportBytes' : 'maxMessageBytes', message: 'A sandbox event exceeded the message budget.', channel };
    sent += 1;
    parent.postMessage(value, '*');
  };
  const nativeFetch = window.fetch.bind(window);
  const blockNetwork = (name) => () => { throw new Error(name + ' is disabled in Spectra embedded previews.'); };
  try {
    window.fetch = (input, init = {}) => {
      if (typeof input !== 'string' && !(input instanceof URL)) throw new Error('Spectra network requests require an explicit HTTPS URL.');
      const url = new URL(String(input));
      const method = String(init.method || 'GET').toUpperCase();
      if (!allowedNetworkOrigins.has(url.origin)) throw new Error('This HTTPS origin is not approved for the artifact runtime.');
      if (method !== 'GET' && method !== 'HEAD') throw new Error('Spectra artifact network access is read-only.');
      return nativeFetch(url.href, { ...init, method, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', mode: 'cors' });
    };
  } catch {}
  try { window.XMLHttpRequest = class { constructor() { throw new Error('Network access is disabled in Spectra embedded previews.'); } }; } catch {}
  try { window.WebSocket = class { constructor() { throw new Error('WebSockets are disabled in Spectra embedded previews.'); } }; } catch {}
  try { navigator.sendBeacon = () => false; } catch {}
  const hostListeners = new Set();
  const completedExportRequests = new Set();
  const exportGraphic = async (request) => {
    const requestId = String(request && request.id || '').slice(0, 180);
    const format = request && request.format === 'png' ? 'png' : request && request.format === 'webm' ? 'webm' : 'svg';
    if (!requestId || completedExportRequests.has(requestId)) return;
    completedExportRequests.add(requestId);
    if (completedExportRequests.size > 40) completedExportRequests.delete(completedExportRequests.values().next().value);
    const source = document.querySelector('svg');
    try {
      const canvasSource = !source ? document.querySelector('canvas') : null;
      if (format === 'webm') {
        const canvas = document.querySelector('canvas');
        if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') throw new Error('Video export is available for canvas-based visualisations in supported browsers.');
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((value) => MediaRecorder.isTypeSupported(value));
        if (!mimeType) throw new Error('This browser cannot encode a WebM visualisation.');
        const stream = canvas.captureStream(30);
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1800000 });
        recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
        const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = () => reject(new Error('The video encoder stopped unexpectedly.')); });
        recorder.start(250);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) throw new Error('The canvas produced an empty video.');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The recorded video could not be encoded.')); reader.readAsDataURL(blob); });
        post({ type: 'spectra:export', requestId, format, data, width: canvas.width, height: canvas.height });
        return;
      }
      if (canvasSource && format === 'png') {
        const width = Math.max(1, Math.min(2400, canvasSource.width || Math.round(canvasSource.getBoundingClientRect().width) || 1200));
        const height = Math.max(1, Math.min(2400, canvasSource.height || Math.round(canvasSource.getBoundingClientRect().height) || 675));
        post({ type: 'spectra:export', requestId, format, data: canvasSource.toDataURL('image/png'), width, height });
        return;
      }
      const bounds = (source || document.body).getBoundingClientRect();
      const width = Math.max(1, Math.min(2400, Math.round(bounds.width || (source && Number(source.getAttribute('width'))) || document.documentElement.clientWidth || 1200)));
      const height = Math.max(1, Math.min(2400, Math.round(bounds.height || (source && Number(source.getAttribute('height'))) || document.documentElement.scrollHeight || 675)));
      const clone = (source || document.body).cloneNode(true);
      clone.querySelectorAll('script,foreignObject').forEach((node) => node.remove());
      [clone, ...clone.querySelectorAll('*')].forEach((node) => {
        for (const attribute of [...node.attributes]) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (name.startsWith('on') || (name === 'style' && /url\\(\\s*["']?(?:https?:|\\/\\/|javascript:|data:text)/i.test(value)) || ((name === 'href' || name.endsWith(':href') || name === 'src' || name === 'poster') && /^(?:https?:|javascript:|data:text\\/html)/i.test(value))) node.removeAttribute(attribute.name);
        }
      });
      let serialized = '';
      if (source) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height));
        if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        serialized = new XMLSerializer().serializeToString(clone);
      } else {
        const css = [...document.styleSheets].map((sheet) => {
          try { return [...sheet.cssRules].map((rule) => rule.cssText).join('\\n'); } catch { return ''; }
        }).join('\\n').replace(/@import[^;]+;?/gi, '').replace(/url\\(\\s*(["']?)(?:https?:|\\/\\/|javascript:|data:text)[^)]*\\)/gi, 'none').replace(/<\\/style/gi, '<\\\\/style');
        const markup = new XMLSerializer().serializeToString(clone);
        serialized = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:' + width + 'px;min-height:' + height + 'px;overflow:hidden"><style>' + css + '</style>' + markup + '</div></foreignObject></svg>';
      }
      if (format === 'svg') { post({ type: 'spectra:export', requestId, format, data: serialized, width, height }); return; }
      const blob = new Blob([serialized], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The SVG could not be rasterized.')); image.src = url; });
        const scale = Math.min(2, Math.sqrt(8000000 / (width * height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas export is unavailable.');
        context.fillStyle = getComputedStyle(document.body).backgroundColor || 'var(--bg-elevated)'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        post({ type: 'spectra:export', requestId, format, data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { post({ type: 'spectra:export', requestId, format, error: String(error && error.message || error).slice(0, 500) }); }
  };
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.type !== 'spectra:host' || message.channel !== channel) return;
    applyTheme(message);
    if (message.resources && typeof message.resources === 'object' && !Array.isArray(message.resources)) resourceSnapshot = Object.freeze(message.resources);
    if (message.parameters && typeof message.parameters === 'object' && !Array.isArray(message.parameters)) parameterSnapshot = Object.freeze(message.parameters);
    if (message.exportRequest && typeof message.exportRequest === 'object') void exportGraphic(message.exportRequest);
    resetGuard();
    hostListeners.forEach((listener) => { try { listener(message); } catch {} });
  });
  window.SpectraEmbed = Object.freeze({
    version,
    tokens: sdkTokens,
    get resources() { return resourceSnapshot; },
    getResource(id) { return typeof id === 'string' ? resourceSnapshot[id] : undefined; },
    listResources() { return Object.keys(resourceSnapshot); },
    get assets() { return assetSnapshot; },
    getAsset(id) { return typeof id === 'string' ? assetSnapshot[id] : undefined; },
    listAssets() { return Object.keys(assetSnapshot); },
    get parameters() { return parameterSnapshot; },
    getParameter(key) { return typeof key === 'string' ? parameterSnapshot[key] : undefined; },
    listParameters() { return Object.keys(parameterSnapshot); },
    emit(name, detail) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_.:-]{0,63}$/i.test(name)) throw new Error('Invalid Spectra interaction name.');
      post({ type: 'spectra:interaction', name, detail });
    },
    onHostChange(listener) { if (typeof listener !== 'function') return () => {}; hostListeners.add(listener); return () => hostListeners.delete(listener); },
  });
  window.__spectraRunTests = async (tests) => {
    const expect = (received) => Object.freeze({
      toBe(expected) { if (!Object.is(received, expected)) throw new Error('Expected ' + serialize(received) + ' to be ' + serialize(expected)); },
      toEqual(expected) { if (JSON.stringify(received) !== JSON.stringify(expected)) throw new Error('Expected ' + serialize(received) + ' to equal ' + serialize(expected)); },
      toBeTruthy() { if (!received) throw new Error('Expected value to be truthy.'); },
      toBeFalsy() { if (received) throw new Error('Expected value to be falsy.'); },
      toContain(expected) { if (received == null || typeof received.includes !== 'function' || !received.includes(expected)) throw new Error('Expected value to contain ' + serialize(expected)); },
      toHaveLength(expected) { if (received == null || received.length !== expected) throw new Error('Expected length ' + expected + ', received ' + serialize(received && received.length)); },
    });
    Object.defineProperty(window, 'expect', { value: expect, configurable: true, writable: false });
    for (const test of tests) {
      const startedAt = performance.now();
      try {
        const execution = (0, eval)('(async () => {\\n' + test.source + '\\n})()');
        await Promise.race([
          execution,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Check exceeded the 5 second execution limit.')), 5000)),
        ]);
        post({ type: 'spectra:test', testId: test.id, name: test.name, status: 'passed', durationMs: Math.min(30000, Math.max(0, Math.round(performance.now() - startedAt))) });
      } catch (error) {
        post({ type: 'spectra:test', testId: test.id, name: test.name, status: 'failed', durationMs: Math.min(30000, Math.max(0, Math.round(performance.now() - startedAt))), message: String(error && error.message || error).slice(0, 1600) });
      }
    }
    try { delete window.expect; } catch {}
  };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      original(...values);
      if (consoleEntries++ < budgets.maxConsoleEntries) post({ type: 'spectra:console', level, values: values.map(serialize) });
    };
  }
  window.addEventListener('error', (event) => post({ type: 'spectra:error', code: 'runtime_error', message: String(event.message || 'Embedded runtime failed.').slice(0, 1600), line: Number(event.lineno || 0) || undefined }));
  window.addEventListener('unhandledrejection', (event) => post({ type: 'spectra:error', code: 'unhandled_rejection', message: serialize(event.reason) }));
  document.addEventListener('submit', (event) => { event.preventDefault(); post({ type: 'spectra:interaction', name: 'form.submit' }); });
  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (link && link.href) { event.preventDefault(); post({ type: 'spectra:interaction', name: 'link.open', detail: { href: String(link.getAttribute('href') || '').slice(0, 500) } }); }
  });
  // The body's own height, not the document's: the document is at least as tall as the frame, so a frame measured by it could never shrink to its work.
  const reportLayout = () => post({ type: 'spectra:resize', height: Math.max(48, Math.min(budgets.maxHeight, Math.ceil(document.body.scrollHeight) || 48)) });
  const accessibleName = (element) => {
    const direct = element.getAttribute('aria-label') || element.getAttribute('title') || '';
    if (direct.trim()) return direct.trim();
    const labelledBy = String(element.getAttribute('aria-labelledby') || '').trim().split(/\\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (labelledBy) return labelledBy;
    if (element.labels && element.labels.length) return [...element.labels].map((label) => label.textContent || '').join(' ').trim();
    if (element instanceof HTMLInputElement && element.type === 'image') return String(element.alt || '').trim();
    if (element instanceof HTMLImageElement) return String(element.alt || '').trim();
    const svgTitle = element.querySelector && element.querySelector(':scope > title');
    if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim();
    return String(element.textContent || '').trim();
  };
  const reportA11y = () => {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    let previousHeading = 0;
    let headingOrderIssues = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      if ((previousHeading === 0 && level > 1) || (previousHeading > 0 && level > previousHeading + 1)) headingOrderIssues += 1;
      previousHeading = level;
    }
    const seenIds = new Set();
    let duplicateIds = 0;
    document.querySelectorAll('[id]').forEach((element) => {
      const id = String(element.id || '').trim();
      if (!id) return;
      if (seenIds.has(id)) duplicateIds += 1;
      else seenIds.add(id);
    });
    const controls = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="slider"]')];
    const graphics = [...document.querySelectorAll('svg[role="img"],canvas')];
    post({
      type: 'spectra:a11y',
      title: Boolean(document.title.trim()),
      headingCount: headings.length,
      landmarkCount: document.querySelectorAll('main,nav,aside,header,footer,[role="main"],[role="navigation"]').length,
      focusableCount: document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])').length,
      imagesWithoutAlt: document.querySelectorAll('img:not([alt]),input[type="image"]:not([alt])').length,
      unnamedControls: controls.filter((element) => !accessibleName(element)).length,
      duplicateIds,
      headingOrderIssues,
      unlabelledGraphics: graphics.filter((element) => !accessibleName(element)).length,
      language: document.documentElement.lang || ''
    });
  };
  let reportQueued = false;
  const scheduleReport = () => {
    if (reportQueued) return;
    reportQueued = true;
    requestAnimationFrame(() => { reportQueued = false; reportLayout(); reportA11y(); });
  };
  const observer = new MutationObserver(() => {
    const count = document.getElementsByTagName('*').length;
    if (count > budgets.maxDomNodes) { observer.disconnect(); post({ type: 'spectra:limit', budget: 'maxDomNodes', message: 'This visualisation created too many elements to remain safely embedded.' }); }
    scheduleReport();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  new ResizeObserver(reportLayout).observe(document.documentElement);
  const startupTimer = setTimeout(() => { if (!ready) post({ type: 'spectra:error', code: 'startup_timeout', message: 'The embedded experience did not finish starting in time.' }); }, budgets.startupTimeoutMs);
  window.__spectraReady = () => { if (ready) return; ready = true; clearTimeout(startupTimer); scheduleReport(); post({ type: 'spectra:ready', sdkVersion: version }); };
})();`;

  const execution = scripts.length
    ? `for (const source of ${safeJson(scripts)}) { (0, eval)(source); }`
    : "";
  const testExecution = cleanTests.length
    ? `setTimeout(() => window.__spectraRunTests(${safeJson(cleanTests)}), 0);`
    : "";
  const cleanTitle = escapeHtml(title || "Interactive Spectra artifact");
  const connectSource = allowedNetworkOrigins.length
    ? allowedNetworkOrigins.join(" ")
    : "'none'";
  const themeAliasStyles = Object.entries(SPECTRA_EMBED_TOKEN_ALIASES)
    .map(([name, [token, fallback]]) => `--spectra-${name}:var(${token},${fallback})`)
    .join(";");
  const srcDoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src ${connectSource}; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; worker-src 'none'"><title>${cleanTitle}</title><style id="spectra-theme-tokens"></style><style>:root{${themeAliasStyles}}*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--spectra-ink);font-family:var(--font-sans,system-ui,sans-serif)}body{padding:18px}button,input,select,textarea{font:inherit}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}html[data-spectra-reduced-motion="true"] *,html[data-spectra-reduced-motion="true"] *::before,html[data-spectra-reduced-motion="true"] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}${styles.join("\n").replace(/<\/style/gi, "<\\/style")}</style><script>${bootstrap.replace(/<\/script/gi, "<\\/script")}</script></head><body>${body}<script>try{${execution}}catch(error){window.dispatchEvent(new ErrorEvent('error',{message:String(error&&error.message||error),error}));}finally{window.__spectraReady();${testExecution}}</script></body></html>`;
  return { srcDoc, diagnostics, sourceBytes };
}
