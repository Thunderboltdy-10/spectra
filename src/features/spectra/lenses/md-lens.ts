import { z } from "zod";
import { sha256Payload } from "./payload-hash";
import type {
  LensCapabilitySet,
  LensExternalDiff,
  LensFidelityEntry,
  LensFidelityMap,
  LensOpenResult,
  SpectraLens,
} from "./types";

const semanticDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const mdProjectionSchema = z
  .object({
    body: z.string().max(20_000_000),
    nativeBinding: z
      .object({
        version: z.literal(1),
        format: z.literal("md"),
        profile: z.enum(["strict-native", "enhanced", "spectra-native"]),
        semanticDigest: semanticDigestSchema,
        lineEnding: z.enum(["lf", "crlf", "cr"]),
        byteOrderMark: z.boolean(),
        /** Exact YAML fence and content. It is retained, never parsed. */
        frontmatter: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export type MdProjection = z.infer<typeof mdProjectionSchema>;

export const mdOperationSchema = z
  .object({ kind: z.literal("replace-body"), body: z.string().max(20_000_000) })
  .strict();
export type MdSemanticDelta = z.infer<typeof mdOperationSchema>;
export const MD_LENS_DELTA_KINDS = [
  mdOperationSchema.shape.kind.value,
] as const;

export class MdLensError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MdLensError";
  }
}

function lineEndingOf(
  text: string,
): MdProjection["nativeBinding"]["lineEnding"] {
  if (text.includes("\r\n")) return "crlf";
  if (text.includes("\r")) return "cr";
  return "lf";
}

function newlineAt(text: string, offset: number) {
  if (text.startsWith("\r\n", offset)) return "\r\n";
  if (text[offset] === "\n") return "\n";
  if (text[offset] === "\r") return "\r";
  return "";
}

/** Return the exact leading YAML block and the editable Markdown body. */
function splitFrontmatter(text: string) {
  if (!text.startsWith("---")) return { body: text };
  const firstNewline = newlineAt(text, 3);
  if (!firstNewline) return { body: text };
  let cursor = 3 + firstNewline.length;
  while (cursor <= text.length) {
    const nextLf = text.indexOf("\n", cursor);
    const nextCr = text.indexOf("\r", cursor);
    const candidates = [nextLf, nextCr].filter((index) => index >= 0);
    const lineEnd = candidates.length ? Math.min(...candidates) : text.length;
    const line = text.slice(cursor, lineEnd);
    const ending = newlineAt(text, lineEnd);
    if (line === "---" || line === "...") {
      const boundary = lineEnd + ending.length;
      return {
        frontmatter: text.slice(0, boundary),
        body: text.slice(boundary),
      };
    }
    if (!ending) break;
    cursor = lineEnd + ending.length;
  }
  return { body: text };
}

function decodeMarkdown(payload: Uint8Array) {
  const byteOrderMark =
    payload.length >= 3 &&
    payload[0] === 0xef &&
    payload[1] === 0xbb &&
    payload[2] === 0xbf;
  try {
    return {
      byteOrderMark,
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        byteOrderMark ? payload.subarray(3) : payload,
      ),
    };
  } catch {
    throw new MdLensError(
      "MD_INVALID_UTF8",
      "This Markdown file is not valid UTF-8. Spectra kept its bytes unchanged and did not guess an encoding.",
    );
  }
}

function encodeMarkdown(projection: MdProjection) {
  const text = `${projection.nativeBinding.frontmatter ?? ""}${projection.body}`;
  const encoded = new TextEncoder().encode(text);
  if (!projection.nativeBinding.byteOrderMark) return encoded;
  const output = new Uint8Array(encoded.length + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(encoded, 3);
  return output;
}

function fidelityFor(projection: MdProjection): LensFidelityMap {
  const entries: LensFidelityEntry[] = [
    { regionId: "md:body", feature: "body", class: "NATIVE" },
  ];
  if (projection.nativeBinding.frontmatter !== undefined) {
    entries.push({
      regionId: "md:frontmatter",
      feature: "frontmatter",
      class: "PRESERVED",
      readOnly: true,
      reason:
        "Markdown frontmatter is kept byte-for-byte and is not interpreted or edited by Spectra.",
    });
  }
  if (/\[\[[^\]\r\n]+(?:\|[^\]\r\n]+)?\]\]/u.test(projection.body)) {
    entries.push({
      regionId: "md:wikilinks",
      feature: "hyperlinks",
      class: "PRESERVED",
      readOnly: true,
      reason:
        "Obsidian wiki-links are kept as Markdown text; Spectra does not resolve or rewrite their targets.",
    });
  }
  return {
    version: 1,
    profile: projection.nativeBinding.profile,
    entries,
  };
}

