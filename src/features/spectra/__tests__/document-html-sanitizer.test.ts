// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeDocumentHtml } from "../components/artifact-studio-file-utils";

/** Insert sanitized markup the way React's dangerouslySetInnerHTML does. */
function renderInScriptingDocument(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function activeSurfaces(root: Element) {
  const findings: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    const tag = element.tagName.toLowerCase();
    if (["script", "iframe", "object", "embed", "svg", "math", "noscript", "template", "style"].includes(tag))
      findings.push(`<${tag}>`);
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.replace(/[\u0000- ]/g, "").toLowerCase();
      if (name.startsWith("on")) findings.push(`${tag}[${name}]`);
      if (/^(?:javascript|vbscript|data):/.test(value) && !/^data:image\//.test(value))
        findings.push(`${tag}[${name}=${value.slice(0, 24)}]`);
    }
  }
  return findings;
}

describe("sanitizeDocumentHtml", () => {
  it("keeps ordinary rich-text structure, links and equation data", () => {
    const html = sanitizeDocumentHtml(
      '<p>Hello <strong>class</strong> <a href="https://example.org/a">link</a></p>' +
        '<ul><li><em>one</em></li></ul><span data-type="inline-equation" data-latex="x^2"></span>' +
        '<img src="data:image/png;base64,AAAA" alt="diagram">',
    );
    expect(html).toContain("<strong>class</strong>");
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain('data-latex="x^2"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it.each([
    ["noscript parser differential", '<p>ok</p><noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>'],
    ["entity-split javascript URL", '<p><a href="java&#x09;script:alert(1)">tab</a></p>'],
    ["newline-split javascript URL", '<p><a href="jav&#10;ascript:alert(1)">nl</a></p>'],
    ["svg xlink href", '<p>x</p><svg><a xlink:href="javascript:alert(1)"><text>go</text></a></svg>'],
    ["svg animate href", '<p>x</p><svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>go</text></a></svg>'],
    ["math maction", '<p>x</p><math><maction actiontype="statusline" xlink:href="javascript:alert(1)">go</maction></math>'],
    ["template round trip", '<p>x</p><template><img src=x onerror=alert(1)></template>'],
    ["svg style breakout", '<p>x</p><svg><style><img src=x onerror=alert(1)></style></svg>'],
    ["data html frame", '<p><a href="data:text/html;base64,PHNjcmlwdD4=">d</a></p>'],
    ["form action", '<p><a href="#">x</a></p><form action="javascript:alert(1)"><button>go</button></form>'],
  ])("removes %s and stays a fixed point when re-parsed", (_label, payload) => {
    const sanitized = sanitizeDocumentHtml(payload);
    expect(activeSurfaces(renderInScriptingDocument(sanitized))).toEqual([]);
    // A second pass must be a fixed point: sanitized output is stable markup.
    expect(sanitizeDocumentHtml(sanitized)).toBe(sanitized);
  });
});
