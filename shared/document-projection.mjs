/**
 * Canonical document <-> ProseMirror projection used by both the browser Yjs
 * adapter and the plain-Node collaboration gateway. Keep this module free of
 * browser-only and TypeScript-only dependencies so the two runtimes cannot
 * drift into separate document schemas.
 */

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function inlineText(value) {
  return value ? [{ type: "text", text: value }] : undefined;
}

export function richInlineText(content) {
  return content
    .map((item) => {
      if (item.kind === "text") return item.text;
      if (item.kind === "equation") return item.latex;
      return item.altText;
    })
    .join("");
}

export function richInlineHasObject(content) {
  return content.some((item) => item.kind !== "text");
}

export function docxNativeMediaUrl(binding, image) {
  const source = record(binding);
  const artifactId =
    typeof source.sourceArtifactId === "string" ? source.sourceArtifactId : "";
  const payloadHash =
    typeof source.sourcePayloadHash === "string"
      ? source.sourcePayloadHash
      : "";
  if (!artifactId || !/^[a-f0-9]{64}$/.test(payloadHash)) return "";
  const query = new URLSearchParams({
    artifactId,
    payloadHash,
    partName: image.partName,
  });
  return `/api/spectra/lenses/docx/media?${query.toString()}`;
}

export function docxRichInlineToJson(content, binding, nativeReadOnly = false) {
  const nodes = content.flatMap((item) => {
    if (item.kind === "text")
      return item.text ? [{ type: "text", text: item.text }] : [];
    if (item.kind === "equation")
      return [
        {
          type: "inlineEquation",
          attrs: {
            latex: item.latex,
            ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
          },
        },
      ];
    return [
      {
        type: "nativeDocxImage",
        attrs: {
          src: docxNativeMediaUrl(binding, item),
          partName: item.partName,
          mediaType: item.mediaType,
          alt: item.altText,
          ...(item.widthEmu ? { widthEmu: item.widthEmu } : {}),
          ...(item.heightEmu ? { heightEmu: item.heightEmu } : {}),
          placement: item.placement,
          nativeReadOnly: true,
        },
      },
    ];
  });
  return nodes.length ? nodes : undefined;
}

function cellJsonFromRichContent(content, binding, nativeReadOnly) {
  const meaningful = content.filter(
    (item) => item.kind !== "text" || Boolean(item.text.trim()),
  );
  const displayEquation =
    meaningful.length === 1 &&
    meaningful[0]?.kind === "equation" &&
    meaningful[0].display === "block"
      ? meaningful[0]
      : null;
  if (displayEquation)
    return [
      {
        type: "equation",
        attrs: {
          latex: displayEquation.latex,
          display: "block",
          alignment: "center",
          ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
        },
      },
    ];
  return [
    {
      type: "paragraph",
      content: docxRichInlineToJson(content, binding, nativeReadOnly),
    },
  ];
}

export function docxRichBlockToJson(value, binding) {
  const block = record(value);
  if (
    typeof block.id !== "string" ||
    !block.id ||
    typeof block.type !== "string" ||
    typeof block.text !== "string"
  )
    return null;
  const attrs = record(block.attrs);
  const nativeReadOnly = attrs.nativeReadOnly === true;
  const nativeAttrs = {
    blockId: block.id,
    ...(nativeReadOnly ? { nativeReadOnly: true } : {}),
  };

  if (block.type === "equation") {
    const equation = Array.isArray(block.inlineContent)
      ? block.inlineContent.find((item) => item?.kind === "equation")
      : null;
    return {
      type: "equation",
      attrs: {
        ...nativeAttrs,
        latex: equation?.latex ?? block.text,
        display: "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  }

  if (
    block.type === "table" &&
    Array.isArray(block.richRows) &&
    block.richRows.every(
      (row) => Array.isArray(row) && row.every((cell) => Array.isArray(cell)),
    )
  )
    return {
      type: "table",
      attrs: nativeAttrs,
      content: block.richRows.map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          content: cellJsonFromRichContent(cell, binding, nativeReadOnly),
        })),
      })),
    };

  const inlineContent = Array.isArray(block.inlineContent)
    ? block.inlineContent
    : [];
  if (!richInlineHasObject(inlineContent)) return null;
  const content = docxRichInlineToJson(inlineContent, binding, nativeReadOnly);
  if (block.type === "heading")
    return {
      type: "heading",
      attrs: {
        ...nativeAttrs,
        level:
          Number(String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1]) ||
          Number(attrs.level) ||
          2,
      },
      content,
    };
  if (block.type === "list")
    return {
      type: "bulletList",
      attrs: nativeAttrs,
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content }],
        },
      ],
    };
  return { type: "paragraph", attrs: nativeAttrs, content };
}

