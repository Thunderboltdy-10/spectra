import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The resource import both the class shelf and Spectra AI use: the person is
 * read from Convex and must be the run's owner, the school's key is loaded for
 * that person, the file is downloaded only from the tenant's API host, and a
 * failed download leaves no half-made work behind.
 */

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  publicMutation: vi.fn(),
  secret: vi.fn(),
  docx: vi.fn(),
}));

vi.mock("@/lib/convex-server", () => ({
  convexQuery: harness.query,
  convexMutation: harness.mutation,
  convexPublicMutation: harness.publicMutation,
}));
vi.mock("@/lib/server-secrets", () => ({ loadSchoolSecretForConnector: harness.secret }));
vi.mock("@/features/spectra/lenses/docx-lens", () => ({ docxLens: { open: harness.docx } }));

const ORIGIN = "http://127.0.0.1:4555";

const identity = {
  accountId: "account_1",
  clerkId: "user_1",
  email: "ana@school.test",
  emailVerified: true,
  name: "Ana",
  schoolId: "school_1",
  schoolRole: "student",
  membershipId: "membership_1",
};

const context = {
  integration: {
    _id: "integration_1",
    schoolId: "school_1",
    baseUrl: ORIGIN,
    authHeaderName: "auth-token",
    authScheme: "raw",
    requestBudgetPerMinute: 180,
    bootstrapVersion: 1,
    status: "active",
  },
  capabilities: [
    {
      _id: "capability_1",
      category: "Resources",
      name: "Download one selected class resource",
      recordType: "class_resource_download",
      path: "/v2p2/classes/{class_id}/resources/{resource_id}/download",
      purpose: "Download",
      scope: "personal",
      minimumRole: "student",
      pagination: "none",
      changeStrategy: "unknown",
      contractVersion: "v2p2",
      normalization: { onDemand: true },
    },
  ],
  mapping: { status: "verified", providerUserId: "mb_7" },
  selection: { revision: 1, selectedClassIds: ["c1"] },
  actor: { accountId: "account_1", email: "ana@school.test", schoolRole: "student" },
};

const started = {
  status: "started",
  importId: "import_1",
  sourceHash: "hash_1",
  providerRecordId: "res_9",
  providerClassId: "c1",
  title: "Worksheet.pdf",
  normalized: {},
};

const pdf = Buffer.from("%PDF-1.7\nfixture");
const fetches: string[] = [];

function mutations(overrides: Record<string, unknown> = {}) {
  harness.mutation.mockImplementation(async (name: string) => {
    if (name in overrides) {
      const value = overrides[name];
      if (value instanceof Error) throw value;
      return value;
    }
    switch (name) {
      case "managebac:connectorContext":
        return context;
      case "managebac:beginResourceImport":
        return started;
      case "spectraArtifacts:createImportedResource":
      case "spectraArtifacts:create":
        return { artifactId: "work_1" };
      case "payloads:issueUpload":
        return "https://storage.test/upload";
      case "payloads:put":
        return { payloadRef: "payload_1" };
      case "managebac:completeResourceImport":
        return { status: "imported", importId: "import_1", artifactId: "work_1" };
      default:
        return {};
    }
  });
}

function respond(download: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      fetches.push(url);
      if (url.startsWith(ORIGIN)) return download();
      return new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 });
    }),
  );
}

const names = () => harness.mutation.mock.calls.map(([name]) => name as string);

const { importManageBacResourceAs } = await import("../resource-import");

