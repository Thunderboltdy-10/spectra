import {
  inferRuntime,
  languageForPath,
  normalizeCodeContent,
  normalizeCodePath,
  preferredEntry,
  reconcileLineIds,
  type CodeContent,
  type CodeFile,
  type CodeRuntime,
} from "../../../code/model";
import { AuthoringError, type IdFactory, defaultIdFactory, truncate } from "./shared";

/*
 * Code is authored as whole files and edited with find-and-replace, like a
 * coding agent. Line ids are reconciled so collaborators' cursors and comments
 * on untouched lines survive.
 */

export type CodeEditOp =
  | { op: "replace"; file?: string; find: string; replace: string; all?: boolean }
  | { op: "write_file"; path: string; source: string; language?: string }
  | { op: "delete_file"; path: string }
  | { op: "rename_file"; path: string; to: string }
  | { op: "set_entry"; path: string }
  | { op: "set_accessibility"; title: string; description: string; reducedMotion?: boolean };

export type CodeSpec = {
  files: Array<{ path: string; source: string; language?: string }>;
  runtime?: CodeRuntime;
  entry?: string;
  title?: string;
  description?: string;
};

const RUNTIMES = new Set(["browser", "react", "python", "none"]);

function path(value: unknown, label: string, field = "path") {
  try {
    return normalizeCodePath(typeof value === "string" ? value : "");
  } catch (error) {
    throw new AuthoringError(`${label}: ${field} ${error instanceof Error ? error.message.toLowerCase() : "is invalid"}`);
  }
}

function findFile(files: CodeFile[], ref: string | undefined, label: string, field = "file") {
  if (ref === undefined) {
    if (files.length === 1) return files[0]!;
    throw new AuthoringError(`${label}: ${field} is required when there are several files (${files.map((file) => file.path).join(", ")}).`);
  }
  const wanted = path(ref, label, field).toLowerCase();
  const file = files.find((entry) => entry.path.toLowerCase() === wanted);
  if (!file) throw new AuthoringError(`${label}: no file "${ref}". Files: ${files.map((entry) => entry.path).join(", ")}.`);
  return file;
}

function withSource(file: CodeFile, source: string): CodeFile {
  const next = source.replaceAll("\r\n", "\n");
  return { ...file, source: next, lineIds: reconcileLineIds(file.source, file.lineIds, next) };
}

export function applyCodeEdits(content: unknown, ops: CodeEditOp[], ids: IdFactory = defaultIdFactory()): CodeContent {
  const code = normalizeCodeContent(structuredClone(content ?? {}));
  let files = [...code.files];
  let entryFileId = code.entryFileId;
  let accessibility = code.accessibility;
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "replace": {
        const file = findFile(files, op.file, label);
        if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
        const count = file.source.split(op.find).length - 1;
        if (!count)
          throw new AuthoringError(`${label}: \`find\` text is not in ${file.path}. It must match exactly, including indentation.`);
        if (count > 1 && !op.all)
          throw new AuthoringError(`${label}: \`find\` text appears ${count} times in ${file.path}. Include more surrounding lines, or set "all": true.`);
        const source = op.all ? file.source.split(op.find).join(op.replace) : file.source.replace(op.find, () => op.replace);
        files = files.map((entry) => (entry.id === file.id ? withSource(entry, source) : entry));
        break;
      }
      case "write_file": {
        const target = path(op.path, label);
        if (typeof op.source !== "string") throw new AuthoringError(`${label}: source must be the whole file as text.`);
        const existing = files.find((entry) => entry.path.toLowerCase() === target.toLowerCase());
        if (existing) files = files.map((entry) => (entry.id === existing.id ? { ...withSource(entry, op.source), ...(op.language ? { language: op.language } : {}) } : entry));
        else {
          let id = ids("file");
          while (files.some((entry) => entry.id === id)) id = ids("file");
          const source = op.source.replaceAll("\r\n", "\n");
          files.push({
            id,
            path: target,
            language: op.language || languageForPath(target),
            source,
            lineIds: source.split("\n").map((_, line) => `${id}:line:${line + 1}`),
          });
        }
        break;
      }
      case "delete_file": {
        const file = findFile(files, op.path, label, "path");
        if (files.length === 1) throw new AuthoringError(`${label}: a code artifact keeps at least one file.`);
        files = files.filter((entry) => entry.id !== file.id);
        if (entryFileId === file.id) entryFileId = preferredEntry(files, code.runtime).id;
        break;
      }
      case "rename_file": {
        const file = findFile(files, op.path, label, "path");
        const to = path(op.to, label, "to");
        if (files.some((entry) => entry.id !== file.id && entry.path.toLowerCase() === to.toLowerCase()))
          throw new AuthoringError(`${label}: ${to} already exists.`);
        files = files.map((entry) => (entry.id === file.id ? { ...entry, path: to, language: languageForPath(to) } : entry));
        break;
      }
      case "set_entry":
        entryFileId = findFile(files, op.path, label, "path").id;
        break;
      case "set_accessibility":
        if (typeof op.title !== "string" || !op.title.trim() || typeof op.description !== "string" || !op.description.trim())
          throw new AuthoringError(`${label}: give a non-empty accessible title and description.`);
        accessibility = { ...accessibility, title: op.title.trim(), description: op.description.trim(), ...(typeof op.reducedMotion === "boolean" ? { reducedMotion: op.reducedMotion } : {}) };
        break;
      default:
        throw new AuthoringError(`${label}: unknown operation. Use replace, write_file, delete_file, rename_file, set_entry or set_accessibility.`);
    }
  });
  return normalizeCodeContent({ ...code, files, entryFileId, ...(accessibility ? { accessibility } : {}) });
}

