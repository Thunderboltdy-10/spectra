/*
 * Files the user attaches to a message: read in the browser and checked
 * against what Spectra can take, so a wrong file says why before sending.
 */

export type CommandAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx" | "xlsx" | "pptx" | "image";
  data?: string;
  error?: string;
};

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function readFile(file: File, mode: "text" | "data-url") {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    if (mode === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/** Read one file into an attachment, or an attachment that says why it can't be sent. */
export async function readCommandAttachment(file: File): Promise<CommandAttachment> {
  const base = {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
  if (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name)
  ) {
    const mime = file.type || "image/png";
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        mime,
      ) &&
      !/\.(png|jpe?g|webp|gif)$/i.test(file.name)
    )
      return {
        ...base,
        handling: "image",
        error: "Use a PNG, JPEG, WebP, or GIF image.",
      };
    if (file.size > 8 * 1024 * 1024)
      return {
        ...base,
        handling: "image",
        error: "Images must be 8 MB or smaller.",
      };
    return {
      ...base,
      mimeType: mime.startsWith("image/") ? mime : "image/png",
      handling: "image",
      data: await readFile(file, "data-url"),
    };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > 10 * 1024 * 1024)
      return {
        ...base,
        handling: "pdf",
        error: "PDFs must be 10 MB or smaller.",
      };
    return {
      ...base,
      handling: "pdf",
      data: await readFile(file, "data-url"),
    };
  }
  if (
    TEXT_TYPES.has(file.type) ||
    /\.(txt|md|csv|json)$/i.test(file.name)
  ) {
    if (file.size > 2 * 1024 * 1024)
      return {
        ...base,
        handling: "text",
        error: "Text files must be 2 MB or smaller.",
      };
    return {
      ...base,
      handling: "text",
      data: await readFile(file, "text"),
    };
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  ) {
    if (file.size > 8 * 1024 * 1024)
      return {
        ...base,
        handling: "docx",
        error: "Documents must be 8 MB or smaller.",
      };
    return {
      ...base,
      handling: "docx",
      data: await readFile(file, "data-url"),
    };
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.xlsx$/i.test(file.name)
  ) {
    if (file.size > 12 * 1024 * 1024)
      return {
        ...base,
        handling: "xlsx",
        error: "Excel workbooks must be 12 MB or smaller.",
      };
    return {
      ...base,
      handling: "xlsx",
      data: await readFile(file, "data-url"),
    };
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    /\.pptx$/i.test(file.name)
  ) {
    if (file.size > 20 * 1024 * 1024)
      return {
        ...base,
        handling: "pptx",
        error: "PowerPoint presentations must be 20 MB or smaller.",
      };
    return {
      ...base,
      handling: "pptx",
      data: await readFile(file, "data-url"),
    };
  }
  return {
    ...base,
    handling: "text",
    error:
      "This file type is not supported. Use PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, JSON, PNG, JPEG, WebP, or GIF.",
  };
}
