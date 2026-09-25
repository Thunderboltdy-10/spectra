import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, XmlElement } from "@ariadng/office/xml";
import type { WordCommentData, WordRevisionInline } from "./docx-academic-schema";
import { relatedWordPart, storyText, wordAttr, wordElement, wordElements, wordText, writeStoryContent } from "./docx-academic";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

function hasModernComments(document: Document) {
  return ["http://schemas.microsoft.com/office/2011/relationships/commentsExtended", "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds", "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible"].some((type) => document.office.mainPart.relationships().byType(type).length > 0) || document.office.package.parts().some((part) => /\/comments(Extended|Extensible|Ids)\.xml$/i.test(part.name));
}

export function nativeCommentReadOnlyReason(document: Document, comment: XmlElement) {
  if (hasModernComments(document)) return "This native thread uses modern Word comment extensions. Edit or delete it in Word.";
  const allowed = new Set(["comment", "p", "pPr", "pStyle", "r", "rPr", "rStyle", "b", "i", "u", "annotationRef", "t", "tab", "br", "cr"]);
  if (wordElements(comment).some((node) => node.namespaceUri() !== WML_NAMESPACE || !allowed.has(node.localName))) return "This comment contains rich or unmodeled native content. Edit its body in Word.";
  return undefined;
}

export function supportedRevision(element: XmlElement): WordRevisionInline | undefined {
  if (!["ins", "del"].includes(element.localName) || element.parent?.localName !== "p" || !/^\d+$/.test(wordAttr(element, "id") ?? "")) return undefined;
  // Only modeled run formatting may be reviewed through the shared reducer.
  // Other formatting, moves and nested structures remain exact regional carry.
  const allowed = new Set([element.localName, "r", "rPr", "t", "delText", "b", "i", "u"]);
  if (!element.elements().length || element.elements().some((node) => node.localName !== "r") || wordElements(element).some((node) => node.namespaceUri() !== WML_NAMESPACE || !allowed.has(node.localName))) return undefined;
  if (wordElements(element).some((node) => node.localName === "u" && ![undefined, "single"].includes(wordAttr(node, "val")))) return undefined;
  if (wordElements(element).some((node) => ["b", "i"].includes(node.localName) && ["0", "false", "off"].includes(wordAttr(node, "val") ?? ""))) return undefined;
  const content = element.elements().map((run) => {
    const props = run.find(WML_NAMESPACE, "rPr");
    const enabled = (name: string) => {
      const prop = props?.find(WML_NAMESPACE, name);
      return Boolean(prop && !["0", "false", "off", "none"].includes(wordAttr(prop, "val") ?? ""));
    };
    return { text: wordText(run), ...(enabled("b") ? { bold: true } : {}), ...(enabled("i") ? { italic: true } : {}), ...(enabled("u") ? { underline: true } : {}) };
  });
  return {
    kind: "revision", revisionId: wordAttr(element, "id")!, revisionKind: element.localName as "ins" | "del",
    author: wordAttr(element, "author") ?? "", ...(wordAttr(element, "date") ? { date: wordAttr(element, "date") } : {}),
    text: wordText(element), content,
  };
}

export function hasUnsupportedRevision(root: XmlElement) {
  return wordElements(root).some((node) => ["ins", "del"].includes(node.localName) && !supportedRevision(node));
}

export function appendRevision(parent: XmlElement, revision: WordRevisionInline, retained?: XmlElement) {
  if (revision.content && revision.content.map((run) => run.text).join("") !== revision.text) throw new Error("DOCX_UNSUPPORTED_EDIT: Revision text and formatted runs disagree.");
  // Retain native formatting exactly when the authored identity and text agree.
  if (retained && JSON.stringify(supportedRevision(retained)) === JSON.stringify(revision)) {
    parent.appendChild(retained);
    return;
  }
  const wrapper = retained?.clone() ?? wordElement(revision.revisionKind);
  parent.appendChild(wrapper);
  for (const child of [...wrapper.children]) wrapper.removeChild(child);
  wrapper.setAttributeNs(WML_NAMESPACE, "id", revision.revisionId);
  wrapper.setAttributeNs(WML_NAMESPACE, "author", revision.author);
  if (revision.date) wrapper.setAttributeNs(WML_NAMESPACE, "date", revision.date);
  else wrapper.removeAttributeNs(WML_NAMESPACE, "date");
  const story = parseXml(`<w:comment xmlns:w="${WML_NAMESPACE}"/>`).root;
  const paragraph = wordElement("p", story);
  if (retained) for (const run of retained.elements()) paragraph.appendChild(run.clone());
  writeStoryContent(story, [revision.content ?? [{ text: revision.text }]], undefined, !revision.content);
  for (const run of [...story.elements()[0]!.elements()]) {
    wrapper.appendChild(run);
    for (const text of wordElements(run).filter((node) => ["t", "delText"].includes(node.localName))) renameWordText(text, revision.revisionKind === "del" ? "delText" : "t");
  }
}

