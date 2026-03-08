import { convexMutation } from "@/lib/convex-server";
import { parseGeneratedDocument, type GeneratedDocument, type PresentationSlide } from "@/lib/document-generator";

type PersistedArtifact = {
  filename: string;
  mimeType: string;
  resourceId: string;
  downloadUrl: string;
};

function sanitizeArtifactBasename(title: string) {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "ai-school-artifact";
}

function toneForSlide(slide: PresentationSlide, index: number) {
  return slide.accent || (index % 2 === 0 ? "0F766E" : "0F172A");
}

function toPresentationSlides(documentData: GeneratedDocument): PresentationSlide[] {
  if (documentData.type === "presentation") {
    return documentData.slides;
  }

  if (documentData.type === "word") {
    return documentData.sections.map((section, index) => ({
      layout: index === 0 ? "title" : "content",
      title: section.heading,
      body: section.content,
    }));
  }

  if (documentData.type === "study_guide") {
    return [
      {
        layout: "title",
        title: documentData.title,
        body: documentData.summary,
        bullets: documentData.highlights?.slice(0, 5),
      },
      ...documentData.sections.map((section) => ({
        layout: "content" as const,
        title: section.heading,
        body: section.content,
      })),
    ];
  }

  if (documentData.type === "timeline") {
    return [
      {
        layout: "title",
        title: documentData.title,
        body: "Timeline overview",
      },
      ...documentData.events.map((event) => ({
        layout: "content" as const,
        title: `${event.date} - ${event.title}`,
        body: event.detail,
      })),
    ];
  }

  return [
    {
      layout: "title",
      title: documentData.title,
      body: documentData.columns.join(" | "),
    },
    ...documentData.rows.map((row, index) => ({
      layout: "content" as const,
      title: `Row ${index + 1}`,
      bullets: row.map((cell, cellIndex) => `${documentData.columns[cellIndex] || `Column ${cellIndex + 1}`}: ${cell}`),
    })),
  ];
}

function documentLines(documentData: GeneratedDocument) {
  if (documentData.type === "presentation") {
    return documentData.slides.flatMap((slide, index) => [
      index === 0 ? documentData.title : "",
      slide.title || `Slide ${index + 1}`,
      slide.body || "",
      ...(slide.bullets ?? []).map((bullet) => `- ${bullet}`),
      "",
    ]);
  }

  if (documentData.type === "word") {
    return [
      documentData.title,
      "",
      ...documentData.sections.flatMap((section) => [section.heading, section.content, ""]),
    ];
  }

  if (documentData.type === "study_guide") {
    return [
      documentData.title,
      documentData.summary || "",
      "",
      ...(documentData.highlights ?? []).map((highlight) => `- ${highlight}`),
      "",
      ...documentData.sections.flatMap((section) => [section.heading, section.content, ""]),
    ];
  }

  if (documentData.type === "timeline") {
    return [
      documentData.title,
      "",
      ...documentData.events.flatMap((event) => [`${event.date} - ${event.title}`, event.detail, ""]),
    ];
  }

  return [
    documentData.title,
    "",
    documentData.columns.join(" | "),
    ...documentData.rows.map((row) => row.join(" | ")),
  ];
}

async function buildDocxBytes(documentData: GeneratedDocument) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");

  const children: Array<InstanceType<typeof Paragraph>> = [
    new Paragraph({
      text: documentData.title,
      heading: HeadingLevel.TITLE,
    }),
  ];

  if (documentData.type === "word") {
    for (const section of documentData.sections) {
      children.push(new Paragraph({
        text: section.heading,
        heading: section.level === 1 ? HeadingLevel.HEADING_1 : section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      }));
      children.push(new Paragraph(section.content));
    }
  } else if (documentData.type === "study_guide") {
    if (documentData.summary) {
      children.push(new Paragraph({
        children: [new TextRun({ text: documentData.summary })],
      }));
    }
    for (const section of documentData.sections) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph(section.content));
    }
  } else if (documentData.type === "timeline") {
    for (const event of documentData.events) {
      children.push(new Paragraph({ text: `${event.date} - ${event.title}`, heading: HeadingLevel.HEADING_2 }));
      children.push(new Paragraph(event.detail));
    }
  } else if (documentData.type === "comparison_table") {
    documentData.rows.forEach((row, index) => {
      children.push(new Paragraph({ text: `Row ${index + 1}`, heading: HeadingLevel.HEADING_2 }));
      row.forEach((cell, cellIndex) => {
        children.push(new Paragraph(`${documentData.columns[cellIndex] || `Column ${cellIndex + 1}`}: ${cell}`));
      });
    });
  } else {
    documentData.slides.forEach((slide, index) => {
      children.push(new Paragraph({ text: slide.title || `Slide ${index + 1}`, heading: HeadingLevel.HEADING_1 }));
      if (slide.body) children.push(new Paragraph(slide.body));
      slide.bullets?.forEach((bullet) => children.push(new Paragraph({ text: bullet, bullet: { level: 0 } })));
    });
  }

  const doc = new Document({
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

async function buildPptxBytes(documentData: GeneratedDocument) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI School";
  pptx.subject = documentData.title;
  pptx.title = documentData.title;

  const slides = toPresentationSlides(documentData);
  slides.forEach((slide, index) => {
    const page = pptx.addSlide();
    const accent = toneForSlide(slide, index).replace("#", "");
    page.background = { color: "F7F4EC" };
    page.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.3, w: 0.18, h: 6.7, fill: { color: accent } });
    page.addText(slide.title || documentData.title, {
      x: 1.0,
      y: 0.5,
      w: 11.5,
      h: 0.8,
      fontFace: "Aptos Display",
      fontSize: 22,
      bold: true,
      color: "1E1E1A",
    });
    if (slide.body) {
      page.addText(slide.body, {
        x: 1.0,
        y: 1.4,
        w: 11.0,
        h: 1.1,
        fontFace: "Aptos",
        fontSize: 13,
        color: "3E4A52",
      });
    }
    if (slide.bullets?.length) {
      page.addText(
        slide.bullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 14 } } })),
        {
          x: 1.0,
          y: slide.body ? 2.5 : 1.6,
          w: 10.8,
          h: 3.4,
          fontFace: "Aptos",
          fontSize: 16,
          color: "1E1E1A",
          breakLine: true,
        },
      );
    }
    if (slide.notes) {
      page.addNotes(slide.notes);
    }
  });

  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

