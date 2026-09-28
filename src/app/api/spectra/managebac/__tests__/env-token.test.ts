import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const sharedKey = "shared-managebac-key-0123456789";

async function adminRoute(env: Record<string, string>) {
  vi.stubEnv("MANAGEBAC_API_KEY", sharedKey);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const storeSchoolSecret = vi.fn(async () => ({ fingerprint: "fingerprint-1" }));
  const convexMutation = vi.fn(async () => ({ integrationId: "integration-1" }));
  vi.doMock("@/lib/auth-server", () => ({
    requireActor: vi.fn(async () => ({
      clerkId: "admin", accountId: "account-admin", schoolId: "school-1", schoolRole: "school_admin",
    })),
  }));
  vi.doMock("@/lib/convex-server", () => ({
    convexQuery: vi.fn(async () => ({ integration: null })),
    convexMutation,
    convexPublicMutation: vi.fn(),
  }));
  vi.doMock("@/lib/server-secrets", () => ({
    storeSchoolSecret, loadSchoolSecretForConnector: vi.fn(), revokeSchoolSecret: vi.fn(),
  }));
  const route = await import("@/app/api/spectra/managebac/route");
  const overview = await (await route.GET(new NextRequest("http://localhost/api/spectra/managebac"))).json();
  const configure = await route.POST(new NextRequest("http://localhost/api/spectra/managebac", {
    method: "POST",
    body: JSON.stringify({ action: "configure", token: "" }),
  }));
  return { overview, configure, storeSchoolSecret, convexMutation };
}

it("never connects a deployed school with the shared env key from a blank form", async () => {
  const deployed = await adminRoute({ NODE_ENV: "production", SPECTRA_APP_URL: "https://spectra.example" });
  expect(deployed.overview.data.envTokenAvailable).toBe(false);
  expect(deployed.configure.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(await deployed.configure.json())).toContain("school-wide API key");
  expect(deployed.storeSchoolSecret).not.toHaveBeenCalled();
  expect(deployed.convexMutation).not.toHaveBeenCalled();
});

it.each([
  ["a development server", { NODE_ENV: "development" }],
  ["a local production build", { NODE_ENV: "production", SPECTRA_APP_URL: "http://localhost:3000" }],
])("keeps the env key for %s", async (_label, env) => {
  const local = await adminRoute(env);
  expect(local.overview.data.envTokenAvailable).toBe(true);
  expect(local.configure.status).toBe(200);
  expect(local.storeSchoolSecret).toHaveBeenCalledWith(expect.objectContaining({ value: sharedKey }));
});
