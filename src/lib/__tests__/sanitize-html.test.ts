import { describe, expect, it } from "vitest";
import { sanitizeArtifactDocumentHtml } from "@/lib/sanitize-html";

describe("sanitizeArtifactDocumentHtml", () => {
  it("removes scriptable elements and inline handlers", () => {
    const sanitized = sanitizeArtifactDocumentHtml(`
      <div>
        <p onclick="alert(1)">Safe text</p>
        <img src="x" onerror="alert(2)" />
        <script>alert("boom")</script>
      </div>
    `);

    expect(sanitized).toContain("Safe text");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("<script");
  });

  it("blocks javascript urls", () => {
    const sanitized = sanitizeArtifactDocumentHtml(`
      <a href="javascript:alert('xss')">click</a>
      <img src="javascript:alert('xss')" />
    `);

    expect(sanitized).toContain(">click<");
    expect(sanitized).not.toContain("javascript:");
  });
});