function renameWordText(text: XmlElement, name: "t" | "delText") {
  if (text.localName === name) return;
  const renamed = wordElement(name);
  for (const attr of text.attributes) renamed.setAttribute(attr.prefix ? `${attr.prefix}:${attr.localName}` : attr.localName, attr.value);
  for (const child of [...text.children]) renamed.appendChild(child);
  text.parent!.insertBefore(renamed, text);
  text.parent!.removeChild(text);
}

export function reviewRevision(element: XmlElement, decision: "accept" | "reject") {
  const revision = supportedRevision(element);
  if (!revision) throw new Error("DOCX_REGION_READ_ONLY: This revision changes a paragraph, table, formatting, move, or nested structure. Review it in Word.");
  const parent = element.parent!;
  const keep = revision.revisionKind === "ins" ? decision === "accept" : decision === "reject";
  if (keep) for (const child of [...element.elements()]) {
    if (revision.revisionKind === "del") for (const text of wordElements(child).filter((node) => node.localName === "delText")) {
      renameWordText(text, "t");
    }
    parent.insertBefore(child, element);
  }
  parent.removeChild(element);
}

export async function nativeComment(document: Document, id: string) {
  const part = await relatedWordPart(document, "comments");
  const comments = part?.root.elements().filter((node) => node.localName === "comment" && wordAttr(node, "id") === id) ?? [];
  if (comments.length > 1) throw new Error("DOCX_IDENTITY_AMBIGUOUS: This native comment ID is duplicated.");
  return part && comments[0] ? { ...part, comment: comments[0] } : undefined;
}

export async function upsertNativeComment(document: Document, id: string, data: WordCommentData) {
  const existing = await nativeComment(document, id);
  if (existing && storyText(existing.comment) === data.text && wordAttr(existing.comment, "author") === data.author) return;
  // Modern threaded comments use extension IDs and relationships not mapped by
  // this classic annotation writer. Preserve them rather than silently forking.
  const reason = existing && nativeCommentReadOnlyReason(document, existing.comment);
  if (reason) throw new Error(`DOCX_REGION_READ_ONLY: ${reason}`);
  if (!existing && hasModernComments(document)) throw new Error("DOCX_REGION_READ_ONLY: Add native comments in Word while this document uses modern comment extensions.");
  const part = existing ?? await relatedWordPart(document, "comments") ?? (() => {
    const xml = parseXml(`<w:comments xmlns:w="${WML_NAMESPACE}"/>`);
    const added = document._internal().addXmlPart("/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml", `${REL}comments`, xml);
    document._internal().markDirty(added.pd);
    return { partName: added.pd.part.name, root: xml.root };
  })();
  const comment = existing?.comment ?? wordElement("comment", part.root);
  comment.setAttributeNs(WML_NAMESPACE, "id", id);
  comment.setAttributeNs(WML_NAMESPACE, "author", data.author);
  if (data.initials) comment.setAttributeNs(WML_NAMESPACE, "initials", data.initials);
  if (data.date) comment.setAttributeNs(WML_NAMESPACE, "date", data.date);
  writeStoryContent(comment, data.text.split("\n").map((text) => [{ text }]), undefined, true);
  document.office.markDirty(part.partName);
}

export function appendCommentBoundary(parent: XmlElement, id: string, boundary: "start" | "end" | "reference") {
  const element = wordElement(boundary === "start" ? "commentRangeStart" : boundary === "end" ? "commentRangeEnd" : "commentReference", boundary === "reference" ? wordElement("r", parent) : parent);
  element.setAttributeNs(WML_NAMESPACE, "id", id);
  return boundary === "reference" ? element.parent! : element;
}

export async function deleteNativeComment(document: Document, id: string) {
  const found = await nativeComment(document, id);
  if (!found) throw new Error("DOCX_IDENTITY_AMBIGUOUS: The native comment no longer exists.");
  if (hasModernComments(document)) throw new Error("DOCX_REGION_READ_ONLY: Delete this modern Word comment thread in Word.");
  for (const node of wordElements(document.body()).filter((node) => ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(node.localName) && wordAttr(node, "id") === id)) node.parent?.removeChild(node);
  found.root.removeChild(found.comment);
  document.office.markDirty(found.partName);
  document._markMainDirty();
}
