import type { Message } from "@/hooks/use-chat-state";

function roleTitle(role: Message["role"]) {
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return "User";
}

export function exportConversationMarkdown(params: {
  title: string;
  messages: Message[];
}) {
  const blocks = params.messages.map((message) => {
    const lines = [`## ${roleTitle(message.role)}`];
    if (message.modelUsed && message.role === "assistant") {
      lines.push(`_Model: ${message.modelUsed}_`);
    }
    lines.push("", message.content.trim());
    if (message.citations && message.citations.length > 0) {
      lines.push("", "### Sources");
      for (const citation of message.citations) {
        const source = citation.url ?? citation.filename;
        lines.push(`- ${source}`);
      }
    }
    return lines.join("\n").trim();
  });

  return `# ${params.title || "Chat Export"}\n\n${blocks.join("\n\n---\n\n")}\n`;
}

function stripMarkdownFormatting(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function exportConversationPlainText(params: {
  title: string;
  messages: Message[];
}) {
  const blocks = params.messages.map((message) => {
    const lines = [`${roleTitle(message.role)}:`];
    if (message.modelUsed && message.role === "assistant") {
      lines.push(`Model: ${message.modelUsed}`);
    }
    lines.push(stripMarkdownFormatting(message.content));
    if (message.citations && message.citations.length > 0) {
      lines.push("Sources:");
      for (const citation of message.citations) {
        const source = citation.url ?? citation.filename;
        lines.push(`- ${source}`);
      }
    }
    return lines.join("\n");
  });

  return `${params.title || "Chat Export"}\n\n${blocks.join("\n\n--------------------\n\n")}\n`;
}

export function downloadTextFile(filename: string, text: string) {
  const mimeType = filename.toLowerCase().endsWith(".md")
    ? "text/markdown;charset=utf-8"
    : "text/plain;charset=utf-8";
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