function blockToJson(blockValue, index, nativeBinding) {
  const block = record(blockValue);
  const id =
    typeof block.id === "string" && block.id.trim()
      ? block.id
      : `block-${index + 1}`;
  const value = typeof block.text === "string" ? block.text : "";
  const attrs = record(block.attrs);
  const richNode = docxRichBlockToJson(block, nativeBinding);
  if (richNode) return richNode;
  if (block.type === "heading")
    return {
      type: "heading",
      attrs: {
        blockId: id,
        level: [1, 2, 3].includes(Number(attrs.level))
          ? Number(attrs.level)
          : Number(
              String(attrs.styleId ?? "").match(/^Heading([1-3])$/i)?.[1] ?? 2,
            ),
      },
      content: inlineText(value),
    };
  if (block.type === "quote")
    return {
      type: "blockquote",
      attrs: { blockId: id },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "list")
    return {
      type: "bulletList",
      attrs: { blockId: id },
      content: (value.split(/\r?\n/).filter(Boolean).length
        ? value.split(/\r?\n/).filter(Boolean)
        : [""]
      ).map((entry) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineText(entry) }],
      })),
    };
  if (block.type === "callout")
    return {
      type: "callout",
      attrs: { blockId: id, type: attrs.tone ?? "info" },
      content: [{ type: "paragraph", content: inlineText(value) }],
    };
  if (block.type === "math" || block.type === "equation")
    return {
      type: "equation",
      attrs: {
        blockId: id,
        latex: typeof block.latex === "string" ? block.latex : value,
        display: attrs.display ?? "block",
        alignment: attrs.alignment ?? "center",
      },
    };
  if (block.type === "code")
    return {
      type: "codeBlock",
      attrs: { blockId: id, language: attrs.language ?? null },
      content: inlineText(value),
    };
  if (block.type === "table") {
    const rows = Array.isArray(block.rows)
      ? block.rows.flatMap((row) =>
          Array.isArray(row) ? [row.map((cell) => String(cell ?? ""))] : [],
        )
      : value
          .split(/\r?\n/)
          .map((row) => row.split("|").map((cell) => cell.trim()));
    return {
      type: "table",
      attrs: {
        blockId: id,
        ...(attrs.nativeReadOnly === true ? { nativeReadOnly: true } : {}),
      },
      content: (rows.length ? rows : [[""]]).map((row, rowIndex) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          content: [{ type: "paragraph", content: inlineText(cell) }],
        })),
      })),
    };
  }
  return {
    type: "paragraph",
    attrs: { blockId: id },
    content: inlineText(value),
  };
}

export function documentNodeText(node) {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (node.type === "inlineEquation" || node.type === "equation")
    return String(node.attrs?.latex ?? "");
  if (node.type === "nativeDocxImage") return String(node.attrs?.alt ?? "");
  const separator = node.type === "listItem" ? "" : "\n";
  return (node.content ?? []).map(documentNodeText).join(separator);
}

function appendRichInline(output, item) {
  const previous = output.at(-1);
  if (item.kind === "text" && previous?.kind === "text") {
    previous.text += item.text;
    return;
  }
  output.push(item);
}

