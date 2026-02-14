"use client";

import { useMemo, useState } from "react";

export type CanvasVersion = {
  id: string;
  label: string;
  code: string;
  language: string;
  createdAt: number;
};

type OpenCanvasPayload = {
  code: string;
  language?: string;
  label?: string;
};

function normalizeLanguage(value?: string) {
  const raw = (value ?? "text").toLowerCase().trim();
  if (!raw) return "text";
  if (raw === "js") return "javascript";
  if (raw === "ts") return "typescript";
  if (raw === "py") return "python";
  return raw;
}

function buildPreviewDocument(code: string, language: string) {
  if (language === "html") return code;
  if (language === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body><main class="preview-root"><h1>CSS Preview</h1><p>Edit styles and click Run to refresh.</p></main></body></html>`;
  }
  if (language === "javascript" || language === "typescript") {
    return `<!doctype html><html><body><main id="app"><h1>JS Preview</h1><p>Open console for runtime output.</p></main><script type="module">${code}\n<\/script></body></html>`;
  }
  return `<!doctype html><html><body><pre>${code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</pre></body></html>`;
}

export function useCanvasState() {
  const [isOpen, setIsOpen] = useState(false);
  const [language, setLanguage] = useState("text");
  const [code, setCode] = useState("");
  const [versions, setVersions] = useState<CanvasVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [previewDoc, setPreviewDoc] = useState("");

  function saveVersion(label?: string) {
    const timestamp = Date.now();
    const version: CanvasVersion = {
      id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      label: label?.trim() || `Version ${versions.length + 1}`,
      code,
      language,
      createdAt: timestamp,
    };
    setVersions((prev) => [version, ...prev].slice(0, 40));
    setActiveVersionId(version.id);
  }

  function runPreview() {
    setPreviewDoc(buildPreviewDocument(code, language));
  }

  function openCanvas(payload: OpenCanvasPayload) {
    const nextLanguage = normalizeLanguage(payload.language);
    const nextCode = payload.code ?? "";
    setLanguage(nextLanguage);
    setCode(nextCode);
    setPreviewDoc(buildPreviewDocument(nextCode, nextLanguage));
    setIsOpen(true);

    const timestamp = Date.now();
    const initial: CanvasVersion = {
      id: `${timestamp}-initial`,
      label: payload.label?.trim() || "Initial import",
      code: nextCode,
      language: nextLanguage,
      createdAt: timestamp,
    };
    setVersions([initial]);
    setActiveVersionId(initial.id);
  }

  function closeCanvas() {
    setIsOpen(false);
  }

  function restoreVersion(versionId: string) {
    const hit = versions.find((item) => item.id === versionId);
    if (!hit) return;
    setCode(hit.code);
    setLanguage(hit.language);
    setPreviewDoc(buildPreviewDocument(hit.code, hit.language));
    setActiveVersionId(hit.id);
  }

  const currentVersion = useMemo(
    () => versions.find((item) => item.id === activeVersionId),
    [versions, activeVersionId],
  );

  return {
    isOpen,
    language,
    code,
    versions,
    previewDoc,
    currentVersion,
    openCanvas,
    closeCanvas,
    setLanguage,
    setCode,
    saveVersion,
    runPreview,
    restoreVersion,
  };
}
