import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  PREFERENCE_SCOPE_ORDER,
  migratePreferences,
  resolvePreferences,
} from "@/features/spectra/settings/schema";
import {
  COMPUTE_TASK_REGISTRY,
  assertNoMainThreadCompute,
  chooseComputePath,
  type DeviceComputeProfile,
} from "@/features/spectra/compute/broker";
import {
  FIRECRAWL_PDF_INSPECTOR_SCORE,
  fallbackForPdfInspection,
  summarizePdfPages,
} from "@/features/spectra/compute/pdf";
import {
  attachmentBundleForConsumer,
  createModelAttachmentBundle,
  type AttachmentConsumer,
} from "@/features/spectra/compute/files";
import {
  AUTOCOMPLETE_SURFACE_SUPPORT,
  autocompleteTier,
  createAutocompleteSession,
  deterministicSuggestion,
  nextSuggestionWord,
} from "@/features/spectra/compute/autocomplete";
import {
  APPROVED_PYODIDE_PACKAGES,
  pythonRuntimeFallback,
} from "@/features/spectra/code/python-runtime";
import {
  APPROVED_LOCAL_BUILD_DEPENDENCIES,
  localBuildFallback,
  validateLocalBuildInput,
} from "@/features/spectra/compute/build";
import {
  ENGINE_CRITERIA,
  OPEN_SOURCE_ENGINE_SCORECARDS,
  validateEngineScorecards,
} from "@/features/spectra/compute/engines";

const capable: DeviceComputeProfile = {
  worker: true,
  wasm: true,
  webAssemblyStreaming: true,
  mobile: false,
  logicalCores: 8,
  deviceMemoryGb: 16,
  memoryPressure: "low",
  batterySaver: false,
  dataSaver: false,
};

