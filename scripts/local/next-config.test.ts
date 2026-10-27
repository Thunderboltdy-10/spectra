import { relative, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps local bundles outside the directory cleaned by a normal production build", async () => {
  vi.stubEnv("SPECTRA_LOCAL_INSTANCE", undefined);
  const production = (await import("../../next.config")).default;
  const productionRoot = resolve(production.distDir ?? ".next");
  const localRoots = [];
  for (const instance of ["8", "9"]) {
    vi.resetModules();
    vi.stubEnv("SPECTRA_LOCAL_INSTANCE", instance);
    const config = (await import("../../next.config")).default;
    const localRoot = resolve(config.distDir!);
    expect(relative(productionRoot, localRoot)).toMatch(/^\.\./);
    localRoots.push(localRoot);
  }
  expect(new Set(localRoots).size).toBe(2);
});
