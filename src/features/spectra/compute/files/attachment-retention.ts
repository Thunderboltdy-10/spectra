import { createHash } from "node:crypto";
import { decodeBase64DataUrl } from "../../../../../shared/parser-limits";

export function attachmentInputBytes(input: {
  name?: string;
  mimeType?: string;
  handling?: string;
  data?: string;
}) {
  if (typeof input.data !== "string")
    throw new Error(`Attachment bytes are unavailable: ${input.name ?? "attachment"}`);
  if (input.handling === "text" && !input.data.startsWith("data:"))
    return Buffer.from(input.data.replace(/\u0000/g, ""), "utf8");
  return Buffer.from(
    decodeBase64DataUrl(
      input.data,
      input.name ?? "attachment",
      25_000_000,
    ),
  );
}

export function attachmentSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function attachmentBytesAsInput(
  bytes: Uint8Array,
  input: { name: string; mimeType: string; handling: "text" | "pdf" | "docx" | "xlsx" | "pptx" | "image"; id?: string },
) {
  const data =
    input.handling === "text"
      ? new TextDecoder().decode(bytes)
      : `data:${input.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  return {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType,
    handling: input.handling,
    size: bytes.byteLength,
    data,
  };
}
