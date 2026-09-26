import { PML_NAMESPACE } from "@ariadng/office/pptx";
import { XmlElement } from "@ariadng/office/xml";
import { pptxTransitionSchema, type PptxTransition } from "./projection-contracts";

export const P14_NAMESPACE = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const ancillary = new Set(["sndAc", "extLst"]);
const namespaceDeclaration = (attribute: { prefix: string | null; localName: string }) => attribute.prefix === "xmlns" || (!attribute.prefix && attribute.localName === "xmlns");

function supportedEffect(effect: XmlElement): boolean {
  if (effect.namespaceUri() !== PML_NAMESPACE || effect.children.length) return false;
  return effect.attributes.filter((attribute) => !namespaceDeclaration(attribute)).every((attribute) => {
    if (attribute.prefix) return false;
    if (effect.localName === "push") return attribute.localName === "dir" && attribute.value === "l";
    if (effect.localName === "fade") return attribute.localName === "thruBlk" && ["0", "false"].includes(attribute.value);
    return false;
  }) && ["fade", "push", "dissolve"].includes(effect.localName);
}

export function readPptxTransition(root: XmlElement): { node?: XmlElement; transition?: PptxTransition } {
  const transitions: XmlElement[] = [];
  const pending = [...root.elements()];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.namespaceUri() === PML_NAMESPACE && node.localName === "transition") transitions.push(node);
    pending.push(...node.elements());
  }
  if (!transitions.length) return { transition: { kind: "none" } };
  const node = transitions[0]!;
  if (transitions.length !== 1 || node.parent !== root) return { node };
  const effects = node.elements().filter((child) => !(child.namespaceUri() === PML_NAMESPACE && ancillary.has(child.localName)));
  if (effects.length > 1 || (effects.length === 1 && !supportedEffect(effects[0]!))) return { node };
  const duration = node.getAttributeNs(P14_NAMESPACE, "dur");
  if (duration !== undefined && (!/^\d+$/.test(duration) || Number(duration) > 4_294_967_295)) return { node };
  const kind = (effects[0]?.localName ?? "none") as PptxTransition["kind"];
  return { node, transition: { kind, ...(kind !== "none" && duration !== undefined ? { durationMs: Number(duration) } : {}) } };
}

export function writePptxTransition(root: XmlElement, value: PptxTransition): void {
  const desired = pptxTransitionSchema.parse(value);
  const existing = readPptxTransition(root);
  if (!existing.transition) throw Object.assign(new Error("This native PowerPoint transition has settings that Spectra cannot replace losslessly."), { code: "PPTX_TRANSITION_PRESERVED" });
  if (!existing.node && desired.kind === "none") return;
  const node = existing.node ?? (() => {
    const created = new XmlElement("transition", root.lookupPrefix(PML_NAMESPACE) ?? "p");
    const following = root.elements().find((child) => child.namespaceUri() === PML_NAMESPACE && ["timing", "extLst"].includes(child.localName));
    root.insertBefore(created, following ?? null);
    return created;
  })();
  for (const effect of node.elements().filter((child) => child.namespaceUri() === PML_NAMESPACE && ["fade", "push", "dissolve"].includes(child.localName))) node.removeChild(effect);
  if (desired.kind !== "none") {
    const effect = new XmlElement(desired.kind, node.lookupPrefix(PML_NAMESPACE) ?? "p");
    if (desired.kind === "push") effect.setAttribute("dir", "l");
    node.insertBefore(effect, node.elements()[0] ?? null);
    if (desired.durationMs !== undefined) {
      root.ensurePrefix(P14_NAMESPACE, "p14");
      node.setAttributeNs(P14_NAMESPACE, "dur", String(desired.durationMs));
    }
  } else {
    node.removeAttributeNs(P14_NAMESPACE, "dur");
  }
  // Keep the existing root even for None. Legacy speed, advance-on-click/time,
  // sound, extension markup and all unmodeled root attributes remain untouched.
}
