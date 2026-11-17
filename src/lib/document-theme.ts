/**
 * Where dark is allowed. The public pages (landing, sign-in, sign-up, joining,
 * legal) are drawn for light only, so they always show light; the theme the
 * person chose comes back as soon as they are in the app again.
 */
const PUBLIC_PREFIXES = ["/landing", "/sign-in", "/sign-up", "/join", "/request-access", "/legal", "/public", "/school-data"];

export function isPublicPath(pathname: string | null | undefined) {
  if (!pathname) return false;
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Every switch to light or dark goes through here, so a public page can hold light. */
export function setDocumentDark(dark: boolean) {
  const root = document.documentElement;
  root.dataset.spectraDark = String(dark);
  root.classList.toggle("dark", dark && root.dataset.spectraPublic === undefined);
}

export function setPublicDocument(isPublic: boolean) {
  const root = document.documentElement;
  if (isPublic) {
    root.dataset.spectraPublic = "";
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    return;
  }
  delete root.dataset.spectraPublic;
  root.style.colorScheme = "";
  if (root.dataset.spectraDark === "true") root.classList.add("dark");
}