function capabilities(
  profile: MdProjection["nativeBinding"]["profile"],
  fidelityMap: LensFidelityMap,
): LensCapabilitySet {
  const hasFrontmatter = fidelityMap.entries.some(
    (entry) => entry.feature === "frontmatter",
  );
  return {
    profile,
    human: [
      { id: "edit-markdown-body", available: true },
      {
        id: "edit-frontmatter",
        available: false,
        reason: hasFrontmatter
          ? "Edit frontmatter in a text editor; Spectra keeps it unchanged."
          : "This Markdown file has no frontmatter.",
      },
      {
        id: "resolve-wiki-links",
        available: false,
        reason:
          "Spectra preserves wiki-links as written but does not resolve vault targets yet.",
      },
    ],
    aiOperations: ["replace_body"],
  };
}

export const mdLens: SpectraLens<MdProjection, MdSemanticDelta> = {
  format: "md",

  async open(
    payload,
    profile = "strict-native",
  ): Promise<LensOpenResult<MdProjection>> {
    const decoded = decodeMarkdown(payload);
    const split = splitFrontmatter(decoded.text);
    const semanticDigest = await sha256Payload(
      new TextEncoder().encode(
        JSON.stringify({
          body: split.body,
          frontmatter: split.frontmatter ?? null,
        }),
      ),
    );
    const projection = mdProjectionSchema.parse({
      body: split.body,
      nativeBinding: {
        version: 1,
        format: "md",
        profile,
        semanticDigest,
        lineEnding: lineEndingOf(decoded.text),
        byteOrderMark: decoded.byteOrderMark,
        ...(split.frontmatter !== undefined
          ? { frontmatter: split.frontmatter }
          : {}),
      },
    });
    const fidelityMap = fidelityFor(projection);
    return {
      projection,
      fidelityMap,
      preservedCarry: {
        version: 1,
        format: "md",
        profile,
        basePayloadHash: await sha256Payload(payload),
        payload,
        projection,
      },
      capabilities: capabilities(profile, fidelityMap),
    };
  },

  async mutate(carry, delta) {
    return this.materialize({
      projection: { ...carry.projection, body: delta.body },
      carry,
    });
  },

  async materialize({ projection, carry }) {
    const next = mdProjectionSchema.parse(projection);
    if (
      next.nativeBinding.frontmatter !==
        carry.projection.nativeBinding.frontmatter ||
      next.nativeBinding.byteOrderMark !==
        carry.projection.nativeBinding.byteOrderMark ||
      next.nativeBinding.lineEnding !==
        carry.projection.nativeBinding.lineEnding ||
      next.nativeBinding.profile !== carry.projection.nativeBinding.profile
    ) {
      throw new MdLensError(
        "MD_PRESERVED_BOUNDARY_READ_ONLY",
        "Spectra keeps Markdown frontmatter and file encoding unchanged. Edit those fields in a text editor if you need to change them.",
      );
    }
    if (next.body === carry.projection.body) return carry.payload;
    return encodeMarkdown(next);
  },

  async diffExternal(payloadA, payloadB): Promise<LensExternalDiff> {
    const [before, after, hashA, hashB] = await Promise.all([
      this.open(payloadA),
      this.open(payloadB),
      sha256Payload(payloadA),
      sha256Payload(payloadB),
    ]);
    const changes: LensExternalDiff["changes"] = [];
    if (before.projection.body !== after.projection.body) {
      changes.push({
        regionId: "md:body",
        kind: "update",
        before: before.projection.body,
        after: after.projection.body,
      });
    }
    const frontmatterChanged =
      before.projection.nativeBinding.frontmatter !==
      after.projection.nativeBinding.frontmatter;
    if (frontmatterChanged) {
      changes.push({
        regionId: "md:frontmatter",
        kind: "preserved-part-replaced",
        before: before.projection.nativeBinding.frontmatter,
        after: after.projection.nativeBinding.frontmatter,
        partName: "md:frontmatter",
      });
    }
    return {
      changes,
      changedParts: hashA === hashB ? [] : ["md:bytes"],
      preservedPartChanges: frontmatterChanged ? ["md:frontmatter"] : [],
    };
  },

  capabilities,
};