function imageFromJsonNode(node) {
  const attrs = record(node.attrs);
  const partName = attrs.partName;
  const mediaType = attrs.mediaType;
  if (
    typeof partName !== "string" ||
    !/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u.test(partName) ||
    (mediaType !== "image/png" && mediaType !== "image/jpeg")
  )
    return null;
  const widthEmu = Number(attrs.widthEmu);
  const heightEmu = Number(attrs.heightEmu);
  const altText = String(attrs.alt ?? "Word image").slice(0, 4_000);
  return {
    kind: "image",
    partName,
    mediaType,
    altText,
    ...(Number.isSafeInteger(widthEmu) && widthEmu > 0 ? { widthEmu } : {}),
    ...(Number.isSafeInteger(heightEmu) && heightEmu > 0 ? { heightEmu } : {}),
    placement: attrs.placement === "anchored" ? "anchored" : "inline",
  };
}

export function documentRichInlineFromJson(node) {
  const output = [];
  const visit = (current) => {
    if (typeof current?.text === "string") {
      if (current.text)
        appendRichInline(output, { kind: "text", text: current.text });
      return;
    }
    if (current?.type === "inlineEquation" || current?.type === "equation") {
      appendRichInline(output, {
        kind: "equation",
        latex: String(current.attrs?.latex ?? ""),
        display: current.type === "equation" ? "block" : "inline",
      });
      return;
    }
    if (current?.type === "nativeDocxImage") {
      const image = imageFromJsonNode(current);
      if (image) appendRichInline(output, image);
      return;
    }
    const children = Array.isArray(current?.content) ? current.content : [];
    children.forEach((child, index) => {
      if (
        index > 0 &&
        ["paragraph", "heading"].includes(child?.type ?? "") &&
        output.length
      )
        appendRichInline(output, { kind: "text", text: "\n" });
      visit(child);
    });
  };
  visit(node);
  return output;
}

function tableRows(node) {
  return (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => documentNodeText(cell).trim()),
  );
}

function tableRichRows(node) {
  return (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => documentRichInlineFromJson(cell)),
  );
}

export function documentBlocksFromJson(json) {
  const seen = new Set();
  return (json?.content ?? []).map((node, index) => {
    let id =
      typeof node?.attrs?.blockId === "string" && node.attrs.blockId
        ? node.attrs.blockId
        : `block-${index + 1}`;
    if (seen.has(id)) {
      const base = id;
      let suffix = 2;
      while (seen.has(`${base}~${suffix}`)) suffix += 1;
      id = `${base}~${suffix}`;
    }
    seen.add(id);

    if (node?.type === "table") {
      const rows = tableRows(node);
      const richRows = tableRichRows(node);
      return {
        id,
        type: "table",
        text: rows.map((row) => row.join(" | ")).join("\n"),
        rows,
        ...(richRows.some((row) => row.some(richInlineHasObject))
          ? { richRows }
          : {}),
        ...(node.attrs?.nativeReadOnly === true
          ? { attrs: { nativeReadOnly: true } }
          : {}),
      };
    }

    const inlineContent = documentRichInlineFromJson(node);
    const hasRichContent = richInlineHasObject(inlineContent);
    const text = (
      hasRichContent ? richInlineText(inlineContent) : documentNodeText(node)
    ).trimEnd();
    if (node?.type === "heading") {
      const level = Number(node.attrs?.level) || 2;
      return {
        id,
        type: "heading",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
        attrs: {
          level,
          styleId: `Heading${level}`,
          ...(node.attrs?.nativeReadOnly === true
            ? { nativeReadOnly: true }
            : {}),
        },
      };
    }
    if (node?.type === "blockquote")
      return {
        id,
        type: "quote",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
      };
    if (node?.type === "bulletList" || node?.type === "orderedList")
      return {
        id,
        type: "list",
        text,
        ...(hasRichContent ? { inlineContent } : {}),
        ...(node.attrs?.nativeReadOnly === true
          ? { attrs: { nativeReadOnly: true } }
          : {}),
      };
    if (node?.type === "callout")
      return {
        id,
        type: "callout",
        text,
        attrs: { tone: node.attrs?.type ?? node.attrs?.tone ?? "info" },
      };
    if (node?.type === "equation") {
      const latex = String(node.attrs?.latex ?? "");
      return {
        id,
        type: "equation",
        text: latex,
        latex,
        inlineContent: [{ kind: "equation", latex, display: "block" }],
        attrs: {
          display: node.attrs?.display ?? "block",
          alignment: node.attrs?.alignment ?? "center",
          ...(node.attrs?.nativeReadOnly === true
            ? { nativeReadOnly: true }
            : {}),
        },
      };
    }
    if (node?.type === "codeBlock")
      return {
        id,
        type: "code",
        text,
        attrs: { language: node.attrs?.language ?? undefined },
      };
    if (node?.type === "spectraReference")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Referenced work"),
        reference: node.attrs,
      };
    if (node?.type === "spectraCitation")
      return {
        id,
        type: "paragraph",
        text: String(node.attrs?.label ?? "Citation"),
        citation: node.attrs,
      };
    return {
      id,
      type: "paragraph",
      text,
      ...(hasRichContent ? { inlineContent } : {}),
      ...(node?.attrs?.nativeReadOnly === true
        ? { attrs: { nativeReadOnly: true } }
        : {}),
    };
  });
}