async function buildPdfBytes(documentData: GeneratedDocument) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  const lines = documentLines(documentData).filter((line, index, source) => line || source[index - 1] || source[index + 1]);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  const titleLines = pdf.splitTextToSize(documentData.title, maxWidth);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 24 + 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    const wrapped = line ? pdf.splitTextToSize(line, maxWidth) : [""];
    const requiredHeight = Math.max(18, wrapped.length * 16);
    if (y + requiredHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    if (line) {
      pdf.text(wrapped, margin, y);
    }
    y += requiredHeight;
  }

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

async function uploadArtifact(params: {
  actorClerkId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const uploadUrl = await convexMutation("resources:createUploadUrl", {
    actorClerkId: params.actorClerkId,
    scope: "personal",
    ignorePersonalLimit: true,
  }) as string;

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": params.mimeType,
    },
    body: Uint8Array.from(params.bytes),
  });

  if (!uploadResponse.ok) {
    throw new Error(`Artifact upload failed: ${await uploadResponse.text()}`);
  }

  const uploadPayload = (await uploadResponse.json()) as { storageId?: string };
  if (!uploadPayload.storageId) {
    throw new Error("Artifact upload did not return storageId");
  }

  const registered = await convexMutation("resources:registerResource", {
    actorClerkId: params.actorClerkId,
    scope: "personal",
    filename: params.filename,
    mimeType: params.mimeType,
    size: params.bytes.byteLength,
    storageId: uploadPayload.storageId,
    saveToLibrary: false,
  }) as { resourceId: string };

  await convexMutation("resources:finalizeGeneratedResource", {
    actorClerkId: params.actorClerkId,
    resourceId: registered.resourceId,
    parsedCharCount: 0,
  });

  return {
    filename: params.filename,
    mimeType: params.mimeType,
    resourceId: registered.resourceId,
    downloadUrl: `/api/resources/${registered.resourceId}/download`,
  } satisfies PersistedArtifact;
}

export async function generateArtifactResources(params: {
  actorClerkId: string;
  content: string;
}) {
  const parsed = parseGeneratedDocument(params.content);
  if (!parsed.document) {
    return {
      attachments: [] as string[],
      attachmentResourceIds: [] as string[],
      markdownBlock: "",
    };
  }

  const basename = sanitizeArtifactBasename(parsed.document.title);
  const uploads: PersistedArtifact[] = [];

  const docxBytes = await buildDocxBytes(parsed.document);
  uploads.push(await uploadArtifact({
    actorClerkId: params.actorClerkId,
    filename: `${basename}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: docxBytes,
  }));

  const pdfBytes = await buildPdfBytes(parsed.document);
  uploads.push(await uploadArtifact({
    actorClerkId: params.actorClerkId,
    filename: `${basename}.pdf`,
    mimeType: "application/pdf",
    bytes: pdfBytes,
  }));

  const pptxBytes = await buildPptxBytes(parsed.document);
  uploads.push(await uploadArtifact({
    actorClerkId: params.actorClerkId,
    filename: `${basename}.pptx`,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: pptxBytes,
  }));

  return {
    attachments: uploads.map((artifact) => artifact.filename),
    attachmentResourceIds: uploads.map((artifact) => artifact.resourceId),
    markdownBlock: uploads.length > 0
      ? ["## Downloads", ...uploads.map((artifact) => `- [${artifact.filename}](${artifact.downloadUrl})`)].join("\n")
      : "",
  };
}
