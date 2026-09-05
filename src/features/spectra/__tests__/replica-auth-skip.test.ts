import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("authenticated Convex replica reads", () => {
  it("skips replica and policy queries until ConvexAuth is signed in", () => {
    const hook = source("src/features/spectra/data/use-authed-args.ts");
    const studio = source("src/features/spectra/components/artifact-studio.tsx");
    const surface = source("src/features/spectra/bridge/resource-surface.tsx");
    const storage = source(
      "src/features/spectra/bridge/file-storage-controls.tsx",
    );
    const tree = source("src/features/spectra/organization/tree-client.ts");
    expect(hook).toContain("isAuthenticated === true ? args : \"skip\"");
    expect(studio).toContain("useAuthedArgs");
    expect(studio).toContain("api.replicas.forWork");
    expect(surface).toContain("useAuthedArgs");
    expect(surface).toContain("api.replicas.forWork");
    expect(storage).toContain("useAuthedArgs");
    expect(storage).toContain("api.replicas.forWork");
    expect(storage).toContain("api.syncPolicy.effective");
    expect(storage).toContain("api.bridge.activeMounts");
    expect(tree).toContain('from "../data/use-authed-args"');
    expect(tree).not.toContain("function useAuthedArgs");
  });
});
