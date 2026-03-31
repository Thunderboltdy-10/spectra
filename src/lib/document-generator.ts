export type PresentationSlide = {
  layout: "title" | "content" | "two-column" | "image" | "blank";
  title?: string;
  body?: string;
  bullets?: string[];
  notes?: string;
  accent?: string;
};

export type WordSection = {
  heading: string;
  level: 1 | 2 | 3;
  content: string;
};

export type StudyGuideTerm = {
  term: string;
  definition: string;
};

export type TimelineEvent = {
  date: string;
  title: string;
  detail: string;
};

export type ComparisonTable = {
  columns: string[];
  rows: string[][];
};

export type GeneratedDocument =
  | {
      type: "presentation";
      title: string;
      slides: PresentationSlide[];
    }
  | {
      type: "word";
      title: string;
      sections: WordSection[];
    }
  | {
      type: "study_guide";
      title: string;
      summary?: string;
      highlights?: string[];
      terms?: StudyGuideTerm[];
      sections: Array<{ heading: string; content: string }>;
    }
  | {
      type: "timeline";
      title: string;
      events: TimelineEvent[];
    }
  | {
      type: "comparison_table";
      title: string;
      columns: string[];
      rows: string[][];
    }
  | {
      type: "webpage";
      title: string;
      summary?: string;
      html: string;
    };

export type ParsedGeneratedDocument = {
  preamble: string;
  document: GeneratedDocument | null;
  rawJson: string;
};

const DOCUMENT_BLOCK_RE = /<<\s*(?:DOC|DOCUMENT)[_\s]?START\s*>>\s*([\s\S]*?)\s*<<\s*(?:DOC|DOCUMENT)[_\s]?END\s*>>/i;
const DOCUMENT_MARKER_RE = /<<\s*(?:DOC|DOCUMENT)[_\s]?(?:START|END)\s*>>/gi;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

