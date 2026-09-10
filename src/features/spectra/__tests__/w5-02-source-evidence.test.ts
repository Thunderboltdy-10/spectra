import { describe, expect, it, vi } from "vitest";
import {
  buildResearchEvidence,
  fetchFullSource,
  isPrivateAddress,
  SourceCache,
  SourceDeadlineError,
  type SourceResponse,
  type SourceTransport,
} from "../sources/research/full-source";
import { contentHash } from "../sources/records";

const encoder = new TextEncoder();
const publicAddress = { address: "93.184.216.34", family: 4 as const };
const secondPublicAddress = { address: "93.184.216.35", family: 4 as const };

type FixtureResponse = SourceResponse & { closed: () => boolean };

function response(body: string, headers: Record<string, string> = {}, status = 200): FixtureResponse {
  let closed = false;
  const stream = (async function* () {
    yield encoder.encode(body);
  })();
  return {
    status,
    headers: new Headers(headers),
    body: stream,
    close: () => { closed = true; },
    closed: () => closed,
  };
}

function fixtureTransport(handler: (request: Parameters<NonNullable<SourceTransport["request"]>>[0]) => SourceResponse | Promise<SourceResponse>) {
  const requests: Parameters<NonNullable<SourceTransport["request"]>>[0][] = [];
  const transport: SourceTransport = {
    request: vi.fn(async (request) => {
      requests.push(request);
      return handler(request);
    }),
  };
  return { transport, requests };
}

function source(path = "/article") {
  return { title: "Controlled source", url: `https://source.example.test${path}`, content: "Search snippet", authority: "unknown" as const };
}

