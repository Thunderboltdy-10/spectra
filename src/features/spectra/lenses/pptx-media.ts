import { Presentation, DRAWINGML_NAMESPACE, PML_NAMESPACE } from "@ariadng/office/pptx";
import { XmlElement } from "@ariadng/office/xml";
import { pptxImageAssetSchema, type PptxImageAsset } from "./projection-contracts";
import { sniffOfficeRasterMedia } from "./office-media";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const IMAGE_REL = `${REL_NS}/image`;
const ASSET_NS = "urn:spectra:pptx:asset:1";
const ASSET_EXT = "{B7B92F10-5D34-4E6D-9EE3-84C6C92F2917}";

export type PptxMediaWriteOptions = {
  resolveAsset?: (image: PptxImageAsset) => Promise<Uint8Array | undefined>;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function all(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const pending = [...root.elements()].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    pending.push(...node.elements().reverse());
  }
  return result;
}

function child(root: XmlElement, namespace: string, localName: string) {
  return root.elements().find((node) => node.namespaceUri() === namespace && node.localName === localName);
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

function metadata(shape: XmlElement) {
  const owner = all(shape).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "cNvPr");
  const list = owner && child(owner, DRAWINGML_NAMESPACE, "extLst");
  const extension = list?.elements().filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "ext" && node.getAttribute("uri") === ASSET_EXT);
  if (extension?.length !== 1) return undefined;
  const assets = extension[0]!.elements().filter((node) => node.namespaceUri() === ASSET_NS && node.localName === "asset");
  return assets.length === 1 ? assets[0] : undefined;
}

/** Reads durable identity from our extension but hashes the actual embedded
 * bytes. Extension metadata cannot attest that the native image was saved. */
export async function readPptxImageAsset(deck: Presentation, slidePartName: string, shape: XmlElement) {
  const source = metadata(shape);
  const objectId = source?.getAttribute("objectId");
  const assetId = source?.getAttribute("assetId");
  if (!source || !objectId || objectId.length > 500 || !assetId) return undefined;
  const blip = all(shape).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "blip");
  const relationshipId = blip?.getAttributeNs(REL_NS, "embed");
  const slidePart = deck.office.package.getPart(slidePartName);
  const relation = relationshipId && slidePart?.relationships().byId(relationshipId);
  const part = relation && relation.type === IMAGE_REL && relation.targetMode !== "External" && slidePart
    ? deck.office.package.relatedPart(slidePart, relation.id) : undefined;
  if (!part) return undefined;
  const bytes = await part.read();
  const mediaType = sniffOfficeRasterMedia(bytes);
  if (!mediaType || part.contentType.toLowerCase() !== mediaType) return undefined;
  const parsed = pptxImageAssetSchema.safeParse({ assetId, mediaType, sha256: await digest(bytes), ...(source.getAttribute("name") !== undefined ? { name: source.getAttribute("name") } : {}) });
  return parsed.success ? { objectId, image: parsed.data } : undefined;
}

/** Adds immutable media. Replacing one occurrence changes only its blip link;
 * existing parts and other pictures sharing the old bytes remain untouched. */
