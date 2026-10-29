/*
 * The stand-in for Spectra's own routes (/api/spectra and friends). While the
 * landing page shows the app, the browser's fetch is wrapped so a same-origin
 * /api request is answered from the story instead of the network. A route the
 * story does not take (the contact form, which really sends) goes through as
 * normal. The wrapper is installed only while the showcase is mounted and is
 * removed with it; the app itself never installs one.
 */

export type ShowcaseRequest = {
  url: URL;
  method: string;
  /** The parsed JSON body of a POST, when there is one. */
  body: Record<string, unknown> | null;
  signal?: AbortSignal | null;
};

/** A plain value is sent as JSON; a Response as it is; `undefined` lets the request through. */
export type ShowcaseRoute = (request: ShowcaseRequest) => unknown | Promise<unknown>;

const PASSTHROUGH = new Set(["/api/contact"]);

function urlOf(input: RequestInfo | URL) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, window.location.origin);
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null;
  try {
    const value = JSON.parse(init.body) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Answer same-origin /api requests from `route` until the returned function is called. */
export function installShowcaseFetch(route: ShowcaseRoute) {
  const original = window.fetch;
  const wrapped: typeof window.fetch = async (input, init) => {
    const url = urlOf(input);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/") || PASSTHROUGH.has(url.pathname))
      return original(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const answer = await route({ url, method, body: bodyOf(init), signal: init?.signal });
    if (answer instanceof Response) return answer;
    if (answer === undefined) {
      if (process.env.NODE_ENV !== "production")
        console.debug(`[showcase] no route for ${method} ${url.pathname}${url.search}`, bodyOf(init)?.action ?? "");
      // Never the network: a signed-in visitor's own data must not leak into the story.
      return new Response(JSON.stringify({ error: "Not part of the story." }), { status: 404, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}

/** A streamed NDJSON response, one event at a time with the story's own pauses. */
export function ndjsonStream(
  events: Array<{ wait?: number; event: Record<string, unknown>; /** Runs just before the event is sent. */ before?: () => void }>,
  signal?: AbortSignal | null,
) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const { wait, event, before } of events) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (signal?.aborted) break;
        before?.();
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}
