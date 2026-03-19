import type { GeneratedDocument, PresentationSlide } from "@/lib/document-generator";

type ExportTemplate = {
  id: "studio" | "summit" | "horizon";
  label: string;
  primary: string;
  secondary: string;
  background: string;
  paper: string;
  ink: string;
  muted: string;
};

const EXPORT_TEMPLATES: Record<ExportTemplate["id"], ExportTemplate> = {
  studio: {
    id: "studio",
    label: "Studio",
    primary: "0F766E",
    secondary: "0EA5E9",
    background: "F4F6F8",
    paper: "FFFFFF",
    ink: "0F172A",
    muted: "475569",
  },
  summit: {
    id: "summit",
    label: "Summit",
    primary: "1E3A8A",
    secondary: "7C3AED",
    background: "F3F5FB",
    paper: "FFFFFF",
    ink: "111827",
    muted: "4B5563",
  },
  horizon: {
    id: "horizon",
    label: "Horizon",
    primary: "9A3412",
    secondary: "0F766E",
    background: "FBF7F2",
    paper: "FFFFFF",
    ink: "1F2937",
    muted: "52525B",
  },
};

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickTemplate(documentData: GeneratedDocument): ExportTemplate {
  if (documentData.type === "presentation") return EXPORT_TEMPLATES.summit;
  if (documentData.type === "timeline") return EXPORT_TEMPLATES.horizon;
  return EXPORT_TEMPLATES.studio;
}

function normalizeHex(value: string) {
  return value.replace("#", "").toUpperCase();
}

export function sanitizeArtifactBasename(title: string) {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "ai-school-artifact";
}

export function toneForSlide(slide: PresentationSlide, index: number) {
  return slide.accent || (index % 2 === 0 ? "0F766E" : "1E3A8A");
}

export function toPresentationSlides(documentData: GeneratedDocument): PresentationSlide[] {
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

  if (documentData.type === "comparison_table") {
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

  return [
    {
      layout: "title",
      title: documentData.title,
      body: documentData.summary || "Web deliverable",
    },
    {
      layout: "content",
      title: "Page HTML",
      body: stripHtml(documentData.html).slice(0, 900),
    },
  ];
}

export function documentLines(documentData: GeneratedDocument) {
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

  if (documentData.type === "comparison_table") {
    return [
      documentData.title,
      "",
      documentData.columns.join(" | "),
      ...documentData.rows.map((row) => row.join(" | ")),
    ];
  }

  return [
    documentData.title,
    "",
    stripHtml(documentData.html),
  ];
}

export async function buildDocxBytes(documentData: GeneratedDocument) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");
  const template = pickTemplate(documentData);

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({
      text: documentData.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 220 },
    }),
  ];

  if (documentData.type === "word") {
    for (const section of documentData.sections) {
      children.push(new Paragraph({
        text: section.heading,
        heading: section.level === 1 ? HeadingLevel.HEADING_1 : section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 220, after: 100 },
      }));
      children.push(new Paragraph({ text: section.content, spacing: { after: 120 } }));
    }
  } else if (documentData.type === "study_guide") {
    if (documentData.summary) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Summary", bold: true, color: template.primary }),
            new TextRun({ text: `\n${documentData.summary}` }),
          ],
          spacing: { after: 180 },
        }),
      );
    }
    if (documentData.highlights?.length) {
      children.push(new Paragraph({ text: "Highlights", heading: HeadingLevel.HEADING_2 }));
      for (const highlight of documentData.highlights.slice(0, 8)) {
        children.push(new Paragraph({ text: highlight, bullet: { level: 0 } }));
      }
    }
    for (const section of documentData.sections) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1, spacing: { before: 220 } }));
      children.push(new Paragraph(section.content));
    }
  } else if (documentData.type === "timeline") {
    for (const event of documentData.events) {
      children.push(new Paragraph({
        text: `${event.date} - ${event.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 80 },
      }));
      children.push(new Paragraph({ text: event.detail, spacing: { after: 120 } }));
    }
  } else if (documentData.type === "comparison_table") {
    const header = new TableRow({
      tableHeader: true,
      children: documentData.columns.map((column) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: column, bold: true, color: template.primary })] })],
      })),
    });
    const rows = documentData.rows.map((row) => new TableRow({
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({ text: cell })],
      })),
    }));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [header, ...rows],
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
      },
    }));
  } else if (documentData.type === "webpage") {
    children.push(new Paragraph({
      text: documentData.summary || "Web page export",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }));
    children.push(new Paragraph(stripHtml(documentData.html)));
  } else {
    documentData.slides.forEach((slide, index) => {
      children.push(new Paragraph({
        text: slide.title || `Slide ${index + 1}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 220, after: 90 },
      }));
      if (slide.body) children.push(new Paragraph({ text: slide.body, spacing: { after: 80 } }));
      slide.bullets?.forEach((bullet) => children.push(new Paragraph({ text: bullet, bullet: { level: 0 } })));
    });
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Aptos",
            size: 22,
            color: template.ink,
          },
          paragraph: {
            spacing: {
              line: 320,
            },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Aptos Display",
            size: 52,
            bold: true,
            color: template.primary,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: { after: 240 },
          },
        },
      ],
    },
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