describe("Phase 8 settings, compute, files and autocomplete", () => {
  it("declares every settings section with helpful defaults and exact scope order", () => {
    expect(Object.keys(DEFAULT_SPECTRA_PREFERENCES)).toEqual([
      "version",
      "general",
      "ai",
      "writing",
      "collaboration",
      "appearance",
      "compute",
      "notifications",
      "privacy",
      "integrations",
      "accessibility",
    ]);
    expect(PREFERENCE_SCOPE_ORDER).toEqual([
      "account",
      "workspace",
      "work_type",
      "device",
    ]);
    expect(DEFAULT_SPECTRA_PREFERENCES.ai).toMatchObject({
      continueCurrentConversation: true,
      openConversationAfterSend: false,
      showLiveDockProgress: true,
      autoRouteSpecialists: true,
      parallelSafeReads: true,
      researchDepth: "automatic",
      reasoningProfile: "configured_maximum",
      reversibleLowRiskAutonomy: true,
      notifyRequiredInput: true,
      notifyRunCompletion: true,
    });
    expect(DEFAULT_SPECTRA_PREFERENCES.compute).toMatchObject({
      local: "auto",
      respectBatterySaver: true,
      respectDataSaver: true,
      localPdfInspection: true,
      preserveOriginals: true,
    });
    expect(DEFAULT_SPECTRA_PREFERENCES.writing).toMatchObject({
      smartCompletion: true,
      localOnly: true,
    });
  });

  it("migrates legacy settings and resolves product/account/workspace/work/device deterministically", () => {
    expect(migratePreferences({ theme: "dark", compact: true, continueThread: false })).toMatchObject({
      version: 2,
      appearance: { theme: "dark", density: "compact" },
      ai: { continueCurrentConversation: false },
    });
    const resolved = resolvePreferences([
      { scope: "device", values: { appearance: { density: "comfortable" } } },
      { scope: "work_type", values: { appearance: { density: "compact" }, ai: { researchDepth: "verified" } } },
      { scope: "account", values: { appearance: { density: "compact" }, ai: { researchDepth: "quick" } } },
      { scope: "workspace", values: { ai: { researchDepth: "deep" } } },
    ]);
    expect(resolved.appearance.density).toBe("comfortable");
    expect(resolved.ai.researchDepth).toBe("verified");
  });

  it("renders a full settings application contract and a deliberately small quick drawer", () => {
    const app = readFileSync("src/features/spectra/settings/ui/settings-application.tsx", "utf8");
    const drawer = readFileSync("src/components/global-settings-drawer.tsx", "utf8");
    for (const section of ["General", "AI and runs", "Writing and autocomplete", "Collaboration", "Appearance", "Local compute and files", "Notifications", "Privacy and data", "Integrations", "Accessibility"]) {
      expect(app).toContain(section);
    }
    expect(app).toContain("<details");
    expect(app).toContain('aria-label="Settings sections"');
    expect(drawer).toContain("All settings");
    expect(drawer).toContain("Smart completion");
    expect(drawer).not.toContain('href="/memory"');
  });

  it("chooses worker, server, provider and degraded paths across capability and policy matrices", () => {
    expect(chooseComputePath({ task: "pdf_inspection", inputBytes: 2_000_000, preference: "auto", device: capable, privacy: "local_preferred", cancellable: true })).toMatchObject({ path: "local_worker", cancellation: "terminate_worker" });
    expect(chooseComputePath({ task: "javascript_build", inputBytes: 2_000_000, preference: "prefer_local", device: capable, privacy: "server_allowed", cancellable: true })).toMatchObject({ path: "server", reason: "server_for_size" });
    expect(chooseComputePath({ task: "python_execution", inputBytes: 1_000, preference: "never", device: capable, privacy: "server_allowed", cancellable: true })).toMatchObject({ path: "server", reason: "server_by_preference" });
    expect(chooseComputePath({ task: "native_model_attachment", inputBytes: 1_000, preference: "auto", device: capable, privacy: "server_allowed", cancellable: true })).toMatchObject({ path: "provider", cancellation: "provider_abort" });
    expect(chooseComputePath({ task: "autocomplete", inputBytes: 1_000, preference: "auto", device: { ...capable, mobile: true }, privacy: "local_required", cancellable: true })).toMatchObject({ path: "local_worker", reason: "local_only_ready" });
    expect(chooseComputePath({ task: "local_analysis", inputBytes: 1_000, preference: "prefer_local", device: capable, privacy: "local_preferred", cancellable: true, modelDownloadBytes: 120_000_000 })).toMatchObject({ path: "degraded", reason: "degraded_model_approval_required" });
  });

  it("registers every local task off the main thread with cancellation semantics", () => {
    expect(assertNoMainThreadCompute()).toBe(true);
    expect(COMPUTE_TASK_REGISTRY.map((task) => task.kind)).toEqual([
      "autocomplete",
      "pdf_inspection",
      "attachment_extraction",
      "python_execution",
      "javascript_build",
      "office_conversion",
      "native_model_attachment",
    ]);
    expect(COMPUTE_TASK_REGISTRY.filter((task) => task.execution === "worker").every((task) => task.cancellable)).toBe(true);
  });

  it("classifies text, mixed and scanned PDF fixtures without claiming OCR", () => {
    const page = (classification: "text" | "mixed" | "image_or_scanned", number: number) => ({ page: number, width: 600, height: 800, classification, text: classification === "image_or_scanned" ? "" : "Evidence", markdown: "", positionedText: [] });
    expect(summarizePdfPages([page("text", 1), page("text", 2)])).toMatchObject({ classification: "text", warnings: [] });
    const mixed = summarizePdfPages([page("text", 1), page("image_or_scanned", 2)]);
    expect(mixed.classification).toBe("mixed");
    expect(mixed.warnings[0]).toMatchObject({ code: "ocr_not_performed" });
    expect(FIRECRAWL_PDF_INSPECTOR_SCORE).toMatchObject({ adopted: false });
    expect(fallbackForPdfInspection({ path: "provider", reason: "provider_native", cancellation: "provider_abort", disclosure: "native" })).toBe("native_pdf");
  });

  it("preserves original, visual, structure, text, map, warnings and provenance for every consumer", () => {
    const bundle = createModelAttachmentBundle({
      id: "file-1",
      name: "evidence.pdf",
      mimeType: "application/pdf",
      size: 200,
      handling: "pdf",
      data: "data:application/pdf;base64,AA==",
      extractedText: "Page 1\nVerified evidence",
      pageCount: 1,
      structuredRepresentation: { kind: "pdf", value: { pages: 1 } },
      sourceMap: [{ kind: "page", label: "Page 1", startOffset: 0, endOffset: 17 }],
      warnings: [{ code: "partial_text", message: "One figure has no text." }],
      provenance: { source: "user_upload", originalFileId: "file-1", originalName: "evidence.pdf", originalMimeType: "application/pdf", originalBytes: 200, preparedAt: "2026-08-03T00:00:00.000Z", extractor: "spectra/pdfjs" },
    });
    const consumers: AttachmentConsumer[] = ["chat", "agent_evidence", "reference", "import", "research"];
    for (const consumer of consumers) {
      expect(attachmentBundleForConsumer(bundle, consumer)).toMatchObject({
        consumer,
        originalFile: { id: "file-1" },
        visualRepresentation: { kind: "pdf" },
        structuredRepresentation: { kind: "pdf" },
        searchableText: expect.stringContaining("Verified"),
        sourceMap: [{ kind: "page" }],
        warnings: [{ code: "partial_text" }],
        provenance: { originalFileId: "file-1" },
      });
    }
  });

  it("keeps autocomplete ghost state local until one explicit acceptance edit", () => {
    expect(Object.values(AUTOCOMPLETE_SURFACE_SUPPORT).every(Boolean)).toBe(true);
    const suggestion = deterministicSuggestion({ value: "The next step is", cursor: 16, surface: "plan_note" });
    expect(suggestion).toMatchObject({ tier: "deterministic", localOnly: true });
    const session = createAutocompleteSession();
    session.offer(suggestion);
    const original = "The next step is";
    expect(original).toBe("The next step is");
    const accepted = session.accept(original, "word");
    expect(accepted).toBe(`${original}${nextSuggestionWord(suggestion!.text)}`);
    session.setComposition(true);
    expect(session.offer(suggestion)).toBeNull();
    session.setComposition(false);
    session.setRemoteApplying(true);
    expect(session.offer(suggestion)).toBeNull();
    session.setRemoteApplying(false);
    session.offer(suggestion);
    session.dismiss();
    session.offer(suggestion);
    session.dismiss();
    session.offer(suggestion);
    session.dismiss();
    expect(session.offer(suggestion)).toBeNull();
    expect(autocompleteTier({ ...capable, mobile: true })).toBe(1);
    const tiptap = readFileSync("src/features/spectra/compute/autocomplete/tiptap-autocomplete-extension.ts", "utf8");
    const documentStudio = readFileSync("src/features/spectra/components/artifact-studio.tsx", "utf8");
    const presentationStudio = readFileSync("src/features/spectra/components/presentation-studio.tsx", "utf8");
    const agentFoundry = readFileSync("src/features/spectra/components/agent-foundry.tsx", "utf8");
    expect(tiptap).toContain('type: "offer"');
    expect(tiptap).toContain('.setMeta("spectra:autocomplete-accepted", true)');
    expect(tiptap).toContain("remoteOrAiTransaction");
    expect(documentStudio).toContain("SpectraTiptapAutocomplete.configure");
    expect(presentationStudio).toContain('surface="slide_text"');
    expect(agentFoundry).toContain('surface="agent_foundry"');
  });

  it("bounds Python and JS/TS/React runtimes and retains explicit server fallbacks", () => {
    expect(APPROVED_PYODIDE_PACKAGES.has("numpy")).toBe(true);
    expect(APPROVED_PYODIDE_PACKAGES.has("requests")).toBe(false);
    expect(pythonRuntimeFallback({ worker: true, wasm: true, sourceBytes: 200 })).toEqual({ path: "local_worker", reason: "device_ready" });
    expect(pythonRuntimeFallback({ worker: false, wasm: true, sourceBytes: 200 })).toEqual({ path: "server", reason: "unsupported_or_large" });
    const validated = validateLocalBuildInput({ files: [{ path: "src/main.ts", source: "export const answer: number = 42", language: "typescript" }], entryPath: "src/main.ts" });
    expect(validated.sourceBytes).toBeGreaterThan(0);
    expect(APPROVED_LOCAL_BUILD_DEPENDENCIES.react).toBe("19.2.3");
    expect(() => validateLocalBuildInput({ files: [{ path: "../escape.ts", source: "" }], entryPath: "../escape.ts" })).toThrow(/inside the project/);
    expect(() => validateLocalBuildInput({ files: [{ path: "main.tsx", source: "" }], entryPath: "main.tsx", dependencies: { react: { version: "latest", source: "" } } })).toThrow(/approved immutable/);
    expect(localBuildFallback(200, true)).toBe("local_worker");
    expect(localBuildFallback(2_000_000, true)).toBe("server");
  });

  it("scores every considered engine on every criterion and adopts no foreign product shell", () => {
    expect(validateEngineScorecards()).toBe(true);
    for (const engine of OPEN_SOURCE_ENGINE_SCORECARDS) {
      expect(new Set(Object.keys(engine.scores))).toEqual(new Set(ENGINE_CRITERIA));
      expect(engine.foreignProductShell).toBe(false);
      expect(engine.rationale.length).toBeGreaterThan(30);
    }
    expect(OPEN_SOURCE_ENGINE_SCORECARDS.find((engine) => engine.id === "duckdb-wasm")).toMatchObject({ disposition: "not_adopted" });
  });
});