export function parseGeneratedDocument(content: string): ParsedGeneratedDocument {
  const match = content.match(DOCUMENT_BLOCK_RE);
  if (!match) {
    return {
      preamble: content.trim(),
      document: null,
      rawJson: "",
    };
  }

  const rawJson = match[1]?.trim() ?? "";
  const preamble = content.replace(match[0], "").trim();

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const type = asString(parsed.type);
    const title = asString(parsed.title) || "Untitled document";

    if (type === "presentation") {
      const slides: PresentationSlide[] = Array.isArray(parsed.slides)
        ? parsed.slides.reduce<PresentationSlide[]>((acc, slide) => {
            const item = slide as Record<string, unknown>;
            const layout = asString(item.layout) as PresentationSlide["layout"];
            if (!["title", "content", "two-column", "image", "blank"].includes(layout)) return acc;
            acc.push({
              layout,
              title: asString(item.title) || undefined,
              body: asString(item.body) || undefined,
              bullets: asStringArray(item.bullets),
              notes: asString(item.notes) || undefined,
              accent: asString(item.accent) || undefined,
            });
            return acc;
          }, [])
        : [];

      return {
        preamble,
        rawJson,
        document: slides.length > 0 ? { type: "presentation", title, slides } : null,
      };
    }

    if (type === "word") {
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .map((section) => {
              const item = section as Record<string, unknown>;
              const heading = asString(item.heading);
              const contentValue = asString(item.content);
              const level = Number(item.level);
              if (!heading || !contentValue || ![1, 2, 3].includes(level)) return null;
              return { heading, content: contentValue, level: level as 1 | 2 | 3 };
            })
            .filter((section): section is WordSection => Boolean(section))
        : [];

      return {
        preamble,
        rawJson,
        document: sections.length > 0 ? { type: "word", title, sections } : null,
      };
    }

    if (type === "study_guide") {
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .map((section) => {
              const item = section as Record<string, unknown>;
              const heading = asString(item.heading);
              const contentValue = asString(item.content);
              if (!heading || !contentValue) return null;
              return { heading, content: contentValue };
            })
            .filter((section): section is { heading: string; content: string } => Boolean(section))
        : [];

      return {
        preamble,
        rawJson,
        document: sections.length > 0
          ? {
              type: "study_guide",
              title,
              summary: asString(parsed.summary),
              highlights: asStringArray(parsed.highlights),
              terms: Array.isArray(parsed.terms)
                ? parsed.terms
                    .map((term) => {
                      const item = term as Record<string, unknown>;
                      const termLabel = asString(item.term);
                      const definition = asString(item.definition);
                      if (!termLabel || !definition) return null;
                      return { term: termLabel, definition };
                    })
                    .filter((term): term is StudyGuideTerm => Boolean(term))
                : [],
              sections,
            }
          : null,
      };
    }

    if (type === "timeline") {
      const events = Array.isArray(parsed.events)
        ? parsed.events
            .map((event) => {
              const item = event as Record<string, unknown>;
              const date = asString(item.date);
              const eventTitle = asString(item.title);
              const detail = asString(item.detail);
              if (!date || !eventTitle || !detail) return null;
              return { date, title: eventTitle, detail };
            })
            .filter((event): event is TimelineEvent => Boolean(event))
        : [];

      return {
        preamble,
        rawJson,
        document: events.length > 0 ? { type: "timeline", title, events } : null,
      };
    }

    if (type === "comparison_table") {
      const columns = asStringArray(parsed.columns);
      const rows = Array.isArray(parsed.rows)
        ? parsed.rows.map((row) => (Array.isArray(row) ? row.map(asString) : [])).filter((row) => row.length > 0)
        : [];

      return {
        preamble,
        rawJson,
        document: columns.length > 0 && rows.length > 0 ? { type: "comparison_table", title, columns, rows } : null,
      };
    }

    if (type === "webpage") {
      const html = typeof parsed.html === "string" ? parsed.html.trim() : "";
      if (!html) {
        return {
          preamble,
          rawJson,
          document: null,
        };
      }
      return {
        preamble,
        rawJson,
        document: {
          type: "webpage",
          title,
          summary: asString(parsed.summary),
          html,
        },
      };
    }
  } catch {
    // Invalid JSON falls through to null document.
  }

  return {
    preamble,
    rawJson,
    document: null,
  };
}

export function isGeneratedDocumentContent(content: string) {
  return DOCUMENT_BLOCK_RE.test(content);
}

export function stripGeneratedDocumentMarkers(content: string) {
  return content.replace(DOCUMENT_MARKER_RE, "").trim();
}

export function generatedDocumentToPlainText(document: GeneratedDocument) {
  if (document.type === "presentation") {
    return [
      document.title,
      ...document.slides.flatMap((slide, index) => [
        `Slide ${index + 1}: ${slide.title || document.title}`,
        slide.body || "",
        ...(slide.bullets ?? []),
      ]),
    ].filter(Boolean).join("\n\n");
  }

  if (document.type === "word") {
    return [
      document.title,
      ...document.sections.flatMap((section) => [section.heading, section.content]),
    ].filter(Boolean).join("\n\n");
  }

  if (document.type === "study_guide") {
    return [
      document.title,
      document.summary || "",
      ...(document.highlights ?? []),
      ...(document.terms ?? []).map((term) => `${term.term}: ${term.definition}`),
      ...document.sections.flatMap((section) => [section.heading, section.content]),
    ].filter(Boolean).join("\n\n");
  }

  if (document.type === "timeline") {
    return [
      document.title,
      ...document.events.map((event) => `${event.date} - ${event.title}\n${event.detail}`),
    ].filter(Boolean).join("\n\n");
  }

  if (document.type === "comparison_table") {
    return [
      document.title,
      document.columns.join(" | "),
      ...document.rows.map((row) => row.join(" | ")),
    ].filter(Boolean).join("\n");
  }

  return [document.title, document.summary || ""].filter(Boolean).join("\n\n");
}
