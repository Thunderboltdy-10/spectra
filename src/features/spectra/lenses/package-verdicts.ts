import type { PackageComparison, PackagePartComparison } from "@ariadng/office/preservation";
import { parseXml, type XmlElement } from "@ariadng/office/xml";
import { ZipReader } from "@ariadng/office/zip";

/*
 * Which parts of a package a save changed, by the same L1 rules as the office
 * library's comparePackages: byte-identical parts are "identical"; XML parts
 * that differ only in attribute order, namespace prefixes, comments,
 * processing instructions or insignificant whitespace are "equivalent".
 *
 * The library also reports every difference with a path, which costs a scan
 * of all siblings per element (quadratic in a long document body). A save
 * only needs each part's verdict, so this stops at the first difference and
 * resolves namespaces once per scope instead of walking ancestors per element.
 */

type Scope = ReadonlyMap<string, string | null>;
type Child = { kind: "text"; text: string } | { kind: "element"; element: XmlElement };

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

function isXmlWhitespace(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
}

function scopeOf(element: XmlElement, parent: Scope): Scope {
  let scope: Map<string, string | null> | undefined;
  for (const attribute of element.attributes) {
    const declared =
      attribute.prefix === "xmlns" ? attribute.localName : attribute.prefix === null && attribute.localName === "xmlns" ? "" : undefined;
    if (declared === undefined) continue;
    scope ??= new Map(parent);
    scope.set(declared, attribute.value === "" ? null : attribute.value);
  }
  return scope ?? parent;
}

function resolve(scope: Scope, prefix: string | null) {
  if (prefix === "xml") return XML_NAMESPACE;
  if (prefix === "xmlns") return XMLNS_NAMESPACE;
  return scope.get(prefix ?? "") ?? null;
}

function ownXmlSpace(element: XmlElement) {
  for (const attribute of element.attributes)
    if (attribute.prefix === "xml" && attribute.localName === "space") {
      if (attribute.value === "preserve") return true;
      if (attribute.value === "default") return false;
    }
  return null;
}

function attributesOf(element: XmlElement, scope: Scope) {
  const out = new Map<string, string>();
  for (const attribute of element.attributes) {
    if (attribute.prefix === "xmlns" || (attribute.prefix === null && attribute.localName === "xmlns")) continue;
    const namespace = attribute.prefix === null ? null : resolve(scope, attribute.prefix);
    out.set(`${namespace ?? ""} ${attribute.localName}`, attribute.value);
  }
  return out;
}

function normalizedChildren(element: XmlElement, preserve: boolean): Child[] {
  const out: Child[] = [];
  let pending: string | null = null;
  const flush = () => {
    if (pending !== null && (preserve || !isXmlWhitespace(pending))) out.push({ kind: "text", text: pending });
    pending = null;
  };
  for (const child of element.children) {
    if (child.kind === "text" || child.kind === "cdata") pending = (pending ?? "") + (child as { text: string }).text;
    else if (child.kind === "element") {
      flush();
      out.push({ kind: "element", element: child as XmlElement });
    }
  }
  flush();
  return out;
}

/** True when two trees are equal under the L1 rules. */
export function xmlTreesEquivalent(expectedRoot: XmlElement, actualRoot: XmlElement) {
  const empty: Scope = new Map();
  const work: Array<[XmlElement, XmlElement, Scope, Scope, boolean, boolean]> = [
    [expectedRoot, actualRoot, empty, empty, false, false],
  ];
  while (work.length) {
    const [expected, actual, expectedParent, actualParent, expectedInherited, actualInherited] = work.pop()!;
    if (expected.localName !== actual.localName) return false;
    const expectedScope = scopeOf(expected, expectedParent);
    const actualScope = scopeOf(actual, actualParent);
    if (resolve(expectedScope, expected.prefix) !== resolve(actualScope, actual.prefix)) return false;
    const expectedAttributes = attributesOf(expected, expectedScope);
    const actualAttributes = attributesOf(actual, actualScope);
    if (expectedAttributes.size !== actualAttributes.size) return false;
    for (const [key, value] of expectedAttributes) if (actualAttributes.get(key) !== value) return false;
    const expectedPreserve = ownXmlSpace(expected) ?? expectedInherited;
    const actualPreserve = ownXmlSpace(actual) ?? actualInherited;
    const expectedChildren = normalizedChildren(expected, expectedPreserve);
    const actualChildren = normalizedChildren(actual, actualPreserve);
    if (expectedChildren.length !== actualChildren.length) return false;
    for (let index = expectedChildren.length - 1; index >= 0; index -= 1) {
      const left = expectedChildren[index]!;
      const right = actualChildren[index]!;
      if (left.kind !== right.kind) return false;
      if (left.kind === "text") {
        if (left.text !== (right as { text: string }).text) return false;
        continue;
      }
      work.push([left.element, (right as { element: XmlElement }).element, expectedScope, actualScope, expectedPreserve, actualPreserve]);
    }
  }
  return true;
}

const isXmlPartName = (name: string) => /\.(xml|rels)$/i.test(name);

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function entryNames(reader: ZipReader) {
  return [...new Set(reader.entries().map((entry) => entry.name))];
}

/** comparePackages' verdicts, without the per-difference report. */
export async function comparePackageVerdicts(expected: Uint8Array, actual: Uint8Array): Promise<PackageComparison> {
  const expectedZip = await ZipReader.open(expected);
  const actualZip = await ZipReader.open(actual);
  const expectedNames = entryNames(expectedZip);
  const actualNames = entryNames(actualZip);
  const expectedSet = new Set(expectedNames);
  const actualSet = new Set(actualNames);
  const parts: PackagePartComparison[] = [];
  for (const name of expectedNames) {
    if (!actualSet.has(name)) {
      parts.push({ name, verdict: "different", note: "only in expected package" });
      continue;
    }
    const expectedBytes = await expectedZip.read(name);
    const actualBytes = await actualZip.read(name);
    if (bytesEqual(expectedBytes, actualBytes)) {
      parts.push({ name, verdict: "identical" });
      continue;
    }
    if (!isXmlPartName(name)) {
      parts.push({ name, verdict: "different", note: "binary content differs" });
      continue;
    }
    let equivalent: boolean;
    try {
      equivalent = xmlTreesEquivalent(parseXml(expectedBytes).root, parseXml(actualBytes).root);
    } catch (error) {
      parts.push({ name, verdict: "different", note: `xml parse failed: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    parts.push(equivalent ? { name, verdict: "equivalent" } : { name, verdict: "different" });
  }
  for (const name of actualNames)
    if (!expectedSet.has(name)) parts.push({ name, verdict: "different", note: "only in actual package" });
  return { equal: parts.every((part) => part.verdict !== "different"), parts };
}
