import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";
import { MAX_DURABLE_PAYLOAD_BYTES } from "../../../../shared/durable-content";

describe("durable content request configuration", () => {
  it("lets the Next proxy pass bodies up to the durable route limit", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeGreaterThanOrEqual(
      MAX_DURABLE_PAYLOAD_BYTES,
    );
  });
});
