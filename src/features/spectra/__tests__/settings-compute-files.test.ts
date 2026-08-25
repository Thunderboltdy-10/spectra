import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  PREFERENCE_SCOPE_ORDER,
  migratePreferences,
  resolvePreferences,
} from "@/features/spectra/settings/schema";
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
  ENGINE_CRITERIA,
  OPEN_SOURCE_ENGINE_SCORECARDS,
  validateEngineScorecards,
} from "@/features/spectra/compute/engines";

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
      "workbar",
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
    expect(
      migratePreferences({
        theme: "dark",
        compact: true,
        continueThread: false,
      }),
    ).toMatchObject({
      version: 2,
      appearance: { theme: "dark", density: "compact" },
      ai: { continueCurrentConversation: false },
    });
    const resolved = resolvePreferences([
      { scope: "device", values: { appearance: { density: "comfortable" } } },
      {
        scope: "work_type",
        values: {
          appearance: { density: "compact" },
          ai: { researchDepth: "verified" },
        },
      },
      {
        scope: "account",
        values: {
          appearance: { density: "compact" },
          ai: { researchDepth: "quick" },
        },
      },
      { scope: "workspace", values: { ai: { researchDepth: "deep" } } },
    ]);
    expect(resolved.appearance.density).toBe("comfortable");
    expect(resolved.ai.researchDepth).toBe("verified");
  });

  it("renders only settings with runtime effects and a deliberately small quick drawer", () => {
    const app = readFileSync(
      "src/features/spectra/settings/ui/settings-application.tsx",
      "utf8",
    );
    for (const section of ["Conversations", "Writing", "Appearance", "Privacy and data"]) {
      expect(app).toContain(section);
    }
    for (const removed of ["Collaboration", "Local compute and files", "Notifications", "Integrations"]) {
      expect(app).not.toContain(removed);
    }
    expect(app).not.toContain("<details");
    expect(app).toContain('aria-label="Settings sections"');
    const providers = readFileSync("src/components/providers.tsx", "utf8");
    expect(providers).not.toContain("GlobalSettingsDrawer");
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
      sourceMap: [
        { kind: "page", label: "Page 1", startOffset: 0, endOffset: 17 },
      ],
      warnings: [{ code: "partial_text", message: "One figure has no text." }],
      provenance: {
        source: "user_upload",
        originalFileId: "file-1",
        originalName: "evidence.pdf",
        originalMimeType: "application/pdf",
        originalBytes: 200,
        preparedAt: "2026-08-03T00:00:00.000Z",
        extractor: "spectra/pdfjs",
      },
    });
    const consumers: AttachmentConsumer[] = [
      "chat",
      "agent_evidence",
      "reference",
      "import",
      "research",
    ];
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
    expect(Object.values(AUTOCOMPLETE_SURFACE_SUPPORT).every(Boolean)).toBe(
      true,
    );
    const suggestion = deterministicSuggestion({
      value: "The next step is",
      cursor: 16,
      surface: "plan_note",
    });
    expect(suggestion).toMatchObject({
      tier: "deterministic",
      localOnly: true,
    });
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
    expect(autocompleteTier({ worker: true, wasm: true, webAssemblyStreaming: true, mobile: true, logicalCores: 8, deviceMemoryGb: 8, memoryPressure: "low", batterySaver: false, dataSaver: false })).toBe(1);
    const tiptap = readFileSync(
      "src/features/spectra/compute/autocomplete/tiptap-autocomplete-extension.ts",
      "utf8",
    );
    const documentStudio = readFileSync(
      "src/features/spectra/components/document-studio.tsx",
      "utf8",
    );
    const presentationStudio = readFileSync(
      "src/features/spectra/components/presentation-studio.tsx",
      "utf8",
    );
    const agentFoundry = readFileSync(
      "src/features/spectra/components/agent-foundry.tsx",
      "utf8",
    );
    expect(tiptap).toContain('type: "offer"');
    expect(tiptap).toContain('.setMeta("spectra:autocomplete-accepted", true)');
    expect(tiptap).toContain("remoteOrAiTransaction");
    expect(documentStudio).toContain("SpectraTiptapAutocomplete.configure");
    expect(presentationStudio).toContain('surface="slide_text"');
    expect(agentFoundry).toContain('surface="agent_foundry"');
  });

  it("bounds the launch-path Python runtime and retains its explicit server fallback", () => {
    expect(APPROVED_PYODIDE_PACKAGES.has("numpy")).toBe(true);
    expect(APPROVED_PYODIDE_PACKAGES.has("micropip")).toBe(false);
    expect(APPROVED_PYODIDE_PACKAGES.has("requests")).toBe(false);
    expect(
      pythonRuntimeFallback({ worker: true, wasm: true, sourceBytes: 200 }),
    ).toEqual({ path: "local_worker", reason: "device_ready" });
    expect(
      pythonRuntimeFallback({ worker: false, wasm: true, sourceBytes: 200 }),
    ).toEqual({ path: "server", reason: "unsupported_or_large" });
  });

  it("scores every considered engine on every criterion and adopts no foreign product shell", () => {
    expect(validateEngineScorecards()).toBe(true);
    for (const engine of OPEN_SOURCE_ENGINE_SCORECARDS) {
      expect(new Set(Object.keys(engine.scores))).toEqual(
        new Set(ENGINE_CRITERIA),
      );
      expect(engine.foreignProductShell).toBe(false);
      expect(engine.rationale.length).toBeGreaterThan(30);
    }
    expect(
      OPEN_SOURCE_ENGINE_SCORECARDS.find(
        (engine) => engine.id === "duckdb-wasm",
      ),
    ).toMatchObject({ disposition: "not_adopted" });
  });
});
