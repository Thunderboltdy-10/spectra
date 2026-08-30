import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDeploymentConsistency } from "@/lib/boot-diagnostics";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("checkDeploymentConsistency", () => {
  it("returns ok when Convex env vars are missing", () => {
    delete process.env.CONVEX_DEPLOYMENT;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;

    const result = checkDeploymentConsistency();
    expect(result.ok).toBe(true);
  });

  it("warns when explicit environment signals disagree", () => {
    process.env.CONVEX_DEPLOYMENT = "prod";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://dev.example.com";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = checkDeploymentConsistency();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("signals");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("warns on mismatched Convex deployment slugs without relying on prod/dev keywords", () => {
    process.env.CONVEX_DEPLOYMENT = "calm-fox-123";
    process.env.NEXT_PUBLIC_CONVEX_URL =
      "https://silent-whale-999.convex.cloud";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = checkDeploymentConsistency();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("calm-fox-123");
    expect(result.message).toContain("silent-whale-999");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("accepts matching Convex deployment slug and URL", () => {
    process.env.CONVEX_DEPLOYMENT = "prod:steady-swan-321";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://steady-swan-321.convex.site";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = checkDeploymentConsistency();

    expect(result.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:3002",
    "http://localhost:3022",
    "http://[::1]:3042",
  ])("accepts a local Convex deployment at %s", (url) => {
    process.env.CONVEX_DEPLOYMENT = "local:local-spectra-instance";
    process.env.NEXT_PUBLIC_CONVEX_URL = url;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = checkDeploymentConsistency();

    expect(result.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still warns when a cloud deployment selector is paired with a local URL", () => {
    process.env.CONVEX_DEPLOYMENT = "prod:steady-swan-321";
    process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3002";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = checkDeploymentConsistency();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('signals "prod"');
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
