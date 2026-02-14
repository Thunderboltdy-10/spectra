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

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