export async function writePptxImage(
  deck: Presentation,
  slidePartName: string,
  root: XmlElement,
  imageValue: PptxImageAsset,
  objectId: string,
  options?: PptxMediaWriteOptions,
  existing?: XmlElement,
) {
  const image = pptxImageAssetSchema.parse(imageValue);
  if (!objectId || objectId.length > 500) fail("PPTX_IMAGE_IDENTITY_INVALID", "The picture requires a stable object identity.");
  const tree = child(root, PML_NAMESPACE, "cSld");
  const shapeTree = tree && child(tree, PML_NAMESPACE, "spTree");
  const slidePart = deck.office.package.getPart(slidePartName);
  if (!shapeTree || !slidePart) fail("PPTX_IMAGE_OWNER_MISSING", "The slide has no native picture owner.");
  if (existing && (existing.namespaceUri() !== PML_NAMESPACE || existing.localName !== "pic"))
    fail("PPTX_IMAGE_MISSING", "Only a native picture can be replaced.");
  const existingBlip = existing && all(existing).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "blip");
  if (existing && !existingBlip) fail("PPTX_IMAGE_MISSING", "This picture has no editable native image link.");
  if (!existing && all(shapeTree).filter((node) => node.namespaceUri() === PML_NAMESPACE && ["pic", "sp", "graphicFrame", "grpSp"].includes(node.localName)).some((node) => {
    const nativeId = all(node).find((element) => element.namespaceUri() === PML_NAMESPACE && element.localName === "cNvPr")?.getAttribute("id");
    return (metadata(node)?.getAttribute("objectId") ?? `pptx:slide:${slidePartName}:shape:${nativeId}`) === objectId;
  }))
    fail("PPTX_IMAGE_IDENTITY_DUPLICATE", "This slide already contains that picture identity.");
  const bytes = await options?.resolveAsset?.(image);
  if (!bytes) fail("PPTX_IMAGE_ASSET_UNAVAILABLE", "The durable picture asset is unavailable. Restore or upload it before saving.");
  if (!bytes.byteLength || bytes.byteLength > 100_000_000 || sniffOfficeRasterMedia(bytes) !== image.mediaType || await digest(bytes) !== image.sha256)
    fail("PPTX_IMAGE_ASSET_MISMATCH", "The picture bytes do not match the requested durable asset.");

  const extension = image.mediaType === "image/png" ? "png" : "jpg";
  const used = new Set(deck.office.package.parts().map((part) => part.name.toLowerCase()));
  let suffix = 1;
  let partName = `/ppt/media/spectra-image-${suffix}.${extension}`;
  while (used.has(partName.toLowerCase())) partName = `/ppt/media/spectra-image-${++suffix}.${extension}`;
  deck.office.package.addPart(partName, image.mediaType, bytes);
  const relation = slidePart.relationships().add({ type: IMAGE_REL, target: `../media/${partName.split("/").at(-1)}` });
  const p = root.ensurePrefix(PML_NAMESPACE, "p");
  const a = root.ensurePrefix(DRAWINGML_NAMESPACE, "a");
  root.ensurePrefix(REL_NS, "r");
  const shape = existing ?? new XmlElement("pic", p);
  if (!existing) {
    const ids = all(shapeTree).filter((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "cNvPr").map((node) => Number(node.getAttribute("id") ?? 0));
    const id = Math.max(1, ...ids.filter(Number.isFinite)) + 1;
    if (!Number.isInteger(id) || id > 4_294_967_295) fail("PPTX_IMAGE_IDENTITY_EXHAUSTED", "The slide has no available native picture identity.");
    const nonVisual = new XmlElement("nvPicPr", p);
    const owner = new XmlElement("cNvPr", p);
    owner.setAttribute("id", String(id));
    owner.setAttribute("name", image.name ?? `Picture ${id}`);
    nonVisual.appendChild(owner);
    nonVisual.appendChild(new XmlElement("cNvPicPr", p));
    nonVisual.appendChild(new XmlElement("nvPr", p));
    shape.appendChild(nonVisual);
    const fill = new XmlElement("blipFill", p);
    fill.appendChild(new XmlElement("blip", a));
    const stretch = new XmlElement("stretch", a);
    stretch.appendChild(new XmlElement("fillRect", a));
    fill.appendChild(stretch);
    shape.appendChild(fill);
    const properties = new XmlElement("spPr", p);
    const geometry = new XmlElement("prstGeom", a);
    geometry.setAttribute("prst", "rect");
    geometry.appendChild(new XmlElement("avLst", a));
    properties.appendChild(geometry);
    shape.appendChild(properties);
    shapeTree.appendChild(shape);
  }
  const blip = existingBlip ?? all(shape).find((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "blip")!;
  blip.setAttributeNs(REL_NS, "embed", relation.id);
  blip.removeAttributeNs(REL_NS, "link");
  const owner = all(shape).find((node) => node.namespaceUri() === PML_NAMESPACE && node.localName === "cNvPr")!;
  let list = child(owner, DRAWINGML_NAMESPACE, "extLst");
  if (!list) { list = new XmlElement("extLst", a); owner.appendChild(list); }
  const old = list.elements().filter((node) => node.namespaceUri() === DRAWINGML_NAMESPACE && node.localName === "ext" && node.getAttribute("uri") === ASSET_EXT);
  if (old.length > 1) fail("PPTX_IMAGE_IDENTITY_AMBIGUOUS", "This picture has conflicting durable identity metadata.");
  const ext = old[0] ?? new XmlElement("ext", a);
  if (!old.length) ext.setAttribute("uri", ASSET_EXT);
  const prefix = ext.ensurePrefix(ASSET_NS, "spectra");
  const priorAssets = ext.elements().filter((node) => node.namespaceUri() === ASSET_NS && node.localName === "asset");
  if (priorAssets.length > 1) fail("PPTX_IMAGE_IDENTITY_AMBIGUOUS", "This picture has conflicting durable asset metadata.");
  const asset = priorAssets[0] ?? new XmlElement("asset", prefix);
  asset.setAttribute("objectId", objectId);
  asset.setAttribute("assetId", image.assetId);
  if (image.name !== undefined) asset.setAttribute("name", image.name);
  else asset.removeAttribute("name");
  if (!priorAssets.length) ext.appendChild(asset);
  if (!old.length) list.appendChild(ext);
  deck.office.markDirty(slidePartName);
  return shape;
}
