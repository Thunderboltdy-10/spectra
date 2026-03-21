"use client";

import { CodePreview } from "@/components/chat/code-preview";

type MermaidPreviewProps = {
  code: string;
};

export function MermaidPreview({ code }: MermaidPreviewProps) {
  return <CodePreview code={code} language="mermaid" />;
}