export function documentContentToProseMirrorJson(contentValue) {
  const content = record(contentValue);
  const existing = record(content.tiptap);
  const blocks = Array.isArray(content.blocks)
    ? content.blocks.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  if (existing.type === "doc") {
    const byId = new Map(
      blocks.flatMap((block) =>
        typeof block.id === "string" && block.id ? [[block.id, block]] : [],
      ),
    );
    const existingContent = Array.isArray(existing.content)
      ? existing.content
      : [];
    return {
      ...existing,
      content: existingContent.map((node) => {
        const blockId = node?.attrs?.blockId;
        const block =
          typeof blockId === "string" ? byId.get(blockId) : undefined;
        const attrs = record(block?.attrs);
        const richNode = block
          ? docxRichBlockToJson(block, content.nativeBinding)
          : null;
        if (richNode)
          return {
            ...richNode,
            attrs: { ...node.attrs, ...richNode.attrs },
          };
        if (attrs.nativeReadOnly === true)
          return {
            ...node,
            attrs: { ...node.attrs, nativeReadOnly: true },
          };
        if (block?.type === "table") {
          const rebuilt = blockToJson(block, 0, content.nativeBinding);
          return { ...rebuilt, attrs: { ...node.attrs, ...rebuilt.attrs } };
        }
        if (
          typeof block?.text === "string" &&
          block.text !== documentNodeText(node).trimEnd()
        ) {
          const rebuilt = blockToJson(block, 0, content.nativeBinding);
          return { ...rebuilt, attrs: { ...node.attrs, ...rebuilt.attrs } };
        }
        const styleId = typeof attrs.styleId === "string" ? attrs.styleId : "";
        const headingLevel = Number(
          styleId.match(/^Heading([1-3])$/i)?.[1] ?? 0,
        );
        if (
          headingLevel &&
          (node?.type === "paragraph" || node?.type === "heading")
        )
          return {
            ...node,
            type: "heading",
            attrs: {
              ...node.attrs,
              level: headingLevel,
              ...(attrs.nativeReadOnly === true
                ? { nativeReadOnly: true }
                : {}),
            },
          };
        return node;
      }),
    };
  }
  return {
    type: "doc",
    content: (blocks.length
      ? blocks
      : [{ id: "intro", type: "paragraph", text: "" }]
    ).map((block, index) => blockToJson(block, index, content.nativeBinding)),
  };
}
