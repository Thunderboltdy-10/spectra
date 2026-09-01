/** The Library identity of a linked file is the path basename, not a document heading. */
export function filenameFromRelativePath(relativePath: string) {
  const parts = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? relativePath;
}
