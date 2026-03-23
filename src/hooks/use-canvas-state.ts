"use client";

import { useMemo, useState } from "react";
import { buildSrcdoc, canPreview, type PreviewLanguage } from "@/lib/code-sandbox";

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

function sanitizeVersionLabel(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildPreviewDocument(code: string, language: string) {
  const normalized = normalizeLanguage(language);
  const previewLanguage = (
    normalized === "typescript"
      ? "tsx"
      : normalized === "text"
        ? "html"
        : normalized
  ) as PreviewLanguage;

  if (canPreview(previewLanguage)) {
    return buildSrcdoc(code, previewLanguage);
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
      label: sanitizeVersionLabel(label, `Version ${versions.length + 1}`),
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
      label: sanitizeVersionLabel(payload.label, "Initial import"),
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