describe("W5-02 safe source transport and evidence", () => {
  it("pins retries to the validated address set while retaining Host and TLS hostname identity", async () => {
    const lookup = vi.fn(async () => [publicAddress, secondPublicAddress]);
    const { transport, requests } = fixtureTransport((request) => {
      if (request.address === publicAddress.address) throw new Error("fixture connection failed");
      return response("pinned content", { "content-type": "text/plain" });
    });

    const bundle = await fetchFullSource(source("/pin"), undefined, { lookup, transport, cache: null });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.address)).toEqual([publicAddress.address, secondPublicAddress.address]);
    expect(requests[0]).toMatchObject({ host: "source.example.test", servername: "source.example.test", url: { hostname: "source.example.test" } });
    expect(requests[0]?.headers.Host).toBe("source.example.test");
    expect(bundle.source.verified).toBe(true);
  });

  it("does not connect to a private redirect target and closes the redirect body", async () => {
    const redirect = response("ignored", { location: "https://127.0.0.1/private", "content-type": "text/plain" }, 302);
    const { transport, requests } = fixtureTransport(() => redirect);
    const bundle = await fetchFullSource(source("/redirect"), undefined, {
      lookup: async () => [publicAddress],
      transport,
      cache: null,
    }).catch((error: unknown) => error);

    expect(bundle).toBeInstanceOf(Error);
    expect((bundle as Error).message).toBe("SOURCE_PRIVATE_NETWORK_BLOCKED");
    expect(requests).toHaveLength(1);
    expect(redirect.closed()).toBe(true);
  });

  it("revalidates a DNS redirect before transport and rejects all private answers", async () => {
    const redirect = response("ignored", { location: "https://redirect.example.test/private" }, 302);
    const lookup = vi.fn(async (hostname: string) => hostname === "redirect.example.test" ? [{ address: "10.0.0.8", family: 4 as const }] : [publicAddress]);
    const { transport, requests } = fixtureTransport(() => redirect);

    await expect(fetchFullSource(source("/redirect-dns"), undefined, { lookup, transport, cache: null })).rejects.toThrow("SOURCE_PRIVATE_NETWORK_BLOCKED");
    expect(requests).toHaveLength(1);
    expect(redirect.closed()).toBe(true);
  });

  it("bounds a slow DNS lookup with the same operation deadline", async () => {
    const lookup = vi.fn(() => new Promise<readonly typeof publicAddress[]>(() => undefined));
    const started = Date.now();

    await expect(fetchFullSource(source("/slow-dns"), undefined, { lookup, cache: null, deadlineMs: 20 })).rejects.toBeInstanceOf(SourceDeadlineError);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("returns an honest unverified fallback when the bounded research run times out", async () => {
    const lookup = vi.fn(() => new Promise<readonly typeof publicAddress[]>(() => undefined));
    const built = await buildResearchEvidence([source("/run-timeout")], undefined, { lookup, cache: null, deadlineMs: 20 });

    expect(built.sources[0]?.verified).toBe(false);
    expect(built.partial).toBe(true);
  });

  it("aborts a body stream and closes its response when the deadline expires", async () => {
    const body = (async function* () {
      await new Promise<void>(() => undefined);
      yield encoder.encode("never");
    })();
    const fixtureResponse: FixtureResponse = { status: 200, headers: new Headers({ "content-type": "text/plain" }), body, close: vi.fn(), closed: () => Boolean(fixtureResponse.close && (fixtureResponse.close as ReturnType<typeof vi.fn>).mock.calls.length) };
    const { transport } = fixtureTransport(() => fixtureResponse);

    await expect(fetchFullSource(source("/slow-body"), undefined, { lookup: async () => [publicAddress], transport, cache: null, deadlineMs: 20 })).rejects.toBeInstanceOf(SourceDeadlineError);
    expect(fixtureResponse.close).toHaveBeenCalled();
  });

  it("propagates caller cancellation to the transport instead of manufacturing fallback evidence", async () => {
    const controller = new AbortController();
    let aborted = false;
    const { transport } = fixtureTransport(({ signal }) => new Promise<SourceResponse>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
      controller.abort();
    }));

    await expect(fetchFullSource(source("/cancel"), controller.signal, { lookup: async () => [publicAddress], transport, cache: null })).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted).toBe(true);
  });

  it("revalidates stale cache entries and changes immutable content identity when content changes", async () => {
    let now = 0;
    let version = "one";
    const cache = new SourceCache({ freshnessMs: 10 });
    const { transport, requests } = fixtureTransport(() => response(version, { "content-type": "text/plain", etag: `"${version}"` }));
    const options = { lookup: async () => [publicAddress], transport, cache, now: () => now };

    const first = await fetchFullSource(source("/cache"), undefined, options);
    now = 5;
    const fresh = await fetchFullSource(source("/cache"), undefined, options);
    version = "two";
    now = 11;
    const refreshed = await fetchFullSource(source("/cache"), undefined, options);

    expect(requests).toHaveLength(2);
    expect(fresh.source.contentHash).toBe(first.source.contentHash);
    expect(refreshed.source.contentHash).not.toBe(first.source.contentHash);
    expect(refreshed.source.contentHash).toBe(contentHash("two"));
  });

  it("sends validators on explicit stale revalidation and keeps identity on 304", async () => {
    let now = 0;
    let count = 0;
    const cache = new SourceCache({ freshnessMs: 10 });
    const { transport, requests } = fixtureTransport(() => {
      count += 1;
      return count === 1 ? response("stable", { "content-type": "text/plain", etag: '"stable"' }) : response("", { etag: '"stable"' }, 304);
    });
    const options = { lookup: async () => [publicAddress], transport, cache, now: () => now };
    const first = await fetchFullSource(source("/revalidate"), undefined, options);
    now = 11;
    const second = await fetchFullSource(source("/revalidate"), undefined, options);

    expect(requests[1]?.headers["If-None-Match"]).toBe('"stable"');
    expect(second.source.contentHash).toBe(first.source.contentHash);
  });

  it("indexes normalized HTML exactly without calling markup loss partial", async () => {
    const { transport } = fixtureTransport(() => response("<html><body><p>Alpha</p> <p>Beta &amp; gamma</p><script>ignored</script></body></html>", { "content-type": "text/html" }));
    const bundle = await fetchFullSource(source("/html"), undefined, { lookup: async () => [publicAddress], transport, cache: null });

    expect(bundle.text).toBe("Alpha Beta & gamma");
    expect(bundle.partial).toBe(false);
    for (const span of bundle.evidence) {
      expect(span.excerpt).toBe(bundle.text.slice(span.startOffset, span.endOffset));
      expect(span.excerptHash).toBe(contentHash(span.excerpt));
    }
    expect(bundle.source.requestedUrl).toBe("https://source.example.test/html");
    expect(bundle.source.finalUrl).toBe("https://source.example.test/html");
  });

  it("marks bounded extraction partial and keeps the resulting source unverified", async () => {
    const { transport } = fixtureTransport(() => response("x".repeat(200_001), { "content-type": "text/plain" }));
    const bundle = await fetchFullSource(source("/partial"), undefined, { lookup: async () => [publicAddress], transport, cache: null });

    expect(bundle.partial).toBe(true);
    expect(bundle.source.verified).toBe(false);
    expect(bundle.source.contentHash).toBe(contentHash(bundle.text));
  });

  it("retains only unverified snippet provenance after a failed fetch", async () => {
    const { transport } = fixtureTransport(() => { throw new Error("fixture failure"); });
    const built = await buildResearchEvidence([source("/failed")], undefined, { lookup: async () => [publicAddress], transport, cache: null });

    expect(built.sources[0]?.verified).toBe(false);
    expect(built.evidence[0]?.sourceId).toBe(built.sources[0]?.id);
    expect(built.partial).toBe(true);
  });

  it("keeps three-worker work bounded and allocates evidence round-robin across sources", async () => {
    let active = 0;
    let maximumActive = 0;
    const { transport } = fixtureTransport(async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return response(`${request.url.pathname} ${"evidence ".repeat(6_000)}`, { "content-type": "text/plain" });
    });
    const results = Array.from({ length: 12 }, (_, index) => source(`/many-${index}`));
    const built = await buildResearchEvidence(results, undefined, { lookup: async () => [publicAddress], transport, cache: null });

    expect(maximumActive).toBeLessThanOrEqual(3);
    expect(built.evidence).toHaveLength(96);
    const evidenceBySource = new Map<string, number>();
    for (const span of built.evidence) evidenceBySource.set(span.sourceId, (evidenceBySource.get(span.sourceId) ?? 0) + 1);
    expect([...evidenceBySource.values()]).toEqual(Array(12).fill(8));
  });

  it("handles mapped and special-use addresses conservatively", () => {
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("0:0:0:0:0:ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:5db8:d822")).toBe(false);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("source.example.test")).toBe(false);
  });

  it("rejects credentials and unsupported protocols before lookup or transport", async () => {
    const lookup = vi.fn(async () => [publicAddress]);
    const { transport, requests } = fixtureTransport(() => response("not reached"));
    await expect(fetchFullSource({ ...source("/credentials"), url: "https://user:pass@source.example.test/article" }, undefined, { lookup, transport, cache: null })).rejects.toThrow("SOURCE_URL_CREDENTIALS_UNSUPPORTED");
    await expect(fetchFullSource({ ...source("/file"), url: "file:///etc/passwd" }, undefined, { lookup, transport, cache: null })).rejects.toThrow("SOURCE_PROTOCOL_UNSUPPORTED");
    expect(lookup).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});