beforeEach(() => {
  vi.clearAllMocks();
  fetches.length = 0;
  vi.stubEnv("SPECTRA_CONNECTOR_BRIDGE_KEY", "k".repeat(40));
  vi.stubEnv("SPECTRA_MANAGEBAC_TEST_FIXTURE_ORIGIN", ORIGIN);
  harness.query.mockImplementation(async (name: string) => {
    if (name === "identity:me") return identity;
    if (name === "managebac:myOverview") return { integration: { _id: "integration_1" } };
    return null;
  });
  harness.secret.mockResolvedValue({ value: "school-key-0123456789", fingerprint: "f" });
  mutations();
  respond(() => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("importing a ManageBac resource for Spectra AI", () => {
  it("downloads the file from the tenant host with the school key, keeps it in the Library and completes the import", async () => {
    const result = await importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" });
    expect(result).toEqual({ status: "imported", importId: "import_1", artifactId: "work_1" });
    expect(harness.secret).toHaveBeenCalledWith({ schoolId: "school_1", purpose: "managebac-api-token", subject: "user_1" });
    expect(fetches[0]).toBe(`${ORIGIN}/v2p2/classes/c1/resources/res_9/download`);
    const download = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((download.headers as Record<string, string>)["auth-token"]).toBe("school-key-0123456789");
    expect(names()).toEqual([
      "managebac:connectorContext",
      "managebac:beginResourceImport",
      "spectraArtifacts:createImportedResource",
      "managebac:attachResourceImportArtifact",
      "payloads:issueUpload",
      "payloads:put",
      "replicas:attachPortablePayload",
      "managebac:completeResourceImport",
    ]);
    expect(harness.mutation).toHaveBeenCalledWith("managebac:beginResourceImport", { sourceRecordId: "record_1", refresh: false });
    expect(harness.mutation).toHaveBeenCalledWith(
      "spectraArtifacts:createImportedResource",
      expect.objectContaining({ title: "Worksheet.pdf", nativeFormat: "pdf", mimeType: "application/pdf", tags: ["imported", "managebac"] }),
    );
  });

  it("opens an Office file as an editable artifact", async () => {
    mutations({ "managebac:beginResourceImport": { ...started, title: "Notes.docx" } });
    harness.docx.mockResolvedValue({ projection: { type: "doc", content: [] } });
    respond(() => new Response(Buffer.from("PK\u0003\u0004word"), {
      status: 200,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    }));
    await importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1", refresh: true });
    expect(harness.mutation).toHaveBeenCalledWith("managebac:beginResourceImport", { sourceRecordId: "record_1", refresh: true });
    expect(harness.mutation).toHaveBeenCalledWith(
      "spectraArtifacts:create",
      expect.objectContaining({ blueprintKey: "document", title: "Notes.docx", content: { type: "doc", content: [] } }),
    );
    expect(names()).not.toContain("spectraArtifacts:createImportedResource");
  });

  it("returns a copy already made without downloading again", async () => {
    mutations({ "managebac:beginResourceImport": { status: "imported", importId: "import_1", artifactId: "work_1", replayed: true } });
    const result = await importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" });
    expect(result).toMatchObject({ status: "imported", artifactId: "work_1", replayed: true });
    expect(fetches).toEqual([]);
  });

  it("records a failed download and removes the half-made artifact", async () => {
    respond(() => new Response("", { status: 403 }));
    await expect(importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" })).rejects.toThrow("INTEGRATION_PERMISSION_DENIED");
    expect(harness.mutation).toHaveBeenCalledWith(
      "managebac:failResourceImport",
      expect.objectContaining({ importId: "import_1", errorCode: "INTEGRATION_PERMISSION_DENIED" }),
    );
    expect(names()).not.toContain("spectraArtifacts:createImportedResource");
  });

  it("acts only for the run's owner, and only when ManageBac is connected", async () => {
    await expect(importManageBacResourceAs({ clerkId: "someone_else", sourceRecordId: "record_1" })).rejects.toThrow("AUTH_NO_SCHOOL");
    harness.query.mockImplementation(async (name: string) => (name === "identity:me" ? identity : { integration: null }));
    await expect(importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" })).rejects.toThrow("INTEGRATION_NOT_CONFIGURED");
    harness.query.mockImplementation(async (name: string) =>
      name === "identity:me" ? identity : { integration: { _id: "integration_1" } },
    );
    harness.secret.mockResolvedValue(null);
    await expect(importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" })).rejects.toThrow("INTEGRATION_TOKEN_REQUIRED");
    expect(harness.mutation).not.toHaveBeenCalledWith("managebac:beginResourceImport", expect.anything());
  });

  it("reads the school-wide overview for a school administrator", async () => {
    harness.query.mockImplementation(async (name: string) => {
      if (name === "identity:me") return { ...identity, schoolRole: "school_admin" };
      if (name === "managebac:adminOverview") return { integration: { _id: "integration_1" } };
      return null;
    });
    await importManageBacResourceAs({ clerkId: "user_1", sourceRecordId: "record_1" });
    expect(harness.query).toHaveBeenCalledWith("managebac:adminOverview", {});
  });
});