export async function buildPptxBytes(documentData: GeneratedDocument) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const template = pickTemplate(documentData);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Spectra";
  pptx.subject = documentData.title;
  pptx.title = documentData.title;

  const slides = toPresentationSlides(documentData);
  slides.forEach((slide, index) => {
    const page = pptx.addSlide();
    const accent = normalizeHex(toneForSlide(slide, index) || template.primary);
    page.background = { color: template.background };

    page.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.33,
      h: 0.28,
      fill: { color: accent },
      line: { color: accent, pt: 0 },
    });

    page.addShape(pptx.ShapeType.roundRect, {
      x: 0.55,
      y: 0.55,
      w: 0.42,
      h: 6.2,
      rectRadius: 0.08,
      fill: { color: template.secondary },
      line: { color: template.secondary, pt: 0 },
    });

    page.addText(slide.title || documentData.title, {
      x: 1.18,
      y: 0.62,
      w: 11.5,
      h: 0.9,
      fontFace: "Aptos Display",
      fontSize: 30,
      bold: true,
      color: template.ink,
      fit: "resize",
    });

    if (slide.body) {
      page.addText(slide.body, {
        x: 1.18,
        y: 1.65,
        w: 11.2,
        h: 1.25,
        fontFace: "Aptos",
        fontSize: 15,
        color: template.muted,
        valign: "top",
      });
    }

    if (slide.bullets?.length) {
      page.addText(
        slide.bullets.slice(0, 10).map((bullet) => ({ text: bullet, options: { bullet: { indent: 16 } } })),
        {
          x: 1.18,
          y: slide.body ? 2.9 : 1.85,
          w: 11.1,
          h: 3.5,
          fontFace: "Aptos",
          fontSize: 17,
          color: template.ink,
          breakLine: true,
          valign: "top",
        },
      );
    }

    page.addText(`${index + 1} / ${slides.length}`, {
      x: 11.95,
      y: 6.88,
      w: 1.1,
      h: 0.24,
      align: "right",
      fontFace: "Aptos",
      fontSize: 9,
      color: template.muted,
    });

    if (slide.notes) {
      page.addNotes(slide.notes);
    }
  });

  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

export async function buildPdfBytes(documentData: GeneratedDocument) {
  const { jsPDF } = await import("jspdf");
  const template = pickTemplate(documentData);
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  const lines = documentLines(documentData).filter((line, index, source) => line || source[index - 1] || source[index + 1]);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addHeader = () => {
    pdf.setFillColor(`#${template.primary}`);
    pdf.rect(0, 0, pageWidth, 18, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.setTextColor(`#${template.ink}`);
    const titleLines = pdf.splitTextToSize(documentData.title, maxWidth);
    pdf.text(titleLines, margin, 56);
    y = 56 + titleLines.length * 24 + 6;
  };

  addHeader();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(`#${template.muted}`);

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - margin) return;
    pdf.addPage();
    addHeader();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    pdf.setTextColor(`#${template.muted}`);
  };

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    const isHeading = line.endsWith(":") || (/^[A-Z][^.!?]{4,80}$/.test(line) && line.length < 90);
    const isBullet = line.startsWith("- ");
    const clean = isBullet ? line.slice(2).trim() : line;
    const wrapped = clean ? pdf.splitTextToSize(clean, maxWidth - (isBullet ? 16 : 0)) : [""];
    const requiredHeight = Math.max(18, wrapped.length * 15) + (isHeading ? 8 : 0);
    ensureSpace(requiredHeight);

    if (!clean) {
      y += 12;
      continue;
    }

    if (isHeading) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(`#${template.ink}`);
      pdf.text(wrapped, margin, y);
      y += wrapped.length * 17 + 5;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(12);
      pdf.setTextColor(`#${template.muted}`);
      continue;
    }

    if (isBullet) {
      pdf.setFillColor(`#${template.secondary}`);
      pdf.circle(margin + 2.5, y - 3.5, 2.2, "F");
      pdf.text(wrapped, margin + 10, y);
      y += Math.max(18, wrapped.length * 15);
      continue;
    }

    pdf.text(wrapped, margin, y);
    y += Math.max(18, wrapped.length * 15);
  }

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

