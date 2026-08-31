import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  officialPersonalCapabilities,
  unverifiedPersonalCapabilityFrontier,
} from "@/app/api/spectra/managebac/contracts";
import { ManageBacSchoolSourceAdapter } from "../integrations/school/managebac-adapter";

type FixtureManifest = {
  auth: { header: string; scheme: string; mode: string };
  provenance: {
    liveCaptureDate: string | null;
    livePayloadRetained: boolean;
    fixtureKind: string;
  };
  fixtures: Array<{
    path: string;
    file: string;
    verdict: string;
    responseSchemaHash: string;
    expectedProviderRecordIds: string[];
  }>;
};

const fixtureRoot = path.resolve(process.cwd(), "fixtures/managebac");

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function atPath(value: unknown, pathValue: string): unknown {
  const segments = pathValue.split(".").filter(Boolean);
  const visit = (current: unknown, index: number): unknown => {
    if (index === segments.length) return current;
    const segment = segments[index]!;
    if (segment === "*") {
      if (!Array.isArray(current)) return undefined;
      return current.flatMap((item) => {
        const result = visit(item, index + 1);
        return Array.isArray(result)
          ? result
          : result === undefined
            ? []
            : [result];
      });
    }
    return visit(object(current)[segment], index + 1);
  };
  return visit(value, 0);
}

function recordsForFixture(
  payload: unknown,
  normalization: Record<string, unknown>,
) {
  if (normalization.transform === "managebac_timetable") {
    const years = atPath(payload, "timetable.academic_years");
    if (!Array.isArray(years)) return [];
    return years.flatMap((yearValue) => {
      const year = object(yearValue);
      return (Array.isArray(year.slots) ? year.slots : []).map((slotValue) => {
        const slot = object(slotValue);
        return {
          id: `${String(year.id)}:${String(slot.day)}:${String(slot.period)}`,
        };
      });
    });
  }
  const paths = Array.isArray(normalization.recordsPath)
    ? normalization.recordsPath
    : [normalization.recordsPath ?? "$"];
  for (const candidate of paths) {
    if (candidate === "$") return [payload];
    if (typeof candidate !== "string") continue;
    const found = atPath(payload, candidate);
    if (Array.isArray(found)) return found;
    if (found && typeof found === "object") return [found];
  }
  return [];
}

function sensitiveValues(value: unknown, keyPath = "root"): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      sensitiveValues(item, `${keyPath}[${index}]`),
    );
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) => {
      const currentPath = `${keyPath}.${key}`;
      const direct = /^(token|api[_-]?key|authorization|secret)$/i.test(key)
        ? [currentPath]
        : [];
      return [...direct, ...sensitiveValues(item, currentPath)];
    },
  );
}

describe("ManageBac API capture contracts", () => {
  const manifest = readJson("manifest.json") as FixtureManifest;
  const capabilities = officialPersonalCapabilities();

  it("keeps the runtime manifest and sanitized corpus in exact route parity", () => {
    expect(manifest.auth).toEqual({
      header: "auth-token",
      scheme: "raw",
      mode: "read_only",
    });
    expect(manifest.fixtures.map((fixture) => fixture.path)).toEqual(
      capabilities.map((capability) => capability.path),
    );
    expect(
      manifest.fixtures.map((fixture) => fixture.responseSchemaHash),
    ).toEqual(capabilities.map((capability) => capability.responseSchemaHash));
    expect(
      new Set(capabilities.map((capability) => capability.path)).size,
    ).toBe(capabilities.length);
    expect(capabilities).toHaveLength(7);
    for (const capability of capabilities) {
      expect(capability.permissionState).toBe("read_only");
      expect(capability.verificationStatus).toBe("verified");
      expect(capability.responseSchemaHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(capability.normalization).toHaveProperty("idPath");
    }
  });

  it("exercises each retained normalization contract against its fixture", () => {
    for (const fixture of manifest.fixtures) {
      const capability = capabilities.find(
        (item) => item.path === fixture.path,
      );
      expect(capability, fixture.path).toBeDefined();
      const payload = readJson(fixture.file);
      const normalization = capability!.normalization;
      const records = recordsForFixture(payload, normalization);
      const idPath = String(normalization.idPath);
      const requiredPaths = Array.isArray(normalization.requiredPaths)
        ? normalization.requiredPaths.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      for (const record of records) {
        expect(
          atPath(record, idPath),
          `${fixture.file}:${idPath}`,
        ).toBeDefined();
        for (const requiredPath of requiredPaths)
          expect(
            atPath(record, requiredPath),
            `${fixture.file}:${requiredPath}`,
          ).toBeDefined();
      }
      expect(records.map((record) => String(atPath(record, idPath)))).toEqual(
        fixture.expectedProviderRecordIds,
      );
    }
  });

  it("keeps the unapproved frontier unavailable instead of guessing routes", () => {
    const frontier = unverifiedPersonalCapabilityFrontier();
    expect(frontier.map((item) => item.category)).toEqual([
      "Year groups",
      "CAS reflections",
      "CAS evidence",
      "Grades",
      "Term grades",
      "Attendance",
      "Groups",
      "Discussions and messages",
      "Events",
    ]);
    expect(frontier.every((item) => item.providerPath === null)).toBe(true);
    expect(
      frontier.every((item) => item.verdict === "live_probe_required"),
    ).toBe(true);
  });

  it("normalizes CAS reflection and evidence kinds without promoting provider routes", () => {
    const adapter = new ManageBacSchoolSourceAdapter({
      discover: async () => ({
        provider: "managebac",
        version: "test",
        discoveredAt: 0,
        capabilities: [],
      }),
      async *batches() {
        return;
      },
    });
    expect(
      adapter.normalize({
        id: "reflection-1",
        recordType: "cas_reflection",
        normalized: { title: "Reflection" },
      }).kind,
    ).toBe("cas_reflection");
    expect(
      adapter.normalize({
        id: "evidence-1",
        recordType: "cas_evidence",
        normalized: { title: "Evidence" },
      }).kind,
    ).toBe("cas_evidence");
    expect(officialPersonalCapabilities()).toHaveLength(7);
    expect(
      unverifiedPersonalCapabilityFrontier().find(
        (item) => item.category === "CAS reflections",
      )?.providerPath,
    ).toBeNull();
  });

  it("contains only fictional personal data and no credential-shaped fields", () => {
    expect(manifest.provenance).toMatchObject({
      liveCaptureDate: null,
      livePayloadRetained: false,
      fixtureKind: "sanitized_contract_example",
    });
    for (const fixture of manifest.fixtures) {
      const payload = readJson(fixture.file);
      const serialized = JSON.stringify(payload);
      const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi) ?? [];
      const urls = serialized.match(/https?:\/\/[^"\\]+/gi) ?? [];
      expect(emails.every((email) => email.endsWith("@example.invalid"))).toBe(
        true,
      );
      expect(
        urls.every((url) => {
          const hostname = new URL(url).hostname;
          return (
            hostname === "example.invalid" ||
            hostname.endsWith(".example.invalid")
          );
        }),
      ).toBe(true);
      expect(serialized).not.toMatch(/pablo|thunderbolt|gcm\.managebac|tgc/i);
      expect(sensitiveValues(payload)).toEqual([]);
    }
  });
});
