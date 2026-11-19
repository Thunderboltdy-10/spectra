import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { docxPreviewContent } from "@/features/spectra/lenses/docx-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Word files the fidelity lab can open. The committed fixtures always; a
 * local folder of private copies through SPECTRA_DOCUMENT_LAB_DIR, which is
 * read in place and never copied into the repository. Word's own PDF of a
 * file sits next to it as `<name>.pdf` (scripts/word-verify.ps1 makes them).
 */
function sources() {
  const root = process.cwd();
  return [
    { id: "fixtures", label: "Spectra fixtures", dir: path.join(root, "src/features/spectra/__tests__/fixtures") },
    { id: "office", label: "Office corpus", dir: path.join(root, "fixtures/office/docx") },
    ...(process.env.SPECTRA_DOCUMENT_LAB_DIR
      ? [{ id: "local", label: "Local copies", dir: path.resolve(process.env.SPECTRA_DOCUMENT_LAB_DIR) }]
      : []),
  ];
}

async function listFixtures() {
  const result: Array<{ source: string; label: string; name: string; hasPdf: boolean; bytes: number }> = [];
  for (const source of sources()) {
    const names = await readdir(source.dir).catch(() => [] as string[]);
    const files = new Set(names);
    for (const name of names.sort((left, right) => left.localeCompare(right))) {
      if (!/\.docx$/iu.test(name) || name.startsWith("~$")) continue;
      const info = await stat(path.join(source.dir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      result.push({ source: source.id, label: source.label, name, bytes: info.size, hasPdf: files.has(name.replace(/\.docx$/iu, ".pdf")) });
    }
  }
  return result;
}

/** Resolve only names the listing offers, so a request can't walk the disk. */
async function fixturePath(source: string | null, name: string | null) {
  if (!source || !name) return null;
  const listed = (await listFixtures()).some((entry) => entry.source === source && entry.name === name);
  const dir = sources().find((entry) => entry.id === source)?.dir;
  return listed && dir ? path.join(dir, name) : null;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const params = request.nextUrl.searchParams;
  if (!params.has("name")) return NextResponse.json({ fixtures: await listFixtures() });
  const file = await fixturePath(params.get("source"), params.get("name"));
  if (!file) return NextResponse.json({ error: "Unknown fixture." }, { status: 404 });
  if (params.get("as") === "pdf") {
    const bytes = await readFile(file.replace(/\.docx$/iu, ".pdf")).catch(() => null);
    return bytes
      ? new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } })
      : NextResponse.json({ error: "No Word PDF yet. Run scripts/word-verify.ps1 on this folder." }, { status: 404 });
  }
  try {
    const started = performance.now();
    const content = await docxPreviewContent(new Uint8Array(await readFile(file)));
    return NextResponse.json({ content, openMs: Math.round(performance.now() - started) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "This file could not be opened." }, { status: 422 });
  }
}