export function buildHtmlArtifact(documentData: GeneratedDocument) {
  if (documentData.type === "webpage") {
    if (/<!doctype html>/i.test(documentData.html)) {
      return documentData.html;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><title>${documentData.title}</title></head><body>${documentData.html}</body></html>`;
  }

  const template = pickTemplate(documentData);
  const bodySections: string[] = [];
  if (documentData.type === "presentation") {
    bodySections.push(
      ...documentData.slides.map((slide, index) => `
        <section class="slide">
          <p class="kicker">Slide ${index + 1}</p>
          <h2>${slide.title || `${documentData.title} - Slide ${index + 1}`}</h2>
          ${slide.body ? `<p>${slide.body}</p>` : ""}
          ${(slide.bullets ?? []).length ? `<ul>${(slide.bullets ?? []).map((bullet) => `<li>${bullet}</li>`).join("")}</ul>` : ""}
        </section>
      `),
    );
  } else if (documentData.type === "word") {
    bodySections.push(
      ...documentData.sections.map((section) => `<section><h2>${section.heading}</h2><p>${section.content}</p></section>`),
    );
  } else if (documentData.type === "study_guide") {
    if (documentData.summary) {
      bodySections.push(`<section class="highlight"><h2>Summary</h2><p>${documentData.summary}</p></section>`);
    }
    if ((documentData.highlights ?? []).length > 0) {
      bodySections.push(`<section><h2>Highlights</h2><ul>${(documentData.highlights ?? []).map((item) => `<li>${item}</li>`).join("")}</ul></section>`);
    }
    if ((documentData.terms ?? []).length > 0) {
      bodySections.push(
        `<section><h2>Terms</h2><div class="terms">${
          (documentData.terms ?? [])
            .map((term) => `<article><h3>${term.term}</h3><p>${term.definition}</p></article>`)
            .join("")
        }</div></section>`,
      );
    }
    bodySections.push(
      ...documentData.sections.map((section) => `<section><h2>${section.heading}</h2><p>${section.content}</p></section>`),
    );
  } else if (documentData.type === "timeline") {
    bodySections.push(
      `<section class="timeline">${
        documentData.events
          .map((event) => `<article><time>${event.date}</time><h2>${event.title}</h2><p>${event.detail}</p></article>`)
          .join("")
      }</section>`,
    );
  } else if (documentData.type === "comparison_table") {
    bodySections.push(`
      <section>
        <table>
          <thead><tr>${documentData.columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead>
          <tbody>
            ${documentData.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </section>
    `);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${documentData.title}</title>
  <style>
    :root {
      --ink: #${template.ink};
      --muted: #${template.muted};
      --line: #d6dbe3;
      --bg: #${template.background};
      --panel: #${template.paper};
      --primary: #${template.primary};
      --secondary: #${template.secondary};
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Aptos", "Segoe UI", "Helvetica Neue", sans-serif; background: var(--bg); color: var(--ink); line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 34px 20px 64px; }
    header { border-left: 8px solid var(--primary); padding: 6px 0 6px 14px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 2.1rem; letter-spacing: -0.01em; }
    h2 { margin: 0 0 8px; font-size: 1.24rem; }
    h3 { margin: 0 0 4px; font-size: 1rem; }
    p { margin: 0 0 12px; color: var(--muted); }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; margin-bottom: 14px; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06); }
    section.highlight { border-color: color-mix(in oklab, var(--secondary) 34%, var(--line)); background: color-mix(in oklab, var(--secondary) 8%, var(--panel)); }
    section.slide { border-left: 6px solid var(--primary); }
    .kicker { margin: 0 0 5px; font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--primary); font-weight: 700; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    th, td { border: 1px solid var(--line); text-align: left; padding: 8px 10px; }
    th { background: color-mix(in oklab, var(--primary) 8%, white); }
    .terms { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .terms article { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: color-mix(in oklab, var(--secondary) 6%, white); }
    .timeline { border-left: 0; padding: 0; background: transparent; border: 0; box-shadow: none; }
    .timeline article { border: 1px solid var(--line); border-left: 4px solid var(--secondary); border-radius: 12px; background: var(--panel); padding: 12px 14px; margin-bottom: 10px; }
    .timeline time { display: block; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--primary); font-weight: 700; margin-bottom: 4px; }
  </style>
</head>
<body>
  <main>
    <header><h1>${documentData.title}</h1></header>
    ${bodySections.join("\n")}
  </main>
</body>
</html>`;
}

export function buildHtmlBytes(documentData: GeneratedDocument) {
  return new TextEncoder().encode(buildHtmlArtifact(documentData));
}
