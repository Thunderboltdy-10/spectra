import { describe, expect, it } from "vitest";

import { buildSpectraSandboxDocument } from "../embed/sandbox-protocol";

describe("Spectra sandbox document", () => {
  it("emits syntactically valid runtime scripts for browser previews", () => {
    const result = buildSpectraSandboxDocument({
      channel: "preview-test",
      title: "Preview test",
      files: [
        {
          path: "index.html",
          language: "html",
          source:
            "<main><style>.card{background:url('https://example.com/a.png')}</style></main>",
        },
      ],
    });

    expect(result.srcDoc).not.toBeNull();
    const scripts = Array.from(
      result.srcDoc!.matchAll(/<script>([\s\S]*?)<\/script>/g),
      (match) => match[1],
    );

    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });
});