export function codeFromSpec(spec: CodeSpec, ids: IdFactory = defaultIdFactory()): CodeContent {
  if (!Array.isArray(spec?.files) || !spec.files.length) throw new AuthoringError("files: give at least one file.");
  if (spec.runtime !== undefined && !RUNTIMES.has(spec.runtime))
    throw new AuthoringError(`runtime must be browser, react, python or none.`);
  const seed = normalizeCodeContent({ files: [{ id: "seed", path: "seed.txt", source: "" }] });
  const built = applyCodeEdits(
    seed,
    [
      ...spec.files.map((file) => ({ op: "write_file" as const, path: file.path, source: file.source, language: file.language })),
      { op: "delete_file", path: "seed.txt" },
    ],
    ids,
  );
  const runtime = spec.runtime ?? inferRuntime(built.files);
  const entry = spec.entry
    ? findFile(built.files, spec.entry, "entry", "entry")
    : preferredEntry(built.files, runtime);
  return normalizeCodeContent({
    ...built,
    runtime,
    entryFileId: entry.id,
    ...(spec.title || spec.description ? { accessibility: { ...(spec.title ? { title: spec.title } : {}), ...(spec.description ? { description: spec.description } : {}) } } : {}),
    visualisation: {
      ...built.visualisation,
      enabled: runtime === "browser" || runtime === "react",
      ...(spec.title ? { title: spec.title } : {}),
      ...(spec.description ? { description: spec.description } : {}),
    },
  });
}

function numbered(source: string, from = 1, to?: number) {
  const lines = source.split("\n");
  const end = Math.min(lines.length, to ?? lines.length);
  return lines
    .slice(from - 1, end)
    .map((line, index) => `${String(from + index).padStart(4)}  ${line}`)
    .join("\n");
}

export function codeOutline(content: unknown, options: { file?: string; from?: number; to?: number; max?: number } = {}) {
  const code = normalizeCodeContent(content);
  const header = `${code.runtime} runtime; entry ${code.files.find((file) => file.id === code.entryFileId)?.path ?? "?"}. Files: ${code.files
    .map((file) => `${file.path} (${file.source.split("\n").length} lines)`)
    .join(", ")}.`;
  const files = options.file ? [findFile(code.files, options.file, "read")] : code.files;
  const body = files.map((file) => `--- ${file.path}\n${numbered(file.source, options.from ?? 1, options.to)}`).join("\n");
  return truncate(`${header}\n${body}`, options.max ?? 12_000);
}

export function codeReadback(content: unknown, previous?: unknown) {
  const code = normalizeCodeContent(content);
  if (!previous) return codeOutline(code, { max: 2_400 });
  const before = normalizeCodeContent(previous);
  const prior = new Map(before.files.map((file) => [file.id, file]));
  const lines = [`${code.files.length} file${code.files.length === 1 ? "" : "s"}.`];
  for (const file of code.files) {
    const old = prior.get(file.id);
    if (!old) {
      lines.push(`New ${file.path} (${file.source.split("\n").length} lines).`);
      continue;
    }
    if (old.source === file.source && old.path === file.path) continue;
    const a = old.source.split("\n");
    const b = file.source.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let tail = 0;
    while (tail < a.length - start && tail < b.length - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
    const from = Math.max(1, start + 1 - 2);
    const to = Math.min(b.length, b.length - tail + 2);
    lines.push(`${old.path !== file.path ? `${old.path} → ` : ""}${file.path} lines ${from}-${to} now:\n${truncate(numbered(file.source, from, to), 1_600)}`);
  }
  const removed = before.files.filter((file) => !code.files.some((entry) => entry.id === file.id));
  if (removed.length) lines.push(`Removed ${removed.map((file) => file.path).join(", ")}.`);
  return lines.join("\n");
}
