import { internalAnchor } from "../lenses/word-bookmarks";

/**
 * The link a typed address stands for: a web address (given https:// when it
 * has no scheme), an email address (as mailto:), or a heading in this
 * document (#name). Undefined for anything else, so a link the Word file
 * can't hold, or a script URL, never goes in.
 */
export function linkAddress(typed: string) {
  const value = typed.trim();
  if (!value || /[\u0000-\u001f\u007f\s]/u.test(value) || value.length > 2_000) return undefined;
  if (value.startsWith("#")) return internalAnchor(value) ? value : undefined;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/iu.test(value)) {
    if (/^mailto:[^@]+@[^@]+$/iu.test(value)) return value;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? value : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^[^@/]+@[^@/]+\.[^@/]+$/u.test(value)) return `mailto:${value}`;
  if (/^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d{1,5})?(?:[/?#].*)?$/u.test(value)) return `https://${value}`;
  return undefined;
}
